import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  Prisma,
  RechargeCodeStatus,
  WalletTransactionType
} from '../generated/prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma.service';

type CreateRechargeCodeInput = {
  amountCents?: unknown;
  count?: unknown;
};

type RedeemRechargeCodeInput = {
  code?: unknown;
};

const CODE_PREFIX = 'RC';
const CODE_BYTES = 16;
const CODE_COLLISION_RETRIES = 5;
const MAX_RECHARGE_AMOUNT_CENTS = 100_000_000;
const MAX_RECHARGE_CODE_COUNT = 100;

@Injectable()
export class RechargeService {
  constructor(private readonly prisma: PrismaService) {}

  async createRechargeCodes(adminUserId: string, body: CreateRechargeCodeInput) {
    const amountCents = this.positiveInt(body.amountCents, 'amountCents', 1, MAX_RECHARGE_AMOUNT_CENTS);
    const count = this.positiveInt(body.count ?? 1, 'count', 1, MAX_RECHARGE_CODE_COUNT);

    const codes = await this.prisma.$transaction(async (tx) => {
      const createdCodes = [];

      for (let index = 0; index < count; index += 1) {
        const createdCode = await this.createSingleCodeWithRetry(tx, adminUserId, amountCents);
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
              amountCents,
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
        status: entry.status.toLowerCase(),
        createdAt: entry.createdAt.toISOString()
      }))
    };
  }

  async listAdminRechargeCodes() {
    const codes = await this.prisma.rechargeCode.findMany({
      include: {
        createdByAdmin: { select: { username: true } },
        usedByUser: { select: { username: true } },
        walletTransaction: { select: { id: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    return {
      items: codes.map((code) => ({
        id: code.id,
        amountCents: code.amountCents,
        status: code.status.toLowerCase(),
        createdBy: code.createdByAdmin.username,
        usedBy: code.usedByUser?.username ?? null,
        usedAt: code.usedAt?.toISOString() ?? null,
        walletTransactionId: code.walletTransaction?.id ?? null,
        createdAt: code.createdAt.toISOString()
      }))
    };
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
          usedAt: usedAt.toISOString()
        },
        wallet: {
          balanceCents: wallet.balanceCents,
          totalSpendCents: wallet.totalSpendCents
        },
        transaction: {
          id: transaction.id,
          amountCents: transaction.amountCents,
          balanceAfterCents: transaction.balanceAfterCents,
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
        rechargeCode: true
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    return {
      items: records.map((record) => ({
        id: record.id,
        rechargeCodeId: record.rechargeCodeId,
        amountCents: record.amountCents,
        balanceAfterCents: record.balanceAfterCents,
        status: record.rechargeCode?.status.toLowerCase() ?? 'unknown',
        createdAt: record.createdAt.toISOString()
      }))
    };
  }

  private async createSingleCodeWithRetry(
    tx: Prisma.TransactionClient,
    adminUserId: string,
    amountCents: number
  ) {
    let lastError: unknown;

    for (let attempt = 0; attempt < CODE_COLLISION_RETRIES; attempt += 1) {
      const plainCode = this.generateRechargeCode();
      const codeHash = this.hashRechargeCode(plainCode);

      try {
        const code = await tx.rechargeCode.create({
          data: {
            codeHash,
            amountCents,
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
    status: RechargeCodeStatus;
    usedByUserId: string | null;
    usedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: code.id,
      amountCents: code.amountCents,
      status: code.status.toLowerCase(),
      usedByUserId: code.usedByUserId,
      usedAt: code.usedAt?.toISOString() ?? null,
      createdAt: code.createdAt.toISOString()
    };
  }

  private generateRechargeCode() {
    return `${CODE_PREFIX}-${randomBytes(CODE_BYTES).toString('hex').toUpperCase()}`;
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
