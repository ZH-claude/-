import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  PaymentChannel,
  PaymentOrderStatus,
  Prisma,
  RechargeCodeKind,
  RechargeCodeStatus,
  WalletTransactionType
} from '../generated/prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import {
  baseTokenRechargeRateSnapshot,
  cnyCentsToBaseTokens,
  MAX_RECHARGE_FACE_VALUE_CNY_CENTS
} from '../billing/token-units';
import { PrismaService } from '../prisma.service';

type CreateRechargeCodeInput = {
  amountCnyCents?: unknown;
  amountCents?: unknown;
  codeKind?: unknown;
  count?: unknown;
  kind?: unknown;
  quotaHours?: unknown;
  quotaPeriodDays?: unknown;
  tokenQuota?: unknown;
};

type RedeemRechargeCodeInput = {
  code?: unknown;
};

type CreatePaymentOrderInput = {
  amountCnyCents?: unknown;
  amountCents?: unknown;
  channel?: unknown;
};

type PaymentNotifyInput = Record<string, unknown>;

const CODE_PREFIX = 'RC';
const CODE_BYTES = 16;
const CODE_COLLISION_RETRIES = 5;
const MAX_RECHARGE_CODE_COUNT = 100;
const DEFAULT_VIBE_CODE_QUOTA_HOURS = 5;
const DEFAULT_VIBE_CODE_QUOTA_PERIOD_DAYS = 7;
const DEFAULT_VIBE_CODE_TOKEN_QUOTA = 50_000;
const MAX_VIBE_CODE_TOKEN_QUOTA = 2_147_483_647;
const ORDER_PREFIX = 'PAY';
const ORDER_BYTES = 6;
const ORDER_COLLISION_RETRIES = 5;
const PAYMENT_ORDER_EXPIRES_MINUTES = 15;

@Injectable()
export class RechargeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createRechargeCodes(adminUserId: string, body: CreateRechargeCodeInput) {
    const input = this.parseRechargeCodeInput(body);
    const count = this.positiveInt(body.count ?? 1, 'count', 1, MAX_RECHARGE_CODE_COUNT);

    const codes = await this.prisma.$transaction(async (tx) => {
      const createdCodes = [];

      for (let index = 0; index < count; index += 1) {
        const createdCode = await this.createSingleCodeWithRetry(tx, adminUserId, input);
        createdCodes.push(createdCode);

        await tx.adminAuditLog.create({
          data: {
            adminUserId,
            action: 'recharge_code_created',
            targetType: 'recharge_code',
            targetId: createdCode.id,
            beforeSnapshot: Prisma.JsonNull,
            afterSnapshot: {
              id: createdCode.id,
              kind: createdCode.kind.toLowerCase(),
              amountCents: createdCode.amountCents,
              amountBaseTokens: createdCode.amountCents,
              faceValueCnyCents: createdCode.faceValueCnyCents,
              quotaHours: createdCode.quotaHours,
              quotaPeriodDays: createdCode.quotaPeriodDays,
              tokenQuota: createdCode.tokenQuota,
              rechargeRate: baseTokenRechargeRateSnapshot(),
              status: RechargeCodeStatus.UNUSED.toLowerCase()
            }
          }
        });
      }

      return createdCodes;
    });

    return {
      items: codes.map((entry) => ({
        id: entry.id,
        code: entry.plainCode,
        kind: entry.kind.toLowerCase(),
        amountCents: entry.amountCents,
        amountBaseTokens: entry.amountCents,
        faceValueCnyCents: entry.faceValueCnyCents,
        quotaHours: entry.quotaHours,
        quotaPeriodDays: entry.quotaPeriodDays,
        tokenQuota: entry.tokenQuota,
        vibeCodingPackage: this.toVibeCodingPackage(entry),
        status: entry.status.toLowerCase(),
        createdAt: entry.createdAt.toISOString()
      }))
    };
  }

  async listAdminRechargeCodes() {
    const [codes, statusGroups] = await Promise.all([
      this.prisma.rechargeCode.findMany({
        include: {
          createdByAdmin: { select: { username: true } },
          usedByUser: { select: { username: true } },
          walletTransaction: { select: { id: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 100
      }),
      this.prisma.rechargeCode.groupBy({
        by: ['status'],
        _count: { _all: true }
      })
    ]);
    const statusCounts = Object.fromEntries(
      [RechargeCodeStatus.UNUSED, RechargeCodeStatus.USED, RechargeCodeStatus.DISABLED].map((status) => [
        status.toLowerCase(),
        0
      ])
    ) as Record<Lowercase<RechargeCodeStatus>, number>;
    for (const group of statusGroups) {
      statusCounts[group.status.toLowerCase() as Lowercase<RechargeCodeStatus>] = group._count._all;
    }

    return {
      stats: {
        total: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
        unused: statusCounts.unused,
        used: statusCounts.used,
        disabled: statusCounts.disabled
      },
      items: codes.map((code) => ({
        id: code.id,
        kind: code.kind.toLowerCase(),
        amountCents: code.amountCents,
        amountBaseTokens: code.amountCents,
        faceValueCnyCents: code.faceValueCnyCents,
        quotaHours: code.quotaHours,
        quotaPeriodDays: code.quotaPeriodDays,
        tokenQuota: code.tokenQuota,
        vibeCodingPackage: this.toVibeCodingPackage(code),
        status: code.status.toLowerCase(),
        createdBy: code.createdByAdmin.username,
        usedBy: code.usedByUser?.username ?? null,
        usedAt: code.usedAt?.toISOString() ?? null,
        walletTransactionId: code.walletTransaction?.id ?? null,
        createdAt: code.createdAt.toISOString()
      }))
    };
  }

  async listAdminPaymentOrders() {
    const orders = await this.prisma.paymentOrder.findMany({
      include: {
        user: { select: { username: true } },
        walletTransaction: { select: { id: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    return {
      items: orders.map((order) => ({
        ...this.toPaymentOrder(order),
        username: order.user.username,
        walletTransactionId: order.walletTransaction?.id ?? null
      }))
    };
  }

  async mockConfirmPaymentOrder(adminUserId: string, orderNo: string) {
    return this.confirmPaymentOrderPaid({
      orderNo: this.normalizeOrderNo(orderNo),
      providerTradeNo: `MOCK-${randomBytes(8).toString('hex').toUpperCase()}`,
      providerPayload: {
        source: 'admin_mock',
        confirmedByAdminId: adminUserId,
        confirmedAt: new Date().toISOString()
      },
      adminUserId
    });
  }

  async disableRechargeCode(adminUserId: string, codeId: string) {
    const id = this.requiredUuid(codeId, 'codeId');
    const existing = await this.prisma.rechargeCode.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException('Recharge code not found');
    }

    if (existing.status === RechargeCodeStatus.USED) {
      throw new ConflictException('Recharge code has already been used');
    }

    if (existing.status === RechargeCodeStatus.DISABLED) {
      return this.toAdminRechargeCode(existing);
    }

    const code = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.rechargeCode.updateMany({
        where: {
          id,
          status: RechargeCodeStatus.UNUSED
        },
        data: { status: RechargeCodeStatus.DISABLED }
      });

      if (updateResult.count !== 1) {
        const current = await tx.rechargeCode.findUnique({ where: { id } });

        if (!current) {
          throw new NotFoundException('Recharge code not found');
        }

        if (current.status === RechargeCodeStatus.DISABLED) {
          return current;
        }

        throw new ConflictException('Recharge code has already been used');
      }

      const updated = {
        ...existing,
        status: RechargeCodeStatus.DISABLED
      };

      await tx.adminAuditLog.create({
        data: {
          adminUserId,
          action: 'recharge_code_disabled',
          targetType: 'recharge_code',
          targetId: updated.id,
          beforeSnapshot: {
            status: existing.status.toLowerCase()
          },
          afterSnapshot: {
            status: updated.status.toLowerCase()
          }
        }
      });

      return updated;
    });

    return this.toAdminRechargeCode(code);
  }

  async createPaymentOrder(user: AuthenticatedUser, body: CreatePaymentOrderInput) {
    const channel = this.normalizePaymentChannel(body.channel);
    const faceValueCnyCents = this.positiveInt(
      body.amountCnyCents ?? body.amountCents,
      'amountCnyCents',
      1,
      MAX_RECHARGE_FACE_VALUE_CNY_CENTS
    );
    const baseTokenAmount = cnyCentsToBaseTokens(faceValueCnyCents);
    const expiresAt = new Date(Date.now() + PAYMENT_ORDER_EXPIRES_MINUTES * 60_000);

    const order = await this.createSinglePaymentOrderWithRetry(
      user.id,
      channel,
      faceValueCnyCents,
      baseTokenAmount,
      expiresAt
    );

    return {
      order: this.toPaymentOrder(order)
    };
  }

  async listUserPaymentOrders(user: AuthenticatedUser) {
    const orders = await this.prisma.paymentOrder.findMany({
      where: { userId: user.id },
      include: { walletTransaction: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    return {
      items: orders.map((order) => ({
        ...this.toPaymentOrder(order),
        walletTransactionId: order.walletTransaction?.id ?? null
      }))
    };
  }

  async getUserPaymentOrder(user: AuthenticatedUser, orderNo: string) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const order = await this.prisma.paymentOrder.findFirst({
      where: {
        orderNo: normalizedOrderNo,
        userId: user.id
      },
      include: { walletTransaction: { select: { id: true } } }
    });

    if (!order) {
      throw new NotFoundException('Payment order not found');
    }

    return {
      order: {
        ...this.toPaymentOrder(order),
        walletTransactionId: order.walletTransaction?.id ?? null
      }
    };
  }

  async handleProviderNotify(channelValue: string, body: PaymentNotifyInput) {
    const channel = this.normalizePaymentChannel(channelValue);
    const orderNo = this.extractProviderOrderNo(body);

    return {
      accepted: false,
      code: 'payment_provider_not_configured',
      channel: channel.toLowerCase(),
      orderNo,
      message: 'Alipay/WeChat credentials and signature verification are not configured yet. No balance was credited.'
    };
  }

  async redeemRechargeCode(user: AuthenticatedUser, body: RedeemRechargeCodeInput) {
    const normalizedCode = this.normalizeRechargeCode(body.code);
    const codeHash = this.hashRechargeCode(normalizedCode);
    const usedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      const code = await tx.rechargeCode.findUnique({
        where: { codeHash }
      });

      if (!code) {
        throw new BadRequestException('兑换码无效');
      }

      if (code.status === RechargeCodeStatus.DISABLED) {
        throw new BadRequestException('兑换码已禁用');
      }

      if (code.status === RechargeCodeStatus.USED) {
        throw new ConflictException('兑换码已被使用');
      }

      const codeUpdate = await tx.rechargeCode.updateMany({
        where: {
          id: code.id,
          status: RechargeCodeStatus.UNUSED
        },
        data: {
          status: RechargeCodeStatus.USED,
          usedByUserId: user.id,
          usedAt
        }
      });

      if (codeUpdate.count !== 1) {
        throw new ConflictException('兑换码已被使用');
      }

      const isBalanceCode = code.kind === RechargeCodeKind.BALANCE;
      const wallet = isBalanceCode
        ? await tx.wallet.update({
            where: { userId: user.id },
            data: {
              balanceCents: { increment: code.amountCents },
              version: { increment: 1 }
            }
          })
        : await tx.wallet.findUniqueOrThrow({
            where: { userId: user.id }
          });

      const transaction = await tx.walletTransaction.create({
        data: {
          userId: user.id,
          type: WalletTransactionType.RECHARGE,
          amountCents: isBalanceCode ? code.amountCents : 0,
          balanceAfterCents: wallet.balanceCents,
          rechargeCodeId: code.id,
          idempotencyKey: `recharge:${code.id}`
        }
      });
      const entitlement = isBalanceCode
        ? null
        : await this.createVibeCodingEntitlementFromRechargeCode(tx, {
            userId: user.id,
            rechargeCodeId: code.id,
            quotaHours: code.quotaHours,
            quotaPeriodDays: code.quotaPeriodDays,
            tokenQuota: code.tokenQuota,
            startsAt: usedAt
          });

      return {
        recharge: {
          id: code.id,
          kind: code.kind.toLowerCase(),
          amountCents: code.amountCents,
          amountBaseTokens: code.amountCents,
          faceValueCnyCents: code.faceValueCnyCents,
          quotaHours: code.quotaHours,
          quotaPeriodDays: code.quotaPeriodDays,
          tokenQuota: code.tokenQuota,
          vibeCodingPackage: this.toVibeCodingPackage(code),
          entitlement: entitlement ? this.toVibeCodingEntitlement(entitlement) : null,
          usedAt: usedAt.toISOString()
        },
        wallet: {
          balanceCents: wallet.balanceCents,
          balanceBaseTokens: wallet.balanceCents,
          totalSpendCents: wallet.totalSpendCents
        },
        transaction: {
          id: transaction.id,
          amountCents: transaction.amountCents,
          amountBaseTokens: transaction.amountCents,
          balanceAfterCents: transaction.balanceAfterCents,
          balanceAfterBaseTokens: transaction.balanceAfterCents,
          createdAt: transaction.createdAt.toISOString()
        }
      };
    });
  }

  async listUserRechargeRecords(user: AuthenticatedUser) {
    const records = await this.prisma.walletTransaction.findMany({
      where: {
        userId: user.id,
        type: WalletTransactionType.RECHARGE
      },
      include: {
        rechargeCode: {
          include: {
            vibeCodingEntitlement: true
          }
        },
        paymentOrder: true
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    return {
      items: records.map((record) => ({
        id: record.id,
        rechargeCodeId: record.rechargeCodeId,
        paymentOrderId: record.paymentOrderId,
        paymentOrderNo: record.paymentOrder?.orderNo ?? null,
        paymentChannel: record.paymentOrder?.channel.toLowerCase() ?? null,
        rechargeCodeKind: record.rechargeCode?.kind.toLowerCase() ?? null,
        amountCents: record.amountCents,
        amountBaseTokens: record.amountCents,
        faceValueCnyCents: record.rechargeCode?.faceValueCnyCents ?? record.paymentOrder?.faceValueCnyCents ?? null,
        quotaHours: record.rechargeCode?.quotaHours ?? null,
        quotaPeriodDays: record.rechargeCode?.quotaPeriodDays ?? null,
        tokenQuota: record.rechargeCode?.tokenQuota ?? null,
        vibeCodingPackage: record.rechargeCode ? this.toVibeCodingPackage(record.rechargeCode) : null,
        vibeCodingEntitlement: record.rechargeCode?.vibeCodingEntitlement
          ? this.toVibeCodingEntitlement(record.rechargeCode.vibeCodingEntitlement)
          : null,
        balanceAfterCents: record.balanceAfterCents,
        balanceAfterBaseTokens: record.balanceAfterCents,
        status: record.rechargeCode?.status.toLowerCase() ?? record.paymentOrder?.status.toLowerCase() ?? 'unknown',
        createdAt: record.createdAt.toISOString()
      }))
    };
  }

  private async confirmPaymentOrderPaid(input: {
    orderNo: string;
    providerTradeNo: string;
    providerPayload: Prisma.InputJsonValue;
    adminUserId?: string;
  }) {
    const paidAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.paymentOrder.findUnique({
        where: { orderNo: input.orderNo },
        include: {
          walletTransaction: {
            select: {
              id: true,
              amountCents: true,
              balanceAfterCents: true,
              createdAt: true
            }
          }
        }
      });

      if (!existing) {
        throw new NotFoundException('Payment order not found');
      }

      if (existing.status === PaymentOrderStatus.PAID) {
        const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: existing.userId } });
        return {
          order: existing,
          wallet,
          transaction: existing.walletTransaction
        };
      }

      if (existing.status !== PaymentOrderStatus.PENDING) {
        throw new ConflictException(`Payment order is ${existing.status.toLowerCase()}`);
      }

      if (existing.expiresAt.getTime() <= paidAt.getTime()) {
        throw new ConflictException('Payment order expired');
      }

      const orderUpdate = await tx.paymentOrder.updateMany({
        where: {
          id: existing.id,
          status: PaymentOrderStatus.PENDING
        },
        data: {
          status: PaymentOrderStatus.PAID,
          paidAt,
          providerTradeNo: input.providerTradeNo,
          providerPayload: input.providerPayload
        }
      });

      if (orderUpdate.count !== 1) {
        const current = await tx.paymentOrder.findUniqueOrThrow({
          where: { id: existing.id },
          include: {
            walletTransaction: {
              select: {
                id: true,
                amountCents: true,
                balanceAfterCents: true,
                createdAt: true
              }
            }
          }
        });

        if (current.status === PaymentOrderStatus.PAID) {
          const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: current.userId } });
          return {
            order: current,
            wallet,
            transaction: current.walletTransaction
          };
        }

        throw new ConflictException(`Payment order is ${current.status.toLowerCase()}`);
      }

      const wallet = await tx.wallet.update({
        where: { userId: existing.userId },
        data: {
          balanceCents: { increment: existing.amountCents },
          version: { increment: 1 }
        }
      });

      const transaction = await tx.walletTransaction.create({
        data: {
          userId: existing.userId,
          type: WalletTransactionType.RECHARGE,
          amountCents: existing.amountCents,
          balanceAfterCents: wallet.balanceCents,
          paymentOrderId: existing.id,
          idempotencyKey: `payment:${existing.id}`
        },
        select: {
          id: true,
          amountCents: true,
          balanceAfterCents: true,
          createdAt: true
        }
      });

      if (input.adminUserId) {
        await tx.adminAuditLog.create({
          data: {
            adminUserId: input.adminUserId,
            action: 'payment_order_mock_paid',
            targetType: 'payment_order',
            targetId: existing.id,
            beforeSnapshot: {
              status: existing.status.toLowerCase()
            },
            afterSnapshot: {
              status: PaymentOrderStatus.PAID.toLowerCase(),
              orderNo: existing.orderNo,
              providerTradeNo: input.providerTradeNo,
              amountCents: existing.amountCents,
              amountBaseTokens: existing.amountCents,
              faceValueCnyCents: existing.faceValueCnyCents,
              walletTransactionId: transaction.id
            }
          }
        });
      }

      const order = await tx.paymentOrder.findUniqueOrThrow({
        where: { id: existing.id },
        include: { walletTransaction: { select: { id: true } } }
      });

      return {
        order,
        wallet,
        transaction
      };
    });

    return {
      order: {
        ...this.toPaymentOrder(result.order),
        walletTransactionId: result.order.walletTransaction?.id ?? result.transaction?.id ?? null
      },
      wallet: {
        balanceCents: result.wallet.balanceCents,
        balanceBaseTokens: result.wallet.balanceCents,
        totalSpendCents: result.wallet.totalSpendCents
      },
      transaction: result.transaction
        ? {
            id: result.transaction.id,
            amountCents: result.transaction.amountCents,
            amountBaseTokens: result.transaction.amountCents,
            balanceAfterCents: result.transaction.balanceAfterCents,
            balanceAfterBaseTokens: result.transaction.balanceAfterCents,
            createdAt: result.transaction.createdAt.toISOString()
          }
        : null
    };
  }

  private async createSinglePaymentOrderWithRetry(
    userId: string,
    channel: PaymentChannel,
    faceValueCnyCents: number,
    baseTokenAmount: number,
    expiresAt: Date
  ) {
    let lastError: unknown;

    for (let attempt = 0; attempt < ORDER_COLLISION_RETRIES; attempt += 1) {
      const orderNo = this.generateOrderNo();
      const lowerChannel = channel.toLowerCase();
      const qrCodeContent = `nested-relay-payment://${lowerChannel}/${orderNo}?amountCnyCents=${faceValueCnyCents}`;

      try {
        return await this.prisma.paymentOrder.create({
          data: {
            orderNo,
            userId,
            channel,
            faceValueCnyCents,
            amountCents: baseTokenAmount,
            payUrl: qrCodeContent,
            qrCodeContent,
            expiresAt
          }
        });
      } catch (error) {
        if (!this.isUniqueViolation(error)) {
          throw error;
        }

        lastError = error;
      }
    }

    throw new ConflictException('Payment order number collision, please retry', { cause: lastError });
  }

  private async createSingleCodeWithRetry(
    tx: Prisma.TransactionClient,
    adminUserId: string,
    input: {
      kind: RechargeCodeKind;
      amountCents: number;
      faceValueCnyCents: number;
      quotaHours: number | null;
      quotaPeriodDays: number | null;
      tokenQuota: number | null;
    }
  ) {
    let lastError: unknown;

    for (let attempt = 0; attempt < CODE_COLLISION_RETRIES; attempt += 1) {
      const plainCode = this.generateRechargeCode();
      const codeHash = this.hashRechargeCode(plainCode);

      try {
        const code = await tx.rechargeCode.create({
          data: {
            codeHash,
            kind: input.kind,
            amountCents: input.amountCents,
            faceValueCnyCents: input.faceValueCnyCents,
            quotaHours: input.quotaHours,
            quotaPeriodDays: input.quotaPeriodDays,
            tokenQuota: input.tokenQuota,
            createdByAdminId: adminUserId
          }
        });

        return { ...code, plainCode };
      } catch (error) {
        if (!this.isUniqueViolation(error)) {
          throw error;
        }

        lastError = error;
      }
    }

    throw new ConflictException('兑换码生成冲突，请重试', { cause: lastError });
  }

  private toAdminRechargeCode(code: {
    id: string;
    kind: RechargeCodeKind;
    amountCents: number;
    faceValueCnyCents: number;
    quotaHours: number | null;
    quotaPeriodDays: number | null;
    tokenQuota: number | null;
    status: RechargeCodeStatus;
    usedByUserId: string | null;
    usedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: code.id,
      kind: code.kind.toLowerCase(),
      amountCents: code.amountCents,
      amountBaseTokens: code.amountCents,
      faceValueCnyCents: code.faceValueCnyCents,
      quotaHours: code.quotaHours,
      quotaPeriodDays: code.quotaPeriodDays,
      tokenQuota: code.tokenQuota,
      vibeCodingPackage: this.toVibeCodingPackage(code),
      status: code.status.toLowerCase(),
      usedByUserId: code.usedByUserId,
      usedAt: code.usedAt?.toISOString() ?? null,
      createdAt: code.createdAt.toISOString()
    };
  }

  private parseRechargeCodeInput(body: CreateRechargeCodeInput) {
    const kind = this.normalizeRechargeCodeKind(body.codeKind ?? body.kind ?? 'balance');

    if (kind === RechargeCodeKind.BALANCE) {
      const faceValueCnyCents = this.positiveInt(
        body.amountCnyCents ?? body.amountCents,
        'amountCnyCents',
        1,
        MAX_RECHARGE_FACE_VALUE_CNY_CENTS
      );

      return {
        kind,
        amountCents: cnyCentsToBaseTokens(faceValueCnyCents),
        faceValueCnyCents,
        quotaHours: null,
        quotaPeriodDays: null,
        tokenQuota: null
      };
    }

    const amountInput = body.amountCnyCents ?? body.amountCents;

    return {
      kind,
      amountCents: 0,
      faceValueCnyCents:
        amountInput === undefined || amountInput === null || amountInput === ''
          ? 0
          : this.positiveInt(amountInput, 'amountCnyCents', 0, MAX_RECHARGE_FACE_VALUE_CNY_CENTS),
      quotaHours: this.positiveInt(body.quotaHours ?? DEFAULT_VIBE_CODE_QUOTA_HOURS, 'quotaHours', 1, 100_000),
      quotaPeriodDays: this.positiveInt(
        body.quotaPeriodDays ?? DEFAULT_VIBE_CODE_QUOTA_PERIOD_DAYS,
        'quotaPeriodDays',
        1,
        3_650
      ),
      tokenQuota: this.positiveInt(body.tokenQuota ?? DEFAULT_VIBE_CODE_TOKEN_QUOTA, 'tokenQuota', 1, MAX_VIBE_CODE_TOKEN_QUOTA)
    };
  }

  private normalizeRechargeCodeKind(value: unknown) {
    const kind = typeof value === 'string' ? value.trim().toLowerCase().replace(/-/g, '_') : '';

    if (!kind || kind === 'balance') {
      return RechargeCodeKind.BALANCE;
    }

    if (kind === 'vibe_coding' || kind === 'vibecoding') {
      return RechargeCodeKind.VIBE_CODING;
    }

    throw new BadRequestException('codeKind must be balance or vibe_coding');
  }

  private toVibeCodingPackage(code: {
    kind: RechargeCodeKind;
    quotaHours: number | null;
    quotaPeriodDays: number | null;
    tokenQuota: number | null;
  }) {
    if (code.kind !== RechargeCodeKind.VIBE_CODING) {
      return null;
    }

    return {
      quotaHours: code.quotaHours,
      quotaPeriodDays: code.quotaPeriodDays,
      tokenQuota: code.tokenQuota
    };
  }

  private async createVibeCodingEntitlementFromRechargeCode(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      rechargeCodeId: string;
      quotaHours: number | null;
      quotaPeriodDays: number | null;
      tokenQuota: number | null;
      startsAt: Date;
    }
  ) {
    const quotaHours = this.requiredPositivePackageInt(input.quotaHours, 'quotaHours');
    const quotaPeriodDays = this.requiredPositivePackageInt(input.quotaPeriodDays, 'quotaPeriodDays');
    const tokenQuota = this.requiredPositivePackageInt(input.tokenQuota, 'tokenQuota');

    return tx.vibeCodingEntitlement.create({
      data: {
        userId: input.userId,
        sourceRechargeCodeId: input.rechargeCodeId,
        quotaHours,
        quotaPeriodDays,
        tokenQuota,
        startsAt: input.startsAt,
        expiresAt: this.addDays(input.startsAt, quotaPeriodDays)
      }
    });
  }

  private requiredPositivePackageInt(value: number | null, field: string) {
    if (!Number.isInteger(value) || value === null || value <= 0) {
      throw new BadRequestException(`${field} must be a positive integer for vibe_coding packages`);
    }

    return value;
  }

  private addDays(value: Date, days: number) {
    return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private toVibeCodingEntitlement(entitlement: {
    id: string;
    quotaHours: number;
    quotaPeriodDays: number;
    tokenQuota: number;
    usedTokenQuota: number;
    startsAt: Date;
    expiresAt: Date;
    status: string;
  }) {
    return {
      id: entitlement.id,
      quotaHours: entitlement.quotaHours,
      quotaPeriodDays: entitlement.quotaPeriodDays,
      tokenQuota: entitlement.tokenQuota,
      usedTokenQuota: entitlement.usedTokenQuota,
      startsAt: entitlement.startsAt.toISOString(),
      expiresAt: entitlement.expiresAt.toISOString(),
      status: entitlement.status.toLowerCase()
    };
  }

  private toPaymentOrder(order: {
    id: string;
    orderNo: string;
    channel: PaymentChannel;
    status: PaymentOrderStatus;
    faceValueCnyCents: number;
    amountCents: number;
    providerTradeNo: string | null;
    payUrl: string | null;
    qrCodeContent: string | null;
    expiresAt: Date;
    paidAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: order.id,
      orderNo: order.orderNo,
      channel: order.channel.toLowerCase(),
      status: order.status.toLowerCase(),
      amountCents: order.amountCents,
      amountBaseTokens: order.amountCents,
      faceValueCnyCents: order.faceValueCnyCents,
      providerTradeNo: order.providerTradeNo,
      payUrl: order.payUrl,
      qrCodeContent: order.qrCodeContent,
      expiresAt: order.expiresAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString()
    };
  }

  private generateRechargeCode() {
    return `${CODE_PREFIX}-${randomBytes(CODE_BYTES).toString('hex').toUpperCase()}`;
  }

  private generateOrderNo() {
    return `${ORDER_PREFIX}${Date.now().toString(36).toUpperCase()}${randomBytes(ORDER_BYTES).toString('hex').toUpperCase()}`;
  }

  private normalizePaymentChannel(value: unknown) {
    const channel = typeof value === 'string' ? value.trim().toLowerCase() : '';

    if (channel === 'alipay') {
      return PaymentChannel.ALIPAY;
    }

    if (channel === 'wechat' || channel === 'weixin' || channel === 'wxpay') {
      return PaymentChannel.WECHAT;
    }

    throw new BadRequestException('channel must be alipay or wechat');
  }

  private normalizeOrderNo(value: unknown) {
    if (typeof value !== 'string') {
      throw new BadRequestException('orderNo is required');
    }

    const orderNo = value.trim().toUpperCase();
    if (!/^PAY[A-Z0-9]{12,40}$/.test(orderNo)) {
      throw new BadRequestException('orderNo is invalid');
    }

    return orderNo;
  }

  private extractProviderOrderNo(body: PaymentNotifyInput) {
    const value = body.out_trade_no ?? body.orderNo ?? body.order_no;
    if (typeof value !== 'string') {
      return null;
    }

    try {
      return this.normalizeOrderNo(value);
    } catch {
      return null;
    }
  }

  private normalizeRechargeCode(value: unknown) {
    if (typeof value !== 'string') {
      throw new BadRequestException('兑换码不能为空');
    }

    const code = value.trim().replace(/\s+/g, '').toUpperCase();
    if (!/^RC-[A-F0-9]{32}$/.test(code)) {
      throw new BadRequestException('兑换码无效');
    }

    return code;
  }

  private hashRechargeCode(code: string) {
    return createHash('sha256').update(`recharge-code:${code}`).digest('hex');
  }

  private positiveInt(value: unknown, field: string, min: number, max: number) {
    const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isInteger(numericValue) || numericValue < min || numericValue > max) {
      throw new BadRequestException(`${field} must be an integer between ${min} and ${max}`);
    }

    return numericValue;
  }

  private requiredUuid(value: string, field: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }

    return value;
  }

  private isUniqueViolation(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
