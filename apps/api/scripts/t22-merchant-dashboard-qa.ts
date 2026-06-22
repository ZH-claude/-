import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import {
  ModelStatus,
  PrismaClient,
  RechargeCodeStatus,
  UpstreamHealthStatus,
  UpstreamProviderStatus,
  UsageEventStatus,
  UserRole,
  UserStatus
} from '../src/generated/prisma/client';
import { encryptUpstreamApiKey, maskUpstreamApiKey } from '../src/admin/upstream-key-crypto';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  text: string;
  headers: Headers;
  cookies: string;
};

type DashboardSummary = {
  generatedAt: string;
  window: {
    todayStart: string;
    last24HoursStart: string;
  };
  users: {
    total: number;
    active: number;
    disabled: number;
    riskLocked: number;
    admins: number;
    ordinary: number;
    newToday: number;
  };
  wallets: {
    totalBalanceCents: number;
    totalSpendCents: number;
  };
  today: {
    callCount: number;
    spendCents: number;
    totalTokens: number;
    statusCounts: Record<string, number>;
  };
  upstreams: {
    total: number;
    active: number;
    disabled: number;
    health: Record<string, number>;
  };
  models: {
    total: number;
    active: number;
    disabled: number;
    upstreamMappings: {
      total: number;
      active: number;
      disabled: number;
    };
  };
  rechargeCodes: {
    total: number;
    unused: number;
    used: number;
    disabled: number;
  };
  recentAlerts: Array<{
    id: string;
    type: string;
    severity: string;
    title: string;
    detail: string;
    createdAt: string;
  }>;
};

type Baseline = {
  users: {
    total: number;
    active: number;
    disabled: number;
    riskLocked: number;
    admins: number;
    ordinary: number;
    newToday: number;
  };
  wallets: {
    totalBalanceCents: number;
    totalSpendCents: number;
  };
  today: {
    callCount: number;
    spendCents: number;
    totalTokens: number;
    statusCounts: Record<string, number>;
  };
  upstreams: {
    total: number;
    active: number;
    disabled: number;
    health: Record<string, number>;
  };
  models: {
    total: number;
    active: number;
    disabled: number;
    upstreamMappings: {
      total: number;
      active: number;
      disabled: number;
    };
  };
  rechargeCodes: {
    total: number;
    unused: number;
    used: number;
    disabled: number;
  };
};

type Residual = {
  users: number;
  sessions: number;
  wallets: number;
  apiTokens: number;
  usageEvents: number;
  requestLogs: number;
  upstreamProviders: number;
  upstreamModels: number;
  modelPrices: number;
  rechargeCodes: number;
};

type SeededPayload = {
  usernames: {
    user: string;
    admin: string;
  };
  userIds: string[];
  providerName: string;
  providerId: string;
  modelName: string;
  upstreamModelName: string;
  tokenId: string;
  requestLogRequestIds: string[];
  usageRequestIds: string[];
  rechargeCodeIds: string[];
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T22 merchant dashboard QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
const prefix = `q23_${suffix}`;
const password = `qa-password-${suffix}`;
const upstreamKey = `qa-t22-merchant-dashboard-${suffix}`;
const checks: string[] = [];
const checksPasswordHashSaltRounds = 12;
const seededData: SeededPayload = {
  usernames: {
    user: `${prefix}_user`,
    admin: `${prefix}_admin`
  },
  userIds: [],
  providerName: `${prefix}_provider`,
  providerId: '',
  modelName: `${prefix}_model`,
  upstreamModelName: `${prefix}_upstream_model`,
  tokenId: '',
  requestLogRequestIds: [],
  usageRequestIds: [],
  rechargeCodeIds: []
};

let checksError: unknown;
let residualBefore: Residual | null = null;
let residualAfter: Residual | null = null;

async function main() {
  let expected: Baseline;
  let adminSummary: HttpResult<DashboardSummary>;
  let userSummary: HttpResult<unknown>;

  try {
    const seed = await seedFixture();
    checks.push('seeded_real_users_wallets_tokens_upstreams_models_usage_logs_and_recharge_codes');
    seededData.userIds = seed.userIds;

    const adminLogin = await login(seed.usernames.admin);
    assert(adminLogin.status >= 200 && adminLogin.status < 300, `admin login failed with ${adminLogin.status}`);
    assert(adminLogin.cookies.length > 0, 'admin login did not return session cookie');
    checks.push('admin_login_success');

    const userLogin = await login(seed.usernames.user);
    assert(userLogin.status >= 200 && userLogin.status < 300, `user login failed with ${userLogin.status}`);
    assert(userLogin.cookies.length > 0, 'user login did not return session cookie');
    checks.push('ordinary_user_login_success');

    expected = await captureExpectedSummary();
    checks.push('expected_summary_recomputed_from_real_database');

    adminSummary = await request<DashboardSummary>('GET', '/admin/dashboard-summary', undefined, adminLogin.cookies);
    assert(adminSummary.status === 200, `dashboard summary request for admin failed with ${adminSummary.status}`);
    assert(adminSummary.json, 'admin dashboard summary response missing json payload');
    checks.push('admin_can_call_dashboard_summary');

    assertDashboardNumbers(adminSummary.json, expected);
    assertNoSensitiveLeak(adminSummary.text || JSON.stringify(adminSummary.json));
    checks.push('admin_dashboard_summary_returns_real_numbers_without_sensitive_payload');

    userSummary = await request<unknown>('GET', '/admin/dashboard-summary', undefined, userLogin.cookies);
    assert(userSummary.status === 403, `ordinary user should get 403 from dashboard summary, got ${userSummary.status}`);
    checks.push('ordinary_user_forbidden_from_dashboard_summary');

    residualBefore = await countResidual();
    checks.push('residual_state_counted_before_cleanup');

    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          checks,
          expected,
          summary: adminSummary.json
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
    residualBefore,
    residualAfter
  };
  console.log(JSON.stringify(result, null, 2));

  if (checksError) {
    throw checksError;
  }
}

async function seedFixture() {
  const passwordHash = await bcrypt.hash(password, checksPasswordHashSaltRounds);
  const group = await prisma.userGroup.upsert({
    where: { code: 'default' },
    update: {},
    create: {
      code: 'default',
      name: 'Default Group'
    }
  });

  const user = await prisma.user.create({
    data: {
      username: seededData.usernames.user,
      passwordHash,
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      groupId: group.id,
      inviteCode: `${prefix}_invite_user`
    }
  });

  const admin = await prisma.user.create({
    data: {
      username: seededData.usernames.admin,
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      groupId: group.id,
      inviteCode: `${prefix}_invite_admin`
    }
  });

  await prisma.wallet.createMany({
    data: [
      { userId: user.id, balanceCents: 1200 },
      { userId: admin.id, balanceCents: 3400 }
    ]
  });

  const token = await prisma.apiToken.create({
    data: {
      userId: user.id,
      name: `${prefix}_token`,
      tokenHash: `${prefix}_token_${randomBytes(8).toString('hex')}`,
      keyPreview: `${prefix}-preview`
    }
  });

  const provider = await prisma.upstreamProvider.create({
    data: {
      name: seededData.providerName,
      baseUrl: `https://${seededData.providerName}.example.invalid`,
      encryptedApiKey: encryptUpstreamApiKey(upstreamKey),
      apiKeyPreview: maskUpstreamApiKey(upstreamKey),
      status: UpstreamProviderStatus.ACTIVE,
      healthStatus: UpstreamHealthStatus.UNHEALTHY,
      createdByAdminId: admin.id
    }
  });

  const modelPrice = await prisma.modelPrice.create({
    data: {
      model: seededData.modelName,
      displayName: `${seededData.modelName}_display`,
      inputPriceCentsPer1k: 8,
      outputPriceCentsPer1k: 12,
      modelMultiplier: '1.0',
      status: ModelStatus.ACTIVE
    }
  });

  await prisma.upstreamModel.create({
    data: {
      providerId: provider.id,
      publicModel: seededData.modelName,
      upstreamModel: seededData.upstreamModelName,
      status: ModelStatus.ACTIVE,
      supportsStream: true
    }
  });

  const usageOneId = `${seededData.providerName}_usage_billable_${suffix}`;
  const usageTwoId = `${seededData.providerName}_usage_failed_${suffix}`;
  await prisma.usageEvent.createMany({
    data: [
      {
        requestId: usageOneId,
        userId: user.id,
        tokenId: token.id,
        upstreamProviderId: provider.id,
        model: seededData.modelName,
        upstreamModel: seededData.upstreamModelName,
        promptTokens: 120,
        completionTokens: 80,
        totalTokens: 200,
        costCents: 90,
        status: UsageEventStatus.BILLABLE,
        errorCode: null,
        priceSnapshot: { source: prefix, model: seededData.modelName, multiplier: 1 }
      },
      {
        requestId: `${seededData.providerName}_usage_pending_${suffix}`,
        userId: user.id,
        tokenId: token.id,
        upstreamProviderId: provider.id,
        model: seededData.modelName,
        upstreamModel: seededData.upstreamModelName,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costCents: 0,
        status: UsageEventStatus.FAILED,
        errorCode: 'upstream_error',
        priceSnapshot: { source: prefix, model: seededData.modelName, multiplier: 1 }
      }
    ]
  });

  const requestLogRequestId = `${seededData.providerName}_request_error_${suffix}`;
  await prisma.requestLog.create({
    data: {
      requestId: requestLogRequestId,
      userId: user.id,
      tokenId: token.id,
      upstreamProviderId: provider.id,
      method: 'POST',
      path: '/v1/chat/completions',
      model: seededData.modelName,
      statusCode: 503,
      errorCode: 'upstream_unavailable',
      latencyMs: 180
    }
  });

  const usedRecharge = await prisma.rechargeCode.create({
    data: {
      codeHash: `${seededData.providerName}_used_${suffix}`,
      amountCents: 7000,
      status: RechargeCodeStatus.USED,
      createdByAdminId: admin.id,
      usedByUserId: user.id,
      usedAt: new Date()
    }
  });
  const unusedRecharge = await prisma.rechargeCode.create({
    data: {
      codeHash: `${seededData.providerName}_unused_${suffix}`,
      amountCents: 3000,
      status: RechargeCodeStatus.UNUSED,
      createdByAdminId: admin.id
    }
  });

  seededData.userIds = [user.id, admin.id];
  seededData.providerId = provider.id;
  seededData.tokenId = token.id;
  seededData.requestLogRequestIds = [requestLogRequestId];
  seededData.usageRequestIds = [usageOneId, `${seededData.providerName}_usage_pending_${suffix}`];
  seededData.rechargeCodeIds = [usedRecharge.id, unusedRecharge.id];

  checks.push('seeded_rows_are_marked_with_prefix');

  return {
    ...seededData,
    userIds: [user.id, admin.id]
  };
}

async function captureExpectedSummary() {
  const now = new Date();
  const todayStart = startOfChinaDay(now);
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
    rechargeStatusGroups
  ] = await Promise.all([
    prisma.user.groupBy({
      by: ['status', 'role'],
      where: userWhere,
      _count: { _all: true }
    }),
    prisma.user.count({
      where: {
        ...userWhere,
        createdAt: { gte: todayStart }
      }
    }),
    prisma.wallet.aggregate({
      where: { user: userWhere },
      _sum: {
        balanceCents: true,
        totalSpendCents: true
      }
    }),
    prisma.usageEvent.aggregate({
      where: { createdAt: { gte: todayStart } },
      _sum: {
        costCents: true,
        totalTokens: true
      }
    }),
    prisma.usageEvent.count({
      where: { createdAt: { gte: todayStart } }
    }),
    prisma.usageEvent.groupBy({
      by: ['status'],
      where: { createdAt: { gte: todayStart } },
      _count: { _all: true }
    }),
    prisma.upstreamProvider.count(),
    prisma.upstreamProvider.groupBy({
      by: ['status'],
      _count: { _all: true }
    }),
    prisma.upstreamProvider.groupBy({
      by: ['healthStatus'],
      _count: { _all: true }
    }),
    prisma.modelPrice.groupBy({
      by: ['status'],
      _count: { _all: true }
    }),
    prisma.upstreamModel.groupBy({
      by: ['status'],
      _count: { _all: true }
    }),
    prisma.rechargeCode.groupBy({
      by: ['status'],
      _count: { _all: true }
    })
  ]);

  const userStatusCounts = enumCountMap(userGroups, 'status', [
    UserStatus.ACTIVE,
    UserStatus.DISABLED,
    UserStatus.RISK_LOCKED
  ]);
  const userRoleCounts = enumCountMap(userGroups, 'role', [UserRole.USER, UserRole.ADMIN]);
  const upstreamStatusCounts = enumCountMap(upstreamStatusGroups, 'status', [
    UpstreamProviderStatus.ACTIVE,
    UpstreamProviderStatus.DISABLED
  ]);
  const upstreamHealthCounts = enumCountMap(upstreamHealthGroups, 'healthStatus', [
    UpstreamHealthStatus.HEALTHY,
    UpstreamHealthStatus.UNHEALTHY,
    UpstreamHealthStatus.UNKNOWN
  ]);
  const modelStatusCounts = enumCountMap(modelStatusGroups, 'status', [ModelStatus.ACTIVE, ModelStatus.DISABLED]);
  const upstreamModelStatusCounts = enumCountMap(upstreamModelStatusGroups, 'status', [ModelStatus.ACTIVE, ModelStatus.DISABLED]);
  const rechargeStatusCounts = enumCountMap(rechargeStatusGroups, 'status', [
    RechargeCodeStatus.UNUSED,
    RechargeCodeStatus.USED,
    RechargeCodeStatus.DISABLED
  ]);
  const usageStatusCounts = enumCountMap(todayUsageStatusGroups, 'status', [
    UsageEventStatus.BILLABLE,
    UsageEventStatus.FREE,
    UsageEventStatus.FAILED,
    UsageEventStatus.METERING_UNKNOWN
  ]);
  const modelTotal = Object.values(modelStatusCounts).reduce((sum, count) => sum + count, 0);
  const upstreamModelTotal = Object.values(upstreamModelStatusCounts).reduce((sum, count) => sum + count, 0);
  const rechargeTotal = Object.values(rechargeStatusCounts).reduce((sum, count) => sum + count, 0);

  return {
    users: {
      total: userGroups.reduce((sum, group) => sum + groupCount(group), 0),
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
    }
  };
}

function assertDashboardNumbers(summary: DashboardSummary, expected: Baseline) {
  assertEqual(summary.users.total, expected.users.total, 'users.total');
  assertEqual(summary.users.active, expected.users.active, 'users.active');
  assertEqual(summary.users.disabled, expected.users.disabled, 'users.disabled');
  assertEqual(summary.users.riskLocked, expected.users.riskLocked, 'users.riskLocked');
  assertEqual(summary.users.admins, expected.users.admins, 'users.admins');
  assertEqual(summary.users.ordinary, expected.users.ordinary, 'users.ordinary');
  assertEqual(summary.users.newToday, expected.users.newToday, 'users.newToday');
  assertEqual(summary.wallets.totalBalanceCents, expected.wallets.totalBalanceCents, 'wallets.totalBalanceCents');
  assertEqual(summary.wallets.totalSpendCents, expected.wallets.totalSpendCents, 'wallets.totalSpendCents');
  assertEqual(summary.today.callCount, expected.today.callCount, 'today.callCount');
  assertEqual(summary.today.spendCents, expected.today.spendCents, 'today.spendCents');
  assertEqual(summary.today.totalTokens, expected.today.totalTokens, 'today.totalTokens');
  assertEqual(summary.today.statusCounts.billable, expected.today.statusCounts.billable, 'today.statusCounts.billable');
  assertEqual(summary.today.statusCounts.free, expected.today.statusCounts.free, 'today.statusCounts.free');
  assertEqual(summary.today.statusCounts.failed, expected.today.statusCounts.failed, 'today.statusCounts.failed');
  assertEqual(
    summary.today.statusCounts.metering_unknown,
    expected.today.statusCounts.metering_unknown,
    'today.statusCounts.metering_unknown'
  );
  assertEqual(summary.upstreams.total, expected.upstreams.total, 'upstreams.total');
  assertEqual(summary.upstreams.active, expected.upstreams.active, 'upstreams.active');
  assertEqual(summary.upstreams.disabled, expected.upstreams.disabled, 'upstreams.disabled');
  assertEqual(summary.upstreams.health.healthy, expected.upstreams.health.healthy, 'upstreams.health.healthy');
  assertEqual(summary.upstreams.health.unhealthy, expected.upstreams.health.unhealthy, 'upstreams.health.unhealthy');
  assertEqual(summary.upstreams.health.unknown, expected.upstreams.health.unknown, 'upstreams.health.unknown');
  assertEqual(summary.models.total, expected.models.total, 'models.total');
  assertEqual(summary.models.active, expected.models.active, 'models.active');
  assertEqual(summary.models.disabled, expected.models.disabled, 'models.disabled');
  assertEqual(summary.models.upstreamMappings.total, expected.models.upstreamMappings.total, 'models.upstreamMappings.total');
  assertEqual(summary.models.upstreamMappings.active, expected.models.upstreamMappings.active, 'models.upstreamMappings.active');
  assertEqual(summary.models.upstreamMappings.disabled, expected.models.upstreamMappings.disabled, 'models.upstreamMappings.disabled');
  assertEqual(summary.rechargeCodes.total, expected.rechargeCodes.total, 'rechargeCodes.total');
  assertEqual(summary.rechargeCodes.unused, expected.rechargeCodes.unused, 'rechargeCodes.unused');
  assertEqual(summary.rechargeCodes.used, expected.rechargeCodes.used, 'rechargeCodes.used');
  assertEqual(summary.rechargeCodes.disabled, expected.rechargeCodes.disabled, 'rechargeCodes.disabled');
  assert(summary.recentAlerts.length >= 1, 'dashboard summary should contain at least one recent alert');
  const alertText = JSON.stringify(summary.recentAlerts);
  assert(
    alertText.includes(seededData.providerName) || alertText.includes(seededData.modelName),
    'dashboard recent alerts should include the seeded real request/upstream alert'
  );
}

function assertNoSensitiveLeak(serialized: string) {
  const forbidden = [
    'passwordHash',
    'tokenHash',
    'encryptedApiKey',
    'codeHash',
    'connection string',
    'DATABASE_URL',
    'REDIS_URL',
    upstreamKey
  ];

  for (const field of forbidden) {
    assert(!serialized.includes(field), `dashboard summary should not expose sensitive field/value: ${field}`);
  }
}

async function login(username: string) {
  return request<{ user: { id: string; username: string; role: string; status: string } }>('POST', '/auth/login', {
    username,
    password
  });
}

async function request<T = unknown>(method: string, path: string, body?: unknown, cookie?: string): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      accept: 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const json = text ? (JSON.parse(text) as T) : ({} as T);
  return {
    status: response.status,
    json,
    text,
    headers: response.headers,
    cookies: extractCookieHeader(response)
  };
}

function extractCookieHeader(response: Response) {
  const headerAccessor = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookieHeaders = headerAccessor.getSetCookie ? headerAccessor.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
  return cookieHeaders
    .filter(Boolean)
    .map((entry) => entry.split(';')[0])
    .join('; ');
}

function startOfChinaDay(date: Date) {
  const chinaOffsetMs = 8 * 60 * 60 * 1000;
  const chinaTime = new Date(date.getTime() + chinaOffsetMs);
  return new Date(Date.UTC(chinaTime.getUTCFullYear(), chinaTime.getUTCMonth(), chinaTime.getUTCDate()) - chinaOffsetMs);
}

function enumCountMap<T extends string>(
  groups: Array<Record<string, unknown> & { _count?: true | { _all?: number } }>,
  key: string,
  expectedValues: T[]
) {
  const counts = Object.fromEntries(expectedValues.map((value) => [value.toLowerCase(), 0])) as Record<Lowercase<T>, number>;

  for (const group of groups) {
    const value = group[key];
    if (typeof value === 'string') {
      counts[value.toLowerCase() as Lowercase<T>] = groupCount(group);
    }
  }

  return counts;
}

function groupCount(group: { _count?: true | { _all?: number } }) {
  return typeof group._count === 'object' ? group._count._all ?? 0 : 0;
}

async function countResidual(): Promise<Residual> {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((entry) => entry.id);
  const tokens = await prisma.apiToken.findMany({
    where: { userId: { in: userIds } },
    select: { id: true }
  });
  const tokenIds = tokens.map((entry) => entry.id);
  const upstreamProviders = await prisma.upstreamProvider.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true }
  });
  const providerIds = upstreamProviders.map((entry) => entry.id);
  const modelNames = [seededData.modelName];

  const usageEvents = await prisma.usageEvent.findMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { tokenId: { in: tokenIds } },
        { requestId: { in: seededData.usageRequestIds } },
        { model: { in: modelNames } }
      ]
    },
    select: { id: true }
  });
  const usageIds = usageEvents.map((entry) => entry.id);
  const requestLogs = await prisma.requestLog.findMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { tokenId: { in: tokenIds } },
        { requestId: { in: seededData.requestLogRequestIds } },
        { requestId: { startsWith: prefix } }
      ]
    },
    select: { id: true }
  });

  return {
    users: users.length,
    sessions: await prisma.session.count({ where: { userId: { in: userIds } } }),
    wallets: await prisma.wallet.count({ where: { userId: { in: userIds } } }),
    apiTokens: tokenIds.length,
    usageEvents: usageIds.length,
    requestLogs: requestLogs.length,
    upstreamProviders: providerIds.length,
    upstreamModels: await prisma.upstreamModel.count({
      where: { OR: [{ providerId: { in: providerIds } }, { publicModel: { in: modelNames } }] }
    }),
    modelPrices: await prisma.modelPrice.count({ where: { model: { in: modelNames } } }),
    rechargeCodes: await prisma.rechargeCode.count({
      where: {
        OR: [
          { createdByAdminId: { in: userIds } },
          { usedByUserId: { in: userIds } },
          { id: { in: seededData.rechargeCodeIds } }
        ]
      }
    })
  };
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  if (!userIds.length) {
    return;
  }

  const tokens = await prisma.apiToken.findMany({
    where: { userId: { in: userIds } },
    select: { id: true }
  });
  const tokenIds = tokens.map((token) => token.id);

  const providers = await prisma.upstreamProvider.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true }
  });
  const providerIds = providers.map((provider) => provider.id);

  const usageEvents = await prisma.usageEvent.findMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { tokenId: { in: tokenIds } },
        { requestId: { in: seededData.usageRequestIds } },
        { model: seededData.modelName }
      ]
    },
    select: { id: true }
  });
  const usageIds = usageEvents.map((event) => event.id);

  await prisma.securityAuditLog.deleteMany({
    where: {
      OR: [{ actorUserId: { in: userIds } }, { targetId: { in: userIds } }]
    }
  });

  await prisma.requestLog.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { tokenId: { in: tokenIds } },
        { requestId: { in: seededData.requestLogRequestIds } },
        { requestId: { startsWith: prefix } }
      ]
    }
  });

  await prisma.walletTransaction.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { usageEventId: { in: usageIds } }] }
  });
  await prisma.usageEvent.deleteMany({ where: { id: { in: usageIds } } });

  const modelPrice = await prisma.modelPrice.findUnique({
    where: { model: seededData.modelName },
    select: { id: true }
  });

  if (modelPrice) {
    await prisma.modelGroupAccess.deleteMany({ where: { modelPriceId: modelPrice.id } });
  }

  await prisma.apiTokenModelAccess.deleteMany({
    where: { OR: [{ apiTokenId: { in: tokenIds } }, { model: seededData.modelName }] }
  });
  await prisma.apiToken.deleteMany({ where: { id: { in: tokenIds } } });

  await prisma.upstreamModel.deleteMany({
    where: { OR: [{ providerId: { in: providerIds } }, { publicModel: seededData.modelName }] }
  });
  await prisma.upstreamProvider.deleteMany({ where: { id: { in: providerIds } } });
  if (modelPrice) {
    await prisma.modelPrice.deleteMany({ where: { id: modelPrice.id } });
  }
  await prisma.rechargeCode.deleteMany({
    where: {
      OR: [
        { createdByAdminId: { in: userIds } },
        { usedByUserId: { in: userIds } },
        { id: { in: seededData.rechargeCodeIds } }
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

function assertEqual(actual: number, expected: number, label: string) {
  assert(actual === expected, `${label} mismatch: expected ${expected}, got ${actual}`);
}

void main();
