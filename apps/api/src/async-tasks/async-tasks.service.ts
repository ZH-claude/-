import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AsyncTaskKind, AsyncTaskStatus, Prisma } from '../generated/prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma.service';

type AsyncTaskQuery = {
  kind?: unknown;
  status?: unknown;
  platform?: unknown;
  model?: unknown;
  limit?: unknown;
};

type NormalizedAsyncTaskFilters = {
  kind?: AsyncTaskKind;
  status?: AsyncTaskStatus;
  platform?: string;
  model?: string;
  limit: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_FILTER_LENGTH = 120;

@Injectable()
export class AsyncTasksService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listTasks(user: AuthenticatedUser, query: AsyncTaskQuery) {
    const filters = this.normalizeFilters(query);
    const where = this.buildWhere(user.id, filters);

    const [items, total, statusGroups, kindGroups, platformRows, modelRows] = await this.prisma.$transaction([
      this.prisma.asyncTask.findMany({
        where,
        include: {
          upstreamProvider: {
            select: {
              name: true,
              status: true,
              healthStatus: true
            }
          }
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: filters.limit
      }),
      this.prisma.asyncTask.count({ where }),
      this.prisma.asyncTask.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        orderBy: { status: 'asc' }
      }),
      this.prisma.asyncTask.groupBy({
        by: ['kind'],
        where,
        _count: { _all: true },
        orderBy: { kind: 'asc' }
      }),
      this.prisma.asyncTask.findMany({
        where: { userId: user.id },
        distinct: ['platform'],
        orderBy: { platform: 'asc' },
        select: { platform: true },
        take: 100
      }),
      this.prisma.asyncTask.findMany({
        where: {
          userId: user.id,
          model: { not: null }
        },
        distinct: ['model'],
        orderBy: { model: 'asc' },
        select: { model: true },
        take: 100
      })
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        externalTaskId: item.externalTaskId,
        platform: item.platform,
        kind: item.kind.toLowerCase(),
        status: item.status.toLowerCase(),
        model: item.model,
        prompt: item.prompt,
        progress: item.progress,
        result: item.resultJson,
        errorMessage: item.errorMessage,
        submittedAt: item.submittedAt.toISOString(),
        startedAt: item.startedAt?.toISOString() ?? null,
        completedAt: item.completedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        upstreamProvider: item.upstreamProvider
          ? {
              name: item.upstreamProvider.name,
              status: item.upstreamProvider.status.toLowerCase(),
              healthStatus: item.upstreamProvider.healthStatus.toLowerCase()
            }
          : null
      })),
      summary: {
        total,
        statusCounts: this.toStatusCounts(statusGroups),
        kindCounts: this.toKindCounts(kindGroups)
      },
      filters: {
        limit: filters.limit,
        platforms: platformRows.map((entry) => entry.platform),
        models: modelRows.map((entry) => entry.model).filter((model): model is string => Boolean(model)),
        statuses: ['queued', 'running', 'succeeded', 'failed', 'canceled'],
        kinds: ['generic', 'image']
      },
      capabilities: {
        taskSubmissionSupported: false,
        imageSubmissionSupported: false,
        statusSyncSupported: false
      }
    };
  }

  private buildWhere(userId: string, filters: NormalizedAsyncTaskFilters): Prisma.AsyncTaskWhereInput {
    return {
      userId,
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.platform ? { platform: filters.platform } : {}),
      ...(filters.model ? { model: filters.model } : {})
    };
  }

  private normalizeFilters(query: AsyncTaskQuery): NormalizedAsyncTaskFilters {
    return {
      kind: this.optionalKind(query.kind),
      status: this.optionalStatus(query.status),
      platform: this.optionalText(query.platform, 'platform'),
      model: this.optionalText(query.model, 'model'),
      limit: this.optionalLimit(query.limit)
    };
  }

  private optionalKind(value: unknown) {
    const raw = this.firstValue(value);
    if (!raw) {
      return undefined;
    }

    const normalized = raw.trim().toUpperCase();
    if (normalized === AsyncTaskKind.GENERIC) {
      return AsyncTaskKind.GENERIC;
    }
    if (normalized === AsyncTaskKind.IMAGE) {
      return AsyncTaskKind.IMAGE;
    }

    throw new BadRequestException('kind must be generic or image');
  }

  private optionalStatus(value: unknown) {
    const raw = this.firstValue(value);
    if (!raw) {
      return undefined;
    }

    const normalized = raw.trim().toUpperCase();
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

  private optionalText(value: unknown, field: string) {
    const raw = this.firstValue(value)?.trim();
    if (!raw) {
      return undefined;
    }

    if (raw.length > MAX_FILTER_LENGTH || !/^[a-zA-Z0-9._:/+ -]+$/.test(raw)) {
      throw new BadRequestException(`${field} contains unsupported characters`);
    }

    return raw;
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

  private toStatusCounts(groups: Array<{ status: AsyncTaskStatus; _count?: true | { _all?: number } }>) {
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

  private toKindCounts(groups: Array<{ kind: AsyncTaskKind; _count?: true | { _all?: number } }>) {
    const counts = {
      generic: 0,
      image: 0
    };

    for (const group of groups) {
      const count = typeof group._count === 'object' && group._count ? group._count._all ?? 0 : 0;
      counts[group.kind.toLowerCase() as keyof typeof counts] = count;
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
