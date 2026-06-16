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
  RechargeCodeStatus,
  UpstreamHealthStatus,
  UpstreamProviderStatus,
  UserRole,
  UserStatus,
  UsageEventStatus
} from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { SecurityAuditService } from '../security-audit/security-audit.service';
import { decryptUpstreamApiKey, encryptUpstreamApiKey, maskUpstreamApiKey } from './upstream-key-crypto';

type ListUsersOptions = {
  page: number;
  limit: number;
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
  inputPriceCentsPer1k?: unknown;
  outputPriceCentsPer1k?: unknown;
  modelMultiplier?: unknown;
  status?: unknown;
  groupIds?: unknown;
};

type UpstreamModelInput = {
  providerId?: unknown;
  publicModel?: unknown;
  upstreamModel?: unknown;
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
    const todayStart = this.startOfUtcDay(generatedAt);
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

    return {
      items: users.map((user) => ({
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
          totalSpendCents: user.wallet?.totalSpendCents ?? 0
        },
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString()
      })),
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

  async checkUpstreamHealth(adminUserId: string, upstreamProviderId: string) {
    const provider = await this.prisma.upstreamProvider.findUnique({
      where: { id: upstreamProviderId }
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
            orderBy: { createdAt: 'desc' }
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
        orderBy: { createdAt: 'desc' },
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
    const groupId = this.requiredUuid(body.groupId, 'groupId');

    const [user, group] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
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

  async createModelPrice(adminUserId: string, body: ModelPriceInput) {
    const model = this.normalizeModelName(body.model, 'model');
    const displayName = this.optionalText(body.displayName, 'displayName', 1, 120) ?? null;
    const inputPriceCentsPer1k = this.nonNegativeInt(body.inputPriceCentsPer1k, 'inputPriceCentsPer1k', 0, 100000000);
    const outputPriceCentsPer1k = this.nonNegativeInt(body.outputPriceCentsPer1k, 'outputPriceCentsPer1k', 0, 100000000);
    const modelMultiplier = this.normalizeMultiplier(body.modelMultiplier, 'modelMultiplier');
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
            inputPriceCentsPer1k,
            outputPriceCentsPer1k,
            modelMultiplier,
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
              inputPriceCentsPer1k,
              outputPriceCentsPer1k,
              modelMultiplier: modelMultiplier.toString(),
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

  async createUpstreamModel(adminUserId: string, body: UpstreamModelInput) {
    const providerId = this.requiredUuid(body.providerId, 'providerId');
    const publicModel = this.normalizeModelName(body.publicModel, 'publicModel');
    const upstreamModel = this.normalizeModelName(body.upstreamModel, 'upstreamModel');
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

    try {
      const upstreamModelRecord = await this.prisma.$transaction(async (tx) => {
        const createdModel = await tx.upstreamModel.create({
          data: {
            providerId,
            publicModel,
            upstreamModel,
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

  private requiredText(value: unknown, field: string, min: number, max: number) {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
      throw new BadRequestException(`${field} must be a string with ${min}-${max} characters`);
    }

    return value.trim();
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
    if (!/^[a-zA-Z0-9._:/+-]+$/.test(model)) {
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
      status: ModelStatus;
      supportsStream: boolean;
      provider: {
        id: string;
        name: string;
        status: UpstreamProviderStatus;
      };
    }>;
  }) {
    return {
      id: model.id,
      model: model.model,
      displayName: model.displayName,
      inputPriceCentsPer1k: model.inputPriceCentsPer1k,
      outputPriceCentsPer1k: model.outputPriceCentsPer1k,
      modelMultiplier: model.modelMultiplier.toString(),
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
        providerStatus: mapping.provider.status.toLowerCase(),
        upstreamModel: mapping.upstreamModel,
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
    status: ModelStatus;
    supportsStream: boolean;
    createdAt: Date;
    updatedAt: Date;
    provider: {
      id: string;
      name: string;
      status: UpstreamProviderStatus;
    };
    modelPrice: {
      displayName: string | null;
    };
  }) {
    return {
      id: model.id,
      providerId: model.providerId,
      providerName: model.provider.name,
      providerStatus: model.provider.status.toLowerCase(),
      publicModel: model.publicModel,
      displayName: model.modelPrice.displayName,
      upstreamModel: model.upstreamModel,
      status: model.status.toLowerCase(),
      supportsStream: model.supportsStream,
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString()
    };
  }

  private toPublicUpstreamProvider(provider: {
    id: string;
    name: string;
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

  private startOfUtcDay(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
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
