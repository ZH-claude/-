import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { Prisma, UsageEventStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

type UsageLogQuery = {
  from?: unknown;
  to?: unknown;
  model?: unknown;
  tokenId?: unknown;
  status?: unknown;
  limit?: unknown;
};

type NormalizedUsageLogFilters = {
  from?: Date;
  to?: Date;
  model?: string;
  tokenId?: string;
  status?: UsageEventStatus;
  limit: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_MODEL_LENGTH = 120;
const UNSUPPORTED_MODEL_NAME_CHARACTERS = /[\x00-\x1F\x7F]/;

@Injectable()
export class UsageLogsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listUsageLogs(user: AuthenticatedUser, query: UsageLogQuery) {
    const filters = this.normalizeFilters(query);
    const where = this.buildWhere(user.id, filters);
    const successfulUsageWhere = this.buildSuccessfulUsageWhere(where);

    const [items, total, totals, statusGroups, modelRows, tokenRows] = await this.prisma.$transaction([
      this.prisma.usageEvent.findMany({
        where,
        include: {
          token: {
            select: {
              id: true,
              name: true,
              keyPreview: true
            }
          },
          walletTransaction: {
            select: {
              id: true,
              amountCents: true,
              balanceAfterCents: true,
              createdAt: true
            }
          }
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: filters.limit
      }),
      this.prisma.usageEvent.count({ where }),
      this.prisma.usageEvent.aggregate({
        where: successfulUsageWhere,
        _sum: {
          costCents: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true
        }
      }),
      this.prisma.usageEvent.groupBy({
        by: ['status'],
        where,
        orderBy: { status: 'asc' },
        _count: { _all: true }
      }),
      this.prisma.usageEvent.findMany({
        where: { userId: user.id },
        distinct: ['model'],
        orderBy: { model: 'asc' },
        select: { model: true },
        take: 200
      }),
      this.prisma.usageEvent.findMany({
        where: { userId: user.id },
        distinct: ['tokenId'],
        include: {
          token: {
            select: {
              id: true,
              name: true,
              keyPreview: true
            }
          }
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200
      })
    ]);

    const statusCounts = this.toStatusCounts(statusGroups);
    const successfulRequests = statusCounts.billable + statusCounts.free;
    const failedRequests = statusCounts.failed + statusCounts.metering_unknown;

    return {
      items: items.map((item) => ({
        id: item.id,
        requestId: item.requestId,
        model: item.model,
        promptTokens: item.promptTokens,
        completionTokens: item.completionTokens,
        totalTokens: item.totalTokens,
        costCents: item.costCents,
        status: item.status.toLowerCase(),
        errorCode: item.errorCode,
        createdAt: item.createdAt.toISOString(),
        token: {
          id: item.token.id,
          name: item.token.name,
          keyPreview: item.token.keyPreview
        },
        walletTransaction: item.walletTransaction
          ? {
              id: item.walletTransaction.id,
              amountCents: item.walletTransaction.amountCents,
              balanceAfterCents: item.walletTransaction.balanceAfterCents,
              createdAt: item.walletTransaction.createdAt.toISOString()
            }
          : null
      })),
      summary: {
        total,
        totalRequests: total,
        successfulRequests,
        failedRequests,
        totalCostCents: totals._sum.costCents ?? 0,
        promptTokens: totals._sum.promptTokens ?? 0,
        completionTokens: totals._sum.completionTokens ?? 0,
        totalTokens: totals._sum.totalTokens ?? 0,
        statusCounts
      },
      filters: {
        limit: filters.limit,
        models: modelRows.map((entry) => entry.model),
        tokens: tokenRows.map((entry) => ({
          id: entry.token.id,
          name: entry.token.name,
          keyPreview: entry.token.keyPreview
        }))
      }
    };
  }

  private buildSuccessfulUsageWhere(where: Prisma.UsageEventWhereInput): Prisma.UsageEventWhereInput {
    return {
      AND: [
        where,
        {
          status: {
            in: [UsageEventStatus.BILLABLE, UsageEventStatus.FREE]
          }
        }
      ]
    };
  }

  async getUsageTrace(user: AuthenticatedUser, requestId: string) {
    const normalizedRequestId = this.requiredRequestId(requestId);
    const [usageEvent, requestLog] = await this.prisma.$transaction([
      this.prisma.usageEvent.findFirst({
        where: {
          requestId: normalizedRequestId,
          userId: user.id
        },
        include: {
          token: {
            select: {
              id: true,
              name: true,
              keyPreview: true
            }
          },
          walletTransaction: {
            select: {
              id: true,
              amountCents: true,
              balanceAfterCents: true,
              createdAt: true
            }
          }
        }
      }),
      this.prisma.requestLog.findFirst({
        where: {
          requestId: normalizedRequestId,
          userId: user.id
        }
      })
    ]);

    if (!usageEvent && !requestLog) {
      throw new NotFoundException('request trace not found');
    }

    return {
      requestId: normalizedRequestId,
      usageEvent: usageEvent
        ? {
            id: usageEvent.id,
            model: usageEvent.model,
            promptTokens: usageEvent.promptTokens,
            completionTokens: usageEvent.completionTokens,
            totalTokens: usageEvent.totalTokens,
            costCents: usageEvent.costCents,
            status: usageEvent.status.toLowerCase(),
            errorCode: usageEvent.errorCode,
            createdAt: usageEvent.createdAt.toISOString(),
            token: {
              id: usageEvent.token.id,
              name: usageEvent.token.name,
              keyPreview: usageEvent.token.keyPreview
            },
            walletTransaction: usageEvent.walletTransaction
              ? {
                  id: usageEvent.walletTransaction.id,
                  amountCents: usageEvent.walletTransaction.amountCents,
                  balanceAfterCents: usageEvent.walletTransaction.balanceAfterCents,
                  createdAt: usageEvent.walletTransaction.createdAt.toISOString()
                }
              : null
          }
        : null,
      requestLog: requestLog
        ? {
            id: requestLog.id,
            method: requestLog.method,
            path: requestLog.path,
            model: requestLog.model,
            statusCode: requestLog.statusCode,
            errorCode: requestLog.errorCode,
            latencyMs: requestLog.latencyMs,
            createdAt: requestLog.createdAt.toISOString(),
            completedAt: requestLog.completedAt?.toISOString() ?? null
          }
        : null,
      upstream: requestLog
        ? {
            status: requestLog.upstreamStatus,
            statusCode: requestLog.upstreamStatusCode,
            latencyMs: requestLog.upstreamLatencyMs
          }
        : null,
      trace: {
        hasUsageEvent: Boolean(usageEvent),
        hasWalletTransaction: Boolean(usageEvent?.walletTransaction),
        hasRequestLog: Boolean(requestLog)
      }
    };
  }

  private buildWhere(userId: string, filters: NormalizedUsageLogFilters): Prisma.UsageEventWhereInput {
    return {
      userId,
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {})
            }
          }
        : {}),
      ...(filters.model ? { model: filters.model } : {}),
      ...(filters.tokenId ? { tokenId: filters.tokenId } : {}),
      ...(filters.status ? { status: filters.status } : {})
    };
  }

  private normalizeFilters(query: UsageLogQuery): NormalizedUsageLogFilters {
    const from = this.optionalDate(query.from, 'from');
    const to = this.optionalDate(query.to, 'to');
    if (from && to && from > to) {
      throw new BadRequestException('from must be earlier than to');
    }

    return {
      from,
      to,
      model: this.optionalModel(query.model),
      tokenId: this.optionalUuid(query.tokenId, 'tokenId'),
      status: this.optionalStatus(query.status),
      limit: this.optionalLimit(query.limit)
    };
  }

  private requiredRequestId(value: unknown) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,120}$/.test(value)) {
      throw new BadRequestException('requestId must be a valid request id');
    }

    return value;
  }

  private optionalDate(value: unknown, field: string) {
    const raw = this.firstValue(value);
    if (!raw) {
      return undefined;
    }

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO datetime`);
    }

    return date;
  }

  private optionalModel(value: unknown) {
    const model = this.firstValue(value)?.trim();
    if (!model) {
      return undefined;
    }

    if (model.length > MAX_MODEL_LENGTH || UNSUPPORTED_MODEL_NAME_CHARACTERS.test(model)) {
      throw new BadRequestException('model contains unsupported characters');
    }

    return model;
  }

  private optionalUuid(value: unknown, field: string) {
    const raw = this.firstValue(value);
    if (!raw) {
      return undefined;
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }

    return raw;
  }

  private optionalStatus(value: unknown) {
    const raw = this.firstValue(value);
    if (!raw) {
      return undefined;
    }

    const normalized = raw.trim().toUpperCase();
    if (normalized === UsageEventStatus.BILLABLE) {
      return UsageEventStatus.BILLABLE;
    }
    if (normalized === UsageEventStatus.FREE) {
      return UsageEventStatus.FREE;
    }
    if (normalized === UsageEventStatus.FAILED) {
      return UsageEventStatus.FAILED;
    }
    if (normalized === UsageEventStatus.METERING_UNKNOWN) {
      return UsageEventStatus.METERING_UNKNOWN;
    }

    throw new BadRequestException('status must be billable, free, failed, or metering_unknown');
  }

  private optionalLimit(value: unknown) {
    const raw = this.firstValue(value);
    if (!raw) {
      return DEFAULT_LIMIT;
    }

    const numericValue = Number(raw);
    if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > MAX_LIMIT) {
      throw new BadRequestException(`limit must be an integer between 1 and ${MAX_LIMIT}`);
    }

    return numericValue;
  }

  private toStatusCounts(
    groups: Array<{
      status: UsageEventStatus;
      _count?: true | { _all?: number };
    }>
  ) {
    const counts = {
      billable: 0,
      free: 0,
      failed: 0,
      metering_unknown: 0
    };

    for (const group of groups) {
      const count = typeof group._count === 'object' && group._count ? group._count._all ?? 0 : 0;
      counts[group.status.toLowerCase() as keyof typeof counts] = count;
    }

    return counts;
  }

  private firstValue(value: unknown) {
    if (Array.isArray(value)) {
      return typeof value[0] === 'string' ? value[0] : undefined;
    }

    return typeof value === 'string' ? value : undefined;
  }
}
