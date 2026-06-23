import { BadRequestException, ConflictException, Injectable, Inject, NotFoundException, OnModuleInit } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  Prisma,
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
import { PrismaService } from '../prisma.service';
import { SecurityAuditService } from '../security-audit/security-audit.service';
import { decryptUpstreamApiKey, encryptUpstreamApiKey, maskUpstreamApiKey } from './upstream-key-crypto';

const UNSUPPORTED_MODEL_NAME_CHARACTERS = /[\x00-\x1F\x7F]/;

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
};

type UpstreamProviderInput = {
  name?: unknown;
  kind?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  status?: unknown;
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

const PASSWORD_HASH_ROUNDS = 12;
const UPSTREAM_HEALTH_CHECK_TIMEOUT_MS = 8000;
const UPSTREAM_HEALTH_ERROR_MAX_LENGTH = 240;
const UPSTREAM_DNS_LOOKUP_TIMEOUT_MS = 3000;
const PRIVATE_UPSTREAM_ADDRESS_ERROR = 'Private or local upstream address is not allowed';
const BLOCKED_UPSTREAM_HOSTNAMES = new Set(['localhost', 'host.docker.internal', 'metadata.google.internal']);
const DASHBOARD_RECENT_ALERT_LIMIT = 5;

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
    const last24HoursStart = new Date(generatedAt.getTime() - 24 * 60 * 60 * 1000);
    const userWhere = { deletedAt: null };

    const [
      userGroups,
      newUsersToday,
      walletAggregate,
      todayUsageAggregate,
      todayUsageCount,
      todayUsageStatusGroups,
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
        last24HoursStart: last24HoursStart.toISOString()
      },
      users: {
        total: userGroups.reduce((sum, group) => sum + this.groupCount(group), 0),
        active: userStatusCounts.active,
        disabled: userStatusCounts.disabled,
        riskLocked: userStatusCounts.risk_locked,
        admins: userRoleCounts.admin,
        ordinary: userRoleCounts.user,
        newToday: newUsersToday
      },
      wallets: {
        totalBalanceCents: walletAggregate._sum.balanceCents ?? 0,
        totalSpendCents: walletAggregate._sum.totalSpendCents ?? 0
      },
      today: {
        callCount: todayUsageCount,
        spendCents: todayUsageAggregate._sum.costCents ?? 0,
        totalTokens: todayUsageAggregate._sum.totalTokens ?? 0,
        statusCounts: usageStatusCounts
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
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    return {
      items: announcements.map((announcement) => ({
        id: announcement.id,
        title: announcement.title,
        content: announcement.content,
        category: announcement.category.toLowerCase(),
        status: announcement.status.toLowerCase(),
        publishedAt: announcement.publishedAt?.toISOString() ?? null,
        createdBy: announcement.createdByAdmin.username,
        createdAt: announcement.createdAt.toISOString(),
        updatedAt: announcement.updatedAt.toISOString()
      }))
    };
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

    const announcement = await this.prisma.$transaction(async (tx) => {
      const createdAnnouncement = await tx.announcement.create({
        data: {
          title,
          content,
          category,
          status,
          publishedAt: status === AnnouncementStatus.PUBLISHED ? new Date() : null,
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
            status: createdAnnouncement.status.toLowerCase()
          }
        }
      });

      return createdAnnouncement;
    });

    return {
      id: announcement.id,
      title: announcement.title,
      content: announcement.content,
      category: announcement.category.toLowerCase(),
      status: announcement.status.toLowerCase(),
      publishedAt: announcement.publishedAt?.toISOString() ?? null,
      createdByAdminId: announcement.createdByAdminId,
      createdAt: announcement.createdAt.toISOString()
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

    const apiKeyChanged = typeof nextApiKey === 'string';
    const addressChanged = currentProvider.baseUrl !== baseUrl;
    const updateData: Prisma.UpstreamProviderUpdateInput = {
      name,
      kind,
      baseUrl,
      status,
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
              apiKeyPreview: currentProvider.apiKeyPreview
            },
            afterSnapshot: {
              id: updatedProvider.id,
              name: updatedProvider.name,
              kind: updatedProvider.kind.toLowerCase(),
              baseUrl: updatedProvider.baseUrl,
              status: updatedProvider.status.toLowerCase(),
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
          lastHealthError: result.error
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
            data: {
              status: ModelStatus.DISABLED
            }
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
            data: {
              status: ModelStatus.DISABLED
            }
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

  private optionalBoolean(value: unknown, defaultValue: boolean) {
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

    throw new BadRequestException('supportsStream must be true or false');
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
      healthStatus: provider.healthStatus.toLowerCase(),
      lastHealthCheckAt: provider.lastHealthCheckAt?.toISOString() ?? null,
      lastHealthLatencyMs: provider.lastHealthLatencyMs,
      lastHealthError: provider.lastHealthError,
      createdBy: provider.createdByAdmin?.username,
      createdAt: provider.createdAt.toISOString(),
      updatedAt: provider.updatedAt.toISOString()
    };
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
