import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Prisma, UsageEventStatus, WalletTransactionType } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma.service';
import { canStartUsageWithEstimatedCost } from './balance-guard';
import { BILLING_FORMULA } from './billing.constants';

export type BillableModel = {
  model: string;
  inputPriceCentsPer1k: number;
  outputPriceCentsPer1k: number;
  modelMultiplier: string;
  groupMultiplier: string;
};

export type BillingPrincipal = {
  userId: string;
  tokenId: string;
};

export type UpstreamBillingTarget = {
  providerId: string;
  upstreamModel: string;
};

export type BillingRecordResult = {
  usageEventId: string;
  walletTransactionId: string | null;
  costCents: number;
  status: UsageEventStatus;
};

type BillingRecordInternalResult = BillingRecordResult & {
  balanceAfterCents: number | null;
  shouldCheckBalanceLow: boolean;
};

type NormalizedUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  metered: boolean;
};

@Injectable()
export class BillingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationsService) private readonly notificationsService: NotificationsService
  ) {}

  async assertCanStartUsage(userId: string, model: BillableModel, estimatedCostCents = 1) {
    if (!this.modelCanCostMoney(model)) {
      return;
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { balanceCents: true }
    });

    if (!wallet || !canStartUsageWithEstimatedCost(wallet.balanceCents, estimatedCostCents)) {
      throw this.insufficientBalance('Insufficient balance');
    }
  }

  async recordCompletedChat(input: {
    requestId: string;
    principal: BillingPrincipal;
    model: BillableModel;
    upstream: UpstreamBillingTarget;
    responseBody: unknown;
  }): Promise<BillingRecordResult> {
    const usage = this.extractUsage(input.responseBody);
    const costCents = usage.metered ? this.calculateCostCents(usage, input.model) : 0;
    const status = usage.metered
      ? costCents > 0
        ? UsageEventStatus.BILLABLE
        : UsageEventStatus.FREE
      : UsageEventStatus.METERING_UNKNOWN;

    return this.createUsageEvent({
      ...input,
      usage,
      costCents,
      status,
      errorCode: null
    });
  }

  async recordMeteringUnknownChat(input: {
    requestId: string;
    principal: BillingPrincipal;
    model: BillableModel;
    upstream: UpstreamBillingTarget;
  }): Promise<BillingRecordResult> {
    return this.createUsageEvent({
      ...input,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        metered: false
      },
      costCents: 0,
      status: UsageEventStatus.METERING_UNKNOWN,
      errorCode: null
    });
  }

  async recordFailedChat(input: {
    requestId: string;
    principal: BillingPrincipal;
    model: BillableModel;
    upstream: UpstreamBillingTarget;
    errorCode: string;
  }): Promise<BillingRecordResult> {
    return this.createUsageEvent({
      ...input,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        metered: false
      },
      costCents: 0,
      status: UsageEventStatus.FAILED,
      errorCode: input.errorCode
    });
  }

  private async createUsageEvent(input: {
    requestId: string;
    principal: BillingPrincipal;
    model: BillableModel;
    upstream: UpstreamBillingTarget;
    usage: NormalizedUsage;
    costCents: number;
    status: UsageEventStatus;
    errorCode: string | null;
  }): Promise<BillingRecordResult> {
    try {
      const result = await this.prisma.$transaction(async (tx): Promise<BillingRecordInternalResult> => {
        const existingEvent = await tx.usageEvent.findUnique({
          where: { requestId: input.requestId },
          include: { walletTransaction: true }
        });

        if (existingEvent) {
          return this.toRecordResult(existingEvent);
        }

        const usageEvent = await tx.usageEvent.create({
          data: {
            requestId: input.requestId,
            userId: input.principal.userId,
            tokenId: input.principal.tokenId,
            upstreamProviderId: input.upstream.providerId,
            model: input.model.model,
            upstreamModel: input.upstream.upstreamModel,
            promptTokens: input.usage.promptTokens,
            completionTokens: input.usage.completionTokens,
            totalTokens: input.usage.totalTokens,
            costCents: input.costCents,
            status: input.status,
            errorCode: input.errorCode,
            priceSnapshot: this.createPriceSnapshot(input)
          }
        });

        if (input.status !== UsageEventStatus.BILLABLE || input.costCents <= 0) {
          return {
            usageEventId: usageEvent.id,
            walletTransactionId: null,
            costCents: usageEvent.costCents,
            status: usageEvent.status,
            balanceAfterCents: null,
            shouldCheckBalanceLow: false
          };
        }

        const now = new Date();
        const walletUpdate = await tx.wallet.updateMany({
          where: {
            userId: input.principal.userId,
            balanceCents: { gte: input.costCents }
          },
          data: {
            balanceCents: { decrement: input.costCents },
            totalSpendCents: { increment: input.costCents },
            version: { increment: 1 },
            updatedAt: now
          }
        });

        if (walletUpdate.count !== 1) {
          throw this.insufficientBalance('Insufficient balance');
        }

        const tokenUpdateCount = await tx.$executeRaw`
          UPDATE "api_tokens"
          SET "used_cents" = "used_cents" + ${input.costCents}, "updated_at" = NOW()
          WHERE "id" = ${input.principal.tokenId}::uuid
            AND "deleted_at" IS NULL
            AND "revoked_at" IS NULL
            AND "status" = 'ACTIVE'
            AND ("quota_cents" IS NULL OR "used_cents" + ${input.costCents} <= "quota_cents")
        `;

        if (tokenUpdateCount !== 1) {
          throw this.insufficientBalance('API token quota exceeded');
        }

        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId: input.principal.userId },
          select: { balanceCents: true }
        });

        const walletTransaction = await tx.walletTransaction.create({
          data: {
            userId: input.principal.userId,
            type: WalletTransactionType.DEBIT,
            amountCents: -input.costCents,
            balanceAfterCents: wallet.balanceCents,
            usageEventId: usageEvent.id,
            idempotencyKey: `usage:${input.requestId}`
          }
        });

        return {
          usageEventId: usageEvent.id,
          walletTransactionId: walletTransaction.id,
          costCents: usageEvent.costCents,
          status: usageEvent.status,
          balanceAfterCents: wallet.balanceCents,
          shouldCheckBalanceLow: true
        };
      });

      if (result.shouldCheckBalanceLow && result.balanceAfterCents !== null) {
        await this.notificationsService
          .sendBalanceLowIfNeeded(input.principal.userId, result.balanceAfterCents)
          .catch((error) => {
            console.warn('balance_low_notification_failed', error instanceof Error ? error.message : 'unknown error');
          });
      }

      return this.toPublicRecordResult(result);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existingEvent = await this.prisma.usageEvent.findUnique({
          where: { requestId: input.requestId },
          include: { walletTransaction: true }
        });

        if (existingEvent) {
          return this.toRecordResult(existingEvent);
        }
      }

      throw error;
    }
  }

  private modelCanCostMoney(model: BillableModel) {
    return model.inputPriceCentsPer1k > 0 || model.outputPriceCentsPer1k > 0;
  }

  private extractUsage(responseBody: unknown): NormalizedUsage {
    if (!responseBody || typeof responseBody !== 'object' || Array.isArray(responseBody)) {
      return this.unmeteredUsage();
    }

    const usage = (responseBody as { usage?: unknown }).usage;
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
      return this.unmeteredUsage();
    }

    const usageRecord = usage as Record<string, unknown>;
    const promptTokens = this.nonNegativeInteger(usageRecord.prompt_tokens ?? usageRecord.input_tokens);
    const completionTokens = this.nonNegativeInteger(usageRecord.completion_tokens ?? usageRecord.output_tokens);
    const totalTokens = this.nonNegativeInteger(usageRecord.total_tokens);
    const hasBillableBreakdown = promptTokens !== null || completionTokens !== null;

    if (!hasBillableBreakdown) {
      return this.unmeteredUsage(totalTokens ?? 0);
    }

    const normalizedPromptTokens = promptTokens ?? 0;
    const normalizedCompletionTokens = completionTokens ?? 0;

    return {
      promptTokens: normalizedPromptTokens,
      completionTokens: normalizedCompletionTokens,
      totalTokens: totalTokens ?? normalizedPromptTokens + normalizedCompletionTokens,
      metered: true
    };
  }

  private calculateCostCents(usage: NormalizedUsage, model: BillableModel) {
    const inputCost = new Prisma.Decimal(usage.promptTokens).mul(model.inputPriceCentsPer1k).div(1000);
    const outputCost = new Prisma.Decimal(usage.completionTokens).mul(model.outputPriceCentsPer1k).div(1000);
    const total = inputCost
      .plus(outputCost)
      .mul(new Prisma.Decimal(model.modelMultiplier))
      .mul(new Prisma.Decimal(model.groupMultiplier))
      .ceil();
    const costCents = Number(total.toString());

    if (!Number.isSafeInteger(costCents) || costCents < 0) {
      throw new Error('Calculated billing cost is outside the safe integer range');
    }

    return costCents;
  }

  private createPriceSnapshot(input: {
    model: BillableModel;
    upstream: UpstreamBillingTarget;
    usage: NormalizedUsage;
    costCents: number;
    status: UsageEventStatus;
    errorCode: string | null;
  }): Prisma.InputJsonObject {
    return {
      model: input.model.model,
      upstreamModel: input.upstream.upstreamModel,
      upstreamProviderId: input.upstream.providerId,
      inputPriceCentsPer1k: input.model.inputPriceCentsPer1k,
      outputPriceCentsPer1k: input.model.outputPriceCentsPer1k,
      modelMultiplier: input.model.modelMultiplier,
      groupMultiplier: input.model.groupMultiplier,
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      totalTokens: input.usage.totalTokens,
      costCents: input.costCents,
      status: input.status,
      errorCode: input.errorCode,
      meteringSource: input.usage.metered ? 'upstream_usage' : 'missing_or_incomplete_usage',
      formula: BILLING_FORMULA
    };
  }

  private unmeteredUsage(totalTokens = 0): NormalizedUsage {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens,
      metered: false
    };
  }

  private nonNegativeInteger(value: unknown) {
    return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
  }

  private insufficientBalance(message: string) {
    return new ForbiddenException({
      code: 'insufficient_balance',
      message
    });
  }

  private toRecordResult(event: {
    id: string;
    costCents: number;
    status: UsageEventStatus;
    walletTransaction: { id: string; balanceAfterCents: number } | null;
  }): BillingRecordInternalResult {
    return {
      usageEventId: event.id,
      walletTransactionId: event.walletTransaction?.id ?? null,
      costCents: event.costCents,
      status: event.status,
      balanceAfterCents: event.walletTransaction?.balanceAfterCents ?? null,
      shouldCheckBalanceLow: false
    };
  }

  private toPublicRecordResult(result: BillingRecordInternalResult): BillingRecordResult {
    return {
      usageEventId: result.usageEventId,
      walletTransactionId: result.walletTransactionId,
      costCents: result.costCents,
      status: result.status
    };
  }

  private isUniqueViolation(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
