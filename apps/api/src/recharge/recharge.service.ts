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
  count?: unknown;
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
const ORDER_PREFIX = 'PAY';
const ORDER_BYTES = 6;
const ORDER_COLLISION_RETRIES = 5;
const PAYMENT_ORDER_EXPIRES_MINUTES = 15;

@Injectable()
export class RechargeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createRechargeCodes(adminUserId: string, body: CreateRechargeCodeInput) {
    const faceValueCnyCents = this.positiveInt(
      body.amountCnyCents ?? body.amountCents,
      'amountCnyCents',
      1,
      MAX_RECHARGE_FACE_VALUE_CNY_CENTS
    );
    const baseTokenAmount = cnyCentsToBaseTokens(faceValueCnyCents);
    const count = this.positiveInt(body.count ?? 1, 'count', 1, MAX_RECHARGE_CODE_COUNT);

    const codes = await this.prisma.$transaction(async (tx) => {
      const createdCodes = [];

      for (let index = 0; index < count; index += 1) {
        const createdCode = await this.createSingleCodeWithRetry(tx, adminUserId, baseTokenAmount, faceValueCnyCents);
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
              amountCents: baseTokenAmount,
              amountBaseTokens: baseTokenAmount,
              faceValueCnyCents,
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
        amountCents: entry.amountCents,
        amountBaseTokens: entry.amountCents,
        faceValueCnyCents: entry.faceValueCnyCents,
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
        amountCents: code.amountCents,
        amountBaseTokens: code.amountCents,
        faceValueCnyCents: code.faceValueCnyCents,
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

      const wallet = await tx.wallet.update({
        where: { userId: user.id },
        data: {
          balanceCents: { increment: code.amountCents },
          version: { increment: 1 }
        }
      });

      const transaction = await tx.walletTransaction.create({
        data: {
          userId: user.id,
          type: WalletTransactionType.RECHARGE,
          amountCents: code.amountCents,
          balanceAfterCents: wallet.balanceCents,
          rechargeCodeId: code.id,
          idempotencyKey: `recharge:${code.id}`
        }
      });

      return {
        recharge: {
          id: code.id,
          amountCents: code.amountCents,
          amountBaseTokens: code.amountCents,
          faceValueCnyCents: code.faceValueCnyCents,
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
        rechargeCode: true,
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
        amountCents: record.amountCents,
        amountBaseTokens: record.amountCents,
        faceValueCnyCents: record.rechargeCode?.faceValueCnyCents ?? record.paymentOrder?.faceValueCnyCents ?? null,
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
    baseTokenAmount: number,
    faceValueCnyCents: number
  ) {
    let lastError: unknown;

    for (let attempt = 0; attempt < CODE_COLLISION_RETRIES; attempt += 1) {
      const plainCode = this.generateRechargeCode();
      const codeHash = this.hashRechargeCode(plainCode);

      try {
        const code = await tx.rechargeCode.create({
          data: {
            codeHash,
            amountCents: baseTokenAmount,
            faceValueCnyCents,
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
    amountCents: number;
    faceValueCnyCents: number;
    status: RechargeCodeStatus;
    usedByUserId: string | null;
    usedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: code.id,
      amountCents: code.amountCents,
      amountBaseTokens: code.amountCents,
      faceValueCnyCents: code.faceValueCnyCents,
      status: code.status.toLowerCase(),
      usedByUserId: code.usedByUserId,
      usedAt: code.usedAt?.toISOString() ?? null,
      createdAt: code.createdAt.toISOString()
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
