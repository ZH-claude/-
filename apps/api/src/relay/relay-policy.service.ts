import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Prisma, UsageEventStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

type TokenPolicy = {
  id: string;
  rateLimitRequestsPerMinute: number | null;
  modelRateLimitRequestsPerMinute: number | null;
  ipRateLimitRequestsPerMinute: number | null;
  ipWhitelist: string[];
};

type UserPolicy = {
  id: string;
  rateLimitRequestsPerMinute: number | null;
  riskLockedUntil: Date | string | null;
  riskReason: string | null;
};

type RelayPolicyInput = {
  requestId: string;
  user: UserPolicy;
  token: TokenPolicy;
  model: string | null;
  clientIp: string | null;
};

type ScopeCheck = {
  key: string;
  label: 'user' | 'token' | 'model' | 'ip';
  limit: number;
  where: Prisma.RelayRateLimitEventWhereInput;
};

const RATE_WINDOW_MS = 60_000;
const RISK_FAILURE_WINDOW_MS = 5 * 60_000;
const DEFAULT_RISK_FAILURE_THRESHOLD = 20;
const MAX_LIMIT_VALUE = 1_000_000;

@Injectable()
export class RelayPolicyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async assertAllowed(input: RelayPolicyInput) {
    const clientIp = this.normalizeIp(input.clientIp);
    this.assertRiskLock(input.user);
    this.assertIpWhitelist(input.token.ipWhitelist, clientIp);
    await this.assertRecentFailureBreaker(input.user.id);

    const now = new Date();
    const since = new Date(now.getTime() - RATE_WINDOW_MS);
    const checks = this.buildScopeChecks(input, clientIp, since);

    await this.prisma.$transaction(async (tx) => {
      for (const scope of checks.map((check) => check.key).sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}))`;
      }

      for (const check of checks) {
        const current = await tx.relayRateLimitEvent.count({ where: check.where });
        if (current >= check.limit) {
          throw new ForbiddenException({
            code: 'rate_limit_exceeded',
            message: `Rate limit exceeded for ${check.label}`,
            scope: check.label,
            limit: check.limit,
            windowSeconds: RATE_WINDOW_MS / 1000
          });
        }
      }

      await tx.relayRateLimitEvent.create({
        data: {
          requestId: input.requestId,
          userId: input.user.id,
          tokenId: input.token.id,
          model: input.model,
          ipAddress: clientIp
        }
      });
    });
  }

  private buildScopeChecks(input: RelayPolicyInput, clientIp: string | null, since: Date): ScopeCheck[] {
    const userLimit = this.normalizeLimit(input.user.rateLimitRequestsPerMinute);
    const tokenLimit = this.normalizeLimit(input.token.rateLimitRequestsPerMinute);
    const modelLimit = this.normalizeLimit(input.token.modelRateLimitRequestsPerMinute);
    const ipLimit = this.normalizeLimit(input.token.ipRateLimitRequestsPerMinute);
    const checks: ScopeCheck[] = [];

    if (userLimit !== null) {
      checks.push({
        key: `relay:user:${input.user.id}`,
        label: 'user',
        limit: userLimit,
        where: {
          userId: input.user.id,
          createdAt: { gte: since }
        }
      });
    }

    if (tokenLimit !== null) {
      checks.push({
        key: `relay:token:${input.token.id}`,
        label: 'token',
        limit: tokenLimit,
        where: {
          tokenId: input.token.id,
          createdAt: { gte: since }
        }
      });
    }

    if (modelLimit !== null && input.model) {
      checks.push({
        key: `relay:token-model:${input.token.id}:${input.model}`,
        label: 'model',
        limit: modelLimit,
        where: {
          tokenId: input.token.id,
          model: input.model,
          createdAt: { gte: since }
        }
      });
    }

    if (ipLimit !== null) {
      if (!clientIp) {
        throw new ForbiddenException({
          code: 'ip_required',
          message: 'Client IP is required for this API token policy'
        });
      }

      checks.push({
        key: `relay:token-ip:${input.token.id}:${clientIp}`,
        label: 'ip',
        limit: ipLimit,
        where: {
          tokenId: input.token.id,
          ipAddress: clientIp,
          createdAt: { gte: since }
        }
      });
    }

    return checks;
  }

  private assertRiskLock(user: UserPolicy) {
    if (!user.riskLockedUntil) {
      return;
    }

    const lockedUntil = user.riskLockedUntil instanceof Date ? user.riskLockedUntil : new Date(user.riskLockedUntil);
    if (lockedUntil > new Date()) {
      throw new ForbiddenException({
        code: 'risk_limit_exceeded',
        message: user.riskReason ?? 'Account is temporarily locked by risk control',
        lockedUntil: lockedUntil.toISOString()
      });
    }
  }

  private async assertRecentFailureBreaker(userId: string) {
    const threshold = this.getRiskFailureThreshold();
    if (threshold === null) {
      return;
    }

    const failures = await this.prisma.usageEvent.count({
      where: {
        userId,
        status: UsageEventStatus.FAILED,
        createdAt: { gte: new Date(Date.now() - RISK_FAILURE_WINDOW_MS) }
      }
    });

    if (failures >= threshold) {
      throw new ForbiddenException({
        code: 'risk_limit_exceeded',
        message: 'Recent upstream failures exceeded the risk threshold',
        failureCount: failures,
        threshold,
        windowSeconds: RISK_FAILURE_WINDOW_MS / 1000
      });
    }
  }

  private assertIpWhitelist(ipWhitelist: string[], clientIp: string | null) {
    const whitelist = ipWhitelist.map((entry) => this.normalizeIp(entry)).filter((entry): entry is string => Boolean(entry));
    if (whitelist.length === 0) {
      return;
    }

    if (!clientIp || !whitelist.includes(clientIp)) {
      throw new ForbiddenException({
        code: 'ip_not_allowed',
        message: 'Client IP is not allowed for this API token'
      });
    }
  }

  private normalizeLimit(value: number | null | undefined) {
    if (value === undefined || value === null) {
      return null;
    }

    if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT_VALUE) {
      return null;
    }

    return value;
  }

  private getRiskFailureThreshold() {
    const rawValue = process.env.RELAY_RISK_FAILURES_PER_5_MINUTE_LIMIT;
    if (rawValue === undefined || rawValue === '') {
      return DEFAULT_RISK_FAILURE_THRESHOLD;
    }

    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 1) {
      return null;
    }

    return value;
  }

  private normalizeIp(value: string | null | undefined) {
    if (!value) {
      return null;
    }

    const ip = value.split(',')[0]?.trim().replace(/^\[|\]$/g, '').replace(/^::ffff:/i, '') ?? '';
    return ip || null;
  }
}
