import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, createHash } from 'node:crypto';
import {
  ApiTokenStatus,
  ModelStatus,
  PrismaClient,
  UpstreamHealthStatus,
  UpstreamProviderStatus,
  UsageEventStatus
} from '../src/generated/prisma/client';
import { encryptUpstreamApiKey, maskUpstreamApiKey } from '../src/admin/upstream-key-crypto';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  headers: Headers;
  cookie?: string;
};

type RegisterResponse = {
  user: {
    id: string;
    username: string;
  };
};

type AvailabilityStatus = 'normal' | 'partial' | 'unavailable' | 'no_data';

type AvailabilityModel = {
  model: string;
  displayName: string | null;
  status: AvailabilityStatus;
  reason: string;
  supportsStream: boolean;
  upstreams: {
    active: number;
    healthy: number;
    unhealthy: number;
    unknown: number;
  };
  usage: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    successRate: number | null;
  };
  lastCallAt: string | null;
  lastHealthCheckAt: string | null;
};

type AvailabilityResponse = {
  group: {
    code: string;
    name: string;
    status: string;
    userCount: number;
  };
  window: {
    hours: number;
    since: string;
  };
  summary: {
    totalModels: number;
    statusCounts: Record<AvailabilityStatus, number>;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    successRate: number | null;
  };
  filters: {
    status: AvailabilityStatus | null;
    statuses: AvailabilityStatus[];
  };
  models: AvailabilityModel[];
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T13 group availability QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const prefix = `qa_t13_${suffix}`;
const password = `qa-password-${suffix}`;
const upstreamKey = `qa-t13-upstream-key-${suffix}`;
const groupACode = `${prefix}_group_a`;
const groupBCode = `${prefix}_group_b`;
const emptyGroupCode = `${prefix}_group_empty`;
const normalModel = `${prefix}-normal`;
const partialModel = `${prefix}-partial`;
const unavailableModel = `${prefix}-unavailable`;
const noDataModel = `${prefix}-no-data`;
const deniedModel = `${prefix}-denied`;
const oldModel = `${prefix}-old`;
const checks: string[] = [];

async function main() {
  let residualBeforeCleanup: Record<string, number> | null = null;

  try {
    const groupA = await prisma.userGroup.create({
      data: { code: groupACode, name: 'QA T13 Group A' }
    });
    const groupB = await prisma.userGroup.create({
      data: { code: groupBCode, name: 'QA T13 Group B' }
    });
    const emptyGroup = await prisma.userGroup.create({
      data: { code: emptyGroupCode, name: 'QA T13 Empty Group' }
    });

    const userACookie = await register(`${prefix}_user_a`);
    const userBCookie = await register(`${prefix}_user_b`);
    const userCCookie = await register(`${prefix}_user_c`);
    const userA = await setUserGroup(`${prefix}_user_a`, groupA.id);
    const userB = await setUserGroup(`${prefix}_user_b`, groupB.id);
    await setUserGroup(`${prefix}_user_c`, emptyGroup.id);
    const tokenA = await createApiToken(userA.id, `${prefix}_token_a`);
    const tokenB = await createApiToken(userB.id, `${prefix}_token_b`);

    const normalProvider = await seedModelWithProvider({
      model: normalModel,
      groupId: groupA.id,
      createdByAdminId: userA.id,
      healthStatus: UpstreamHealthStatus.HEALTHY,
      lastHealthCheckAt: new Date(),
      supportsStream: true
    });
    const partialProvider = await seedModelWithProvider({
      model: partialModel,
      groupId: groupA.id,
      createdByAdminId: userA.id,
      healthStatus: UpstreamHealthStatus.HEALTHY,
      lastHealthCheckAt: new Date(),
      supportsStream: false
    });
    await seedModelWithoutProvider(unavailableModel, groupA.id);
    await seedModelWithProvider({
      model: noDataModel,
      groupId: groupA.id,
      createdByAdminId: userA.id,
      healthStatus: UpstreamHealthStatus.UNKNOWN,
      lastHealthCheckAt: null,
      supportsStream: true
    });
    const deniedProvider = await seedModelWithProvider({
      model: deniedModel,
      groupId: groupB.id,
      createdByAdminId: userA.id,
      healthStatus: UpstreamHealthStatus.HEALTHY,
      lastHealthCheckAt: new Date(),
      supportsStream: true
    });
    const oldProvider = await seedModelWithProvider({
      model: oldModel,
      groupId: groupA.id,
      createdByAdminId: userA.id,
      healthStatus: UpstreamHealthStatus.HEALTHY,
      lastHealthCheckAt: new Date(),
      supportsStream: true
    });

    await createUsageEvent({
      userId: userA.id,
      tokenId: tokenA.id,
      providerId: normalProvider.id,
      model: normalModel,
      status: UsageEventStatus.BILLABLE,
      createdAt: new Date()
    });
    await createUsageEvent({
      userId: userA.id,
      tokenId: tokenA.id,
      providerId: normalProvider.id,
      model: normalModel,
      status: UsageEventStatus.FREE,
      createdAt: new Date()
    });
    await createUsageEvent({
      userId: userA.id,
      tokenId: tokenA.id,
      providerId: partialProvider.id,
      model: partialModel,
      status: UsageEventStatus.BILLABLE,
      createdAt: new Date()
    });
    await createUsageEvent({
      userId: userA.id,
      tokenId: tokenA.id,
      providerId: partialProvider.id,
      model: partialModel,
      status: UsageEventStatus.FAILED,
      createdAt: new Date(),
      errorCode: 'qa_upstream_error'
    });
    await createUsageEvent({
      userId: userB.id,
      tokenId: tokenB.id,
      providerId: deniedProvider.id,
      model: deniedModel,
      status: UsageEventStatus.BILLABLE,
      createdAt: new Date()
    });
    await createUsageEvent({
      userId: userA.id,
      tokenId: tokenA.id,
      providerId: oldProvider.id,
      model: oldModel,
      status: UsageEventStatus.FAILED,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    });

    const unauthenticated = await get<AvailabilityResponse>('/group-availability/models');
    assert(unauthenticated.status === 401, `unauthenticated group availability should be 401, got ${unauthenticated.status}`);
    checks.push('unauthenticated_group_availability_request_is_rejected');

    const availabilityA = await get<AvailabilityResponse>('/group-availability/models?hours=24', userACookie);
    assert(availabilityA.status === 200, `user A availability failed with ${availabilityA.status}`);
    assert(availabilityA.json.group.code === groupACode, 'user A group code mismatch');
    assert(availabilityA.json.group.userCount === 1, 'group user count should count only current group users');
    assert(availabilityA.json.summary.totalModels === 5, 'user A should see five group A models');
    assert(availabilityA.json.summary.totalCalls === 4, '24h total call count mismatch');
    assert(availabilityA.json.summary.successfulCalls === 3, '24h successful call count mismatch');
    assert(availabilityA.json.summary.failedCalls === 1, '24h failed call count mismatch');
    assert(availabilityA.json.summary.successRate === 0.75, '24h success rate mismatch');
    checks.push('availability_summary_uses_real_usage_events_for_current_group');

    assertModel(availabilityA.json, normalModel, {
      status: 'normal',
      reason: 'recent_calls_successful',
      totalCalls: 2,
      successfulCalls: 2,
      failedCalls: 0,
      successRate: 1,
      stream: true
    });
    assertModel(availabilityA.json, partialModel, {
      status: 'partial',
      reason: 'low_success_rate',
      totalCalls: 2,
      successfulCalls: 1,
      failedCalls: 1,
      successRate: 0.5,
      stream: false
    });
    assertModel(availabilityA.json, unavailableModel, {
      status: 'unavailable',
      reason: 'no_active_upstream',
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      successRate: null,
      stream: false
    });
    assertModel(availabilityA.json, noDataModel, {
      status: 'no_data',
      reason: 'no_recent_usage_or_health_check',
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      successRate: null,
      stream: true
    });
    assertModel(availabilityA.json, oldModel, {
      status: 'normal',
      reason: 'upstream_healthy',
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      successRate: null,
      stream: true
    });
    assert(!availabilityA.json.models.some((model) => model.model === deniedModel), 'user A can see user B group model');
    checks.push('availability_model_rows_reflect_real_status_and_group_access');

    const partialOnly = await get<AvailabilityResponse>('/group-availability/models?hours=24&status=partial', userACookie);
    assert(partialOnly.status === 200, `partial filter failed with ${partialOnly.status}`);
    assert(partialOnly.json.filters.status === 'partial', 'partial filter status echo mismatch');
    assert(partialOnly.json.models.length === 1 && partialOnly.json.models[0]?.model === partialModel, 'partial filter returned wrong models');
    checks.push('status_filter_returns_only_requested_status');

    const sevenDays = await get<AvailabilityResponse>('/group-availability/models?hours=168', userACookie);
    assert(sevenDays.status === 200, `168h query failed with ${sevenDays.status}`);
    assert(sevenDays.json.summary.totalCalls === 5, '168h window should include old event');
    checks.push('time_window_changes_real_usage_aggregation');

    await createUsageEvent({
      userId: userA.id,
      tokenId: tokenA.id,
      providerId: normalProvider.id,
      model: normalModel,
      status: UsageEventStatus.FAILED,
      createdAt: new Date(),
      errorCode: 'qa_new_failure'
    });
    const refreshed = await get<AvailabilityResponse>('/group-availability/models?hours=24', userACookie);
    assert(refreshed.status === 200, `refresh query failed with ${refreshed.status}`);
    assert(refreshed.json.summary.totalCalls === 5, 'refresh did not reflect newly inserted event');
    assert(requireModel(refreshed.json, normalModel).usage.failedCalls === 1, 'refresh did not update model failedCalls');
    checks.push('refresh_reads_live_database_changes');

    const availabilityB = await get<AvailabilityResponse>('/group-availability/models?hours=24', userBCookie);
    assert(availabilityB.status === 200, `user B availability failed with ${availabilityB.status}`);
    assert(availabilityB.json.models.length === 1, 'user B should see only group B model');
    assert(requireModel(availabilityB.json, deniedModel).usage.totalCalls === 1, 'user B usage count mismatch');
    assert(!availabilityB.json.models.some((model) => model.model === normalModel), 'user B can see user A model');
    checks.push('availability_blocks_cross_group_models_and_usage');

    const emptyAvailability = await get<AvailabilityResponse>('/group-availability/models?hours=24', userCCookie);
    assert(emptyAvailability.status === 200, `empty group availability failed with ${emptyAvailability.status}`);
    assert(emptyAvailability.json.group.code === emptyGroupCode, 'empty group code mismatch');
    assert(emptyAvailability.json.group.userCount === 1, 'empty group should still report real user count');
    assert(emptyAvailability.json.summary.totalModels === 0, 'empty group should have zero models');
    assert(emptyAvailability.json.models.length === 0, 'empty group should return no model rows');
    checks.push('empty_group_reports_real_user_count_without_synthetic_models');

    const serialized = JSON.stringify({ availabilityA: refreshed.json, availabilityB: availabilityB.json, emptyAvailability: emptyAvailability.json });
    for (const forbidden of [
      'encryptedApiKey',
      'apiKeyPreview',
      'priceSnapshot',
      'requestId',
      'tokenId',
      'userId',
      'upstreamProviderId',
      'providerId',
      'upstreamModel',
      'passwordHash',
      'tokenHash',
      'walletTransaction',
      'idempotencyKey',
      upstreamKey,
      userA.id,
      tokenA.id,
      normalProvider.id
    ]) {
      assert(!serialized.includes(forbidden), `availability response leaked forbidden field/value: ${forbidden}`);
    }
    checks.push('availability_response_uses_sensitive_field_allowlist');

    residualBeforeCleanup = await countResidual();

    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          checks,
          residualBeforeCleanup
        },
        null,
        2
      )
    );
  } finally {
    await cleanup();
    const residualAfterCleanup = await countResidual();
    console.log(JSON.stringify({ cleanup: true, suffix, residualAfterCleanup }, null, 2));
    await prisma.$disconnect();
  }
}

async function register(username: string) {
  const result = await post<RegisterResponse>('/auth/register', { username, password });
  assert(result.status >= 200 && result.status < 300, `register ${username} failed with ${result.status}`);
  assert(result.cookie, `register ${username} did not return a session cookie`);
  return result.cookie!;
}

async function setUserGroup(username: string, groupId: string) {
  return prisma.user.update({
    where: { username },
    data: { groupId },
    select: { id: true, username: true }
  });
}

async function createApiToken(userId: string, name: string) {
  return prisma.apiToken.create({
    data: {
      userId,
      name,
      tokenHash: createHash('sha256').update(`${name}:${suffix}`).digest('hex'),
      keyPreview: `qa_${suffix.slice(-8)}`,
      status: ApiTokenStatus.ACTIVE
    },
    select: { id: true }
  });
}

async function seedModelWithProvider(input: {
  model: string;
  groupId: string;
  createdByAdminId: string;
  healthStatus: UpstreamHealthStatus;
  lastHealthCheckAt: Date | null;
  supportsStream: boolean;
}) {
  await seedModelPrice(input.model, input.groupId);
  const provider = await prisma.upstreamProvider.create({
    data: {
      name: `${input.model}-provider`,
      baseUrl: `https://${input.model}.qa.invalid`,
      encryptedApiKey: encryptUpstreamApiKey(upstreamKey),
      apiKeyPreview: maskUpstreamApiKey(upstreamKey),
      status: UpstreamProviderStatus.ACTIVE,
      healthStatus: input.healthStatus,
      lastHealthCheckAt: input.lastHealthCheckAt,
      createdByAdminId: input.createdByAdminId
    },
    select: { id: true }
  });

  await prisma.upstreamModel.create({
    data: {
      providerId: provider.id,
      publicModel: input.model,
      upstreamModel: `${input.model}-upstream`,
      status: ModelStatus.ACTIVE,
      supportsStream: input.supportsStream
    }
  });

  return provider;
}

async function seedModelWithoutProvider(model: string, groupId: string) {
  await seedModelPrice(model, groupId);
}

async function seedModelPrice(model: string, groupId: string) {
  const modelPrice = await prisma.modelPrice.create({
    data: {
      model,
      displayName: `QA ${model}`,
      inputPriceCentsPer1k: 10,
      outputPriceCentsPer1k: 20,
      modelMultiplier: '1.0000',
      status: ModelStatus.ACTIVE
    },
    select: { id: true }
  });

  await prisma.modelGroupAccess.create({
    data: { modelPriceId: modelPrice.id, groupId }
  });
}

async function createUsageEvent(input: {
  userId: string;
  tokenId: string;
  providerId: string;
  model: string;
  status: UsageEventStatus;
  createdAt: Date;
  errorCode?: string;
}) {
  return prisma.usageEvent.create({
    data: {
      requestId: `${prefix}-${randomBytes(8).toString('hex')}`,
      userId: input.userId,
      tokenId: input.tokenId,
      upstreamProviderId: input.providerId,
      model: input.model,
      upstreamModel: `${input.model}-upstream`,
      promptTokens: input.status === UsageEventStatus.FAILED ? 0 : 10,
      completionTokens: input.status === UsageEventStatus.FAILED ? 0 : 5,
      totalTokens: input.status === UsageEventStatus.FAILED ? 0 : 15,
      costCents: input.status === UsageEventStatus.BILLABLE ? 1 : 0,
      status: input.status,
      errorCode: input.errorCode ?? null,
      priceSnapshot: {
        formula: 'qa-real-usage-event',
        model: input.model
      },
      createdAt: input.createdAt
    },
    select: { id: true }
  });
}

async function get<T>(path: string, cookie?: string) {
  return request<T>('GET', path, undefined, cookie);
}

async function post<T = unknown>(path: string, body: unknown, cookie?: string) {
  return request<T>('POST', path, body, cookie);
}

async function request<T>(method: string, path: string, body?: unknown, cookie?: string): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  return {
    status: response.status,
    json,
    headers: response.headers,
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}

function assertModel(
  response: AvailabilityResponse,
  modelName: string,
  expected: {
    status: AvailabilityStatus;
    reason: string;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    successRate: number | null;
    stream: boolean;
  }
) {
  const model = requireModel(response, modelName);
  assert(model.status === expected.status, `${modelName} status mismatch: ${model.status}`);
  assert(model.reason === expected.reason, `${modelName} reason mismatch: ${model.reason}`);
  assert(model.usage.totalCalls === expected.totalCalls, `${modelName} totalCalls mismatch`);
  assert(model.usage.successfulCalls === expected.successfulCalls, `${modelName} successfulCalls mismatch`);
  assert(model.usage.failedCalls === expected.failedCalls, `${modelName} failedCalls mismatch`);
  assert(model.usage.successRate === expected.successRate, `${modelName} successRate mismatch`);
  assert(model.supportsStream === expected.stream, `${modelName} stream mismatch`);
}

function requireModel(response: AvailabilityResponse, modelName: string) {
  const model = response.models.find((item) => item.model === modelName);
  assert(model, `missing availability model ${modelName}`);
  return model!;
}

async function countResidual() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  const groups = await prisma.userGroup.findMany({
    where: { code: { startsWith: prefix } },
    select: { id: true }
  });
  const groupIds = groups.map((group) => group.id);
  const providers = await prisma.upstreamProvider.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true }
  });
  const providerIds = providers.map((provider) => provider.id);
  const modelPrices = await prisma.modelPrice.findMany({
    where: { model: { startsWith: prefix } },
    select: { id: true }
  });
  const modelPriceIds = modelPrices.map((modelPrice) => modelPrice.id);
  const tokenIds = (
    await prisma.apiToken.findMany({
      where: { userId: { in: userIds } },
      select: { id: true }
    })
  ).map((token) => token.id);
  const usageIds = (
    await prisma.usageEvent.findMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { tokenId: { in: tokenIds } },
          { upstreamProviderId: { in: providerIds } },
          { model: { startsWith: prefix } }
        ]
      },
      select: { id: true }
    })
  ).map((event) => event.id);

  return {
    users: users.length,
    groups: groups.length,
    sessions: await prisma.session.count({ where: { userId: { in: userIds } } }),
    wallets: await prisma.wallet.count({ where: { userId: { in: userIds } } }),
    api_tokens: tokenIds.length,
    usage_events: usageIds.length,
    model_prices: modelPrices.length,
    model_group_accesses: await prisma.modelGroupAccess.count({
      where: { OR: [{ modelPriceId: { in: modelPriceIds } }, { groupId: { in: groupIds } }] }
    }),
    upstream_providers: providers.length,
    upstream_models: await prisma.upstreamModel.count({
      where: { OR: [{ providerId: { in: providerIds } }, { publicModel: { startsWith: prefix } }] }
    })
  };
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  const groups = await prisma.userGroup.findMany({
    where: { code: { startsWith: prefix } },
    select: { id: true }
  });
  const groupIds = groups.map((group) => group.id);
  const providers = await prisma.upstreamProvider.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true }
  });
  const providerIds = providers.map((provider) => provider.id);
  const modelPrices = await prisma.modelPrice.findMany({
    where: { model: { startsWith: prefix } },
    select: { id: true }
  });
  const modelPriceIds = modelPrices.map((modelPrice) => modelPrice.id);
  const tokenIds = (
    await prisma.apiToken.findMany({
      where: { userId: { in: userIds } },
      select: { id: true }
    })
  ).map((token) => token.id);
  const usageIds = (
    await prisma.usageEvent.findMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { tokenId: { in: tokenIds } },
          { upstreamProviderId: { in: providerIds } },
          { model: { startsWith: prefix } }
        ]
      },
      select: { id: true }
    })
  ).map((event) => event.id);

  await prisma.walletTransaction.deleteMany({ where: { usageEventId: { in: usageIds } } });
  await prisma.usageEvent.deleteMany({ where: { id: { in: usageIds } } });
  await prisma.apiTokenModelAccess.deleteMany({
    where: { OR: [{ apiTokenId: { in: tokenIds } }, { model: { startsWith: prefix } }] }
  });
  await prisma.apiToken.deleteMany({ where: { id: { in: tokenIds } } });
  await prisma.upstreamModel.deleteMany({
    where: { OR: [{ providerId: { in: providerIds } }, { publicModel: { startsWith: prefix } }] }
  });
  await prisma.modelGroupAccess.deleteMany({
    where: { OR: [{ modelPriceId: { in: modelPriceIds } }, { groupId: { in: groupIds } }] }
  });
  await prisma.modelPrice.deleteMany({ where: { id: { in: modelPriceIds } } });
  await prisma.upstreamProvider.deleteMany({ where: { id: { in: providerIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.userGroup.deleteMany({ where: { id: { in: groupIds } } });
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
