import { PrismaPg } from '@prisma/adapter-pg';
import { hash as bcryptHash } from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  ModelStatus,
  PrismaClient,
  RechargeCodeKind,
  RechargeCodeStatus,
  UpstreamHealthStatus,
  UpstreamProviderStatus,
  UsageEventStatus,
  UserRole,
  UserStatus,
  WalletTransactionType
} from '../src/generated/prisma/client';
import { encryptUpstreamApiKey, maskUpstreamApiKey } from '../src/admin/upstream-key-crypto';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  text: string;
  ms: number;
};

type DashboardSummary = {
  users: {
    total: number;
    ordinary: number;
    admins: number;
    newToday: number;
  };
  today: {
    callCount: number;
    totalTokens: number;
    activeUsers: number;
    rechargeCents: number;
    rechargeCount: number;
  };
  month: {
    newUsers: number;
    callCount: number;
    totalTokens: number;
    activeUsers: number;
    rechargeCents: number;
    rechargeCount: number;
  };
  topUsers: Array<{
    id: string;
    username: string;
    usage: {
      totalTokens: number;
      requestCount: number;
    };
  }>;
};

type ModelsResponse = {
  data?: Array<{
    id?: string;
  }>;
};

type UsageLogsResponse = {
  items?: Array<{
    requestId?: string;
    model?: string;
    status?: string;
  }>;
  summary?: {
    total?: number;
    totalRequests?: number;
  };
};

type UsageTraceResponse = {
  requestId?: string;
  trace?: {
    hasUsageEvent?: boolean;
    hasRequestLog?: boolean;
  };
};

type SeededUser = {
  id: string;
  username: string;
  sessionToken: string;
  apiKey: string;
  apiTokenId: string;
  rechargeCodeId: string;
  usageRequestId: string;
};

type ResidualCounts = {
  users: number;
  sessions: number;
  wallets: number;
  apiTokens: number;
  usageEvents: number;
  requestLogs: number;
  walletTransactions: number;
  rechargeCodes: number;
  upstreamProviders: number;
  upstreamModels: number;
  modelPrices: number;
  modelGroupAccesses: number;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;

const USER_COUNT = positiveInt(process.env.ENTERPRISE_PERF_USER_COUNT, 1000, 'ENTERPRISE_PERF_USER_COUNT');
const AUTH_CONCURRENT_REQUESTS = positiveInt(
  process.env.ENTERPRISE_PERF_AUTH_CONCURRENT_REQUESTS,
  USER_COUNT,
  'ENTERPRISE_PERF_AUTH_CONCURRENT_REQUESTS'
);
const DASHBOARD_PARALLEL_REQUESTS = positiveInt(
  process.env.ENTERPRISE_PERF_DASHBOARD_PARALLEL_REQUESTS,
  10,
  'ENTERPRISE_PERF_DASHBOARD_PARALLEL_REQUESTS'
);
const MODEL_LIST_CONCURRENT_REQUESTS = positiveInt(
  process.env.ENTERPRISE_PERF_MODEL_LIST_CONCURRENT_REQUESTS,
  100,
  'ENTERPRISE_PERF_MODEL_LIST_CONCURRENT_REQUESTS'
);
const USAGE_LOG_PARALLEL_REQUESTS = positiveInt(
  process.env.ENTERPRISE_PERF_USAGE_LOG_PARALLEL_REQUESTS,
  50,
  'ENTERPRISE_PERF_USAGE_LOG_PARALLEL_REQUESTS'
);
const AUTH_MAX_MS = positiveInt(process.env.ENTERPRISE_PERF_AUTH_MAX_MS, 30000, 'ENTERPRISE_PERF_AUTH_MAX_MS');
const DASHBOARD_MAX_MS = positiveInt(process.env.ENTERPRISE_PERF_DASHBOARD_MAX_MS, 5000, 'ENTERPRISE_PERF_DASHBOARD_MAX_MS');
const DASHBOARD_PARALLEL_MAX_MS = positiveInt(
  process.env.ENTERPRISE_PERF_DASHBOARD_PARALLEL_MAX_MS,
  10000,
  'ENTERPRISE_PERF_DASHBOARD_PARALLEL_MAX_MS'
);
const MODEL_LIST_BATCH_MAX_MS = positiveInt(
  process.env.ENTERPRISE_PERF_MODEL_LIST_BATCH_MAX_MS,
  10000,
  'ENTERPRISE_PERF_MODEL_LIST_BATCH_MAX_MS'
);
const MODEL_LIST_P95_MAX_MS = positiveInt(
  process.env.ENTERPRISE_PERF_MODEL_LIST_P95_MAX_MS,
  2500,
  'ENTERPRISE_PERF_MODEL_LIST_P95_MAX_MS'
);
const USAGE_LOG_BATCH_MAX_MS = positiveInt(
  process.env.ENTERPRISE_PERF_USAGE_LOG_BATCH_MAX_MS,
  10000,
  'ENTERPRISE_PERF_USAGE_LOG_BATCH_MAX_MS'
);
const USAGE_LOG_P95_MAX_MS = positiveInt(
  process.env.ENTERPRISE_PERF_USAGE_LOG_P95_MAX_MS,
  3500,
  'ENTERPRISE_PERF_USAGE_LOG_P95_MAX_MS'
);
const USAGE_TRACE_MAX_MS = positiveInt(
  process.env.ENTERPRISE_PERF_USAGE_TRACE_MAX_MS,
  2500,
  'ENTERPRISE_PERF_USAGE_TRACE_MAX_MS'
);

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T32 enterprise performance QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const prefix = `qa_t32_${suffix}`;
const password = `qa-password-${suffix}`;
const providerName = `${prefix}_provider`;
const modelName = `${prefix}_model`;
const upstreamModel = `${prefix}_upstream_model`;
const upstreamKey = `qa-t32-upstream-${suffix}`;
const checks: string[] = [];

let seededUsers: SeededUser[] = [];
let adminUserId = '';
let adminSessionToken = '';
let providerId = '';
let checksError: unknown;
let residualBefore: ResidualCounts | null = null;
let residualAfter: ResidualCounts | null = null;

async function main() {
  try {
    const seedStartedAt = performance.now();
    await seedEnterpriseFixture();
    const seedMs = Math.round(performance.now() - seedStartedAt);
    checks.push('seeded_1000_user_scale_fixture');

    const dashboard = await timedGet<DashboardSummary>('/admin/dashboard-summary', cookieFor(adminSessionToken));
    assert(dashboard.status === 200, `dashboard summary failed with ${dashboard.status}: ${dashboard.text}`);
    assert(dashboard.ms <= DASHBOARD_MAX_MS, `dashboard summary took ${dashboard.ms}ms, limit ${DASHBOARD_MAX_MS}ms`);
    assertDashboardScale(dashboard.json);
    assertNoSensitiveLeak(dashboard.text);
    checks.push('dashboard_summary_handles_1000_user_scale_within_threshold');

    const parallelDashboardStartedAt = performance.now();
    const dashboardResults = await Promise.all(
      Array.from({ length: DASHBOARD_PARALLEL_REQUESTS }, () => timedGet<DashboardSummary>('/admin/dashboard-summary', cookieFor(adminSessionToken)))
    );
    const parallelDashboardMs = Math.round(performance.now() - parallelDashboardStartedAt);
    const dashboardFailures = dashboardResults.filter((entry) => entry.status !== 200);
    assert(dashboardFailures.length === 0, `parallel dashboard requests failed: ${dashboardFailures.map((entry) => entry.status).join(', ')}`);
    assert(
      parallelDashboardMs <= DASHBOARD_PARALLEL_MAX_MS,
      `parallel dashboard batch took ${parallelDashboardMs}ms, limit ${DASHBOARD_PARALLEL_MAX_MS}ms`
    );
    checks.push('parallel_dashboard_reads_do_not_collapse_under_load');

    const authUsers = seededUsers.slice(0, AUTH_CONCURRENT_REQUESTS);
    assert(authUsers.length === AUTH_CONCURRENT_REQUESTS, 'not enough seeded users for concurrent auth test');
    const authStartedAt = performance.now();
    const authResults = await Promise.all(authUsers.map((user) => timedGet('/auth/me', cookieFor(user.sessionToken))));
    const authBatchMs = Math.round(performance.now() - authStartedAt);
    const authFailures = authResults.filter((entry) => entry.status !== 200);
    assert(authFailures.length === 0, `concurrent /auth/me failures: ${authFailures.map((entry) => entry.status).join(', ')}`);
    assert(authBatchMs <= AUTH_MAX_MS, `concurrent /auth/me batch took ${authBatchMs}ms, limit ${AUTH_MAX_MS}ms`);
    checks.push('one_thousand_concurrent_authenticated_reads_return_200');

    const modelListUsers = seededUsers.slice(0, MODEL_LIST_CONCURRENT_REQUESTS);
    assert(modelListUsers.length === MODEL_LIST_CONCURRENT_REQUESTS, 'not enough seeded users for concurrent model list test');
    const modelListStartedAt = performance.now();
    const modelListResults = await Promise.all(
      modelListUsers.map((user) => timedGet<ModelsResponse>('/v1/models', undefined, user.apiKey))
    );
    const modelListBatchMs = Math.round(performance.now() - modelListStartedAt);
    const modelListFailures = modelListResults.filter((entry) => entry.status !== 200);
    assert(
      modelListFailures.length === 0,
      `concurrent /v1/models failures: ${modelListFailures.map((entry) => entry.status).join(', ')}`
    );
    assert(modelListBatchMs <= MODEL_LIST_BATCH_MAX_MS, `/v1/models batch took ${modelListBatchMs}ms, limit ${MODEL_LIST_BATCH_MAX_MS}ms`);
    const modelListP95Ms = percentile(modelListResults.map((entry) => entry.ms), 0.95);
    assert(modelListP95Ms <= MODEL_LIST_P95_MAX_MS, `/v1/models p95 took ${modelListP95Ms}ms, limit ${MODEL_LIST_P95_MAX_MS}ms`);
    for (const result of modelListResults) {
      assert(result.json.data?.some((entry) => entry.id === modelName), '/v1/models response did not include seeded model');
      assertNoSensitiveLeak(result.text);
    }
    checks.push('concurrent_model_list_reads_stay_fast_at_1000_user_scale');

    const usageLogUsers = seededUsers.slice(0, USAGE_LOG_PARALLEL_REQUESTS);
    assert(usageLogUsers.length === USAGE_LOG_PARALLEL_REQUESTS, 'not enough seeded users for usage log test');
    const usageLogStartedAt = performance.now();
    const usageLogResults = await Promise.all(
      usageLogUsers.map((user) =>
        timedGet<UsageLogsResponse>(
          `/usage/logs?limit=100&model=${encodeURIComponent(modelName)}&status=billable`,
          cookieFor(user.sessionToken)
        )
      )
    );
    const usageLogBatchMs = Math.round(performance.now() - usageLogStartedAt);
    const usageLogFailures = usageLogResults.filter((entry) => entry.status !== 200);
    assert(
      usageLogFailures.length === 0,
      `parallel /usage/logs requests failed: ${usageLogFailures.map((entry) => entry.status).join(', ')}`
    );
    assert(usageLogBatchMs <= USAGE_LOG_BATCH_MAX_MS, `/usage/logs batch took ${usageLogBatchMs}ms, limit ${USAGE_LOG_BATCH_MAX_MS}ms`);
    const usageLogP95Ms = percentile(usageLogResults.map((entry) => entry.ms), 0.95);
    assert(usageLogP95Ms <= USAGE_LOG_P95_MAX_MS, `/usage/logs p95 took ${usageLogP95Ms}ms, limit ${USAGE_LOG_P95_MAX_MS}ms`);
    for (const [index, result] of usageLogResults.entries()) {
      const expectedRequestId = usageLogUsers[index].usageRequestId;
      assert(result.json.items?.some((entry) => entry.requestId === expectedRequestId), '/usage/logs response missed seeded request');
      assert(result.json.summary?.totalRequests !== undefined, '/usage/logs response missed summary totalRequests');
      assertNoSensitiveLeak(result.text);
    }
    checks.push('parallel_usage_log_reads_stay_fast_at_1000_user_scale');

    const traceUser = seededUsers[0];
    assert(traceUser, 'trace test requires at least one seeded user');
    const usageTrace = await timedGet<UsageTraceResponse>(
      `/usage/logs/${encodeURIComponent(traceUser.usageRequestId)}/trace`,
      cookieFor(traceUser.sessionToken)
    );
    assert(usageTrace.status === 200, `usage trace failed with ${usageTrace.status}: ${usageTrace.text}`);
    assert(usageTrace.ms <= USAGE_TRACE_MAX_MS, `usage trace took ${usageTrace.ms}ms, limit ${USAGE_TRACE_MAX_MS}ms`);
    assert(usageTrace.json.requestId === traceUser.usageRequestId, 'usage trace requestId mismatch');
    assert(usageTrace.json.trace?.hasUsageEvent === true, 'usage trace should include usage event');
    assert(usageTrace.json.trace?.hasRequestLog === true, 'usage trace should include request log');
    assertNoSensitiveLeak(usageTrace.text);
    checks.push('usage_trace_lookup_stays_fast_at_1000_user_scale');

    residualBefore = await countResidual();
    checks.push('residual_metrics_captured_before_cleanup');

    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          config: {
            userCount: USER_COUNT,
            authConcurrentRequests: AUTH_CONCURRENT_REQUESTS,
            dashboardParallelRequests: DASHBOARD_PARALLEL_REQUESTS,
            modelListConcurrentRequests: MODEL_LIST_CONCURRENT_REQUESTS,
            usageLogParallelRequests: USAGE_LOG_PARALLEL_REQUESTS,
            authMaxMs: AUTH_MAX_MS,
            dashboardMaxMs: DASHBOARD_MAX_MS,
            dashboardParallelMaxMs: DASHBOARD_PARALLEL_MAX_MS,
            modelListBatchMaxMs: MODEL_LIST_BATCH_MAX_MS,
            modelListP95MaxMs: MODEL_LIST_P95_MAX_MS,
            usageLogBatchMaxMs: USAGE_LOG_BATCH_MAX_MS,
            usageLogP95MaxMs: USAGE_LOG_P95_MAX_MS,
            usageTraceMaxMs: USAGE_TRACE_MAX_MS
          },
          timings: {
            seedMs,
            dashboardMs: dashboard.ms,
            parallelDashboardMs,
            authBatchMs,
            authAverageMs: Math.round(authResults.reduce((sum, entry) => sum + entry.ms, 0) / authResults.length),
            authP95Ms: percentile(authResults.map((entry) => entry.ms), 0.95),
            modelListBatchMs,
            modelListAverageMs: Math.round(modelListResults.reduce((sum, entry) => sum + entry.ms, 0) / modelListResults.length),
            modelListP95Ms,
            usageLogBatchMs,
            usageLogAverageMs: Math.round(usageLogResults.reduce((sum, entry) => sum + entry.ms, 0) / usageLogResults.length),
            usageLogP95Ms,
            usageTraceMs: usageTrace.ms
          },
          checks,
          residualBefore
        },
        null,
        2
      )
    );
  } catch (error) {
    checksError = error;
  } finally {
    await cleanup();
    residualAfter = await countResidual();
    await prisma.$disconnect();
  }

  const result = {
    ok: checksError === undefined,
    suffix,
    checks,
    residualAfter
  };
  console.log(JSON.stringify(result, null, 2));

  if (checksError) {
    throw checksError;
  }
}

async function seedEnterpriseFixture() {
  const passwordHash = await bcryptHash(password, 12);
  const group = await prisma.userGroup.upsert({
    where: { code: 'default' },
    update: {},
    create: {
      code: 'default',
      name: 'Default Group'
    }
  });

  adminUserId = randomUUID();
  adminSessionToken = `${prefix}_admin_session_${randomBytes(18).toString('base64url')}`;

  const users: SeededUser[] = Array.from({ length: USER_COUNT }, (_, index) => ({
    id: randomUUID(),
    username: `${prefix}_user_${index.toString().padStart(4, '0')}`,
    sessionToken: `${prefix}_session_${index}_${randomBytes(18).toString('base64url')}`,
    apiKey: `${prefix}_api_key_${index}_${randomBytes(18).toString('base64url')}`,
    apiTokenId: randomUUID(),
    rechargeCodeId: randomUUID(),
    usageRequestId: `${prefix}_usage_${index}`
  }));
  seededUsers = users;

  await prisma.user.create({
    data: {
      id: adminUserId,
      username: `${prefix}_admin`,
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      groupId: group.id,
      inviteCode: `${prefix}_admin_invite`
    }
  });

  await chunkedCreateMany(
    users.map((user, index) => ({
      id: user.id,
      username: user.username,
      phoneNumber: `+1555${suffix.slice(-4)}${index.toString().padStart(6, '0')}`,
      passwordHash,
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      groupId: group.id,
      inviteCode: `${prefix}_invite_${index.toString().padStart(4, '0')}`,
      lastLoginAt: new Date()
    })),
    (data) => prisma.user.createMany({ data })
  );

  await chunkedCreateMany(
    [
      { userId: adminUserId, balanceCents: 0, totalSpendCents: 0 },
      ...users.map((user, index) => ({
        userId: user.id,
        balanceCents: 100_000 + index,
        totalSpendCents: 100 + index
      }))
    ],
    (data) => prisma.wallet.createMany({ data })
  );

  await chunkedCreateMany(
    [
      {
        userId: adminUserId,
        tokenHash: hashToken(adminSessionToken),
        expiresAt: daysFromNow(7)
      },
      ...users.map((user) => ({
        userId: user.id,
        tokenHash: hashToken(user.sessionToken),
        expiresAt: daysFromNow(7)
      }))
    ],
    (data) => prisma.session.createMany({ data })
  );

  providerId = randomUUID();
  await prisma.upstreamProvider.create({
    data: {
      id: providerId,
      name: providerName,
      baseUrl: `https://${providerName}.example.invalid`,
      encryptedApiKey: encryptUpstreamApiKey(upstreamKey),
      apiKeyPreview: maskUpstreamApiKey(upstreamKey),
      status: UpstreamProviderStatus.ACTIVE,
      healthStatus: UpstreamHealthStatus.HEALTHY,
      createdByAdminId: adminUserId
    }
  });

  const modelPrice = await prisma.modelPrice.create({
    data: {
      model: modelName,
      displayName: `${modelName}_display`,
      inputPriceCentsPer1k: 8,
      outputPriceCentsPer1k: 12,
      modelMultiplier: '1.0',
      status: ModelStatus.ACTIVE
    }
  });

  await prisma.modelGroupAccess.create({
    data: {
      modelPriceId: modelPrice.id,
      groupId: group.id
    }
  });

  await prisma.upstreamModel.create({
    data: {
      providerId,
      publicModel: modelName,
      upstreamModel,
      status: ModelStatus.ACTIVE,
      supportsStream: true
    }
  });

  await chunkedCreateMany(
    users.map((user, index) => ({
      id: user.apiTokenId,
      userId: user.id,
      name: `${prefix}_token_${index}`,
      tokenHash: hashToken(user.apiKey),
      keyPreview: `${user.apiKey.slice(0, 10)}...${user.apiKey.slice(-4)}`
    })),
    (data) => prisma.apiToken.createMany({ data })
  );

  await chunkedCreateMany(
    users.map((user, index) => ({
      id: user.rechargeCodeId,
      codeHash: hashToken(`${prefix}_recharge_${index}`),
      kind: RechargeCodeKind.BALANCE,
      amountCents: 1000 + index,
      faceValueCnyCents: 1000 + index,
      status: RechargeCodeStatus.USED,
      createdByAdminId: adminUserId,
      usedByUserId: user.id,
      usedAt: new Date()
    })),
    (data) => prisma.rechargeCode.createMany({ data })
  );

  await chunkedCreateMany(
    users.map((user, index) => ({
      userId: user.id,
      type: WalletTransactionType.RECHARGE,
      amountCents: 1000 + index,
      balanceAfterCents: 100_000 + index,
      rechargeCodeId: user.rechargeCodeId,
      idempotencyKey: `${prefix}_recharge_tx_${index}`
    })),
    (data) => prisma.walletTransaction.createMany({ data })
  );

  await chunkedCreateMany(
    users.map((user, index) => ({
      requestId: user.usageRequestId,
      userId: user.id,
      tokenId: user.apiTokenId,
      upstreamProviderId: providerId,
      model: modelName,
      upstreamModel,
      promptTokens: 20 + index,
      completionTokens: 10,
      totalTokens: 30 + index,
      costCents: 1 + (index % 17),
      status: UsageEventStatus.BILLABLE,
      errorCode: null,
      priceSnapshot: {
        source: prefix,
        model: modelName,
        userIndex: index
      }
    })),
    (data) => prisma.usageEvent.createMany({ data })
  );

  await chunkedCreateMany(
    users.map((user, index) => ({
      requestId: user.usageRequestId,
      userId: user.id,
      tokenId: user.apiTokenId,
      upstreamProviderId: providerId,
      method: 'POST',
      path: '/v1/chat/completions',
      model: modelName,
      statusCode: 200,
      errorCode: null,
      latencyMs: 80 + (index % 40),
      upstreamLatencyMs: 60 + (index % 30),
      upstreamStatusCode: 200,
      upstreamStatus: 'success',
      completedAt: new Date()
    })),
    (data) => prisma.requestLog.createMany({ data })
  );
}

function assertDashboardScale(summary: DashboardSummary) {
  assert(summary.users.total >= USER_COUNT + 1, `dashboard users.total should include seeded users, got ${summary.users.total}`);
  assert(summary.users.ordinary >= USER_COUNT, `dashboard ordinary users should include seeded users, got ${summary.users.ordinary}`);
  assert(summary.users.admins >= 1, `dashboard admin count should include seeded admin, got ${summary.users.admins}`);
  assert(summary.users.newToday >= USER_COUNT + 1, `dashboard newToday should include seeded users, got ${summary.users.newToday}`);
  assert(summary.today.callCount >= USER_COUNT, `today.callCount should include seeded usage, got ${summary.today.callCount}`);
  assert(summary.today.activeUsers >= USER_COUNT, `today.activeUsers should include seeded users, got ${summary.today.activeUsers}`);
  assert(summary.today.rechargeCount >= USER_COUNT, `today.rechargeCount should include seeded recharges, got ${summary.today.rechargeCount}`);
  assert(summary.today.rechargeCents >= USER_COUNT * 1000, `today.rechargeCents too low: ${summary.today.rechargeCents}`);
  assert(summary.month.newUsers >= USER_COUNT + 1, `month.newUsers should include seeded users, got ${summary.month.newUsers}`);
  assert(summary.month.callCount >= USER_COUNT, `month.callCount should include seeded usage, got ${summary.month.callCount}`);
  assert(summary.month.activeUsers >= USER_COUNT, `month.activeUsers should include seeded users, got ${summary.month.activeUsers}`);
  assert(summary.month.rechargeCount >= USER_COUNT, `month.rechargeCount should include seeded recharges, got ${summary.month.rechargeCount}`);
  assert(summary.topUsers.length > 0, 'dashboard topUsers should not be empty at 1000-user scale');
  assert(
    summary.topUsers.some((entry) => entry.username.startsWith(prefix) && entry.usage.totalTokens > 0),
    'dashboard topUsers should include at least one seeded active user'
  );
}

async function timedGet<T = unknown>(path: string, cookie?: string, bearerApiKey?: string): Promise<HttpResult<T>> {
  const startedAt = performance.now();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      accept: 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(bearerApiKey ? { authorization: `Bearer ${bearerApiKey}` } : {})
    }
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as T) : ({} as T);

  return {
    status: response.status,
    json,
    text,
    ms: Math.round(performance.now() - startedAt)
  };
}

async function cleanup() {
  const userIds = [adminUserId, ...seededUsers.map((user) => user.id)].filter(Boolean);
  const apiTokenIds = seededUsers.map((user) => user.apiTokenId);

  await prisma.walletTransaction.deleteMany({
    where: { idempotencyKey: { startsWith: prefix } }
  });
  await prisma.rechargeCode.deleteMany({
    where: { id: { in: seededUsers.map((user) => user.rechargeCodeId) } }
  });
  await prisma.usageEvent.deleteMany({
    where: { requestId: { startsWith: `${prefix}_usage_` } }
  });
  await prisma.requestLog.deleteMany({
    where: requestLogResidualWhere(userIds, apiTokenIds)
  });
  await prisma.session.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { tokenHash: { startsWith: prefix } }
      ]
    }
  });
  await prisma.apiToken.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { id: { in: apiTokenIds } }
      ]
    }
  });
  await prisma.wallet.deleteMany({
    where: { userId: { in: userIds } }
  });
  await prisma.upstreamModel.deleteMany({
    where: { publicModel: modelName }
  });
  await prisma.modelGroupAccess.deleteMany({
    where: {
      modelPrice: { model: modelName }
    }
  });
  await prisma.modelPrice.deleteMany({
    where: { model: modelName }
  });
  await prisma.upstreamProvider.deleteMany({
    where: { name: providerName }
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: prefix } }
  });
}

async function countResidual(): Promise<ResidualCounts> {
  const userIds = (
    await prisma.user.findMany({
      where: { username: { startsWith: prefix } },
      select: { id: true }
    })
  ).map((entry) => entry.id);
  const apiTokenIds = seededUsers.map((user) => user.apiTokenId);

  return {
    users: userIds.length,
    sessions: await prisma.session.count({ where: { userId: { in: userIds } } }),
    wallets: await prisma.wallet.count({ where: { userId: { in: userIds } } }),
    apiTokens: await prisma.apiToken.count({
      where: {
        OR: [
          { userId: { in: userIds } },
          { id: { in: apiTokenIds } }
        ]
      }
    }),
    usageEvents: await prisma.usageEvent.count({ where: { requestId: { startsWith: `${prefix}_usage_` } } }),
    requestLogs: await prisma.requestLog.count({ where: requestLogResidualWhere(userIds, apiTokenIds) }),
    walletTransactions: await prisma.walletTransaction.count({ where: { idempotencyKey: { startsWith: prefix } } }),
    rechargeCodes: await prisma.rechargeCode.count({
      where: {
        OR: [
          { codeHash: { startsWith: prefix } },
          { id: { in: seededUsers.map((user) => user.rechargeCodeId) } }
        ]
      }
    }),
    upstreamProviders: await prisma.upstreamProvider.count({ where: { name: providerName } }),
    upstreamModels: await prisma.upstreamModel.count({ where: { publicModel: modelName } }),
    modelPrices: await prisma.modelPrice.count({ where: { model: modelName } }),
    modelGroupAccesses: await prisma.modelGroupAccess.count({
      where: {
        modelPrice: { model: modelName }
      }
    })
  };
}

function requestLogResidualWhere(userIds: string[], apiTokenIds: string[]) {
  return {
    OR: [
      { userId: { in: userIds } },
      { tokenId: { in: apiTokenIds } },
      { requestId: { startsWith: `${prefix}_` } },
      { model: modelName },
      ...(providerId ? [{ upstreamProviderId: providerId }] : [])
    ]
  };
}

async function chunkedCreateMany<T>(items: T[], create: (data: T[]) => Promise<unknown>, size = 250) {
  for (let index = 0; index < items.length; index += size) {
    await create(items.slice(index, index + size));
  }
}

function cookieFor(token: string) {
  return `nested_api_relay_session=${encodeURIComponent(token)}`;
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function assertNoSensitiveLeak(serialized: string) {
  for (const field of ['passwordHash', 'tokenHash', 'encryptedApiKey', upstreamKey, password, `${prefix}_api_key_`]) {
    assert(!serialized.includes(field), `enterprise performance payload leaked sensitive field/value: ${field}`);
  }
}

function percentile(values: number[], rank: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * rank) - 1);
  return sorted[index] ?? 0;
}

function positiveInt(value: string | undefined, fallback: number, label: string) {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return parsed;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main();
