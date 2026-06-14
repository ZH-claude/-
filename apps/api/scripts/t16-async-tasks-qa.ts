import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { AsyncTaskKind, AsyncTaskStatus, PrismaClient } from '../src/generated/prisma/client';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  cookie?: string;
};

type RegisterResponse = {
  user: {
    id: string;
    username: string;
  };
};

type AsyncTasksResponse = {
  items: Array<{
    id: string;
    externalTaskId: string;
    platform: string;
    kind: 'generic' | 'image';
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
    model: string | null;
    prompt: string | null;
    progress: number | null;
    result: unknown;
    errorMessage: string | null;
    submittedAt: string;
    createdAt: string;
    updatedAt: string;
    userId?: string;
    upstreamProviderId?: string;
  }>;
  summary: {
    total: number;
    statusCounts: Record<string, number>;
    kindCounts: Record<string, number>;
  };
  filters: {
    limit: number;
    platforms: string[];
    models: string[];
    statuses: string[];
    kinds: string[];
  };
  capabilities: {
    taskSubmissionSupported: boolean;
    imageSubmissionSupported: boolean;
    statusSyncSupported: boolean;
  };
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T16 async tasks QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const prefix = `qa_t16_${suffix}`;
const password = `qa-password-${suffix}`;
const platform = `${prefix}-platform`;
const alternatePlatform = `${prefix}-alt-platform`;
const genericModel = `${prefix}-generic-model`;
const imageModel = `${prefix}-image-model`;
const otherUserTaskId = `${prefix}-other-user-task`;
const createdTaskIds: string[] = [];
const checks: string[] = [];

async function main() {
  let residualBeforeCleanup: Record<string, number> | null = null;

  try {
    const userA = await register(`${prefix}_user_a`);
    const userB = await register(`${prefix}_user_b`);
    const emptyUser = await register(`${prefix}_empty_user`);

    const unauthenticated = await get<AsyncTasksResponse>('/async-tasks');
    assert(unauthenticated.status === 401, `unauthenticated async task list should be 401, got ${unauthenticated.status}`);
    checks.push('unauthenticated_async_task_requests_are_rejected');

    await seedTasks(userA.json.user.id, userB.json.user.id);
    checks.push('real_async_task_rows_are_written_to_postgres');

    const allForUserA = await get<AsyncTasksResponse>('/async-tasks', userA.cookie);
    assert(allForUserA.status === 200, `user A async task list failed with ${allForUserA.status}`);
    assert(allForUserA.json.items.length === 4, `user A should see 4 tasks, got ${allForUserA.json.items.length}`);
    assert(allForUserA.json.summary.total === 4, `user A summary total mismatch: ${allForUserA.json.summary.total}`);
    assert(allForUserA.json.summary.statusCounts.running === 1, 'running count mismatch for user A');
    assert(allForUserA.json.summary.statusCounts.succeeded === 1, 'succeeded count mismatch for user A');
    assert(allForUserA.json.summary.statusCounts.failed === 1, 'failed count mismatch for user A');
    assert(allForUserA.json.summary.kindCounts.generic === 2, 'generic count mismatch for user A');
    assert(allForUserA.json.summary.kindCounts.image === 2, 'image count mismatch for user A');
    assert(!JSON.stringify(allForUserA.json).includes(otherUserTaskId), 'user A response leaked user B task');
    checks.push('owner_filter_returns_only_current_user_async_tasks');

    const imageOnly = await get<AsyncTasksResponse>('/async-tasks?kind=image', userA.cookie);
    assert(imageOnly.status === 200, `image task filter failed with ${imageOnly.status}`);
    assert(imageOnly.json.items.length === 2, `image filter should return 2 tasks, got ${imageOnly.json.items.length}`);
    assert(imageOnly.json.items.every((task) => task.kind === 'image'), 'kind=image returned a non-image task');
    checks.push('kind_filter_returns_only_image_tasks');

    const failedOnly = await get<AsyncTasksResponse>('/async-tasks?status=failed', userA.cookie);
    assert(failedOnly.status === 200, `failed task filter failed with ${failedOnly.status}`);
    assert(failedOnly.json.items.length === 1, `failed filter should return 1 task, got ${failedOnly.json.items.length}`);
    assert(failedOnly.json.items[0]!.status === 'failed', 'status=failed returned a non-failed task');
    assert(failedOnly.json.items[0]!.errorMessage === `${prefix} upstream rejected image task`, 'failed task reason mismatch');
    checks.push('status_filter_returns_real_failure_reason');

    const platformAndModel = await get<AsyncTasksResponse>(
      `/async-tasks?platform=${encodeURIComponent(alternatePlatform)}&model=${encodeURIComponent(imageModel)}`,
      userA.cookie
    );
    assert(platformAndModel.status === 200, `platform/model filter failed with ${platformAndModel.status}`);
    assert(platformAndModel.json.items.length === 1, `platform/model filter should return 1 task, got ${platformAndModel.json.items.length}`);
    assert(platformAndModel.json.items[0]!.platform === alternatePlatform, 'platform filter returned wrong platform');
    assert(platformAndModel.json.items[0]!.model === imageModel, 'model filter returned wrong model');
    checks.push('platform_and_model_filters_are_applied_together');

    const limited = await get<AsyncTasksResponse>('/async-tasks?limit=2', userA.cookie);
    assert(limited.status === 200, `limit filter failed with ${limited.status}`);
    assert(limited.json.items.length === 2, `limit=2 should return 2 tasks, got ${limited.json.items.length}`);
    assert(limited.json.summary.total === 4, 'limited response should preserve full summary total');
    checks.push('limit_reduces_rows_without_changing_summary');

    const badKind = await get('/async-tasks?kind=video', userA.cookie);
    const badStatus = await get('/async-tasks?status=waiting', userA.cookie);
    const badLimit = await get('/async-tasks?limit=101', userA.cookie);
    assert(badKind.status === 400, `invalid kind should be 400, got ${badKind.status}`);
    assert(badStatus.status === 400, `invalid status should be 400, got ${badStatus.status}`);
    assert(badLimit.status === 400, `invalid limit should be 400, got ${badLimit.status}`);
    checks.push('invalid_filters_are_rejected');

    const empty = await get<AsyncTasksResponse>('/async-tasks', emptyUser.cookie);
    assert(empty.status === 200, `empty user list failed with ${empty.status}`);
    assert(empty.json.items.length === 0, `empty user should see 0 tasks, got ${empty.json.items.length}`);
    assert(empty.json.summary.total === 0, 'empty user summary should be 0');
    assert(empty.json.filters.platforms.length === 0, 'empty user should not see platform options');
    assert(empty.json.filters.models.length === 0, 'empty user should not see model options');
    checks.push('empty_user_gets_real_empty_state_data');

    const nextProxy = await requestFromBase<AsyncTasksResponse>(WEB_BASE_URL, 'GET', '/api/async-tasks?kind=image', undefined, userA.cookie);
    assert(nextProxy.status === 200, `Next async tasks proxy failed with ${nextProxy.status}`);
    assert(nextProxy.json.items.length === 2, `Next proxy image filter should return 2 tasks, got ${nextProxy.json.items.length}`);
    assert(nextProxy.json.items.every((task) => task.kind === 'image'), 'Next proxy returned non-image task');
    checks.push('next_proxy_returns_authenticated_async_tasks');

    const serialized = JSON.stringify({ allForUserA: allForUserA.json, nextProxy: nextProxy.json });
    for (const forbidden of [
      'userId',
      'upstreamProviderId',
      'passwordHash',
      'tokenHash',
      userB.json.user.id,
      otherUserTaskId
    ]) {
      assert(!serialized.includes(forbidden), `async task response leaked forbidden field or value: ${forbidden}`);
    }
    assert(allForUserA.json.capabilities.taskSubmissionSupported === false, 'task submission should stay disabled until wired');
    assert(allForUserA.json.capabilities.imageSubmissionSupported === false, 'image submission should stay disabled until wired');
    assert(allForUserA.json.capabilities.statusSyncSupported === false, 'status sync should stay disabled until wired');
    checks.push('async_task_response_uses_sensitive_field_allowlist_and_honest_capabilities');

    residualBeforeCleanup = await countResidual(prefix);
    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          checks,
          visibleTaskIds: allForUserA.json.items.map((task) => task.externalTaskId),
          residualBeforeCleanup
        },
        null,
        2
      )
    );
  } finally {
    await cleanup(prefix);
    const residualAfterCleanup = await countResidual(prefix);
    console.log(JSON.stringify({ cleanup: true, suffix, residualAfterCleanup }, null, 2));
    await prisma.$disconnect();
  }
}

async function seedTasks(userAId: string, userBId: string) {
  const now = new Date();
  const rows = [
    {
      userId: userAId,
      externalTaskId: `${prefix}-generic-running`,
      platform,
      kind: AsyncTaskKind.GENERIC,
      status: AsyncTaskStatus.RUNNING,
      model: genericModel,
      prompt: `${prefix} queued billing export`,
      progress: 45,
      submittedAt: new Date(now.getTime() - 60_000),
      startedAt: new Date(now.getTime() - 30_000)
    },
    {
      userId: userAId,
      externalTaskId: `${prefix}-generic-queued`,
      platform,
      kind: AsyncTaskKind.GENERIC,
      status: AsyncTaskStatus.QUEUED,
      model: genericModel,
      prompt: `${prefix} pending usage rollup`,
      progress: 0,
      submittedAt: new Date(now.getTime() - 50_000)
    },
    {
      userId: userAId,
      externalTaskId: `${prefix}-image-succeeded`,
      platform,
      kind: AsyncTaskKind.IMAGE,
      status: AsyncTaskStatus.SUCCEEDED,
      model: imageModel,
      prompt: `${prefix} image render request`,
      progress: 100,
      resultJson: { artifactId: `${prefix}-artifact`, width: 1024, height: 1024 },
      submittedAt: new Date(now.getTime() - 40_000),
      startedAt: new Date(now.getTime() - 35_000),
      completedAt: new Date(now.getTime() - 5_000)
    },
    {
      userId: userAId,
      externalTaskId: `${prefix}-image-failed`,
      platform: alternatePlatform,
      kind: AsyncTaskKind.IMAGE,
      status: AsyncTaskStatus.FAILED,
      model: imageModel,
      prompt: `${prefix} rejected image render request`,
      progress: 20,
      errorMessage: `${prefix} upstream rejected image task`,
      submittedAt: new Date(now.getTime() - 30_000),
      startedAt: new Date(now.getTime() - 20_000),
      completedAt: new Date(now.getTime() - 10_000)
    },
    {
      userId: userBId,
      externalTaskId: otherUserTaskId,
      platform,
      kind: AsyncTaskKind.IMAGE,
      status: AsyncTaskStatus.SUCCEEDED,
      model: imageModel,
      prompt: `${prefix} other user task`,
      progress: 100,
      resultJson: { artifactId: `${prefix}-other-artifact` },
      submittedAt: new Date(now.getTime() - 25_000),
      startedAt: new Date(now.getTime() - 20_000),
      completedAt: new Date(now.getTime() - 15_000)
    }
  ];

  for (const row of rows) {
    const task = await prisma.asyncTask.create({ data: row });
    createdTaskIds.push(task.id);
  }
}

async function register(username: string) {
  const result = await post<RegisterResponse>('/auth/register', { username, password });
  assert(result.status >= 200 && result.status < 300, `register ${username} failed with ${result.status}`);
  assert(result.cookie, `register ${username} did not return a session cookie`);
  return result;
}

async function get<T>(path: string, cookie?: string) {
  return requestFromBase<T>(API_BASE_URL, 'GET', path, undefined, cookie);
}

async function post<T = unknown>(path: string, body: unknown, cookie?: string) {
  return requestFromBase<T>(API_BASE_URL, 'POST', path, body, cookie);
}

async function requestFromBase<T>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  cookie?: string
): Promise<HttpResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      accept: 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  return {
    status: response.status,
    json,
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}

async function countResidual(prefixValue: string) {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefixValue } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  return {
    users: users.length,
    sessions: await prisma.session.count({ where: { userId: { in: userIds } } }),
    wallets: await prisma.wallet.count({ where: { userId: { in: userIds } } }),
    async_tasks: await prisma.asyncTask.count({
      where: {
        OR: [
          { id: { in: createdTaskIds } },
          { userId: { in: userIds } },
          { externalTaskId: { startsWith: prefixValue } },
          { platform: { startsWith: prefixValue } },
          { model: { startsWith: prefixValue } }
        ]
      }
    })
  };
}

async function cleanup(prefixValue: string) {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefixValue } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  await prisma.asyncTask.deleteMany({
    where: {
      OR: [
        { id: { in: createdTaskIds } },
        { userId: { in: userIds } },
        { externalTaskId: { startsWith: prefixValue } },
        { platform: { startsWith: prefixValue } },
        { model: { startsWith: prefixValue } }
      ]
    }
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
