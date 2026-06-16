import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

type AuditClient = PrismaService | Prisma.TransactionClient;

type RecordSecurityAuditInput = {
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  ipAddress?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  tx?: Prisma.TransactionClient;
};

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|password|tokenhash|token_hash|apikey|api_key|encryptedapikey|encrypted_api_key|secret|connection|string|database_url|redis_url|baseurl|base_url|codehash|code_hash/i;

@Injectable()
export class SecurityAuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(input: RecordSecurityAuditInput) {
    const client: AuditClient = input.tx ?? this.prisma;

    await client.securityAuditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        ipAddress: this.normalizeIp(input.ipAddress),
        metadata:
          input.metadata === undefined || input.metadata === null
            ? Prisma.JsonNull
            : (this.redact(input.metadata) as Prisma.InputJsonValue)
      }
    });
  }

  async listSecurityAuditLogs(options: { page: number; limit: number }) {
    const skip = (options.page - 1) * options.limit;
    const where = {};
    const [items, total] = await Promise.all([
      this.prisma.securityAuditLog.findMany({
        where,
        skip,
        take: options.limit,
        include: {
          actorUser: {
            select: {
              id: true,
              username: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.securityAuditLog.count({ where })
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        action: item.action,
        targetType: item.targetType,
        targetId: item.targetId,
        actor: item.actorUser
          ? {
              id: item.actorUser.id,
              username: item.actorUser.username
            }
          : null,
        ipAddress: item.ipAddress,
        metadata: this.redact(item.metadata),
        createdAt: item.createdAt.toISOString()
      })),
      total,
      page: options.page,
      limit: options.limit
    };
  }

  redact(value: unknown): unknown {
    if (value === null || value === undefined) {
      return null;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.redact(entry));
    }

    if (typeof value === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : this.redact(entry);
      }
      return output;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    return String(value);
  }

  private normalizeIp(value: string | null | undefined) {
    if (!value) {
      return null;
    }

    return value.split(',')[0]?.trim().replace(/^\[|\]$/g, '').replace(/^::ffff:/i, '') || null;
  }
}
