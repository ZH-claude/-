import { BadRequestException, ConflictException, Injectable, Inject, NotFoundException, OnModuleInit } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  Prisma,
  Announcement,
  AnnouncementCategory,
  AnnouncementStatus,
  AsyncTaskKind,
  AsyncTaskStatus,
  GroupStatus,
  ModelStatus,
  ModelPricingMode,
  RechargeCodeStatus,
  UpstreamHealthStatus,
  UpstreamProviderKind,
  UpstreamProviderStatus,
  UserRole,
  UserStatus,
  UsageEventStatus,
  WalletTransactionType
} from '../generated/prisma/client';
import {
  calculateRelayUsdPricing,
  deepSeekBaseUsdUnitsPer1k,
  DEFAULT_USD_TO_CNY_RATE,
  type TokenPricingCurrency
} from '../billing/token-pricing';
import { prepareAutoTranslationDrafts } from '../i18n/auto-translate';
import { isSourceFallbackDraftRecord, normalizeTranslations } from '../i18n/localized-content';
import { PrismaService } from '../prisma.service';
import { SecurityAuditService } from '../security-audit/security-audit.service';
import { decryptUpstreamApiKey, encryptUpstreamApiKey, maskUpstreamApiKey } from './upstream-key-crypto';

const UNSUPPORTED_MODEL_NAME_CHARACTERS = /[\x00-\x1F\x7F]/;
const MODEL_PRICE_TRANSLATION_RULES = {
  displayName: 120
};

type ListUsersOptions = {
  page: number;
  limit: number;
};

type UserFinanceMetrics = {
  totalRechargeCents: number;
  rechargeCount: number;
  lastRechargeAt: Date | null;
  spendCents: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  lastUsedAt: Date | null;
};

type ListRequestLogsOptions = ListUsersOptions & {
  status?: string;
  model?: string;
};

type ListImageTasksOptions = ListUsersOptions & {
  status?: string;
  platform?: string;
  model?: string;
};

type ModelConfigurationOptions = {
  upstreamModelsPage: number;
  upstreamModelsLimit: number;
};

type AnnouncementInput = {
  title?: unknown;
  content?: unknown;
  category?: unknown;
  status?: unknown;
  isPinned?: unknown;
  pinned?: unknown;
  scheduledAt?: unknown;
  scheduledPublishAt?: unknown;
  translations?: unknown;
};

type TranslationGlossaryInput = {
  sourceTerm?: unknown;
  replacementTerm?: unknown;
  note?: unknown;
  isActive?: unknown;
};

type PrepareAnnouncementTranslationInput = {
  targetLanguages?: unknown;
  languages?: unknown;
};

const ANNOUNCEMENT_TRANSLATION_RULES = {
  title: 120,
  content: 5000
};
const ANNOUNCEMENT_PREVIEW_LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

type UpstreamProviderInput = {
  name?: unknown;
  kind?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  status?: unknown;
  maxConcurrency?: unknown;
};

type UserGroupInput = {
  code?: unknown;
  name?: unknown;
  multiplier?: unknown;
  status?: unknown;
};

type AssignUserGroupInput = {
  groupId?: unknown;
};

type ModelPriceInput = {
  model?: unknown;
  displayName?: unknown;
  translations?: unknown;
  pricingMode?: unknown;
  inputPriceCentsPer1k?: unknown;
  outputPriceCentsPer1k?: unknown;
  modelMultiplier?: unknown;
  upstreamInputPricePerMillion?: unknown;
  upstreamOutputPricePerMillion?: unknown;
  upstreamCurrency?: unknown;
  upstreamExchangeRate?: unknown;
  marginPercent?: unknown;
  status?: unknown;
  groupIds?: unknown;
};

type ModelPriceRecordForPricing = {
  pricingMode: ModelPricingMode;
  inputPriceCentsPer1k: number;
  outputPriceCentsPer1k: number;
  modelMultiplier: { toString(): string };
  upstreamInputPricePerMillion: { toString(): string } | null;
  upstreamOutputPricePerMillion: { toString(): string } | null;
  upstreamCurrency: string | null;
  upstreamExchangeRate: { toString(): string } | null;
  marginPercent: { toString(): string } | null;
};

type RoutePricingRecordForPricing = {
  pricingMode: ModelPricingMode | null;
  inputPriceCentsPer1k: number | null;
  outputPriceCentsPer1k: number | null;
  modelMultiplier: { toString(): string } | null;
  upstreamInputPricePerMillion: { toString(): string } | null;
  upstreamOutputPricePerMillion: { toString(): string } | null;
  upstreamCurrency: string | null;
  upstreamExchangeRate: { toString(): string } | null;
  marginPercent: { toString(): string } | null;
};

type ResolvedModelPricing = {
  pricingMode: ModelPricingMode;
  inputPriceCentsPer1k: number;
  outputPriceCentsPer1k: number;
  modelMultiplier: string;
  upstreamInputPricePerMillion: string | null;
  upstreamOutputPricePerMillion: string | null;
  upstreamCurrency: TokenPricingCurrency | null;
  upstreamExchangeRate: string | null;
  marginPercent: string | null;
  auditSnapshot: Prisma.InputJsonObject;
};

type UpstreamModelInput = {
  providerId?: unknown;
  publicModel?: unknown;
  upstreamModel?: unknown;
  priority?: unknown;
  timeoutMs?: unknown;
  upstreamPrompt?: unknown;
  pricingMode?: unknown;
  inputPriceCentsPer1k?: unknown;
  outputPriceCentsPer1k?: unknown;
  modelMultiplier?: unknown;
  upstreamInputPricePerMillion?: unknown;
  upstreamOutputPricePerMillion?: unknown;
  upstreamCurrency?: unknown;
  upstreamExchangeRate?: unknown;
  marginPercent?: unknown;
  status?: unknown;
  supportsStream?: unknown;
};

type DailyConsumptionReportOptions = {
  days: number;
  userDailyCostAlertCents?: number;
};

type DailyConsumptionReportRow = {
  date_key: string;
  window_start: string;
  window_end: string;
  call_count: unknown;
  billable_count: unknown;
  free_count: unknown;
  failed_count: unknown;
  metering_unknown_count: unknown;
  spend_cents: unknown;
  prompt_tokens: unknown;
  completion_tokens: unknown;
  total_tokens: unknown;
  active_users: unknown;
  recharge_cents: unknown;
  recharge_count: unknown;
  request_log_count: unknown;
  error_request_count: unknown;
  average_latency_ms: unknown;
  average_upstream_latency_ms: unknown;
};

type DailyUserCostAlertRow = {
  date_key: string;
  user_id: string;
  username: string;
  spend_cents: unknown;
  total_tokens: unknown;
  request_count: unknown;
  last_used_at: Date | null;
};

const PASSWORD_HASH_ROUNDS = 12;
const UPSTREAM_HEALTH_CHECK_TIMEOUT_MS = 8000;
const UPSTREAM_HEALTH_ERROR_MAX_LENGTH = 240;
const UPSTREAM_DNS_LOOKUP_TIMEOUT_MS = 3000;
const MAX_UPSTREAM_PROVIDER_CONCURRENCY = 1_000_000;
const PRIVATE_UPSTREAM_ADDRESS_ERROR = 'Private or local upstream address is not allowed';
const BLOCKED_UPSTREAM_HOSTNAMES = new Set(['localhost', 'host.docker.internal', 'metadata.google.internal']);
const DASHBOARD_RECENT_ALERT_LIMIT = 5;
const DEFAULT_USER_DAILY_COST_ALERT_CENTS = 10000;

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SecurityAuditService) private readonly securityAuditService: SecurityAuditService
  ) {}

  async onModuleInit() {
    await this.bootstrapAdminFromEnv();
  }

  async getDashboardSummary() {
    const generatedAt = new Date();
    const todayStart = this.startOfChinaDay(generatedAt);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const monthStart = this.startOfChinaMonth(generatedAt);
    const last24HoursStart = new Date(generatedAt.getTime() - 24 * 60 * 60 * 1000);
    const userWhere = { deletedAt: null };

    const [
      userGroups,
      newUsersToday,
      newUsersYesterday,
      walletAggregate,
      todayUsageAggregate,
      todayUsageCount,
      todayUsageStatusGroups,
      todayActiveUserGroups,
      todayRechargeAggregate,
      last24RequestCount,
      last24RequestErrorCount,
      last24RequestLatencyAggregate,
      monthNewUsers,
      monthUsageAggregate,
      monthUsageCount,
      monthUsageStatusGroups,
      monthActiveUserGroups,
      monthRechargeAggregate,
      monthRequestCount,
      monthRequestErrorCount,
      monthRequestLatencyAggregate,
      upstreamTotal,
      upstreamStatusGroups,
      upstreamHealthGroups,
      modelStatusGroups,
      upstreamModelStatusGroups,
      rechargeStatusGroups,
      rechargeAggregate,
      totalUsageAggregate,
      totalUsageCount,
      usageUserGroups,
      rechargeUserGroups,
      recentRequestErrors,
      unhealthyUpstreams
    ] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['status', 'role'],
        where: userWhere,
        _count: { _all: true }
      }),
      this.prisma.user.count({
        where: {
          ...userWhere,
          createdAt: { gte: todayStart }
        }
      }),
      this.prisma.user.count({
        where: {
          ...userWhere,
          createdAt: { gte: yesterdayStart, lt: todayStart }
        }
      }),
      this.prisma.wallet.aggregate({
        where: {
          user: userWhere
        },
        _sum: {
          balanceCents: true,
          totalSpendCents: true
        }
      }),
      this.prisma.usageEvent.aggregate({
        where: { createdAt: { gte: todayStart } },
        _sum: {
          costCents: true,
          totalTokens: true
        }
      }),
      this.prisma.usageEvent.count({
        where: { createdAt: { gte: todayStart } }
      }),
      this.prisma.usageEvent.groupBy({
        by: ['status'],
        where: { createdAt: { gte: todayStart } },
        _count: { _all: true }
      }),
      this.prisma.usageEvent.groupBy({
        by: ['userId'],
        where: {
          createdAt: { gte: todayStart },
          totalTokens: { gt: 0 },
          user: userWhere
        },
        _count: { _all: true }
      }),
      this.prisma.walletTransaction.aggregate({
        where: {
          type: WalletTransactionType.RECHARGE,
          rechargeCodeId: { not: null },
          createdAt: { gte: todayStart },
          user: userWhere
        },
        _sum: { amountCents: true },
        _count: { _all: true }
      }),
      this.prisma.requestLog.count({
        where: { createdAt: { gte: last24HoursStart } }
      }),
      this.prisma.requestLog.count({
        where: {
          createdAt: { gte: last24HoursStart },
          OR: [
            { errorCode: { not: null } },
            { statusCode: { gte: 500 } }
          ]
        }
      }),
      this.prisma.requestLog.aggregate({
        where: { createdAt: { gte: last24HoursStart } },
        _avg: {
          latencyMs: true,
          upstreamLatencyMs: true
        }
      }),
      this.prisma.user.count({
        where: {
          ...userWhere,
          createdAt: { gte: monthStart }
        }
      }),
      this.prisma.usageEvent.aggregate({
        where: { createdAt: { gte: monthStart } },
        _sum: {
          costCents: true,
          totalTokens: true
        }
      }),
      this.prisma.usageEvent.count({
        where: { createdAt: { gte: monthStart } }
      }),
      this.prisma.usageEvent.groupBy({
        by: ['status'],
        where: { createdAt: { gte: monthStart } },
        _count: { _all: true }
      }),
      this.prisma.usageEvent.groupBy({
        by: ['userId'],
        where: {
          createdAt: { gte: monthStart },
          totalTokens: { gt: 0 },
          user: userWhere
        },
        _count: { _all: true }
      }),
      this.prisma.walletTransaction.aggregate({
        where: {
          type: WalletTransactionType.RECHARGE,
          rechargeCodeId: { not: null },
          createdAt: { gte: monthStart },
          user: userWhere
        },
        _sum: { amountCents: true },
        _count: { _all: true }
      }),
      this.prisma.requestLog.count({
        where: { createdAt: { gte: monthStart } }
      }),
      this.prisma.requestLog.count({
        where: {
          createdAt: { gte: monthStart },
          OR: [
            { errorCode: { not: null } },
            { statusCode: { gte: 500 } }
          ]
        }
      }),
      this.prisma.requestLog.aggregate({
        where: { createdAt: { gte: monthStart } },
        _avg: {
          latencyMs: true,
          upstreamLatencyMs: true
        }
      }),
      this.prisma.upstreamProvider.count(),
      this.prisma.upstreamProvider.groupBy({
        by: ['status'],
        _count: { _all: true }
      }),
      this.prisma.upstreamProvider.groupBy({
        by: ['healthStatus'],
        _count: { _all: true }
      }),
      this.prisma.modelPrice.groupBy({
        by: ['status'],
        _count: { _all: true }
      }),
      this.prisma.upstreamModel.groupBy({
        by: ['status'],
        _count: { _all: true }
      }),
      this.prisma.rechargeCode.groupBy({
        by: ['status'],
        _count: { _all: true }
      }),
      this.prisma.walletTransaction.aggregate({
        where: {
          type: WalletTransactionType.RECHARGE,
          rechargeCodeId: { not: null },
          user: userWhere
        },
        _sum: { amountCents: true },
        _count: { _all: true }
      }),
      this.prisma.usageEvent.aggregate({
        where: {
          user: userWhere
        },
        _sum: {
          costCents: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true
        }
      }),
      this.prisma.usageEvent.count({
        where: {
          user: userWhere
        }
      }),
      this.prisma.usageEvent.groupBy({
        by: ['userId'],
        where: {
          user: userWhere
        },
        _sum: {
          costCents: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true
        },
        _count: { _all: true },
        _max: { createdAt: true }
      }),
      this.prisma.walletTransaction.groupBy({
        by: ['userId'],
        where: {
          type: WalletTransactionType.RECHARGE,
          rechargeCodeId: { not: null },
          user: userWhere
        },
        _sum: { amountCents: true },
        _count: { _all: true },
        _max: { createdAt: true }
      }),
      this.prisma.requestLog.findMany({
        where: {
          createdAt: { gte: last24HoursStart },
          OR: [
            { errorCode: { not: null } },
            { statusCode: { gte: 500 } }
          ]
        },
        orderBy: { createdAt: 'desc' },
        take: DASHBOARD_RECENT_ALERT_LIMIT,
        select: {
          requestId: true,
          path: true,
          model: true,
          statusCode: true,
          errorCode: true,
          upstreamStatus: true,
          createdAt: true
        }
      }),
      this.prisma.upstreamProvider.findMany({
        where: { healthStatus: UpstreamHealthStatus.UNHEALTHY },
        orderBy: [{ lastHealthCheckAt: 'desc' }, { createdAt: 'desc' }],
        take: DASHBOARD_RECENT_ALERT_LIMIT,
        select: {
          id: true,
          name: true,
          lastHealthCheckAt: true,
          updatedAt: true
        }
      })
    ]);

    const userStatusCounts = this.enumCountMap(userGroups, 'status', [
      UserStatus.ACTIVE,
      UserStatus.DISABLED,
      UserStatus.RISK_LOCKED
    ]);
    const userRoleCounts = this.enumCountMap(userGroups, 'role', [UserRole.USER, UserRole.ADMIN]);
    const upstreamStatusCounts = this.enumCountMap(upstreamStatusGroups, 'status', [
      UpstreamProviderStatus.ACTIVE,
      UpstreamProviderStatus.DISABLED
    ]);
    const upstreamHealthCounts = this.enumCountMap(upstreamHealthGroups, 'healthStatus', [
      UpstreamHealthStatus.HEALTHY,
      UpstreamHealthStatus.UNHEALTHY,
      UpstreamHealthStatus.UNKNOWN
    ]);
    const modelStatusCounts = this.enumCountMap(modelStatusGroups, 'status', [ModelStatus.ACTIVE, ModelStatus.DISABLED]);
    const upstreamModelStatusCounts = this.enumCountMap(upstreamModelStatusGroups, 'status', [
      ModelStatus.ACTIVE,
      ModelStatus.DISABLED
    ]);
    const rechargeStatusCounts = this.enumCountMap(rechargeStatusGroups, 'status', [
      RechargeCodeStatus.UNUSED,
      RechargeCodeStatus.USED,
      RechargeCodeStatus.DISABLED
    ]);
    const usageStatusCounts = this.enumCountMap(todayUsageStatusGroups, 'status', [
      UsageEventStatus.BILLABLE,
      UsageEventStatus.FREE,
      UsageEventStatus.FAILED,
      UsageEventStatus.METERING_UNKNOWN
    ]);
    const monthUsageStatusCounts = this.enumCountMap(monthUsageStatusGroups, 'status', [
      UsageEventStatus.BILLABLE,
      UsageEventStatus.FREE,
      UsageEventStatus.FAILED,
      UsageEventStatus.METERING_UNKNOWN
    ]);
    const modelTotal = Object.values(modelStatusCounts).reduce((sum, count) => sum + count, 0);
    const upstreamModelTotal = Object.values(upstreamModelStatusCounts).reduce((sum, count) => sum + count, 0);
    const rechargeTotal = Object.values(rechargeStatusCounts).reduce((sum, count) => sum + count, 0);
    const dashboardUserMetrics = this.buildUserFinanceMetrics(usageUserGroups, rechargeUserGroups);
    const topUserIds = Array.from(dashboardUserMetrics.entries())
      .sort(([, left], [, right]) => {
        const spendDelta = right.spendCents - left.spendCents;
        if (spendDelta !== 0) {
          return spendDelta;
        }

        const tokenDelta = right.totalTokens - left.totalTokens;
        if (tokenDelta !== 0) {
          return tokenDelta;
        }

        return right.totalRechargeCents - left.totalRechargeCents;
      })
      .slice(0, 10)
      .map(([userId]) => userId);
    const topUsers = topUserIds.length
      ? await this.prisma.user.findMany({
          where: {
            id: { in: topUserIds },
            deletedAt: null,
            role: UserRole.USER
          },
          include: {
            wallet: true
          }
        })
      : [];
    const topUsersById = new Map(topUsers.map((user) => [user.id, user]));
    const recentAlerts = [
      ...recentRequestErrors.map((entry) => ({
        id: `request:${entry.requestId}`,
        type: 'request_error',
        severity: entry.statusCode && entry.statusCode >= 500 ? 'high' : 'medium',
        title: entry.errorCode ?? `HTTP ${entry.statusCode ?? 'error'}`,
        detail: [entry.path, entry.model, entry.upstreamStatus].filter(Boolean).join(' · ') || '请求异常',
        createdAt: entry.createdAt.toISOString()
      })),
      ...unhealthyUpstreams.map((entry) => ({
        id: `upstream:${entry.id}`,
        type: 'upstream_unhealthy',
        severity: 'high',
        title: '上游健康检查失败',
        detail: entry.name,
        createdAt: (entry.lastHealthCheckAt ?? entry.updatedAt).toISOString()
      }))
    ]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, DASHBOARD_RECENT_ALERT_LIMIT);

    return {
      generatedAt: generatedAt.toISOString(),
      window: {
        todayStart: todayStart.toISOString(),
        monthStart: monthStart.toISOString(),
        last24HoursStart: last24HoursStart.toISOString()
      },
      users: {
        total: userGroups.reduce((sum, group) => sum + this.groupCount(group), 0),
        active: userStatusCounts.active,
        disabled: userStatusCounts.disabled,
        riskLocked: userStatusCounts.risk_locked,
        admins: userRoleCounts.admin,
        ordinary: userRoleCounts.user,
        newToday: newUsersToday,
        newYesterday: newUsersYesterday,
        newTodayDelta: newUsersToday - newUsersYesterday
      },
      wallets: {
        totalBalanceCents: walletAggregate._sum.balanceCents ?? 0,
        totalSpendCents: walletAggregate._sum.totalSpendCents ?? 0
      },
      today: {
        callCount: todayUsageCount,
        spendCents: todayUsageAggregate._sum.costCents ?? 0,
        totalTokens: todayUsageAggregate._sum.totalTokens ?? 0,
        activeUsers: todayActiveUserGroups.length,
        rechargeCents: todayRechargeAggregate._sum.amountCents ?? 0,
        rechargeCount: todayRechargeAggregate._count._all ?? 0,
        statusCounts: usageStatusCounts
      },
      performance: {
        windowStart: last24HoursStart.toISOString(),
        requestCount: last24RequestCount,
        errorCount: last24RequestErrorCount,
        errorRatePercent: last24RequestCount > 0 ? Number(((last24RequestErrorCount / last24RequestCount) * 100).toFixed(2)) : 0,
        averageLatencyMs: Math.round(last24RequestLatencyAggregate._avg.latencyMs ?? 0),
        averageUpstreamLatencyMs: Math.round(last24RequestLatencyAggregate._avg.upstreamLatencyMs ?? 0)
      },
      month: {
        windowStart: monthStart.toISOString(),
        newUsers: monthNewUsers,
        callCount: monthUsageCount,
        spendCents: monthUsageAggregate._sum.costCents ?? 0,
        totalTokens: monthUsageAggregate._sum.totalTokens ?? 0,
        activeUsers: monthActiveUserGroups.length,
        rechargeCents: monthRechargeAggregate._sum.amountCents ?? 0,
        rechargeCount: monthRechargeAggregate._count._all ?? 0,
        statusCounts: monthUsageStatusCounts,
        performance: {
          requestCount: monthRequestCount,
          errorCount: monthRequestErrorCount,
          errorRatePercent: monthRequestCount > 0 ? Number(((monthRequestErrorCount / monthRequestCount) * 100).toFixed(2)) : 0,
          averageLatencyMs: Math.round(monthRequestLatencyAggregate._avg.latencyMs ?? 0),
          averageUpstreamLatencyMs: Math.round(monthRequestLatencyAggregate._avg.upstreamLatencyMs ?? 0)
        }
      },
      upstreams: {
        total: upstreamTotal,
        active: upstreamStatusCounts.active,
        disabled: upstreamStatusCounts.disabled,
        health: upstreamHealthCounts
      },
      models: {
        total: modelTotal,
        active: modelStatusCounts.active,
        disabled: modelStatusCounts.disabled,
        upstreamMappings: {
          total: upstreamModelTotal,
          active: upstreamModelStatusCounts.active,
          disabled: upstreamModelStatusCounts.disabled
        }
      },
      rechargeCodes: {
        total: rechargeTotal,
        unused: rechargeStatusCounts.unused,
        used: rechargeStatusCounts.used,
        disabled: rechargeStatusCounts.disabled
      },
      totals: {
        rechargeCents: rechargeAggregate._sum.amountCents ?? 0,
        rechargeCount: rechargeAggregate._count._all ?? 0,
        spendCents: totalUsageAggregate._sum.costCents ?? 0,
        promptTokens: totalUsageAggregate._sum.promptTokens ?? 0,
        completionTokens: totalUsageAggregate._sum.completionTokens ?? 0,
        totalTokens: totalUsageAggregate._sum.totalTokens ?? 0,
        requestCount: totalUsageCount
      },
      topUsers: topUserIds
        .map((userId) => {
          const user = topUsersById.get(userId);
          if (!user) {
            return null;
          }

          return this.toUserStats(user, dashboardUserMetrics.get(userId));
        })
        .filter((user): user is NonNullable<typeof user> => Boolean(user)),
      recentAlerts
    };
  }

  async getDailyConsumptionReport(options: DailyConsumptionReportOptions) {
    const generatedAt = new Date();
    const days = Math.max(1, Math.min(90, Math.floor(options.days)));
    const reportEnd = new Date(this.startOfChinaDay(generatedAt).getTime() + 24 * 60 * 60 * 1000);
    const reportStart = new Date(reportEnd.getTime() - days * 24 * 60 * 60 * 1000);
    const reportStartIso = reportStart.toISOString();
    const reportEndIso = reportEnd.toISOString();
    const userDailyCostAlertCents =
      options.userDailyCostAlertCents ?? this.configuredUserDailyCostAlertCents();

    const dailyRows = await this.prisma.$queryRaw<DailyConsumptionReportRow[]>(Prisma.sql`
      WITH days AS (
        SELECT generate_series(
          ${reportStartIso}::timestamp,
          ${reportEndIso}::timestamp - interval '1 day',
          interval '1 day'
        ) AS bucket_start
      )
      SELECT
        to_char(days.bucket_start + interval '8 hours', 'YYYY-MM-DD') AS date_key,
        to_char(days.bucket_start, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS window_start,
        to_char(days.bucket_start + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS window_end,
        COALESCE(usage.call_count, 0)::bigint AS call_count,
        COALESCE(usage.billable_count, 0)::bigint AS billable_count,
        COALESCE(usage.free_count, 0)::bigint AS free_count,
        COALESCE(usage.failed_count, 0)::bigint AS failed_count,
        COALESCE(usage.metering_unknown_count, 0)::bigint AS metering_unknown_count,
        COALESCE(usage.spend_cents, 0)::bigint AS spend_cents,
        COALESCE(usage.prompt_tokens, 0)::bigint AS prompt_tokens,
        COALESCE(usage.completion_tokens, 0)::bigint AS completion_tokens,
        COALESCE(usage.total_tokens, 0)::bigint AS total_tokens,
        COALESCE(usage.active_users, 0)::bigint AS active_users,
        COALESCE(recharge.recharge_cents, 0)::bigint AS recharge_cents,
        COALESCE(recharge.recharge_count, 0)::bigint AS recharge_count,
        COALESCE(requests.request_log_count, 0)::bigint AS request_log_count,
        COALESCE(requests.error_request_count, 0)::bigint AS error_request_count,
        COALESCE(requests.average_latency_ms, 0)::double precision AS average_latency_ms,
        COALESCE(requests.average_upstream_latency_ms, 0)::double precision AS average_upstream_latency_ms
      FROM days
      LEFT JOIN LATERAL (
        SELECT
          count(*) AS call_count,
          count(*) FILTER (WHERE ue.status = 'BILLABLE') AS billable_count,
          count(*) FILTER (WHERE ue.status = 'FREE') AS free_count,
          count(*) FILTER (WHERE ue.status = 'FAILED') AS failed_count,
          count(*) FILTER (WHERE ue.status = 'METERING_UNKNOWN') AS metering_unknown_count,
          COALESCE(sum(ue.cost_cents), 0) AS spend_cents,
          COALESCE(sum(ue.prompt_tokens), 0) AS prompt_tokens,
          COALESCE(sum(ue.completion_tokens), 0) AS completion_tokens,
          COALESCE(sum(ue.total_tokens), 0) AS total_tokens,
          count(DISTINCT ue.user_id) FILTER (WHERE ue.total_tokens > 0) AS active_users
        FROM usage_events ue
        INNER JOIN users u ON u.id = ue.user_id AND u.deleted_at IS NULL
        WHERE ue.created_at >= days.bucket_start
          AND ue.created_at < days.bucket_start + interval '1 day'
      ) usage ON true
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(sum(wt.amount_cents), 0) AS recharge_cents,
          count(*) AS recharge_count
        FROM wallet_transactions wt
        INNER JOIN users u ON u.id = wt.user_id AND u.deleted_at IS NULL
        WHERE wt.type = 'RECHARGE'
          AND wt.recharge_code_id IS NOT NULL
          AND wt.created_at >= days.bucket_start
          AND wt.created_at < days.bucket_start + interval '1 day'
      ) recharge ON true
      LEFT JOIN LATERAL (
        SELECT
          count(*) AS request_log_count,
          count(*) FILTER (WHERE rl.error_code IS NOT NULL OR COALESCE(rl.status_code, 0) >= 500) AS error_request_count,
          COALESCE(avg(rl.latency_ms), 0) AS average_latency_ms,
          COALESCE(avg(rl.upstream_latency_ms), 0) AS average_upstream_latency_ms
        FROM request_logs rl
        WHERE rl.created_at >= days.bucket_start
          AND rl.created_at < days.bucket_start + interval '1 day'
      ) requests ON true
      ORDER BY days.bucket_start DESC
    `);

    const daysReport = dailyRows.map((row) => {
      const callCount = this.toNumber(row.call_count);
      const requestLogCount = this.toNumber(row.request_log_count);
      const errorRequestCount = this.toNumber(row.error_request_count);

      return {
        date: row.date_key,
        windowStart: row.window_start,
        windowEnd: row.window_end,
        callCount,
        spendCents: this.toNumber(row.spend_cents),
        promptTokens: this.toNumber(row.prompt_tokens),
        completionTokens: this.toNumber(row.completion_tokens),
        totalTokens: this.toNumber(row.total_tokens),
        activeUsers: this.toNumber(row.active_users),
        rechargeCents: this.toNumber(row.recharge_cents),
        rechargeCount: this.toNumber(row.recharge_count),
        requestLogCount,
        errorRequestCount,
        errorRatePercent: requestLogCount > 0 ? Number(((errorRequestCount / requestLogCount) * 100).toFixed(2)) : 0,
        averageLatencyMs: Math.round(this.toNumber(row.average_latency_ms)),
        averageUpstreamLatencyMs: Math.round(this.toNumber(row.average_upstream_latency_ms)),
        statusCounts: {
          billable: this.toNumber(row.billable_count),
          free: this.toNumber(row.free_count),
          failed: this.toNumber(row.failed_count),
          metering_unknown: this.toNumber(row.metering_unknown_count)
        }
      };
    });

    const userCostAlerts = userDailyCostAlertCents > 0
      ? await this.getDailyUserCostAlerts(reportStartIso, reportEndIso, userDailyCostAlertCents)
      : [];

    const totals = daysReport.reduce(
      (sum, day) => ({
        callCount: sum.callCount + day.callCount,
        spendCents: sum.spendCents + day.spendCents,
        promptTokens: sum.promptTokens + day.promptTokens,
        completionTokens: sum.completionTokens + day.completionTokens,
        totalTokens: sum.totalTokens + day.totalTokens,
        activeUserDays: sum.activeUserDays + day.activeUsers,
        rechargeCents: sum.rechargeCents + day.rechargeCents,
        rechargeCount: sum.rechargeCount + day.rechargeCount,
        requestLogCount: sum.requestLogCount + day.requestLogCount,
        errorRequestCount: sum.errorRequestCount + day.errorRequestCount
      }),
      {
        callCount: 0,
        spendCents: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        activeUserDays: 0,
        rechargeCents: 0,
        rechargeCount: 0,
        requestLogCount: 0,
        errorRequestCount: 0
      }
    );

    return {
      generatedAt: generatedAt.toISOString(),
      window: {
        days,
        start: reportStart.toISOString(),
        end: reportEnd.toISOString(),
        timezone: 'Asia/Shanghai'
      },
      costAlert: {
        userDailyThresholdCents: userDailyCostAlertCents,
        alerts: userCostAlerts
      },
      totals: {
        ...totals,
        errorRatePercent:
          totals.requestLogCount > 0 ? Number(((totals.errorRequestCount / totals.requestLogCount) * 100).toFixed(2)) : 0
      },
      days: daysReport
    };
  }

  async listUsers(options: ListUsersOptions) {
    const { page, limit } = options;
    const skip = (page - 1) * limit;

    const where = { deletedAt: null };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          group: true,
          wallet: true
        }
      }),
      this.prisma.user.count({ where })
    ]);
    const userMetrics = await this.getUserFinanceMetrics(users.map((user) => user.id));

    return {
      items: users.map((user) => this.toAdminUser(user, userMetrics.get(user.id))),
      total,
      page,
      limit
    };
  }

  async listAnnouncements() {
    const announcements = await this.prisma.announcement.findMany({
      include: {
        createdByAdmin: {
          select: { username: true }
        }
      },
      orderBy: [{ isPinned: 'desc' }, { scheduledAt: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100
    });

    return {
      items: announcements.map((announcement) => ({
        id: announcement.id,
        title: announcement.title,
        content: announcement.content,
        translations: announcement.translations ?? null,
        translationWorkflow: this.translationWorkflowSummary(announcement.translations),
        category: announcement.category.toLowerCase(),
        status: announcement.status.toLowerCase(),
        isPinned: announcement.isPinned,
        scheduledAt: announcement.scheduledAt?.toISOString() ?? null,
        publishedAt: announcement.publishedAt?.toISOString() ?? null,
        createdBy: announcement.createdByAdmin.username,
        createdAt: announcement.createdAt.toISOString(),
        updatedAt: announcement.updatedAt.toISOString()
      }))
    };
  }

  async previewAnnouncement(announcementId: string, languageValue?: unknown) {
    const language = this.normalizeAnnouncementPreviewLanguage(languageValue);
    const announcement = await this.prisma.announcement.findUnique({
      where: { id: announcementId }
    });

    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }

    const translation = this.resolveAnnouncementPreviewTranslation(announcement.translations, language);
    const title = translation.title ?? announcement.title;
    const content = translation.content ?? announcement.content;

    return {
      id: announcement.id,
      language: language ?? 'source',
      title,
      content,
      fallback: translation.title === null || translation.content === null,
      source: {
        title: announcement.title,
        content: announcement.content
      },
      translation: {
        language: translation.language,
        status: translation.status,
        locked: translation.locked,
        source: translation.source,
        hasTitle: translation.title !== null,
        hasContent: translation.content !== null,
        updatedAt: translation.updatedAt
      },
      category: announcement.category.toLowerCase(),
      status: announcement.status.toLowerCase(),
      isPinned: announcement.isPinned,
      scheduledAt: announcement.scheduledAt?.toISOString() ?? null,
      publishedAt: announcement.publishedAt?.toISOString() ?? null,
      createdAt: announcement.createdAt.toISOString(),
      updatedAt: announcement.updatedAt.toISOString()
    };
  }

  async prepareAnnouncementTranslations(
    adminUserId: string,
    announcementId: string,
    body: PrepareAnnouncementTranslationInput
  ) {
    const currentAnnouncement = await this.prisma.announcement.findUnique({
      where: { id: announcementId }
    });

    if (!currentAnnouncement) {
      throw new NotFoundException('Announcement not found');
    }

    const targetLanguages = this.normalizeAnnouncementPrepareLanguages(body);
    const glossary = await this.getActiveTranslationGlossaryMap();
    const preparedTranslations = await prepareAutoTranslationDrafts({
      translations: currentAnnouncement.translations,
      fields: {
        title: currentAnnouncement.title,
        content: currentAnnouncement.content
      },
      maxLengths: ANNOUNCEMENT_TRANSLATION_RULES,
      targetLanguages,
      glossary
    });

    const updatedAnnouncement = await this.prisma.$transaction(async (tx) => {
      const nextAnnouncement = preparedTranslations.changed
        ? await tx.announcement.update({
            where: { id: announcementId },
            data: { translations: preparedTranslations.translations ?? Prisma.DbNull }
          })
        : currentAnnouncement;

      await tx.adminAuditLog.create({
        data: {
          adminUserId,
          action: 'announcement_translation_drafts_prepared',
          targetType: 'announcement',
          targetId: currentAnnouncement.id,
          beforeSnapshot: this.announcementAuditSnapshot(currentAnnouncement),
          afterSnapshot: {
            ...this.announcementAuditSnapshot(nextAnnouncement),
            preparedTranslationLanguages: preparedTranslations.preparedLanguages,
            translationErrors: preparedTranslations.errors,
            changed: preparedTranslations.changed
          }
        }
      });

      return nextAnnouncement;
    });

    return {
      id: updatedAnnouncement.id,
      title: updatedAnnouncement.title,
      content: updatedAnnouncement.content,
      translations: updatedAnnouncement.translations ?? null,
      translationWorkflow: this.translationWorkflowSummary(updatedAnnouncement.translations),
      category: updatedAnnouncement.category.toLowerCase(),
      status: updatedAnnouncement.status.toLowerCase(),
      isPinned: updatedAnnouncement.isPinned,
      scheduledAt: updatedAnnouncement.scheduledAt?.toISOString() ?? null,
      publishedAt: updatedAnnouncement.publishedAt?.toISOString() ?? null,
      createdByAdminId: updatedAnnouncement.createdByAdminId,
      createdAt: updatedAnnouncement.createdAt.toISOString(),
      updatedAt: updatedAnnouncement.updatedAt.toISOString(),
      preparedTranslationLanguages: preparedTranslations.preparedLanguages,
      translationErrors: preparedTranslations.errors,
      changed: preparedTranslations.changed
    };
  }

  async listTranslationGlossaryTerms() {
    const items = await this.prisma.translationGlossaryTerm.findMany({
      orderBy: [{ isActive: 'desc' }, { sourceTerm: 'asc' }],
      take: 500
    });

    return {
      items: items.map((item) => this.toPublicTranslationGlossaryTerm(item)),
      activeGlossary: this.translationGlossaryRowsToMap(items.filter((item) => item.isActive))
    };
  }

  async createTranslationGlossaryTerm(adminUserId: string, body: TranslationGlossaryInput) {
    const sourceTerm = this.normalizeGlossaryTerm(body.sourceTerm, 'sourceTerm');
    const replacementTerm = this.normalizeGlossaryTerm(body.replacementTerm, 'replacementTerm');
    const note = this.optionalText(body.note, 'note', 1, 500) ?? null;
    const isActive = this.optionalBoolean(body.isActive, true, 'isActive');

    try {
      const item = await this.prisma.$transaction(async (tx) => {
        const created = await tx.translationGlossaryTerm.create({
          data: {
            sourceTerm,
            replacementTerm,
            note,
            isActive,
            createdByAdminId: adminUserId,
            updatedByAdminId: adminUserId
          }
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId,
            action: 'translation_glossary_term_created',
            targetType: 'translation_glossary_term',
            targetId: created.id,
            beforeSnapshot: Prisma.JsonNull,
            afterSnapshot: this.translationGlossaryAuditSnapshot(created)
          }
        });

        return created;
      });

      return this.toPublicTranslationGlossaryTerm(item);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Translation glossary source term already exists');
      }
      throw error;
    }
  }

  async updateTranslationGlossaryTerm(adminUserId: string, termId: string, body: TranslationGlossaryInput) {
    const current = await this.prisma.translationGlossaryTerm.findUnique({
      where: { id: termId }
    });
    if (!current) {
      throw new NotFoundException('Translation glossary term not found');
    }

    const data: Prisma.TranslationGlossaryTermUpdateInput = {
      updatedByAdmin: { connect: { id: adminUserId } }
    };
    if (Object.prototype.hasOwnProperty.call(body, 'sourceTerm')) {
      data.sourceTerm = this.normalizeGlossaryTerm(body.sourceTerm, 'sourceTerm');
    }
    if (Object.prototype.hasOwnProperty.call(body, 'replacementTerm')) {
      data.replacementTerm = this.normalizeGlossaryTerm(body.replacementTerm, 'replacementTerm');
    }
    if (Object.prototype.hasOwnProperty.call(body, 'note')) {
      data.note = this.optionalText(body.note, 'note', 1, 500) ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'isActive')) {
      data.isActive = this.optionalBoolean(body.isActive, current.isActive, 'isActive');
    }

    if (Object.keys(data).length === 1) {
      throw new BadRequestException('No translation glossary fields to update');
    }

    try {
      const item = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.translationGlossaryTerm.update({
          where: { id: termId },
          data
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId,
            action: 'translation_glossary_term_updated',
            targetType: 'translation_glossary_term',
            targetId: updated.id,
            beforeSnapshot: this.translationGlossaryAuditSnapshot(current),
            afterSnapshot: this.translationGlossaryAuditSnapshot(updated)
          }
        });

        return updated;
      });

      return this.toPublicTranslationGlossaryTerm(item);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Translation glossary source term already exists');
      }
      throw error;
    }
  }

  async listAdminAuditLogs(options: ListUsersOptions) {
    const { page, limit } = options;
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        skip,
        take: limit,
        include: {
          adminUser: {
            select: {
              id: true,
              username: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.adminAuditLog.count()
    ]);

    return {
      items: logs.map((log) => ({
        id: log.id,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        admin: {
          id: log.adminUser.id,
          username: log.adminUser.username
        },
        beforeSnapshot: this.securityAuditService.redact(log.beforeSnapshot),
        afterSnapshot: this.securityAuditService.redact(log.afterSnapshot),
        createdAt: log.createdAt.toISOString()
      })),
      total,
      page,
      limit
    };
  }

  async listSecurityAuditLogs(options: ListUsersOptions) {
    return this.securityAuditService.listSecurityAuditLogs(options);
  }

  async listRequestLogs(options: ListRequestLogsOptions) {
    const { page, limit } = options;
    const skip = (page - 1) * limit;
    const model = this.optionalFilterText(options.model, 'model');
    const status = this.normalizeRequestLogStatus(options.status);
    const where: Prisma.RequestLogWhereInput = {
      ...(model ? { model } : {}),
      ...this.requestLogStatusWhere(status)
    };

    const [logs, total, successCount, errorCount] = await Promise.all([
      this.prisma.requestLog.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              username: true
            }
          },
          token: {
            select: {
              id: true,
              name: true,
              keyPreview: true
            }
          },
          upstreamProvider: {
            select: {
              id: true,
              name: true,
              status: true,
              healthStatus: true
            }
          }
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      }),
      this.prisma.requestLog.count({ where }),
      this.prisma.requestLog.count({
        where: {
          ...where,
          errorCode: null,
          statusCode: { lt: 400 }
        }
      }),
      this.prisma.requestLog.count({
        where: {
          ...where,
          OR: [{ errorCode: { not: null } }, { statusCode: { gte: 400 } }]
        }
      })
    ]);

    return {
      items: logs.map((log) => ({
        id: log.id,
        requestId: log.requestId,
        method: log.method,
        path: log.path,
        model: log.model,
        statusCode: log.statusCode,
        errorCode: log.errorCode,
        latencyMs: log.latencyMs,
        upstreamLatencyMs: log.upstreamLatencyMs,
        upstreamStatusCode: log.upstreamStatusCode,
        upstreamStatus: log.upstreamStatus,
        createdAt: log.createdAt.toISOString(),
        completedAt: log.completedAt?.toISOString() ?? null,
        user: log.user
          ? {
              id: log.user.id,
              username: log.user.username
            }
          : null,
        token: log.token
          ? {
              id: log.token.id,
              name: log.token.name,
              keyPreview: log.token.keyPreview
            }
          : null,
        upstreamProvider: log.upstreamProvider
          ? {
              id: log.upstreamProvider.id,
              name: log.upstreamProvider.name,
              status: log.upstreamProvider.status.toLowerCase(),
              healthStatus: log.upstreamProvider.healthStatus.toLowerCase()
            }
          : null
      })),
      summary: {
        total,
        successCount,
        errorCount
      },
      total,
      page,
      limit
    };
  }

  async listImageTasks(options: ListImageTasksOptions) {
    const { page, limit } = options;
    const skip = (page - 1) * limit;
    const status = this.optionalAsyncTaskStatus(options.status);
    const platform = this.optionalFilterText(options.platform, 'platform');
    const model = this.optionalFilterText(options.model, 'model');
    const where: Prisma.AsyncTaskWhereInput = {
      kind: AsyncTaskKind.IMAGE,
      ...(status ? { status } : {}),
      ...(platform ? { platform } : {}),
      ...(model ? { model } : {})
    };

    const [items, total, statusGroups, platformRows, modelRows] = await Promise.all([
      this.prisma.asyncTask.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              username: true
            }
          },
          upstreamProvider: {
            select: {
              id: true,
              name: true,
              status: true,
              healthStatus: true
            }
          }
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      }),
      this.prisma.asyncTask.count({ where }),
      this.prisma.asyncTask.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        orderBy: { status: 'asc' }
      }),
      this.prisma.asyncTask.findMany({
        where: { kind: AsyncTaskKind.IMAGE },
        distinct: ['platform'],
        orderBy: { platform: 'asc' },
        select: { platform: true },
        take: 100
      }),
      this.prisma.asyncTask.findMany({
        where: {
          kind: AsyncTaskKind.IMAGE,
          model: { not: null }
        },
        distinct: ['model'],
        orderBy: { model: 'asc' },
        select: { model: true },
        take: 100
      })
    ]);

    return {
      items: items.map((task) => ({
        id: task.id,
        externalTaskId: task.externalTaskId,
        platform: task.platform,
        kind: task.kind.toLowerCase(),
        status: task.status.toLowerCase(),
        model: task.model,
        prompt: task.prompt,
        progress: task.progress,
        result: task.resultJson,
        errorMessage: task.errorMessage,
        submittedAt: task.submittedAt.toISOString(),
        startedAt: task.startedAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        user: {
          id: task.user.id,
          username: task.user.username
        },
        upstreamProvider: task.upstreamProvider
          ? {
              id: task.upstreamProvider.id,
              name: task.upstreamProvider.name,
              status: task.upstreamProvider.status.toLowerCase(),
              healthStatus: task.upstreamProvider.healthStatus.toLowerCase()
            }
          : null
      })),
      summary: {
        total,
        statusCounts: this.toAsyncTaskStatusCounts(statusGroups)
      },
      filters: {
        platforms: platformRows.map((entry) => entry.platform),
        models: modelRows.map((entry) => entry.model).filter((entry): entry is string => Boolean(entry)),
        statuses: ['queued', 'running', 'succeeded', 'failed', 'canceled']
      },
      capabilities: {
        imageSubmissionSupported: false,
        statusSyncSupported: false
      },
      total,
      page,
      limit
    };
  }

  async createAnnouncement(adminUserId: string, body: AnnouncementInput) {
    const title = this.requiredText(body.title, 'title', 3, 120);
    const content = this.requiredText(body.content, 'content', 1, 5000);
    const category = this.normalizeAnnouncementCategory(body.category);
    const status = this.normalizeStatus(body.status);
    const isPinned = this.normalizeAnnouncementPinned(body);
    const scheduledAt = this.normalizeAnnouncementSchedule(body);
    let translations = normalizeTranslations(body.translations, ANNOUNCEMENT_TRANSLATION_RULES);
    let preparedTranslationLanguages: string[] = [];

    if (status === AnnouncementStatus.PUBLISHED) {
      const glossary = await this.getActiveTranslationGlossaryMap();
      const preparedTranslations = await prepareAutoTranslationDrafts({
        translations,
        fields: { title, content },
        maxLengths: ANNOUNCEMENT_TRANSLATION_RULES,
        glossary
      });
      translations = preparedTranslations.translations;
      preparedTranslationLanguages = preparedTranslations.preparedLanguages;
    }

    const announcement = await this.prisma.$transaction(async (tx) => {
      const createdAnnouncement = await tx.announcement.create({
        data: {
          title,
          content,
          ...(translations !== undefined ? { translations: translations ?? Prisma.DbNull } : {}),
          category,
          status,
          isPinned,
          scheduledAt,
          publishedAt: status === AnnouncementStatus.PUBLISHED ? scheduledAt ?? new Date() : null,
          createdByAdminId: adminUserId
        }
      });

      await tx.adminAuditLog.create({
        data: {
          adminUserId,
          action: 'announcement_created',
          targetType: 'announcement',
          targetId: createdAnnouncement.id,
          beforeSnapshot: Prisma.JsonNull,
          afterSnapshot: {
            id: createdAnnouncement.id,
            title,
            category: createdAnnouncement.category.toLowerCase(),
            status: createdAnnouncement.status.toLowerCase(),
            isPinned: createdAnnouncement.isPinned,
            scheduledAt: createdAnnouncement.scheduledAt?.toISOString() ?? null,
            publishedAt: createdAnnouncement.publishedAt?.toISOString() ?? null,
            hasTranslations: Boolean(translations),
            preparedTranslationLanguages
          }
        }
      });

      return createdAnnouncement;
    });

    return {
      id: announcement.id,
      title: announcement.title,
      content: announcement.content,
      translations: announcement.translations ?? null,
      translationWorkflow: this.translationWorkflowSummary(announcement.translations),
      category: announcement.category.toLowerCase(),
      status: announcement.status.toLowerCase(),
      isPinned: announcement.isPinned,
      scheduledAt: announcement.scheduledAt?.toISOString() ?? null,
      publishedAt: announcement.publishedAt?.toISOString() ?? null,
      createdByAdminId: announcement.createdByAdminId,
      createdAt: announcement.createdAt.toISOString()
    };
  }

  async updateAnnouncement(adminUserId: string, announcementId: string, body: AnnouncementInput) {
    const currentAnnouncement = await this.prisma.announcement.findUnique({
      where: { id: announcementId }
    });

    if (!currentAnnouncement) {
      throw new NotFoundException('Announcement not found');
    }

    const data: Prisma.AnnouncementUpdateInput = {};
    let nextTitle = currentAnnouncement.title;
    let nextContent = currentAnnouncement.content;
    let nextStatus = currentAnnouncement.status;
    let nextScheduledAt = currentAnnouncement.scheduledAt;
    let nextTranslations: unknown = currentAnnouncement.translations;
    const hasStatusInput = Object.prototype.hasOwnProperty.call(body, 'status');
    const hasScheduleInput = this.hasAnnouncementScheduleInput(body);
    if (Object.prototype.hasOwnProperty.call(body, 'title')) {
      nextTitle = this.requiredText(body.title, 'title', 3, 120);
      data.title = nextTitle;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'content')) {
      nextContent = this.requiredText(body.content, 'content', 1, 5000);
      data.content = nextContent;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'category')) {
      data.category = this.normalizeAnnouncementCategory(body.category);
    }
    if (this.hasAnnouncementPinnedInput(body)) {
      data.isPinned = this.normalizeAnnouncementPinned(body);
    }
    if (hasScheduleInput) {
      nextScheduledAt = this.normalizeAnnouncementSchedule(body);
      data.scheduledAt = nextScheduledAt;
    }
    if (hasStatusInput) {
      nextStatus = this.normalizeStatus(body.status);
      data.status = nextStatus;
    }
    if (nextStatus === AnnouncementStatus.DRAFT) {
      data.publishedAt = null;
    } else if (nextStatus === AnnouncementStatus.PUBLISHED && (hasStatusInput || hasScheduleInput)) {
      data.publishedAt = nextScheduledAt ?? currentAnnouncement.publishedAt ?? new Date();
    }
    if (Object.prototype.hasOwnProperty.call(body, 'translations')) {
      const translations = normalizeTranslations(body.translations, ANNOUNCEMENT_TRANSLATION_RULES);
      nextTranslations = translations;
      data.translations = translations ?? Prisma.DbNull;
    }

    if (nextStatus === AnnouncementStatus.PUBLISHED) {
      const glossary = await this.getActiveTranslationGlossaryMap();
      const preparedTranslations = await prepareAutoTranslationDrafts({
        translations: nextTranslations,
        fields: { title: nextTitle, content: nextContent },
        maxLengths: ANNOUNCEMENT_TRANSLATION_RULES,
        glossary
      });
      if (preparedTranslations.changed) {
        data.translations = preparedTranslations.translations ?? Prisma.DbNull;
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No announcement fields to update');
    }

    const updatedAnnouncement = await this.prisma.$transaction(async (tx) => {
      const nextAnnouncement = await tx.announcement.update({
        where: { id: announcementId },
        data
      });

      await tx.adminAuditLog.create({
        data: {
          adminUserId,
          action: 'announcement_updated',
          targetType: 'announcement',
          targetId: nextAnnouncement.id,
          beforeSnapshot: this.announcementAuditSnapshot(currentAnnouncement),
          afterSnapshot: this.announcementAuditSnapshot(nextAnnouncement)
        }
      });

      return nextAnnouncement;
    });

    return {
      id: updatedAnnouncement.id,
      title: updatedAnnouncement.title,
      content: updatedAnnouncement.content,
      translations: updatedAnnouncement.translations ?? null,
      translationWorkflow: this.translationWorkflowSummary(updatedAnnouncement.translations),
      category: updatedAnnouncement.category.toLowerCase(),
      status: updatedAnnouncement.status.toLowerCase(),
      isPinned: updatedAnnouncement.isPinned,
      scheduledAt: updatedAnnouncement.scheduledAt?.toISOString() ?? null,
      publishedAt: updatedAnnouncement.publishedAt?.toISOString() ?? null,
      createdByAdminId: updatedAnnouncement.createdByAdminId,
      createdAt: updatedAnnouncement.createdAt.toISOString(),
      updatedAt: updatedAnnouncement.updatedAt.toISOString()
    };
  }

  async listUpstreamProviders() {
    const providers = await this.prisma.upstreamProvider.findMany({
      include: {
        createdByAdmin: {
          select: { username: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    return {
      items: providers.map((provider) => this.toPublicUpstreamProvider(provider))
    };
  }

  async createUpstreamProvider(adminUserId: string, body: UpstreamProviderInput) {
    const name = this.requiredText(body.name, 'name', 2, 80);
    const kind = this.normalizeUpstreamProviderKind(body.kind);
    const baseUrl = this.normalizeBaseUrl(body.baseUrl);
    const apiKey = this.requiredText(body.apiKey, 'apiKey', 8, 512);
    const status = this.normalizeUpstreamStatus(body.status);
    const maxConcurrency = this.optionalPositiveInt(body.maxConcurrency, 'maxConcurrency', MAX_UPSTREAM_PROVIDER_CONCURRENCY);
    const apiKeyPreview = maskUpstreamApiKey(apiKey);
    const encryptedApiKey = encryptUpstreamApiKey(apiKey);

    try {
      const provider = await this.prisma.$transaction(async (tx) => {
        const createdProvider = await tx.upstreamProvider.create({
          data: {
            name,
            kind,
            baseUrl,
            encryptedApiKey,
            apiKeyPreview,
            status,
            maxConcurrency,
            createdByAdminId: adminUserId
          },
          include: {
            createdByAdmin: {
              select: { username: true }
            }
          }
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId,
            action: 'upstream_provider_created',
            targetType: 'upstream_provider',
            targetId: createdProvider.id,
            beforeSnapshot: Prisma.JsonNull,
            afterSnapshot: {
              id: createdProvider.id,
              name,
              kind: kind.toLowerCase(),
              baseUrl,
              status: status.toLowerCase(),
              maxConcurrency,
              apiKeyPreview
            }
          }
        });

        return createdProvider;
      });

      return this.toPublicUpstreamProvider(provider);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Upstream provider name already exists');
      }

      throw error;
    }
  }

  async updateUpstreamProvider(adminUserId: string, upstreamProviderId: string, body: UpstreamProviderInput) {
    const providerId = this.requiredUuid(upstreamProviderId, 'upstreamProviderId');
    const name = this.requiredText(body.name, 'name', 2, 80);
    const kind = this.normalizeUpstreamProviderKind(body.kind);
    const baseUrl = this.normalizeBaseUrl(body.baseUrl);
    const nextApiKey = this.optionalText(body.apiKey, 'apiKey', 8, 512);
    const status = this.normalizeUpstreamStatus(body.status);
    const hasMaxConcurrencyInput = Object.prototype.hasOwnProperty.call(body, 'maxConcurrency');

    const currentProvider = await this.prisma.upstreamProvider.findUnique({
      where: { id: providerId }
    });

    if (!currentProvider) {
      throw new NotFoundException('Upstream provider not found');
    }

    if (kind !== currentProvider.kind) {
      const existingMappingCount = await this.prisma.upstreamModel.count({
        where: { providerId }
      });

      if (existingMappingCount > 0) {
        throw new BadRequestException('Upstream provider kind cannot be changed while mappings exist');
      }
    }

    const maxConcurrency = hasMaxConcurrencyInput
      ? this.optionalPositiveInt(body.maxConcurrency, 'maxConcurrency', MAX_UPSTREAM_PROVIDER_CONCURRENCY)
      : currentProvider.maxConcurrency;
    const apiKeyChanged = typeof nextApiKey === 'string';
    const addressChanged = currentProvider.baseUrl !== baseUrl;
    const updateData: Prisma.UpstreamProviderUpdateInput = {
      name,
      kind,
      baseUrl,
      status,
      maxConcurrency,
      ...(apiKeyChanged
        ? {
            encryptedApiKey: encryptUpstreamApiKey(nextApiKey),
            apiKeyPreview: maskUpstreamApiKey(nextApiKey)
          }
        : {})
    };

    if (addressChanged || apiKeyChanged) {
      updateData.healthStatus = UpstreamHealthStatus.UNKNOWN;
      updateData.lastHealthCheckAt = null;
      updateData.lastHealthLatencyMs = null;
      updateData.lastHealthError = null;
      updateData.consecutiveFailures = 0;
      updateData.circuitOpenedUntil = null;
      updateData.lastFailureAt = null;
      updateData.lastSuccessAt = null;
    }

    try {
      const provider = await this.prisma.$transaction(async (tx) => {
        const updatedProvider = await tx.upstreamProvider.update({
          where: { id: providerId },
          data: updateData,
          include: {
            createdByAdmin: {
              select: { username: true }
            }
          }
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId,
            action: 'upstream_provider_updated',
            targetType: 'upstream_provider',
            targetId: updatedProvider.id,
            beforeSnapshot: {
              id: currentProvider.id,
              name: currentProvider.name,
              kind: currentProvider.kind.toLowerCase(),
              baseUrl: currentProvider.baseUrl,
              status: currentProvider.status.toLowerCase(),
              maxConcurrency: currentProvider.maxConcurrency,
              apiKeyPreview: currentProvider.apiKeyPreview
            },
            afterSnapshot: {
              id: updatedProvider.id,
              name: updatedProvider.name,
              kind: updatedProvider.kind.toLowerCase(),
              baseUrl: updatedProvider.baseUrl,
              status: updatedProvider.status.toLowerCase(),
              maxConcurrency: updatedProvider.maxConcurrency,
              apiKeyPreview: updatedProvider.apiKeyPreview
            }
          }
        });

        return updatedProvider;
      });

      return this.toPublicUpstreamProvider(provider);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Upstream provider name already exists');
      }

      throw error;
    }
  }

  async checkUpstreamHealth(adminUserId: string, upstreamProviderId: string) {
    const providerId = this.requiredUuid(upstreamProviderId, 'upstreamProviderId');
    const provider = await this.prisma.upstreamProvider.findUnique({
      where: { id: providerId }
    });

    if (!provider) {
      throw new NotFoundException('Upstream provider not found');
    }

    const result = await this.fetchUpstreamHealth(provider.baseUrl, decryptUpstreamApiKey(provider.encryptedApiKey));
    const checkedAt = new Date();

    const updatedProvider = await this.prisma.$transaction(async (tx) => {
      const nextProvider = await tx.upstreamProvider.update({
        where: { id: provider.id },
        data: {
          healthStatus: result.healthStatus,
          lastHealthCheckAt: checkedAt,
          lastHealthLatencyMs: result.latencyMs,
          lastHealthError: result.error,
          ...(result.healthStatus === UpstreamHealthStatus.HEALTHY
            ? {
                consecutiveFailures: 0,
                circuitOpenedUntil: null,
                lastSuccessAt: checkedAt
              }
            : {
                consecutiveFailures: { increment: 1 },
                lastFailureAt: checkedAt
              })
        },
        include: {
          createdByAdmin: {
            select: { username: true }
          }
        }
      });

      await tx.adminAuditLog.create({
        data: {
          adminUserId,
          action: 'upstream_provider_health_checked',
          targetType: 'upstream_provider',
          targetId: provider.id,
          beforeSnapshot: {
            healthStatus: provider.healthStatus.toLowerCase(),
            lastHealthCheckAt: provider.lastHealthCheckAt?.toISOString() ?? null
          },
          afterSnapshot: {
            healthStatus: result.healthStatus.toLowerCase(),
            latencyMs: result.latencyMs,
            error: result.error
          }
        }
      });

      return nextProvider;
    });

    return {
      reachable: result.healthStatus === UpstreamHealthStatus.HEALTHY,
      checkedAt: checkedAt.toISOString(),
      provider: this.toPublicUpstreamProvider(updatedProvider)
    };
  }

  async listModelConfiguration(options: ModelConfigurationOptions) {
    const { upstreamModelsPage, upstreamModelsLimit } = options;
    const upstreamModelsSkip = (upstreamModelsPage - 1) * upstreamModelsLimit;

    const [groups, models, upstreamModels, upstreamModelsTotal] = await Promise.all([
      this.prisma.userGroup.findMany({
        include: {
          _count: {
            select: {
              users: true,
              modelAccesses: true
            }
          }
        },
        orderBy: { code: 'asc' }
      }),
      this.prisma.modelPrice.findMany({
        include: {
          groupAccesses: {
            include: { group: true },
            orderBy: { createdAt: 'asc' }
          },
          upstreamModels: {
            include: { provider: true },
            orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }]
          }
        },
        orderBy: { model: 'asc' }
      }),
      this.prisma.upstreamModel.findMany({
        include: {
          provider: true,
          modelPrice: true
        },
        skip: upstreamModelsSkip,
        orderBy: [{ publicModel: 'asc' }, { priority: 'asc' }, { createdAt: 'desc' }],
        take: upstreamModelsLimit
      }),
      this.prisma.upstreamModel.count()
    ]);

    return {
      groups: groups.map((group) => this.toPublicGroup(group)),
      models: models.map((model) => this.toPublicModelPrice(model)),
      upstreamModels: upstreamModels.map((model) => this.toPublicUpstreamModel(model)),
      upstreamModelsPagination: {
        page: upstreamModelsPage,
        limit: upstreamModelsLimit,
        total: upstreamModelsTotal,
        totalPages: Math.max(1, Math.ceil(upstreamModelsTotal / upstreamModelsLimit))
      }
    };
  }

  async listUserGroups() {
    const groups = await this.prisma.userGroup.findMany({
      include: {
        _count: {
          select: {
            users: true,
            modelAccesses: true
          }
        }
      },
      orderBy: { code: 'asc' }
    });

    return {
      items: groups.map((group) => this.toPublicGroup(group))
    };
  }

  async createUserGroup(adminUserId: string, body: UserGroupInput) {
    const code = this.normalizeGroupCode(body.code);
    const name = this.requiredText(body.name, 'name', 2, 80);
    const multiplier = this.normalizeMultiplier(body.multiplier, 'multiplier');
    const status = this.normalizeGroupStatus(body.status);

    try {
      const group = await this.prisma.$transaction(async (tx) => {
        const createdGroup = await tx.userGroup.create({
          data: {
            code,
            name,
            multiplier,
            status
          }
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId,
            action: 'user_group_created',
            targetType: 'user_group',
            targetId: createdGroup.id,
            beforeSnapshot: Prisma.JsonNull,
            afterSnapshot: {
              id: createdGroup.id,
              code,
              name,
              multiplier: multiplier.toString(),
              status: status.toLowerCase()
            }
          }
        });

        return createdGroup;
      });

      return this.toPublicGroup(group);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('User group code already exists');
      }

      throw error;
    }
  }

  async assignUserGroup(adminUserId: string, userId: string, body: AssignUserGroupInput) {
    const targetUserId = this.requiredUuid(userId, 'userId');
    const groupId = this.requiredUuid(body.groupId, 'groupId');

    const [user, group] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: targetUserId, deletedAt: null },
        include: { group: true }
      }),
      this.prisma.userGroup.findUnique({
        where: { id: groupId }
      })
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!group) {
      throw new NotFoundException('User group not found');
    }

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const nextUser = await tx.user.update({
        where: { id: user.id },
        data: { groupId: group.id },
        include: {
          group: true,
          wallet: true
        }
      });

      await tx.adminAuditLog.create({
        data: {
          adminUserId,
          action: 'user_group_assigned',
          targetType: 'user',
          targetId: user.id,
          beforeSnapshot: {
            groupId: user.group.id,
            groupCode: user.group.code
          },
          afterSnapshot: {
            groupId: group.id,
            groupCode: group.code
          }
        }
      });

      return nextUser;
    });

    return {
      id: updatedUser.id,
      username: updatedUser.username,
      role: updatedUser.role.toLowerCase(),
      status: updatedUser.status.toLowerCase(),
      timezone: updatedUser.timezone,
      group: {
        id: updatedUser.group.id,
        code: updatedUser.group.code,
        name: updatedUser.group.name
      },
      wallet: {
        balanceCents: updatedUser.wallet?.balanceCents ?? 0,
        totalSpendCents: updatedUser.wallet?.totalSpendCents ?? 0
      },
      lastLoginAt: updatedUser.lastLoginAt?.toISOString() ?? null,
      createdAt: updatedUser.createdAt.toISOString()
    };
  }

  async deleteUserData(adminUserId: string, userId: string) {
    const actorUserId = this.requiredUuid(adminUserId, 'adminUserId');
    const targetUserId = this.requiredUuid(userId, 'userId');

    if (actorUserId === targetUserId) {
      throw new BadRequestException('Cannot delete the current admin account');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      include: {
        group: true,
        wallet: true
      }
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== UserRole.USER) {
      throw new BadRequestException('Only ordinary user accounts can be deleted');
    }

    const [
      adminAuditActorCount,
      announcementCount,
      upstreamProviderCount,
      rechargeCodeCreatedCount,
      aiRechargeProductCount
    ] =
      await this.prisma.$transaction([
        this.prisma.adminAuditLog.count({ where: { adminUserId: targetUserId } }),
        this.prisma.announcement.count({ where: { createdByAdminId: targetUserId } }),
        this.prisma.upstreamProvider.count({ where: { createdByAdminId: targetUserId } }),
        this.prisma.rechargeCode.count({ where: { createdByAdminId: targetUserId } }),
        this.prisma.aiRechargeProduct.count({ where: { createdByAdminId: targetUserId } })
      ]);

    if (
      adminAuditActorCount ||
      announcementCount ||
      upstreamProviderCount ||
      rechargeCodeCreatedCount ||
      aiRechargeProductCount
    ) {
      throw new BadRequestException('This account owns merchant resources and cannot be deleted safely');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const tokens = await tx.apiToken.findMany({
        where: { userId: targetUserId },
        select: { id: true }
      });
      const tokenIds = tokens.map((token) => token.id);

      const invitedUsers = await tx.user.updateMany({
        where: { invitedByUserId: targetUserId },
        data: { invitedByUserId: null }
      });
      const securityAuditLogs = await tx.securityAuditLog.updateMany({
        where: { actorUserId: targetUserId },
        data: { actorUserId: null }
      });
      const aiRechargePageConfigs = await tx.aiRechargePageConfig.updateMany({
        where: { updatedByAdminId: targetUserId },
        data: { updatedByAdminId: null }
      });
      const siteContentConfigs = await tx.siteContentConfig.updateMany({
        where: { updatedByAdminId: targetUserId },
        data: { updatedByAdminId: null }
      });
      const requestLogsByUser = await tx.requestLog.updateMany({
        where: { userId: targetUserId },
        data: { userId: null }
      });
      const requestLogsByToken = tokenIds.length
        ? await tx.requestLog.updateMany({
            where: { tokenId: { in: tokenIds } },
            data: { tokenId: null }
          })
        : { count: 0 };

      const notificationDeliveries = await tx.notificationDelivery.deleteMany({
        where: { userId: targetUserId }
      });
      const notificationChannels = await tx.notificationChannel.deleteMany({
        where: { userId: targetUserId }
      });
      const notificationPreferences = await tx.notificationPreference.deleteMany({
        where: { userId: targetUserId }
      });
      const referralRewards = await tx.referralReward.deleteMany({
        where: {
          OR: [{ inviterUserId: targetUserId }, { inviteeUserId: targetUserId }]
        }
      });
      const relayRateLimitEvents = await tx.relayRateLimitEvent.deleteMany({
        where: { userId: targetUserId }
      });
      const upstreamAssignments = await tx.userUpstreamAssignment.deleteMany({
        where: { userId: targetUserId }
      });
      const upstreamConcurrencySlots = await tx.upstreamConcurrencySlot.deleteMany({
        where: { userId: targetUserId }
      });
      const walletTransactions = await tx.walletTransaction.deleteMany({
        where: { userId: targetUserId }
      });
      const rechargeCodes = await tx.rechargeCode.deleteMany({
        where: { usedByUserId: targetUserId }
      });
      const paymentOrders = await tx.paymentOrder.deleteMany({
        where: { userId: targetUserId }
      });
      const usageEvents = await tx.usageEvent.deleteMany({
        where: { userId: targetUserId }
      });
      const asyncTasks = await tx.asyncTask.deleteMany({
        where: { userId: targetUserId }
      });
      const aiRechargeOrders = await tx.aiRechargeOrder.deleteMany({
        where: { userId: targetUserId }
      });
      const sessions = await tx.session.deleteMany({
        where: { userId: targetUserId }
      });
      const apiTokenModelAccesses = tokenIds.length
        ? await tx.apiTokenModelAccess.deleteMany({
            where: { apiTokenId: { in: tokenIds } }
          })
        : { count: 0 };
      const apiTokens = await tx.apiToken.deleteMany({
        where: { userId: targetUserId }
      });
      const wallets = await tx.wallet.deleteMany({
        where: { userId: targetUserId }
      });

      await tx.user.delete({
        where: { id: targetUserId }
      });

      const removed = {
        invitedUsersDetached: invitedUsers.count,
        rechargeCodes: rechargeCodes.count,
        requestLogsDetached: requestLogsByUser.count + requestLogsByToken.count,
        securityAuditLogsDetached: securityAuditLogs.count,
        aiRechargePageConfigsDetached: aiRechargePageConfigs.count,
        siteContentConfigsDetached: siteContentConfigs.count,
        notificationDeliveries: notificationDeliveries.count,
        notificationChannels: notificationChannels.count,
        notificationPreferences: notificationPreferences.count,
        referralRewards: referralRewards.count,
        relayRateLimitEvents: relayRateLimitEvents.count,
        upstreamAssignments: upstreamAssignments.count,
        upstreamConcurrencySlots: upstreamConcurrencySlots.count,
        walletTransactions: walletTransactions.count,
        paymentOrders: paymentOrders.count,
        usageEvents: usageEvents.count,
        asyncTasks: asyncTasks.count,
        aiRechargeOrders: aiRechargeOrders.count,
        sessions: sessions.count,
        apiTokenModelAccesses: apiTokenModelAccesses.count,
        apiTokens: apiTokens.count,
        wallets: wallets.count
      };

      await tx.adminAuditLog.create({
        data: {
          adminUserId: actorUserId,
          action: 'user_data_deleted',
          targetType: 'user',
          targetId: targetUserId,
          beforeSnapshot: {
            id: user.id,
            username: user.username,
            role: user.role.toLowerCase(),
            status: user.status.toLowerCase(),
            groupId: user.group.id,
            groupCode: user.group.code,
            balanceCents: user.wallet?.balanceCents ?? 0,
            totalSpendCents: user.wallet?.totalSpendCents ?? 0,
            createdAt: user.createdAt.toISOString()
          },
          afterSnapshot: {
            deleted: true,
            removed
          }
        }
      });

      return removed;
    });

    return {
      id: user.id,
      username: user.username,
      deleted: true,
      removed: result
    };
  }

  async createModelPrice(adminUserId: string, body: ModelPriceInput) {
    const model = this.normalizeModelName(body.model, 'model');
    const displayName = this.optionalText(body.displayName, 'displayName', 1, 120) ?? null;
    const translations = normalizeTranslations(body.translations, MODEL_PRICE_TRANSLATION_RULES);
    const pricing = this.resolveModelPricingForCreate(body);
    const status = this.normalizeModelStatus(body.status);
    const groupIds = this.requiredUuidArray(body.groupIds, 'groupIds');

    const groups = await this.prisma.userGroup.findMany({
      where: { id: { in: groupIds } }
    });

    if (groups.length !== groupIds.length) {
      throw new BadRequestException('groupIds contains unknown user group');
    }

    try {
      const modelPrice = await this.prisma.$transaction(async (tx) => {
        const createdModel = await tx.modelPrice.create({
          data: {
            model,
            displayName,
            ...(translations !== undefined ? { translations: translations ?? Prisma.DbNull } : {}),
            inputPriceCentsPer1k: pricing.inputPriceCentsPer1k,
            outputPriceCentsPer1k: pricing.outputPriceCentsPer1k,
            modelMultiplier: pricing.modelMultiplier,
            pricingMode: pricing.pricingMode,
            upstreamInputPricePerMillion: pricing.upstreamInputPricePerMillion,
            upstreamOutputPricePerMillion: pricing.upstreamOutputPricePerMillion,
            upstreamCurrency: pricing.upstreamCurrency,
            upstreamExchangeRate: pricing.upstreamExchangeRate,
            marginPercent: pricing.marginPercent,
            status
          }
        });

        await tx.modelGroupAccess.createMany({
          data: groupIds.map((groupId) => ({
            modelPriceId: createdModel.id,
            groupId
          }))
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId,
            action: 'model_price_created',
            targetType: 'model_price',
            targetId: createdModel.id,
            beforeSnapshot: Prisma.JsonNull,
            afterSnapshot: {
              id: createdModel.id,
              model,
              hasTranslations: Boolean(translations),
              ...pricing.auditSnapshot,
              status: status.toLowerCase(),
              groupIds
            }
          }
        });

        return tx.modelPrice.findUniqueOrThrow({
          where: { id: createdModel.id },
          include: {
            groupAccesses: {
              include: { group: true },
              orderBy: { createdAt: 'asc' }
            },
            upstreamModels: {
              include: { provider: true },
              orderBy: { createdAt: 'desc' }
            }
          }
        });
      });

      return this.toPublicModelPrice(modelPrice);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Model already exists');
      }

      throw error;
    }
  }

  async updateModelPrice(adminUserId: string, modelPriceId: string, body: ModelPriceInput) {
    const id = this.requiredUuid(modelPriceId, 'modelPriceId');
    const existing = await this.prisma.modelPrice.findUnique({
      where: { id },
      include: {
        groupAccesses: {
          include: { group: true },
          orderBy: { createdAt: 'asc' }
        },
        upstreamModels: {
          include: { provider: true },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!existing) {
      throw new NotFoundException('Model not found');
    }

    const model = body.model === undefined ? existing.model : this.normalizeModelName(body.model, 'model');
    if (model !== existing.model && existing.upstreamModels.length > 0) {
      throw new BadRequestException('Model with upstream mappings cannot change public model name');
    }

    const displayName =
      body.displayName === undefined
        ? existing.displayName
        : this.optionalText(body.displayName, 'displayName', 1, 120) ?? null;
    const translations = normalizeTranslations(body.translations, MODEL_PRICE_TRANSLATION_RULES);
    const pricing = this.resolveModelPricingForUpdate(body, existing);
    const status = body.status === undefined ? existing.status : this.normalizeModelStatus(body.status);
    const groupIds =
      body.groupIds === undefined
        ? existing.groupAccesses.map((access) => access.group.id)
        : this.requiredUuidArray(body.groupIds, 'groupIds');

    const groups = await this.prisma.userGroup.findMany({
      where: { id: { in: groupIds } }
    });

    if (groups.length !== groupIds.length) {
      throw new BadRequestException('groupIds contains unknown user group');
    }

    try {
      const modelPrice = await this.prisma.$transaction(async (tx) => {
        const updatedModel = await tx.modelPrice.update({
          where: { id },
          data: {
            model,
            displayName,
            ...(translations !== undefined ? { translations: translations ?? Prisma.DbNull } : {}),
            inputPriceCentsPer1k: pricing.inputPriceCentsPer1k,
            outputPriceCentsPer1k: pricing.outputPriceCentsPer1k,
            modelMultiplier: pricing.modelMultiplier,
            pricingMode: pricing.pricingMode,
            upstreamInputPricePerMillion: pricing.upstreamInputPricePerMillion,
            upstreamOutputPricePerMillion: pricing.upstreamOutputPricePerMillion,
            upstreamCurrency: pricing.upstreamCurrency,
            upstreamExchangeRate: pricing.upstreamExchangeRate,
            marginPercent: pricing.marginPercent,
            status
          }
        });

        await tx.modelGroupAccess.deleteMany({
          where: { modelPriceId: id }
        });

        await tx.modelGroupAccess.createMany({
          data: groupIds.map((groupId) => ({
            modelPriceId: updatedModel.id,
            groupId
          }))
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId,
            action: 'model_price_updated',
            targetType: 'model_price',
            targetId: updatedModel.id,
            beforeSnapshot: {
              id: existing.id,
              model: existing.model,
              hasTranslations: Boolean(existing.translations),
              inputPriceCentsPer1k: existing.inputPriceCentsPer1k,
              outputPriceCentsPer1k: existing.outputPriceCentsPer1k,
              modelMultiplier: existing.modelMultiplier.toString(),
              pricingMode: existing.pricingMode.toLowerCase(),
              upstreamInputPricePerMillion: existing.upstreamInputPricePerMillion?.toString() ?? null,
              upstreamOutputPricePerMillion: existing.upstreamOutputPricePerMillion?.toString() ?? null,
              upstreamCurrency: existing.upstreamCurrency,
              upstreamExchangeRate: existing.upstreamExchangeRate?.toString() ?? null,
              marginPercent: existing.marginPercent?.toString() ?? null,
              status: existing.status.toLowerCase(),
              groupIds: existing.groupAccesses.map((access) => access.group.id)
            },
            afterSnapshot: {
              id: updatedModel.id,
              model,
              hasTranslations: translations !== undefined ? Boolean(translations) : Boolean(existing.translations),
              ...pricing.auditSnapshot,
              status: status.toLowerCase(),
              groupIds
            }
          }
        });

        return tx.modelPrice.findUniqueOrThrow({
          where: { id: updatedModel.id },
          include: {
            groupAccesses: {
              include: { group: true },
              orderBy: { createdAt: 'asc' }
            },
            upstreamModels: {
              include: { provider: true },
              orderBy: { createdAt: 'desc' }
            }
          }
        });
      });

      return this.toPublicModelPrice(modelPrice);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Model already exists');
      }

      throw error;
    }
  }

  async updateModelPriceStatus(adminUserId: string, modelPriceId: string, body: { status?: unknown }) {
    const id = this.requiredUuid(modelPriceId, 'modelPriceId');
    const status = this.normalizeModelStatus(body.status);
    const existing = await this.prisma.modelPrice.findUnique({
      where: { id },
      include: {
        groupAccesses: {
          include: { group: true },
          orderBy: { createdAt: 'asc' }
        },
        upstreamModels: {
          include: { provider: true },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!existing) {
      throw new NotFoundException('Model not found');
    }

    const modelPrice = await this.prisma.$transaction(async (tx) => {
      const updatedModel = await tx.modelPrice.update({
        where: { id },
        data: { status }
      });

      await tx.adminAuditLog.create({
        data: {
          adminUserId,
          action: 'model_price_status_updated',
          targetType: 'model_price',
          targetId: updatedModel.id,
          beforeSnapshot: {
            id: existing.id,
            model: existing.model,
            status: existing.status.toLowerCase()
          },
          afterSnapshot: {
            id: updatedModel.id,
            model: updatedModel.model,
            status: updatedModel.status.toLowerCase()
          }
        }
      });

      return tx.modelPrice.findUniqueOrThrow({
        where: { id: updatedModel.id },
        include: {
          groupAccesses: {
            include: { group: true },
            orderBy: { createdAt: 'asc' }
          },
          upstreamModels: {
            include: { provider: true },
            orderBy: { createdAt: 'desc' }
          }
        }
      });
    });

    return this.toPublicModelPrice(modelPrice);
  }

  async deleteModelPrice(adminUserId: string, modelPriceId: string) {
    const id = this.requiredUuid(modelPriceId, 'modelPriceId');
    const existing = await this.prisma.modelPrice.findUnique({
      where: { id },
      include: {
        groupAccesses: {
          include: { group: true },
          orderBy: { createdAt: 'asc' }
        },
        upstreamModels: {
          include: { provider: true },
          orderBy: { createdAt: 'desc' }
        },
        tokenAccesses: true
      }
    });

    if (!existing) {
      throw new NotFoundException('Model not found');
    }

    if (existing.tokenAccesses.length > 0) {
      throw new BadRequestException('Model is used by API token access rules. Disable it first instead of deleting.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.modelPrice.delete({
        where: { id }
      });

      await tx.adminAuditLog.create({
        data: {
          adminUserId,
          action: 'model_price_deleted',
          targetType: 'model_price',
          targetId: existing.id,
          beforeSnapshot: {
            id: existing.id,
            model: existing.model,
            displayName: existing.displayName,
            status: existing.status.toLowerCase(),
            groupIds: existing.groupAccesses.map((access) => access.group.id),
            upstreamMappingIds: existing.upstreamModels.map((mapping) => mapping.id),
            tokenAccessCount: existing.tokenAccesses.length
          },
          afterSnapshot: Prisma.JsonNull
        }
      });
    });

    return {
      id: existing.id,
      model: existing.model,
      deleted: true
    };
  }

  async createUpstreamModel(adminUserId: string, body: UpstreamModelInput) {
    const providerId = this.requiredUuid(body.providerId, 'providerId');
    const publicModel = this.normalizeModelName(body.publicModel, 'publicModel');
    const upstreamModel = this.normalizeModelName(body.upstreamModel, 'upstreamModel');
    const priority = 1;
    const timeoutMs = this.nonNegativeInt(body.timeoutMs, 'timeoutMs', 1000, 30000);
    const upstreamPrompt = this.optionalText(body.upstreamPrompt, 'upstreamPrompt', 1, 4000) ?? null;
    const routePricing = this.resolveRoutePricingForCreate(body);
    const status = this.normalizeModelStatus(body.status);
    const supportsStream = this.optionalBoolean(body.supportsStream, true);

    const [provider, modelPrice] = await Promise.all([
      this.prisma.upstreamProvider.findUnique({
        where: { id: providerId }
      }),
      this.prisma.modelPrice.findUnique({
        where: { model: publicModel }
      })
    ]);

    if (!provider) {
      throw new NotFoundException('Upstream provider not found');
    }

    if (!modelPrice) {
      throw new BadRequestException('publicModel must exist in model prices first');
    }
    this.validateRoutePricingForProvider(provider.kind, routePricing?.pricingMode ?? null);

    try {
      const upstreamModelRecord = await this.prisma.$transaction(async (tx) => {
        if (status === ModelStatus.ACTIVE) {
          await tx.upstreamModel.updateMany({
            where: {
              publicModel,
              status: ModelStatus.ACTIVE
            },
            data: { status: ModelStatus.DISABLED }
          });
        }

        const createdModel = await tx.upstreamModel.create({
          data: {
            providerId,
            publicModel,
            upstreamModel,
            priority,
            timeoutMs,
            upstreamPrompt,
            ...this.routePricingData(routePricing),
            status,
            supportsStream
          }
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId,
            action: 'upstream_model_created',
            targetType: 'upstream_model',
            targetId: createdModel.id,
            beforeSnapshot: Prisma.JsonNull,
            afterSnapshot: {
              id: createdModel.id,
              providerId,
              publicModel,
              upstreamModel,
              priority,
              timeoutMs,
              upstreamPrompt,
              routePricing: routePricing?.auditSnapshot ?? null,
              status: status.toLowerCase(),
              supportsStream
            }
          }
        });

        return tx.upstreamModel.findUniqueOrThrow({
          where: { id: createdModel.id },
          include: {
            provider: true,
            modelPrice: true
          }
        });
      });

      return this.toPublicUpstreamModel(upstreamModelRecord);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Upstream model mapping already exists');
      }

      throw error;
    }
  }

  async updateUpstreamModel(adminUserId: string, upstreamModelId: string, body: UpstreamModelInput) {
    const id = this.requiredUuid(upstreamModelId, 'upstreamModelId');
    const existing = await this.prisma.upstreamModel.findUnique({
      where: { id },
      include: {
        provider: true,
        modelPrice: true
      }
    });

    if (!existing) {
      throw new NotFoundException('Upstream model mapping not found');
    }

    const providerId = this.requiredUuid(body.providerId, 'providerId');
    const publicModel = this.normalizeModelName(body.publicModel, 'publicModel');
    const upstreamModel = this.normalizeModelName(body.upstreamModel, 'upstreamModel');
    const priority = 1;
    const timeoutMs = this.nonNegativeInt(body.timeoutMs, 'timeoutMs', 1000, 30000);
    const upstreamPrompt = this.optionalText(body.upstreamPrompt, 'upstreamPrompt', 1, 4000) ?? null;
    const routePricing = this.resolveRoutePricingForUpdate(body, existing);
    const status = this.normalizeModelStatus(body.status);
    const supportsStream = this.optionalBoolean(body.supportsStream, true);

    const [provider, modelPrice] = await Promise.all([
      this.prisma.upstreamProvider.findUnique({
        where: { id: providerId }
      }),
      this.prisma.modelPrice.findUnique({
        where: { model: publicModel }
      })
    ]);

    if (!provider) {
      throw new NotFoundException('Upstream provider not found');
    }

    if (!modelPrice) {
      throw new BadRequestException('publicModel must exist in model prices first');
    }
    this.validateRoutePricingForProvider(
      provider.kind,
      routePricing === undefined ? existing.pricingMode : routePricing?.pricingMode ?? null
    );

    try {
      const upstreamModelRecord = await this.prisma.$transaction(async (tx) => {
        if (status === ModelStatus.ACTIVE) {
          await tx.upstreamModel.updateMany({
            where: {
              publicModel,
              status: ModelStatus.ACTIVE,
              id: { not: id }
            },
            data: { status: ModelStatus.DISABLED }
          });
        }

        const updatedModel = await tx.upstreamModel.update({
          where: { id },
          data: {
            providerId,
            publicModel,
            upstreamModel,
            priority,
            timeoutMs,
            upstreamPrompt,
            ...(routePricing === undefined ? {} : this.routePricingData(routePricing)),
            status,
            supportsStream
          }
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId,
            action: 'upstream_model_updated',
            targetType: 'upstream_model',
            targetId: updatedModel.id,
            beforeSnapshot: {
              id: existing.id,
              providerId: existing.providerId,
              publicModel: existing.publicModel,
              upstreamModel: existing.upstreamModel,
              priority: existing.priority,
              timeoutMs: existing.timeoutMs,
              upstreamPrompt: existing.upstreamPrompt,
              routePricing: this.routePricingSnapshot(existing),
              status: existing.status.toLowerCase(),
              supportsStream: existing.supportsStream
            },
            afterSnapshot: {
              id: updatedModel.id,
              providerId,
              publicModel,
              upstreamModel,
              priority,
              timeoutMs,
              upstreamPrompt,
              routePricing: routePricing === undefined ? this.routePricingSnapshot(existing) : routePricing?.auditSnapshot ?? null,
              status: status.toLowerCase(),
              supportsStream
            }
          }
        });

        return tx.upstreamModel.findUniqueOrThrow({
          where: { id: updatedModel.id },
          include: {
            provider: true,
            modelPrice: true
          }
        });
      });

      return this.toPublicUpstreamModel(upstreamModelRecord);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Upstream model mapping already exists');
      }

      throw error;
    }
  }

  private announcementAuditSnapshot(announcement: Announcement): Prisma.InputJsonObject {
    return {
      id: announcement.id,
      title: announcement.title,
      category: announcement.category.toLowerCase(),
      status: announcement.status.toLowerCase(),
      isPinned: announcement.isPinned,
      scheduledAt: announcement.scheduledAt?.toISOString() ?? null,
      publishedAt: announcement.publishedAt?.toISOString() ?? null,
      translations: this.translationAuditSummary(announcement.translations)
    };
  }

  private translationAuditSummary(value: unknown): Prisma.InputJsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        languages: [],
        lockedLanguages: [],
        machineDraftLanguages: [],
        humanReviewedLanguages: []
      };
    }

    const languages: string[] = [];
    const lockedLanguages: string[] = [];
    const machineDraftLanguages: string[] = [];
    const humanReviewedLanguages: string[] = [];
    for (const [language, fields] of Object.entries(value as Record<string, unknown>)) {
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        continue;
      }

      const record = fields as Record<string, unknown>;
      languages.push(language);
      if (record._locked === true || record._status === 'manual_locked') {
        lockedLanguages.push(language);
      }
      if (record._status === 'machine_draft') {
        machineDraftLanguages.push(language);
      }
      if (record._status === 'human_reviewed') {
        humanReviewedLanguages.push(language);
      }
    }

    return {
      languages,
      lockedLanguages,
      machineDraftLanguages,
      humanReviewedLanguages
    };
  }

  private translationWorkflowSummary(value: unknown): Prisma.InputJsonObject {
    const counts = {
      total: 0,
      machineDraft: 0,
      humanReviewed: 0,
      manualLocked: 0,
      locked: 0,
      untranslated: 0
    };

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        languages: [],
        counts,
        entries: []
      };
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .flatMap(([language, fields]) => {
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
          return [];
        }

        const record = fields as Record<string, unknown>;
        const status =
          typeof record._status === 'string' && record._status.trim().length > 0 ? record._status : 'unreviewed';
        const locked = record._locked === true || status === 'manual_locked';
        const isSourceFallbackDraft = isSourceFallbackDraftRecord(record);
        const hasTitle = !isSourceFallbackDraft && typeof record.title === 'string' && record.title.trim().length > 0;
        const hasContent = !isSourceFallbackDraft && typeof record.content === 'string' && record.content.trim().length > 0;

        return [
          {
            language,
            status,
            locked,
            source: typeof record._source === 'string' ? record._source : null,
            hasTitle,
            hasContent,
            updatedAt: typeof record._updatedAt === 'string' ? record._updatedAt : null
          }
        ];
      })
      .sort((a, b) => a.language.localeCompare(b.language));

    for (const entry of entries) {
      counts.total += 1;
      if (entry.status === 'machine_draft') {
        counts.machineDraft += 1;
      }
      if (entry.status === 'human_reviewed') {
        counts.humanReviewed += 1;
      }
      if (entry.status === 'manual_locked') {
        counts.manualLocked += 1;
      }
      if (entry.locked) {
        counts.locked += 1;
      }
      if (!entry.hasTitle || !entry.hasContent) {
        counts.untranslated += 1;
      }
    }

    return {
      languages: entries.map((entry) => entry.language),
      counts,
      entries
    };
  }

  private async getActiveTranslationGlossaryMap() {
    const rows = await this.prisma.translationGlossaryTerm.findMany({
      where: { isActive: true },
      orderBy: { sourceTerm: 'asc' },
      take: 500
    });

    return this.translationGlossaryRowsToMap(rows);
  }

  private translationGlossaryRowsToMap(
    rows: Array<{ sourceTerm: string; replacementTerm: string; isActive?: boolean }>
  ) {
    return Object.fromEntries(
      rows
        .filter((row) => row.isActive !== false)
        .map((row) => [row.sourceTerm.trim(), row.replacementTerm.trim()] as const)
        .filter(([sourceTerm, replacementTerm]) => sourceTerm.length > 0 && replacementTerm.length > 0)
        .sort(([left], [right]) => right.length - left.length)
    );
  }

  private normalizeGlossaryTerm(value: unknown, field: string) {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be text`);
    }

    const text = value.trim();
    if (text.length < 1 || text.length > 120) {
      throw new BadRequestException(`${field} must be 1-120 characters`);
    }
    if (/[\x00-\x1F\x7F]/.test(text)) {
      throw new BadRequestException(`${field} contains unsupported characters`);
    }

    return text;
  }

  private toPublicTranslationGlossaryTerm(item: {
    id: string;
    sourceTerm: string;
    replacementTerm: string;
    note: string | null;
    isActive: boolean;
    createdByAdminId: string | null;
    updatedByAdminId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: item.id,
      sourceTerm: item.sourceTerm,
      replacementTerm: item.replacementTerm,
      note: item.note,
      isActive: item.isActive,
      createdByAdminId: item.createdByAdminId,
      updatedByAdminId: item.updatedByAdminId,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  private translationGlossaryAuditSnapshot(item: {
    id: string;
    sourceTerm: string;
    replacementTerm: string;
    note: string | null;
    isActive: boolean;
  }): Prisma.InputJsonObject {
    return {
      id: item.id,
      sourceTerm: item.sourceTerm,
      replacementTerm: item.replacementTerm,
      note: item.note,
      isActive: item.isActive
    };
  }

  private resolveAnnouncementPreviewTranslation(translations: unknown, language: string | null) {
    const matched = this.getAnnouncementTranslationRecord(translations, language);
    if (!matched) {
      return {
        language: null,
        title: null,
        content: null,
        status: 'source',
        locked: false,
        source: null,
        updatedAt: null
      };
    }

    const { language: matchedLanguage, record } = matched;
    const status =
      typeof record._status === 'string' && record._status.trim().length > 0 ? record._status.trim() : 'unreviewed';
    const title = typeof record.title === 'string' && record.title.trim().length > 0 ? record.title.trim() : null;
    const content = typeof record.content === 'string' && record.content.trim().length > 0 ? record.content.trim() : null;

    return {
      language: matchedLanguage,
      title,
      content,
      status,
      locked: record._locked === true || status === 'manual_locked',
      source: typeof record._source === 'string' && record._source.trim().length > 0 ? record._source.trim() : null,
      updatedAt: typeof record._updatedAt === 'string' && record._updatedAt.trim().length > 0 ? record._updatedAt.trim() : null
    };
  }

  private getAnnouncementTranslationRecord(translations: unknown, language: string | null) {
    if (!language || !translations || typeof translations !== 'object' || Array.isArray(translations)) {
      return null;
    }

    const records = translations as Record<string, unknown>;
    for (const candidate of this.getAnnouncementPreviewLanguageCandidates(language)) {
      const exact = records[candidate];
      if (exact && typeof exact === 'object' && !Array.isArray(exact)) {
        const record = exact as Record<string, unknown>;
        if (!isSourceFallbackDraftRecord(record)) {
          return { language: candidate, record };
        }
      }

      const matchedKey = Object.keys(records).find((key) => key.toLowerCase() === candidate.toLowerCase());
      const matched = matchedKey ? records[matchedKey] : null;
      if (matchedKey && matched && typeof matched === 'object' && !Array.isArray(matched)) {
        const record = matched as Record<string, unknown>;
        if (!isSourceFallbackDraftRecord(record)) {
          return { language: matchedKey, record };
        }
      }
    }

    return null;
  }

  private getAnnouncementPreviewLanguageCandidates(language: string) {
    const base = language.split('-')[0];
    return Array.from(new Set([language, language.toLowerCase(), base, base.toLowerCase()]));
  }

  private normalizeAnnouncementPreviewLanguage(value: unknown) {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    if (typeof value !== 'string') {
      throw new BadRequestException('language must be a language code');
    }

    const [base, ...regions] = value.trim().replace(/_/g, '-').split('-');
    const normalized = [base?.toLowerCase(), ...regions.map((region) => region.toUpperCase())].filter(Boolean).join('-');
    if (!ANNOUNCEMENT_PREVIEW_LANGUAGE_PATTERN.test(normalized)) {
      throw new BadRequestException('language must be a language code');
    }

    return normalized;
  }

  private normalizeAnnouncementPrepareLanguages(body: PrepareAnnouncementTranslationInput) {
    const rawValue = Object.prototype.hasOwnProperty.call(body, 'targetLanguages')
      ? body.targetLanguages
      : body.languages;
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return null;
    }

    const rawLanguages = Array.isArray(rawValue)
      ? rawValue
      : typeof rawValue === 'string'
        ? rawValue.split(',')
        : null;

    if (!rawLanguages) {
      throw new BadRequestException('targetLanguages must be an array or comma-separated language list');
    }

    if (rawLanguages.length > 80) {
      throw new BadRequestException('targetLanguages must contain 80 languages or fewer');
    }

    const languages = rawLanguages.map((value) => this.normalizeAnnouncementPreviewLanguage(value));
    const normalized = Array.from(
      new Set(languages.filter((language): language is string => Boolean(language)))
    );
    return normalized.length > 0 ? normalized : null;
  }

  private requiredText(value: unknown, field: string, min: number, max: number) {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
      throw new BadRequestException(`${field} must be a string with ${min}-${max} characters`);
    }

    return value.trim();
  }

  private resolveModelPricingForCreate(body: ModelPriceInput): ResolvedModelPricing {
    const pricingMode = this.normalizePricingMode(body.pricingMode, ModelPricingMode.MANUAL);
    if (
      pricingMode === ModelPricingMode.MANUAL &&
      body.inputPriceCentsPer1k === undefined &&
      body.outputPriceCentsPer1k === undefined &&
      body.modelMultiplier === undefined
    ) {
      return this.buildResolvedModelPricing({
        pricingMode,
        inputPriceCentsPer1k: deepSeekBaseUsdUnitsPer1k(),
        outputPriceCentsPer1k: deepSeekBaseUsdUnitsPer1k(),
        modelMultiplier: '1.0000',
        upstreamInputPricePerMillion: null,
        upstreamOutputPricePerMillion: null,
        upstreamCurrency: null,
        upstreamExchangeRate: null,
        marginPercent: null
      });
    }

    return this.resolveModelPricing(pricingMode, body);
  }

  private resolveRoutePricingForCreate(body: UpstreamModelInput): ResolvedModelPricing | null {
    if (body.pricingMode === undefined) {
      return null;
    }

    const pricingMode = this.normalizePricingMode(body.pricingMode, ModelPricingMode.MANUAL);
    return this.resolveModelPricing(pricingMode, body);
  }

  private resolveRoutePricingForUpdate(
    body: UpstreamModelInput,
    existing: RoutePricingRecordForPricing
  ): ResolvedModelPricing | undefined {
    if (body.pricingMode === undefined) {
      return undefined;
    }

    const existingPricing = this.existingRoutePricingOrUndefined(existing);
    const fallbackMode = existingPricing?.pricingMode ?? ModelPricingMode.MANUAL;
    const pricingMode = this.normalizePricingMode(body.pricingMode, fallbackMode);

    return this.resolveModelPricing(pricingMode, body, existingPricing);
  }

  private existingRoutePricingOrUndefined(
    existing: RoutePricingRecordForPricing
  ): ModelPriceRecordForPricing | undefined {
    if (
      !existing.pricingMode ||
      existing.inputPriceCentsPer1k === null ||
      existing.outputPriceCentsPer1k === null ||
      existing.modelMultiplier === null
    ) {
      return undefined;
    }

    return {
      pricingMode: existing.pricingMode,
      inputPriceCentsPer1k: existing.inputPriceCentsPer1k,
      outputPriceCentsPer1k: existing.outputPriceCentsPer1k,
      modelMultiplier: existing.modelMultiplier,
      upstreamInputPricePerMillion: existing.upstreamInputPricePerMillion,
      upstreamOutputPricePerMillion: existing.upstreamOutputPricePerMillion,
      upstreamCurrency: existing.upstreamCurrency,
      upstreamExchangeRate: existing.upstreamExchangeRate,
      marginPercent: existing.marginPercent
    };
  }

  private resolveModelPricingForUpdate(
    body: ModelPriceInput,
    existing: ModelPriceRecordForPricing
  ): ResolvedModelPricing {
    const pricingMode =
      body.pricingMode === undefined ? existing.pricingMode : this.normalizePricingMode(body.pricingMode, existing.pricingMode);

    return this.resolveModelPricing(pricingMode, body, existing);
  }

  private resolveModelPricing(
    pricingMode: ModelPricingMode,
    body: ModelPriceInput,
    existing?: ModelPriceRecordForPricing
  ): ResolvedModelPricing {
    if (pricingMode === ModelPricingMode.DEEPSEEK_BASE) {
      const modelMultiplier =
        body.modelMultiplier === undefined && existing?.pricingMode === ModelPricingMode.DEEPSEEK_BASE
          ? existing.modelMultiplier.toString()
          : this.normalizeMultiplier(body.modelMultiplier, 'modelMultiplier');
      const inputPriceCentsPer1k = deepSeekBaseUsdUnitsPer1k();
      const outputPriceCentsPer1k = deepSeekBaseUsdUnitsPer1k();

      return this.buildResolvedModelPricing({
        pricingMode,
        inputPriceCentsPer1k,
        outputPriceCentsPer1k,
        modelMultiplier,
        upstreamInputPricePerMillion: null,
        upstreamOutputPricePerMillion: null,
        upstreamCurrency: null,
        upstreamExchangeRate: null,
        marginPercent: null
      });
    }

    if (pricingMode === ModelPricingMode.RELAY_PRICE) {
      const inputPricePerMillion = this.modelPriceNumber(
        body.upstreamInputPricePerMillion,
        existing?.upstreamInputPricePerMillion,
        'upstreamInputPricePerMillion'
      );
      const outputPricePerMillion = this.modelPriceNumber(
        body.upstreamOutputPricePerMillion,
        existing?.upstreamOutputPricePerMillion,
        'upstreamOutputPricePerMillion'
      );
      const currency = this.normalizeTokenPricingCurrency(body.upstreamCurrency ?? existing?.upstreamCurrency);
      const usdToCnyRate = this.modelPriceNumber(
        body.upstreamExchangeRate,
        existing?.upstreamExchangeRate,
        'upstreamExchangeRate',
        0.000001,
        10000,
        DEFAULT_USD_TO_CNY_RATE
      );
      const marginPercent = this.modelPriceNumber(body.marginPercent, existing?.marginPercent, 'marginPercent', 0, 1000, 10);
      const calculated = calculateRelayUsdPricing({
        inputPricePerMillion,
        outputPricePerMillion,
        currency,
        usdToCnyRate,
        marginPercent
      });

      return this.buildResolvedModelPricing({
        pricingMode,
        inputPriceCentsPer1k: calculated.inputUsdUnitsPer1k,
        outputPriceCentsPer1k: calculated.outputUsdUnitsPer1k,
        modelMultiplier: '1.0000',
        upstreamInputPricePerMillion: inputPricePerMillion.toFixed(4),
        upstreamOutputPricePerMillion: outputPricePerMillion.toFixed(4),
        upstreamCurrency: calculated.currency,
        upstreamExchangeRate: calculated.exchangeRate.toFixed(6),
        marginPercent: calculated.marginPercent.toFixed(4)
      });
    }

    const inputPriceCentsPer1k =
      body.inputPriceCentsPer1k === undefined && existing
        ? existing.inputPriceCentsPer1k
        : this.nonNegativeInt(body.inputPriceCentsPer1k, 'inputPriceCentsPer1k', 0, 100000000);
    const outputPriceCentsPer1k =
      body.outputPriceCentsPer1k === undefined && existing
        ? existing.outputPriceCentsPer1k
        : this.nonNegativeInt(body.outputPriceCentsPer1k, 'outputPriceCentsPer1k', 0, 100000000);
    const modelMultiplier =
      body.modelMultiplier === undefined && existing
        ? existing.modelMultiplier.toString()
        : this.normalizeMultiplier(body.modelMultiplier, 'modelMultiplier');

    return this.buildResolvedModelPricing({
      pricingMode: ModelPricingMode.MANUAL,
      inputPriceCentsPer1k,
      outputPriceCentsPer1k,
      modelMultiplier,
      upstreamInputPricePerMillion: null,
      upstreamOutputPricePerMillion: null,
      upstreamCurrency: null,
      upstreamExchangeRate: null,
      marginPercent: null
    });
  }

  private buildResolvedModelPricing(input: Omit<ResolvedModelPricing, 'auditSnapshot'>): ResolvedModelPricing {
    return {
      ...input,
      auditSnapshot: {
        pricingMode: input.pricingMode.toLowerCase(),
        inputPriceCentsPer1k: input.inputPriceCentsPer1k,
        outputPriceCentsPer1k: input.outputPriceCentsPer1k,
        modelMultiplier: input.modelMultiplier,
        upstreamInputPricePerMillion: input.upstreamInputPricePerMillion,
        upstreamOutputPricePerMillion: input.upstreamOutputPricePerMillion,
        upstreamCurrency: input.upstreamCurrency,
        upstreamExchangeRate: input.upstreamExchangeRate,
        marginPercent: input.marginPercent
      }
    };
  }

  private validateRoutePricingForProvider(kind: UpstreamProviderKind, pricingMode: ModelPricingMode | null) {
    if (
      kind === UpstreamProviderKind.DEEPSEEK &&
      pricingMode !== ModelPricingMode.DEEPSEEK_BASE &&
      pricingMode !== ModelPricingMode.MANUAL
    ) {
      throw new BadRequestException('DeepSeek upstream routes must use manual or deepseek_base pricing');
    }

    if (kind === UpstreamProviderKind.RELAY && pricingMode !== ModelPricingMode.RELAY_PRICE) {
      throw new BadRequestException('Relay upstream routes must use relay_price pricing');
    }

    if (kind === UpstreamProviderKind.GENERIC && pricingMode && pricingMode !== ModelPricingMode.MANUAL) {
      throw new BadRequestException('Generic upstream routes must use manual pricing');
    }
  }

  private routePricingData(pricing: ResolvedModelPricing | null) {
    return {
      pricingMode: pricing?.pricingMode ?? null,
      inputPriceCentsPer1k: pricing?.inputPriceCentsPer1k ?? null,
      outputPriceCentsPer1k: pricing?.outputPriceCentsPer1k ?? null,
      modelMultiplier: pricing?.modelMultiplier ?? null,
      upstreamInputPricePerMillion: pricing?.upstreamInputPricePerMillion ?? null,
      upstreamOutputPricePerMillion: pricing?.upstreamOutputPricePerMillion ?? null,
      upstreamCurrency: pricing?.upstreamCurrency ?? null,
      upstreamExchangeRate: pricing?.upstreamExchangeRate ?? null,
      marginPercent: pricing?.marginPercent ?? null
    };
  }

  private routePricingSnapshot(model: {
    pricingMode: ModelPricingMode | null;
    inputPriceCentsPer1k: number | null;
    outputPriceCentsPer1k: number | null;
    modelMultiplier: { toString(): string } | null;
    upstreamInputPricePerMillion: { toString(): string } | null;
    upstreamOutputPricePerMillion: { toString(): string } | null;
    upstreamCurrency: string | null;
    upstreamExchangeRate: { toString(): string } | null;
    marginPercent: { toString(): string } | null;
  }) {
    if (!model.pricingMode) {
      return null;
    }

    return {
      pricingMode: model.pricingMode.toLowerCase(),
      inputPriceCentsPer1k: model.inputPriceCentsPer1k,
      outputPriceCentsPer1k: model.outputPriceCentsPer1k,
      modelMultiplier: model.modelMultiplier?.toString() ?? null,
      upstreamInputPricePerMillion: model.upstreamInputPricePerMillion?.toString() ?? null,
      upstreamOutputPricePerMillion: model.upstreamOutputPricePerMillion?.toString() ?? null,
      upstreamCurrency: model.upstreamCurrency,
      upstreamExchangeRate: model.upstreamExchangeRate?.toString() ?? null,
      marginPercent: model.marginPercent?.toString() ?? null
    };
  }

  private modelPriceNumber(
    value: unknown,
    fallback: { toString(): string } | null | undefined,
    field: string,
    min = 0,
    max = 1000000,
    defaultValue?: number
  ) {
    if (value === undefined || value === null || value === '') {
      if (fallback) {
        return this.numberFromString(fallback.toString(), field, min, max);
      }
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw new BadRequestException(`${field} is required`);
    }

    return this.numberFromString(String(value), field, min, max);
  }

  private modelPricePositiveNumber(
    value: unknown,
    fallback: { toString(): string } | null | undefined,
    field: string
  ) {
    return this.modelPriceNumber(value, fallback, field, 0.000001, 10000);
  }

  private numberFromString(value: string, field: string, min: number, max: number) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < min || numericValue > max) {
      throw new BadRequestException(`${field} must be a number between ${min} and ${max}`);
    }

    return numericValue;
  }

  private normalizePricingMode(value: unknown, fallback: ModelPricingMode): ModelPricingMode {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('pricingMode must be manual, deepseek_base, or relay_price');
    }

    const normalized = value.toLowerCase();
    if (normalized === ModelPricingMode.MANUAL.toLowerCase()) {
      return ModelPricingMode.MANUAL;
    }
    if (normalized === ModelPricingMode.DEEPSEEK_BASE.toLowerCase()) {
      return ModelPricingMode.DEEPSEEK_BASE;
    }
    if (normalized === ModelPricingMode.RELAY_PRICE.toLowerCase()) {
      return ModelPricingMode.RELAY_PRICE;
    }

    throw new BadRequestException('pricingMode must be manual, deepseek_base, or relay_price');
  }

  private normalizeTokenPricingCurrency(value: unknown): TokenPricingCurrency {
    if (value === undefined || value === null || value === '') {
      return 'CNY';
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('upstreamCurrency must be CNY or USD');
    }

    const normalized = value.toUpperCase();
    if (normalized === 'CNY' || normalized === 'USD') {
      return normalized;
    }

    throw new BadRequestException('upstreamCurrency must be CNY or USD');
  }

  private normalizeUpstreamProviderKind(value: unknown): UpstreamProviderKind {
    if (value === undefined || value === null || value === '') {
      return UpstreamProviderKind.GENERIC;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('kind must be generic, deepseek, or relay');
    }

    const normalized = value.toLowerCase();
    if (normalized === UpstreamProviderKind.GENERIC.toLowerCase()) {
      return UpstreamProviderKind.GENERIC;
    }
    if (normalized === UpstreamProviderKind.DEEPSEEK.toLowerCase()) {
      return UpstreamProviderKind.DEEPSEEK;
    }
    if (normalized === UpstreamProviderKind.RELAY.toLowerCase()) {
      return UpstreamProviderKind.RELAY;
    }

    throw new BadRequestException('kind must be generic, deepseek, or relay');
  }

  private normalizeBaseUrl(value: unknown) {
    const rawValue = this.requiredText(value, 'baseUrl', 8, 2048);
    let parsed: URL;

    try {
      parsed = new URL(rawValue);
    } catch {
      throw new BadRequestException('baseUrl must be a valid http or https URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('baseUrl must use http or https');
    }

    if (parsed.username || parsed.password) {
      throw new BadRequestException('baseUrl must not include credentials');
    }

    parsed.hash = '';
    parsed.search = '';

    const normalized = parsed.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  }

  private normalizeUpstreamStatus(value: unknown): UpstreamProviderStatus {
    if (value === undefined || value === null || value === '') {
      return UpstreamProviderStatus.ACTIVE;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('status must be active or disabled');
    }

    const normalized = value.toLowerCase();
    if (normalized === UpstreamProviderStatus.ACTIVE.toLowerCase()) {
      return UpstreamProviderStatus.ACTIVE;
    }
    if (normalized === UpstreamProviderStatus.DISABLED.toLowerCase()) {
      return UpstreamProviderStatus.DISABLED;
    }

    throw new BadRequestException('status must be active or disabled');
  }

  private hasAnnouncementPinnedInput(body: AnnouncementInput) {
    return Object.prototype.hasOwnProperty.call(body, 'isPinned') || Object.prototype.hasOwnProperty.call(body, 'pinned');
  }

  private normalizeAnnouncementPinned(body: AnnouncementInput) {
    const hasIsPinned = Object.prototype.hasOwnProperty.call(body, 'isPinned');
    const hasPinnedAlias = Object.prototype.hasOwnProperty.call(body, 'pinned');
    if (hasIsPinned && hasPinnedAlias && body.isPinned !== body.pinned) {
      throw new BadRequestException('isPinned and pinned must match when both are provided');
    }

    return this.optionalBoolean(hasIsPinned ? body.isPinned : body.pinned, false, 'isPinned');
  }

  private hasAnnouncementScheduleInput(body: AnnouncementInput) {
    return (
      Object.prototype.hasOwnProperty.call(body, 'scheduledAt') ||
      Object.prototype.hasOwnProperty.call(body, 'scheduledPublishAt')
    );
  }

  private normalizeAnnouncementSchedule(body: AnnouncementInput) {
    const hasScheduledAt = Object.prototype.hasOwnProperty.call(body, 'scheduledAt');
    const hasScheduledPublishAt = Object.prototype.hasOwnProperty.call(body, 'scheduledPublishAt');
    const scheduledAt = hasScheduledAt ? this.optionalDateTime(body.scheduledAt, 'scheduledAt') : undefined;
    const scheduledPublishAt = hasScheduledPublishAt
      ? this.optionalDateTime(body.scheduledPublishAt, 'scheduledPublishAt')
      : undefined;

    if (scheduledAt !== undefined && scheduledPublishAt !== undefined) {
      if (scheduledAt === null && scheduledPublishAt === null) {
        return null;
      }
      if (scheduledAt === null || scheduledPublishAt === null || scheduledAt.getTime() !== scheduledPublishAt.getTime()) {
        throw new BadRequestException('scheduledAt and scheduledPublishAt must match when both are provided');
      }
      return scheduledAt;
    }

    return scheduledAt ?? scheduledPublishAt ?? null;
  }

  private optionalDateTime(value: unknown, field: string) {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be an ISO datetime string`);
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO datetime string`);
    }

    return date;
  }

  private normalizeStatus(value: unknown): AnnouncementStatus {
    if (value === undefined || value === null || value === '') {
      return AnnouncementStatus.PUBLISHED;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('status must be draft, published, or archived');
    }

    const normalized = value.toLowerCase();
    if (normalized === AnnouncementStatus.DRAFT.toLowerCase()) {
      return AnnouncementStatus.DRAFT;
    }
    if (normalized === AnnouncementStatus.PUBLISHED.toLowerCase()) {
      return AnnouncementStatus.PUBLISHED;
    }
    if (normalized === AnnouncementStatus.ARCHIVED.toLowerCase()) {
      return AnnouncementStatus.ARCHIVED;
    }

    throw new BadRequestException('status must be draft, published, or archived');
  }

  private normalizeAnnouncementCategory(value: unknown): AnnouncementCategory {
    if (value === undefined || value === null || value === '') {
      return AnnouncementCategory.ANNOUNCEMENT;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('category must be announcement, update_log, or usage_guide');
    }

    const normalized = value.toLowerCase();
    if (normalized === AnnouncementCategory.ANNOUNCEMENT.toLowerCase()) {
      return AnnouncementCategory.ANNOUNCEMENT;
    }
    if (normalized === AnnouncementCategory.UPDATE_LOG.toLowerCase()) {
      return AnnouncementCategory.UPDATE_LOG;
    }
    if (normalized === AnnouncementCategory.USAGE_GUIDE.toLowerCase()) {
      return AnnouncementCategory.USAGE_GUIDE;
    }

    throw new BadRequestException('category must be announcement, update_log, or usage_guide');
  }

  private normalizeGroupCode(value: unknown) {
    const code = this.requiredText(value, 'code', 2, 40).toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(code)) {
      throw new BadRequestException('code must contain only lowercase letters, numbers, underscores, or hyphens');
    }

    return code;
  }

  private normalizeModelName(value: unknown, field: string) {
    const model = this.requiredText(value, field, 2, 120);
    if (UNSUPPORTED_MODEL_NAME_CHARACTERS.test(model)) {
      throw new BadRequestException(`${field} contains unsupported characters`);
    }

    return model;
  }

  private normalizeGroupStatus(value: unknown): GroupStatus {
    if (value === undefined || value === null || value === '') {
      return GroupStatus.ACTIVE;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('status must be active or disabled');
    }

    const normalized = value.toLowerCase();
    if (normalized === GroupStatus.ACTIVE.toLowerCase()) {
      return GroupStatus.ACTIVE;
    }
    if (normalized === GroupStatus.DISABLED.toLowerCase()) {
      return GroupStatus.DISABLED;
    }

    throw new BadRequestException('status must be active or disabled');
  }

  private normalizeModelStatus(value: unknown): ModelStatus {
    if (value === undefined || value === null || value === '') {
      return ModelStatus.ACTIVE;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('status must be active or disabled');
    }

    const normalized = value.toLowerCase();
    if (normalized === ModelStatus.ACTIVE.toLowerCase()) {
      return ModelStatus.ACTIVE;
    }
    if (normalized === ModelStatus.DISABLED.toLowerCase()) {
      return ModelStatus.DISABLED;
    }

    throw new BadRequestException('status must be active or disabled');
  }

  private normalizeMultiplier(value: unknown, field: string) {
    if (value === undefined || value === null || value === '') {
      return '1.0000';
    }

    const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue > 100) {
      throw new BadRequestException(`${field} must be greater than 0 and no more than 100`);
    }

    return numericValue.toFixed(4);
  }

  private nonNegativeInt(value: unknown, field: string, min: number, max: number) {
    const numericValue = value === undefined || value === null || value === '' ? min : Number(value);
    if (!Number.isInteger(numericValue) || numericValue < min || numericValue > max) {
      throw new BadRequestException(`${field} must be an integer between ${min} and ${max}`);
    }

    return numericValue;
  }

  private optionalPositiveInt(value: unknown, field: string, max: number) {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    const numericValue = Number(value);
    if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > max) {
      throw new BadRequestException(`${field} must be an integer between 1 and ${max}`);
    }

    return numericValue;
  }

  private optionalText(value: unknown, field: string, min: number, max: number) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return this.requiredText(value, field, min, max);
  }

  private requiredUuid(value: unknown, field: string) {
    if (typeof value !== 'string' || !this.isUuid(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }

    return value;
  }

  private requiredUuidArray(value: unknown, field: string) {
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException(`${field} must include at least one UUID`);
    }

    const ids = value.map((entry) => this.requiredUuid(entry, field));
    return [...new Set(ids)];
  }

  private optionalBoolean(value: unknown, defaultValue: boolean, field = 'supportsStream') {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    throw new BadRequestException(`${field} must be true or false`);
  }

  private optionalFilterText(value: unknown, field: string) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be text`);
    }

    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }

    if (normalized.length > 120 || !/^[a-zA-Z0-9._:/+ -]+$/.test(normalized)) {
      throw new BadRequestException(`${field} contains unsupported characters`);
    }

    return normalized;
  }

  private normalizeRequestLogStatus(value: unknown) {
    if (value === undefined || value === null || value === '' || value === 'all') {
      return 'all';
    }

    if (value === 'success' || value === 'error') {
      return value;
    }

    throw new BadRequestException('status must be all, success, or error');
  }

  private requestLogStatusWhere(status: 'all' | 'success' | 'error'): Prisma.RequestLogWhereInput {
    if (status === 'success') {
      return {
        errorCode: null,
        statusCode: { lt: 400 }
      };
    }

    if (status === 'error') {
      return {
        OR: [{ errorCode: { not: null } }, { statusCode: { gte: 400 } }]
      };
    }

    return {};
  }

  private optionalAsyncTaskStatus(value: unknown) {
    if (value === undefined || value === null || value === '' || value === 'all') {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('status must be queued, running, succeeded, failed, or canceled');
    }

    const normalized = value.toUpperCase();
    if (normalized === AsyncTaskStatus.QUEUED) {
      return AsyncTaskStatus.QUEUED;
    }
    if (normalized === AsyncTaskStatus.RUNNING) {
      return AsyncTaskStatus.RUNNING;
    }
    if (normalized === AsyncTaskStatus.SUCCEEDED) {
      return AsyncTaskStatus.SUCCEEDED;
    }
    if (normalized === AsyncTaskStatus.FAILED) {
      return AsyncTaskStatus.FAILED;
    }
    if (normalized === AsyncTaskStatus.CANCELED) {
      return AsyncTaskStatus.CANCELED;
    }

    throw new BadRequestException('status must be queued, running, succeeded, failed, or canceled');
  }

  private toAsyncTaskStatusCounts(groups: Array<{ status: AsyncTaskStatus; _count?: true | { _all?: number } }>) {
    const counts = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      canceled: 0
    };

    for (const group of groups) {
      const count = typeof group._count === 'object' && group._count ? group._count._all ?? 0 : 0;
      counts[group.status.toLowerCase() as keyof typeof counts] = count;
    }

    return counts;
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private async bootstrapAdminFromEnv() {
    const username = process.env.ADMIN_BOOTSTRAP_USERNAME?.trim().toLowerCase();
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    const forceReset = this.isBootstrapForceResetEnabled();

    if (!username && !password) {
      return;
    }

    if (!username || !password) {
      throw new Error('ADMIN_BOOTSTRAP_USERNAME and ADMIN_BOOTSTRAP_PASSWORD must be set together');
    }

    if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
      throw new Error('ADMIN_BOOTSTRAP_USERNAME must be 3-32 lowercase letters, numbers, underscores, or hyphens');
    }

    if (password.length < 12 || password.length > 128) {
      throw new Error('ADMIN_BOOTSTRAP_PASSWORD must be 12-128 characters');
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);

    await this.prisma.$transaction(async (tx) => {
      const group = await tx.userGroup.upsert({
        where: { code: 'default' },
        update: {},
        create: {
          code: 'default',
          name: '默认分组'
        }
      });

      const existingUser = await tx.user.findUnique({
        where: { username }
      });

      if (existingUser) {
        const isActiveAdmin =
          existingUser.role === UserRole.ADMIN &&
          existingUser.status === UserStatus.ACTIVE &&
          !existingUser.deletedAt;

        if (isActiveAdmin && !forceReset) {
          return;
        }

        if (!forceReset) {
          throw new Error(
            'ADMIN_BOOTSTRAP_USERNAME already exists but is not an active admin. Set ADMIN_BOOTSTRAP_FORCE_RESET=true to intentionally reset it'
          );
        }

        await tx.user.update({
          where: { id: existingUser.id },
          data: {
            passwordHash,
            role: UserRole.ADMIN,
            status: UserStatus.ACTIVE,
            deletedAt: null
          }
        });
        return;
      }

      const admin = await tx.user.create({
        data: {
          username,
          passwordHash,
          role: UserRole.ADMIN,
          groupId: group.id,
          inviteCode: this.createBootstrapInviteCode()
        }
      });

      await tx.wallet.create({
        data: { userId: admin.id }
      });
    });
  }

  private createBootstrapInviteCode() {
    return `admin-${randomBytes(4).toString('hex')}`;
  }

  private isBootstrapForceResetEnabled() {
    const configured = process.env.ADMIN_BOOTSTRAP_FORCE_RESET?.trim().toLowerCase();
    if (!configured) {
      return false;
    }

    if (configured === 'true') {
      return true;
    }

    if (configured === 'false') {
      return false;
    }

    throw new Error('ADMIN_BOOTSTRAP_FORCE_RESET must be true or false');
  }

  private isUniqueViolation(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private async fetchUpstreamHealth(baseUrl: string, apiKey: string) {
    const startedAt = Date.now();
    const addressError = await this.getPublicUpstreamAddressError(baseUrl);
    if (addressError) {
      return {
        healthStatus: UpstreamHealthStatus.UNHEALTHY,
        latencyMs: Date.now() - startedAt,
        error: addressError
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_HEALTH_CHECK_TIMEOUT_MS);

    try {
      const response = await fetch(this.buildUpstreamModelsUrl(baseUrl), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        signal: controller.signal
      });
      await response.text().catch(() => undefined);

      return {
        healthStatus: response.ok ? UpstreamHealthStatus.HEALTHY : UpstreamHealthStatus.UNHEALTHY,
        latencyMs: Date.now() - startedAt,
        error: response.ok ? null : `HTTP ${response.status}`
      };
    } catch (error) {
      return {
        healthStatus: UpstreamHealthStatus.UNHEALTHY,
        latencyMs: Date.now() - startedAt,
        error: this.normalizeHealthCheckError(error)
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildUpstreamModelsUrl(baseUrl: string) {
    return `${baseUrl.replace(/\/+$/, '')}/v1/models`;
  }

  private async getPublicUpstreamAddressError(baseUrl: string) {
    const parsed = new URL(baseUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (this.isBlockedUpstreamHostname(hostname)) {
      return PRIVATE_UPSTREAM_ADDRESS_ERROR;
    }

    if (isIP(hostname)) {
      return this.isPrivateOrLocalAddress(hostname) ? PRIVATE_UPSTREAM_ADDRESS_ERROR : null;
    }

    try {
      const addresses = await this.lookupUpstreamAddresses(hostname);
      if (!addresses.length) {
        return 'Upstream host could not be resolved';
      }

      return addresses.some((entry) => this.isPrivateOrLocalAddress(entry.address))
        ? PRIVATE_UPSTREAM_ADDRESS_ERROR
        : null;
    } catch (error) {
      return this.normalizeHealthCheckError(error);
    }
  }

  private async lookupUpstreamAddresses(hostname: string) {
    let lookupTimeout: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        lookup(hostname, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => {
          lookupTimeout = setTimeout(() => reject(new Error('DNS lookup timed out')), UPSTREAM_DNS_LOOKUP_TIMEOUT_MS);
        })
      ]);
    } finally {
      if (lookupTimeout) {
        clearTimeout(lookupTimeout);
      }
    }
  }

  private isBlockedUpstreamHostname(hostname: string) {
    return BLOCKED_UPSTREAM_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
  }

  private isPrivateOrLocalAddress(address: string) {
    const normalized = address.toLowerCase();
    const ipv4Mapped = normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized;

    if (isIP(ipv4Mapped) === 4) {
      return this.isPrivateOrLocalIpv4(ipv4Mapped);
    }

    if (isIP(normalized) === 6) {
      return this.isPrivateOrLocalIpv6(normalized);
    }

    return false;
  }

  private isPrivateOrLocalIpv4(address: string) {
    const parts = address.split('.').map((part) => Number(part));
    const [first, second, third] = parts;

    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 168) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113)
    );
  }

  private isPrivateOrLocalIpv6(address: string) {
    return (
      address === '::' ||
      address === '::1' ||
      address.startsWith('fc') ||
      address.startsWith('fd') ||
      address.startsWith('fe80:')
    );
  }

  private normalizeHealthCheckError(error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return 'Health check timed out';
    }

    if (error instanceof Error && error.message) {
      return this.truncateHealthError(error.message);
    }

    return 'Health check failed';
  }

  private truncateHealthError(message: string) {
    return message.length > UPSTREAM_HEALTH_ERROR_MAX_LENGTH
      ? `${message.slice(0, UPSTREAM_HEALTH_ERROR_MAX_LENGTH)}...`
      : message;
  }

  private toPublicGroup(group: {
    id: string;
    code: string;
    name: string;
    multiplier: { toString(): string };
    status: GroupStatus;
    createdAt: Date;
    updatedAt: Date;
    _count?: { users: number; modelAccesses: number };
  }) {
    return {
      id: group.id,
      code: group.code,
      name: group.name,
      multiplier: group.multiplier.toString(),
      status: group.status.toLowerCase(),
      userCount: group._count?.users ?? 0,
      modelAccessCount: group._count?.modelAccesses ?? 0,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString()
    };
  }

  private toPublicModelPrice(model: {
    id: string;
    model: string;
    displayName: string | null;
    translations: unknown;
    inputPriceCentsPer1k: number;
    outputPriceCentsPer1k: number;
    modelMultiplier: { toString(): string };
    pricingMode: ModelPricingMode;
    upstreamInputPricePerMillion: { toString(): string } | null;
    upstreamOutputPricePerMillion: { toString(): string } | null;
    upstreamCurrency: string | null;
    upstreamExchangeRate: { toString(): string } | null;
    marginPercent: { toString(): string } | null;
    status: ModelStatus;
    createdAt: Date;
    updatedAt: Date;
    groupAccesses?: Array<{
      group: {
        id: string;
        code: string;
        name: string;
      };
    }>;
    upstreamModels?: Array<{
      id: string;
      upstreamModel: string;
      priority: number;
      timeoutMs: number;
      upstreamPrompt: string | null;
      status: ModelStatus;
      supportsStream: boolean;
      provider: {
        id: string;
        name: string;
        kind: UpstreamProviderKind;
        status: UpstreamProviderStatus;
      };
      pricingMode: ModelPricingMode | null;
      inputPriceCentsPer1k: number | null;
      outputPriceCentsPer1k: number | null;
      modelMultiplier: { toString(): string } | null;
      upstreamInputPricePerMillion: { toString(): string } | null;
      upstreamOutputPricePerMillion: { toString(): string } | null;
      upstreamCurrency: string | null;
      upstreamExchangeRate: { toString(): string } | null;
      marginPercent: { toString(): string } | null;
    }>;
  }) {
    return {
      id: model.id,
      model: model.model,
      displayName: model.displayName,
      translations: model.translations ?? null,
      inputPriceCentsPer1k: model.inputPriceCentsPer1k,
      outputPriceCentsPer1k: model.outputPriceCentsPer1k,
      modelMultiplier: model.modelMultiplier.toString(),
      pricingMode: model.pricingMode.toLowerCase(),
      upstreamInputPricePerMillion: model.upstreamInputPricePerMillion?.toString() ?? null,
      upstreamOutputPricePerMillion: model.upstreamOutputPricePerMillion?.toString() ?? null,
      upstreamCurrency: model.upstreamCurrency,
      upstreamExchangeRate: model.upstreamExchangeRate?.toString() ?? null,
      marginPercent: model.marginPercent?.toString() ?? null,
      status: model.status.toLowerCase(),
      groups: (model.groupAccesses ?? []).map((access) => ({
        id: access.group.id,
        code: access.group.code,
        name: access.group.name
      })),
      upstreamMappings: (model.upstreamModels ?? []).map((mapping) => ({
        id: mapping.id,
        providerId: mapping.provider.id,
        providerName: mapping.provider.name,
        providerKind: mapping.provider.kind.toLowerCase(),
        providerStatus: mapping.provider.status.toLowerCase(),
        upstreamModel: mapping.upstreamModel,
        priority: mapping.priority,
        timeoutMs: mapping.timeoutMs,
        upstreamPrompt: mapping.upstreamPrompt,
        routePricing: this.routePricingSnapshot(mapping),
        status: mapping.status.toLowerCase(),
        supportsStream: mapping.supportsStream
      })),
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString()
    };
  }

  private toPublicUpstreamModel(model: {
    id: string;
    providerId: string;
    publicModel: string;
    upstreamModel: string;
    priority: number;
    timeoutMs: number;
    upstreamPrompt: string | null;
    status: ModelStatus;
    supportsStream: boolean;
    createdAt: Date;
    updatedAt: Date;
    provider: {
      id: string;
      name: string;
      kind: UpstreamProviderKind;
      status: UpstreamProviderStatus;
    };
    modelPrice: {
      displayName: string | null;
    };
    pricingMode: ModelPricingMode | null;
    inputPriceCentsPer1k: number | null;
    outputPriceCentsPer1k: number | null;
    modelMultiplier: { toString(): string } | null;
    upstreamInputPricePerMillion: { toString(): string } | null;
    upstreamOutputPricePerMillion: { toString(): string } | null;
    upstreamCurrency: string | null;
    upstreamExchangeRate: { toString(): string } | null;
    marginPercent: { toString(): string } | null;
  }) {
    return {
      id: model.id,
      providerId: model.providerId,
      providerName: model.provider.name,
      providerKind: model.provider.kind.toLowerCase(),
      providerStatus: model.provider.status.toLowerCase(),
      publicModel: model.publicModel,
      displayName: model.modelPrice.displayName,
      upstreamModel: model.upstreamModel,
      priority: model.priority,
      timeoutMs: model.timeoutMs,
      upstreamPrompt: model.upstreamPrompt,
      routePricing: this.routePricingSnapshot(model),
      status: model.status.toLowerCase(),
      supportsStream: model.supportsStream,
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString()
    };
  }

  private toPublicUpstreamProvider(provider: {
    id: string;
    name: string;
    kind: UpstreamProviderKind;
    baseUrl: string;
    apiKeyPreview: string;
    status: UpstreamProviderStatus;
    maxConcurrency: number | null;
    consecutiveFailures: number;
    circuitOpenedUntil: Date | null;
    lastFailureAt: Date | null;
    lastSuccessAt: Date | null;
    healthStatus: UpstreamHealthStatus;
    lastHealthCheckAt: Date | null;
    lastHealthLatencyMs: number | null;
    lastHealthError: string | null;
    createdAt: Date;
    updatedAt: Date;
    createdByAdmin?: { username: string };
  }) {
    return {
      id: provider.id,
      name: provider.name,
      kind: provider.kind.toLowerCase(),
      baseUrl: provider.baseUrl,
      apiKeyPreview: provider.apiKeyPreview,
      status: provider.status.toLowerCase(),
      maxConcurrency: provider.maxConcurrency,
      consecutiveFailures: provider.consecutiveFailures,
      circuitOpenedUntil: provider.circuitOpenedUntil?.toISOString() ?? null,
      lastFailureAt: provider.lastFailureAt?.toISOString() ?? null,
      lastSuccessAt: provider.lastSuccessAt?.toISOString() ?? null,
      healthStatus: provider.healthStatus.toLowerCase(),
      lastHealthCheckAt: provider.lastHealthCheckAt?.toISOString() ?? null,
      lastHealthLatencyMs: provider.lastHealthLatencyMs,
      lastHealthError: provider.lastHealthError,
      createdBy: provider.createdByAdmin?.username,
      createdAt: provider.createdAt.toISOString(),
      updatedAt: provider.updatedAt.toISOString()
    };
  }

  private async getDailyUserCostAlerts(startIso: string, endIso: string, thresholdCents: number) {
    const rows = await this.prisma.$queryRaw<DailyUserCostAlertRow[]>(Prisma.sql`
      WITH days AS (
        SELECT generate_series(
          ${startIso}::timestamp,
          ${endIso}::timestamp - interval '1 day',
          interval '1 day'
        ) AS bucket_start
      )
      SELECT
        to_char(days.bucket_start + interval '8 hours', 'YYYY-MM-DD') AS date_key,
        ue.user_id,
        u.username,
        COALESCE(sum(ue.cost_cents), 0)::bigint AS spend_cents,
        COALESCE(sum(ue.total_tokens), 0)::bigint AS total_tokens,
        count(*)::bigint AS request_count,
        max(ue.created_at) AS last_used_at
      FROM days
      INNER JOIN usage_events ue
        ON ue.created_at >= days.bucket_start
        AND ue.created_at < days.bucket_start + interval '1 day'
      INNER JOIN users u ON u.id = ue.user_id AND u.deleted_at IS NULL
      GROUP BY days.bucket_start, ue.user_id, u.username
      HAVING COALESCE(sum(ue.cost_cents), 0) >= ${thresholdCents}
      ORDER BY spend_cents DESC, last_used_at DESC
      LIMIT 50
    `);

    return rows.map((row) => ({
      date: row.date_key,
      userId: row.user_id,
      username: row.username,
      spendCents: this.toNumber(row.spend_cents),
      totalTokens: this.toNumber(row.total_tokens),
      requestCount: this.toNumber(row.request_count),
      thresholdCents,
      lastUsedAt: row.last_used_at?.toISOString() ?? null
    }));
  }

  private configuredUserDailyCostAlertCents() {
    const rawValue = process.env.ADMIN_USER_DAILY_COST_ALERT_CENTS?.trim();
    if (!rawValue) {
      return DEFAULT_USER_DAILY_COST_ALERT_CENTS;
    }

    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error('ADMIN_USER_DAILY_COST_ALERT_CENTS must be a non-negative integer');
    }

    return parsed;
  }

  private toNumber(value: unknown) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }

    if (typeof value === 'bigint') {
      return Number(value);
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
  }

  private async getUserFinanceMetrics(userIds: string[]) {
    if (!userIds.length) {
      return new Map<string, UserFinanceMetrics>();
    }

    const [usageGroups, rechargeGroups] = await Promise.all([
      this.prisma.usageEvent.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds } },
        _sum: {
          costCents: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true
        },
        _count: { _all: true },
        _max: { createdAt: true }
      }),
      this.prisma.walletTransaction.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          type: WalletTransactionType.RECHARGE,
          rechargeCodeId: { not: null }
        },
        _sum: { amountCents: true },
        _count: { _all: true },
        _max: { createdAt: true }
      })
    ]);

    return this.buildUserFinanceMetrics(usageGroups, rechargeGroups);
  }

  private buildUserFinanceMetrics(
    usageGroups: Array<{
      userId: string;
      _sum: {
        costCents?: number | null;
        promptTokens?: number | null;
        completionTokens?: number | null;
        totalTokens?: number | null;
      } | null;
      _count?: { _all?: number } | true;
      _max?: { createdAt?: Date | null } | null;
    }>,
    rechargeGroups: Array<{
      userId: string;
      _sum: { amountCents?: number | null } | null;
      _count?: { _all?: number } | true;
      _max?: { createdAt?: Date | null } | null;
    }>
  ) {
    const metricsByUserId = new Map<string, UserFinanceMetrics>();

    for (const group of usageGroups) {
      const metrics = this.ensureUserFinanceMetrics(metricsByUserId, group.userId);
      metrics.spendCents = group._sum?.costCents ?? 0;
      metrics.promptTokens = group._sum?.promptTokens ?? 0;
      metrics.completionTokens = group._sum?.completionTokens ?? 0;
      metrics.totalTokens = group._sum?.totalTokens ?? 0;
      metrics.requestCount = this.groupCount(group);
      metrics.lastUsedAt = group._max?.createdAt ?? null;
    }

    for (const group of rechargeGroups) {
      const metrics = this.ensureUserFinanceMetrics(metricsByUserId, group.userId);
      metrics.totalRechargeCents = group._sum?.amountCents ?? 0;
      metrics.rechargeCount = this.groupCount(group);
      metrics.lastRechargeAt = group._max?.createdAt ?? null;
    }

    return metricsByUserId;
  }

  private ensureUserFinanceMetrics(metricsByUserId: Map<string, UserFinanceMetrics>, userId: string) {
    const existing = metricsByUserId.get(userId);
    if (existing) {
      return existing;
    }

    const metrics = this.emptyUserFinanceMetrics();
    metricsByUserId.set(userId, metrics);
    return metrics;
  }

  private emptyUserFinanceMetrics(): UserFinanceMetrics {
    return {
      totalRechargeCents: 0,
      rechargeCount: 0,
      lastRechargeAt: null,
      spendCents: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      lastUsedAt: null
    };
  }

  private toAdminUser(
    user: {
      id: string;
      username: string;
      role: UserRole;
      status: UserStatus;
      timezone: string;
      group: { id: string; code: string; name: string };
      wallet: { balanceCents: number; totalSpendCents: number } | null;
      lastLoginAt: Date | null;
      createdAt: Date;
    },
    metricsInput?: UserFinanceMetrics
  ) {
    const metrics = metricsInput ?? this.emptyUserFinanceMetrics();

    return {
      id: user.id,
      username: user.username,
      role: user.role.toLowerCase(),
      status: user.status.toLowerCase(),
      timezone: user.timezone,
      group: {
        id: user.group.id,
        code: user.group.code,
        name: user.group.name
      },
      wallet: {
        balanceCents: user.wallet?.balanceCents ?? 0,
        totalSpendCents: user.wallet?.totalSpendCents ?? 0,
        totalRechargeCents: metrics.totalRechargeCents
      },
      usage: {
        spendCents: metrics.spendCents,
        promptTokens: metrics.promptTokens,
        completionTokens: metrics.completionTokens,
        totalTokens: metrics.totalTokens,
        requestCount: metrics.requestCount,
        lastUsedAt: metrics.lastUsedAt?.toISOString() ?? null
      },
      recharge: {
        totalCents: metrics.totalRechargeCents,
        count: metrics.rechargeCount,
        lastRechargedAt: metrics.lastRechargeAt?.toISOString() ?? null
      },
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString()
    };
  }

  private toUserStats(
    user: {
      id: string;
      username: string;
      role: UserRole;
      status: UserStatus;
      wallet: { balanceCents: number; totalSpendCents: number } | null;
      lastLoginAt: Date | null;
      createdAt: Date;
    },
    metricsInput?: UserFinanceMetrics
  ) {
    const metrics = metricsInput ?? this.emptyUserFinanceMetrics();

    return {
      id: user.id,
      username: user.username,
      role: user.role.toLowerCase(),
      status: user.status.toLowerCase(),
      wallet: {
        balanceCents: user.wallet?.balanceCents ?? 0,
        totalSpendCents: user.wallet?.totalSpendCents ?? 0,
        totalRechargeCents: metrics.totalRechargeCents
      },
      usage: {
        spendCents: metrics.spendCents,
        promptTokens: metrics.promptTokens,
        completionTokens: metrics.completionTokens,
        totalTokens: metrics.totalTokens,
        requestCount: metrics.requestCount,
        lastUsedAt: metrics.lastUsedAt?.toISOString() ?? null
      },
      recharge: {
        totalCents: metrics.totalRechargeCents,
        count: metrics.rechargeCount,
        lastRechargedAt: metrics.lastRechargeAt?.toISOString() ?? null
      },
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString()
    };
  }

  private startOfChinaDay(date: Date) {
    const chinaOffsetMs = 8 * 60 * 60 * 1000;
    const chinaTime = new Date(date.getTime() + chinaOffsetMs);
    return new Date(Date.UTC(chinaTime.getUTCFullYear(), chinaTime.getUTCMonth(), chinaTime.getUTCDate()) - chinaOffsetMs);
  }

  private startOfChinaMonth(date: Date) {
    const chinaOffsetMs = 8 * 60 * 60 * 1000;
    const chinaTime = new Date(date.getTime() + chinaOffsetMs);
    return new Date(Date.UTC(chinaTime.getUTCFullYear(), chinaTime.getUTCMonth(), 1) - chinaOffsetMs);
  }

  private enumCountMap<T extends string>(
    groups: Array<Record<string, unknown> & { _count?: true | { _all?: number } }>,
    key: string,
    expectedValues: T[]
  ) {
    const counts = Object.fromEntries(expectedValues.map((value) => [value.toLowerCase(), 0])) as Record<
      Lowercase<T>,
      number
    >;

    for (const group of groups) {
      const value = group[key];
      if (typeof value === 'string') {
        counts[value.toLowerCase() as Lowercase<T>] = this.groupCount(group);
      }
    }

    return counts;
  }

  private groupCount(group: { _count?: true | { _all?: number } }) {
    return typeof group._count === 'object' ? group._count._all ?? 0 : 0;
  }
}
