import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  GroupStatus,
  ModelStatus,
  UpstreamHealthStatus,
  UpstreamProviderStatus,
  UsageEventStatus
} from '../generated/prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma.service';

type GroupAvailabilityStatus = 'normal' | 'partial' | 'unavailable' | 'no_data';

type GroupAvailabilityQuery = {
  hours?: unknown;
  status?: unknown;
};

type UsageStats = {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
};

type UsageGroup = {
  model: string;
  status: UsageEventStatus;
  _count?: true | { _all?: number };
};

type LastCallGroup = {
  model: string;
  _max?: { createdAt?: Date | null };
};

const DEFAULT_WINDOW_HOURS = 24;
const ALLOWED_WINDOW_HOURS = new Set([1, 24, 168]);
const SUCCESS_RATE_PARTIAL_THRESHOLD = 0.95;

@Injectable()
export class GroupAvailabilityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getGroupAvailability(user: AuthenticatedUser, query: GroupAvailabilityQuery) {
    const filters = this.normalizeFilters(query);
    const since = new Date(Date.now() - filters.hours * 60 * 60 * 1000);

    const modelRows = await this.prisma.modelPrice.findMany({
      where: {
        groupAccesses: {
          some: { groupId: user.group.id }
        }
      },
      select: {
        model: true,
        displayName: true,
        status: true,
        upstreamModels: {
          select: {
            status: true,
            supportsStream: true,
            provider: {
              select: {
                status: true,
                healthStatus: true,
                lastHealthCheckAt: true
              }
            }
          }
        }
      },
      orderBy: { model: 'asc' }
    });

    const modelNames = modelRows.map((model) => model.model);
    const groupUserIds = await this.prisma.user.findMany({
      where: {
        groupId: user.group.id,
        deletedAt: null
      },
      select: { id: true }
    });
    let usageGroups: UsageGroup[] = [];
    let lastCalls: LastCallGroup[] = [];

    if (modelNames.length) {
      [usageGroups, lastCalls] = await this.prisma.$transaction([
        this.prisma.usageEvent.groupBy({
          by: ['model', 'status'],
          where: {
            model: { in: modelNames },
            createdAt: { gte: since },
            user: {
              groupId: user.group.id,
              deletedAt: null
            }
          },
          orderBy: [{ model: 'asc' }, { status: 'asc' }],
          _count: { _all: true }
        }),
        this.prisma.usageEvent.groupBy({
          by: ['model'],
          where: {
            model: { in: modelNames },
            createdAt: { gte: since },
            user: {
              groupId: user.group.id,
              deletedAt: null
            }
          },
          orderBy: { model: 'asc' },
          _max: { createdAt: true }
        })
      ]);
    }

    const usageByModel = this.toUsageByModel(usageGroups);
    const lastCallByModel = new Map(lastCalls.map((entry) => [entry.model, entry._max?.createdAt ?? null]));
    const groupUserCount = groupUserIds.length;
    const models = modelRows.map((model) =>
      this.toModelAvailability(user.group.status, model, usageByModel.get(model.model), lastCallByModel.get(model.model) ?? null)
    );
    const filteredModels = filters.status ? models.filter((model) => model.status === filters.status) : models;

    return {
      group: {
        code: user.group.code,
        name: user.group.name,
        status: user.group.status.toLowerCase(),
        userCount: groupUserCount
      },
      window: {
        hours: filters.hours,
        since: since.toISOString()
      },
      summary: this.toSummary(models),
      filters: {
        status: filters.status ?? null,
        statuses: ['normal', 'partial', 'unavailable', 'no_data']
      },
      models: filteredModels
    };
  }

  private toModelAvailability(
    groupStatus: GroupStatus,
    model: {
      model: string;
      displayName: string | null;
      status: ModelStatus;
      upstreamModels: Array<{
        status: ModelStatus;
        supportsStream: boolean;
        provider: {
          status: UpstreamProviderStatus;
          healthStatus: UpstreamHealthStatus;
          lastHealthCheckAt: Date | null;
        };
      }>;
    },
    usage: UsageStats | undefined,
    lastCallAt: Date | null
  ) {
    const activeUpstreams = model.upstreamModels.filter(
      (mapping) => mapping.status === ModelStatus.ACTIVE && mapping.provider.status === UpstreamProviderStatus.ACTIVE
    );
    const healthyUpstreamCount = activeUpstreams.filter(
      (mapping) => mapping.provider.healthStatus === UpstreamHealthStatus.HEALTHY
    ).length;
    const unhealthyUpstreamCount = activeUpstreams.filter(
      (mapping) => mapping.provider.healthStatus === UpstreamHealthStatus.UNHEALTHY
    ).length;
    const unknownUpstreamCount = activeUpstreams.filter(
      (mapping) => mapping.provider.healthStatus === UpstreamHealthStatus.UNKNOWN
    ).length;
    const lastHealthCheckAt = this.latestDate(
      activeUpstreams.map((mapping) => mapping.provider.lastHealthCheckAt).filter((value): value is Date => Boolean(value))
    );
    const usageStats = usage ?? {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0
    };
    const successRate = usageStats.totalCalls > 0 ? usageStats.successfulCalls / usageStats.totalCalls : null;
    const status = this.resolveStatus({
      groupStatus,
      modelStatus: model.status,
      activeUpstreamCount: activeUpstreams.length,
      healthyUpstreamCount,
      unhealthyUpstreamCount,
      lastHealthCheckAt,
      totalCalls: usageStats.totalCalls,
      successRate
    });

    return {
      model: model.model,
      displayName: model.displayName,
      status: status.status,
      reason: status.reason,
      supportsStream: activeUpstreams.some((mapping) => mapping.supportsStream),
      upstreams: {
        active: activeUpstreams.length,
        healthy: healthyUpstreamCount,
        unhealthy: unhealthyUpstreamCount,
        unknown: unknownUpstreamCount
      },
      usage: {
        totalCalls: usageStats.totalCalls,
        successfulCalls: usageStats.successfulCalls,
        failedCalls: usageStats.failedCalls,
        successRate
      },
      lastCallAt: lastCallAt?.toISOString() ?? null,
      lastHealthCheckAt: lastHealthCheckAt?.toISOString() ?? null
    };
  }

  private resolveStatus(input: {
    groupStatus: GroupStatus;
    modelStatus: ModelStatus;
    activeUpstreamCount: number;
    healthyUpstreamCount: number;
    unhealthyUpstreamCount: number;
    lastHealthCheckAt: Date | null;
    totalCalls: number;
    successRate: number | null;
  }): { status: GroupAvailabilityStatus; reason: string } {
    if (input.groupStatus !== GroupStatus.ACTIVE) {
      return { status: 'unavailable', reason: 'group_disabled' };
    }

    if (input.modelStatus !== ModelStatus.ACTIVE) {
      return { status: 'unavailable', reason: 'model_disabled' };
    }

    if (input.activeUpstreamCount === 0) {
      return { status: 'unavailable', reason: 'no_active_upstream' };
    }

    if (input.totalCalls === 0 && !input.lastHealthCheckAt && input.healthyUpstreamCount === 0 && input.unhealthyUpstreamCount === 0) {
      return { status: 'no_data', reason: 'no_recent_usage_or_health_check' };
    }

    if (input.unhealthyUpstreamCount > 0) {
      return { status: 'partial', reason: 'upstream_unhealthy' };
    }

    if (input.successRate !== null && input.successRate < SUCCESS_RATE_PARTIAL_THRESHOLD) {
      return { status: 'partial', reason: 'low_success_rate' };
    }

    return { status: 'normal', reason: input.totalCalls > 0 ? 'recent_calls_successful' : 'upstream_healthy' };
  }

  private toUsageByModel(
    groups: UsageGroup[]
  ) {
    const byModel = new Map<string, UsageStats>();

    for (const group of groups) {
      const current = byModel.get(group.model) ?? { totalCalls: 0, successfulCalls: 0, failedCalls: 0 };
      const count = typeof group._count === 'object' && group._count ? group._count._all ?? 0 : 0;
      current.totalCalls += count;
      if (group.status === UsageEventStatus.FAILED) {
        current.failedCalls += count;
      } else {
        current.successfulCalls += count;
      }
      byModel.set(group.model, current);
    }

    return byModel;
  }

  private toSummary(models: Array<ReturnType<GroupAvailabilityService['toModelAvailability']>>) {
    const statusCounts = {
      normal: 0,
      partial: 0,
      unavailable: 0,
      no_data: 0
    };
    let totalCalls = 0;
    let successfulCalls = 0;
    let failedCalls = 0;

    for (const model of models) {
      statusCounts[model.status] += 1;
      totalCalls += model.usage.totalCalls;
      successfulCalls += model.usage.successfulCalls;
      failedCalls += model.usage.failedCalls;
    }

    return {
      totalModels: models.length,
      statusCounts,
      totalCalls,
      successfulCalls,
      failedCalls,
      successRate: totalCalls > 0 ? successfulCalls / totalCalls : null
    };
  }

  private normalizeFilters(query: GroupAvailabilityQuery) {
    const hours = this.optionalHours(query.hours);
    const status = this.optionalStatus(query.status);

    return { hours, status };
  }

  private optionalHours(value: unknown) {
    const raw = this.firstValue(value);
    if (!raw) {
      return DEFAULT_WINDOW_HOURS;
    }

    const numericValue = Number(raw);
    if (!Number.isInteger(numericValue) || !ALLOWED_WINDOW_HOURS.has(numericValue)) {
      throw new BadRequestException('hours must be one of 1, 24, or 168');
    }

    return numericValue;
  }

  private optionalStatus(value: unknown): GroupAvailabilityStatus | undefined {
    const raw = this.firstValue(value);
    if (!raw) {
      return undefined;
    }

    if (raw === 'normal' || raw === 'partial' || raw === 'unavailable' || raw === 'no_data') {
      return raw;
    }

    throw new BadRequestException('status must be normal, partial, unavailable, or no_data');
  }

  private firstValue(value: unknown) {
    if (Array.isArray(value)) {
      return typeof value[0] === 'string' ? value[0] : undefined;
    }

    return typeof value === 'string' ? value : undefined;
  }

  private latestDate(values: Date[]) {
    return values.reduce<Date | null>((latest, value) => {
      if (!latest || value > latest) {
        return value;
      }

      return latest;
    }, null);
  }
}
