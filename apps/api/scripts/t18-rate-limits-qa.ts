import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  ModelStatus,
  PrismaClient,
  UpstreamHealthStatus,
  UpstreamProviderStatus,
  UsageEventStatus,
  User
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

type CreateTokenResponse = {
  apiKey: string;
  token: {
    id: string;
    name: string;
    keyPreview: string;
    rateLimitRequestsPerMinute: number | null;
    modelRateLimitRequestsPerMinute: number | null;
    ipRateLimitRequestsPerMinute: number | null;
    ipWhitelist: string[];
    activationTtlSeconds: number | null;
    activatedAt: string | null;
    activationExpiresAt: string | null;
  };
};

type RelayErrorResponse = {
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
  };
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;
const TEMP_UPSTREAM_PUBLIC_HOST = process.env.TEMP_UPSTREAM_PUBLIC_HOST ?? 'host.docker.internal';
const RISK_FAILURE_THRESHOLD = 20;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T18 rate limits QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const TEMP_UPSTREAM_KEY = `qa-t18-upstream-key-${suffix}`;
const prefix = `qa_t18_${suffix}`;
const password = `qa-password-${suffix}`;
const publicModel = `${prefix}-model`;
const upstreamModel = `${prefix}-upstream`;
const providerName = `${prefix}-provider`;
const requestIds: string[] = [];
const checks: string[] = [];
let providerId = '';

async function main() {
  const upstream = await startTemporaryUpstream();
  let residualBeforeCleanup: Record<string, number> | null = null;

  try {
    const users = await createUsers(['a', 'b', 'c', 'd', 'e', 'f']);
    await seedModelAndUpstream(users.map((entry) => entry.user), upstream.baseUrl);

    for (const entry of users) {
      await prisma.wallet.update({ where: { userId: entry.user.id }, data: { balanceCents: 100_000 } });
    }

    await verifyTokenLimit(users[0]!, upstream);
    await verifyCrossUserIsolation(users[1]!, upstream);
    await verifyIpWhitelist(users[0]!, upstream);
    await verifyBlockedPolicyDoesNotActivateToken(users[1]!, upstream);
    await verifyIpLimit(users[0]!, upstream);
    await verifyModelLimit(users[0]!, upstream);
    await verifyActivationWindow(users[0]!, upstream);
    await verifyUserLimit(users[2]!, upstream);
    await verifyRiskBreaker(users[3]!, upstream);
    await verifyConcurrentTokenLimit(users[4]!, upstream);
    await verifyListModelsIpPolicy(users[5]!);

    residualBeforeCleanup = await countResidual();

    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          checks,
          upstreamRequests: upstream.getRequestCount(),
          residualBeforeCleanup
        },
        null,
        2
      )
    );
  } finally {
    upstream.close();
    await cleanup();
    const residualAfterCleanup = await countResidual();
    console.log(JSON.stringify({ cleanup: true, suffix, residualAfterCleanup }, null, 2));
    await prisma.$disconnect();
  }
}

async function verifyTokenLimit(user: QaUser, upstream: TemporaryUpstream) {
  const token = await createToken(user.cookie, `${prefix}_token_limit`, {
    rateLimitRequestsPerMinute: 1,
    modelNames: [publicModel]
  });

  const first = await relayChat(token.apiKey, 'token limit first');
  assert(first.status === 200, `first token-limited request failed with ${first.status}`);

  const beforeBlocked = await snapshotUserBilling(user.user.id);
  const upstreamBeforeBlocked = upstream.getRequestCount();
  const blocked = await relayChat<RelayErrorResponse>(token.apiKey, 'token limit blocked');
  assert(blocked.status === 429, `token limit should return 429, got ${blocked.status}`);
  assert(blocked.json.error?.code === 'rate_limit_exceeded', `token limit error code mismatch: ${blocked.json.error?.code}`);
  await assertNoBillingOrUpstreamChange(user.user.id, beforeBlocked, upstreamBeforeBlocked, upstream);
  checks.push('token_rpm_blocks_before_upstream_and_billing');
}

async function verifyCrossUserIsolation(user: QaUser, upstream: TemporaryUpstream) {
  const before = upstream.getRequestCount();
  const token = await createToken(user.cookie, `${prefix}_cross_user_token`, {
    rateLimitRequestsPerMinute: 1,
    modelNames: [publicModel]
  });
  const response = await relayChat(token.apiKey, 'cross user should pass');
  assert(response.status === 200, `cross-user request failed with ${response.status}`);
  assert(upstream.getRequestCount() === before + 1, 'cross-user request did not reach upstream exactly once');
  checks.push('rate_limit_state_isolated_between_users_and_tokens');
}

async function verifyIpWhitelist(user: QaUser, upstream: TemporaryUpstream) {
  const token = await createToken(user.cookie, `${prefix}_ip_whitelist`, {
    ipWhitelist: ['203.0.113.10'],
    modelNames: [publicModel]
  });

  assert(token.token.ipWhitelist.length === 1, 'token API did not return saved IP whitelist');
  const beforeBlocked = await snapshotUserBilling(user.user.id);
  const upstreamBeforeBlocked = upstream.getRequestCount();
  const blocked = await relayChat<RelayErrorResponse>(token.apiKey, 'ip whitelist blocked', '198.51.100.25');
  assert(blocked.status === 403, `IP whitelist should return 403, got ${blocked.status}`);
  assert(blocked.json.error?.code === 'ip_not_allowed', `IP whitelist error code mismatch: ${blocked.json.error?.code}`);
  await assertNoBillingOrUpstreamChange(user.user.id, beforeBlocked, upstreamBeforeBlocked, upstream);

  const allowed = await relayChat(token.apiKey, 'ip whitelist allowed', '203.0.113.10');
  assert(allowed.status === 200, `IP whitelist allowed request failed with ${allowed.status}`);
  checks.push('ip_whitelist_blocks_unlisted_ip_and_allows_listed_ip');
}

async function verifyBlockedPolicyDoesNotActivateToken(user: QaUser, upstream: TemporaryUpstream) {
  const token = await createToken(user.cookie, `${prefix}_blocked_activation`, {
    activationTtlSeconds: 60,
    ipWhitelist: ['203.0.113.60'],
    modelNames: [publicModel]
  });

  const beforeBlocked = await snapshotUserBilling(user.user.id);
  const upstreamBeforeBlocked = upstream.getRequestCount();
  const blocked = await relayChat<RelayErrorResponse>(token.apiKey, 'blocked before activation', '198.51.100.60');
  assert(blocked.status === 403, `pre-activation IP block should return 403, got ${blocked.status}`);
  assert(
    blocked.json.error?.code === 'ip_not_allowed',
    `pre-activation IP block code mismatch: ${blocked.json.error?.code}`
  );
  await assertNoBillingOrUpstreamChange(user.user.id, beforeBlocked, upstreamBeforeBlocked, upstream);

  const blockedToken = await prisma.apiToken.findUniqueOrThrow({ where: { id: token.token.id } });
  assert(!blockedToken.activatedAt, 'policy-blocked relay request should not set activatedAt');
  assert(!blockedToken.activationExpiresAt, 'policy-blocked relay request should not set activationExpiresAt');

  const allowed = await relayChat(token.apiKey, 'allowed after blocked activation probe', '203.0.113.60');
  assert(allowed.status === 200, `allowed activation request after IP block failed with ${allowed.status}`);
  const activatedToken = await prisma.apiToken.findUniqueOrThrow({ where: { id: token.token.id } });
  assert(activatedToken.activatedAt, 'first policy-allowed relay request did not set activatedAt');
  assert(activatedToken.activationExpiresAt, 'first policy-allowed relay request did not set activationExpiresAt');
  checks.push('policy_blocked_request_does_not_start_first_activation_window');
}

async function verifyIpLimit(user: QaUser, upstream: TemporaryUpstream) {
  const token = await createToken(user.cookie, `${prefix}_ip_limit`, {
    ipRateLimitRequestsPerMinute: 1,
    modelNames: [publicModel]
  });

  const first = await relayChat(token.apiKey, 'ip limit first', '203.0.113.20');
  assert(first.status === 200, `first IP-limited request failed with ${first.status}`);

  const beforeBlocked = await snapshotUserBilling(user.user.id);
  const upstreamBeforeBlocked = upstream.getRequestCount();
  const blocked = await relayChat<RelayErrorResponse>(token.apiKey, 'ip limit blocked', '203.0.113.20');
  assert(blocked.status === 429, `IP limit should return 429, got ${blocked.status}`);
  assert(blocked.json.error?.code === 'rate_limit_exceeded', `IP limit error code mismatch: ${blocked.json.error?.code}`);
  await assertNoBillingOrUpstreamChange(user.user.id, beforeBlocked, upstreamBeforeBlocked, upstream);

  const differentIp = await relayChat(token.apiKey, 'ip limit second ip', '203.0.113.21');
  assert(differentIp.status === 200, `different IP should pass, got ${differentIp.status}`);
  checks.push('ip_rpm_is_scoped_to_token_and_client_ip');
}

async function verifyModelLimit(user: QaUser, upstream: TemporaryUpstream) {
  const token = await createToken(user.cookie, `${prefix}_model_limit`, {
    modelRateLimitRequestsPerMinute: 1,
    modelNames: [publicModel]
  });

  const first = await relayChat(token.apiKey, 'model limit first');
  assert(first.status === 200, `first model-limited request failed with ${first.status}`);

  const beforeBlocked = await snapshotUserBilling(user.user.id);
  const upstreamBeforeBlocked = upstream.getRequestCount();
  const blocked = await relayChat<RelayErrorResponse>(token.apiKey, 'model limit blocked');
  assert(blocked.status === 429, `model limit should return 429, got ${blocked.status}`);
  assert(blocked.json.error?.code === 'rate_limit_exceeded', `model limit error code mismatch: ${blocked.json.error?.code}`);
  await assertNoBillingOrUpstreamChange(user.user.id, beforeBlocked, upstreamBeforeBlocked, upstream);
  checks.push('model_rpm_blocks_same_token_model_before_upstream');
}

async function verifyActivationWindow(user: QaUser, upstream: TemporaryUpstream) {
  const token = await createToken(user.cookie, `${prefix}_activation`, {
    activationTtlSeconds: 1,
    modelNames: [publicModel]
  });

  assert(token.token.activationTtlSeconds === 1, 'token API did not return activation TTL');
  const first = await relayChat(token.apiKey, 'activation first');
  assert(first.status === 200, `activation first request failed with ${first.status}`);

  const activatedToken = await prisma.apiToken.findUniqueOrThrow({ where: { id: token.token.id } });
  assert(activatedToken.activatedAt, 'first real relay request did not set activatedAt');
  assert(activatedToken.activationExpiresAt, 'first real relay request did not set activationExpiresAt');

  await new Promise((resolve) => setTimeout(resolve, 1200));
  const beforeBlocked = await snapshotUserBilling(user.user.id);
  const upstreamBeforeBlocked = upstream.getRequestCount();
  const blocked = await relayChat<RelayErrorResponse>(token.apiKey, 'activation expired');
  assert(blocked.status === 403, `activation expiry should return 403, got ${blocked.status}`);
  assert(
    blocked.json.error?.code === 'token_activation_expired',
    `activation expiry error code mismatch: ${blocked.json.error?.code}`
  );
  await assertNoBillingOrUpstreamChange(user.user.id, beforeBlocked, upstreamBeforeBlocked, upstream);
  checks.push('first_activation_window_uses_real_first_relay_request');
}

async function verifyUserLimit(user: QaUser, upstream: TemporaryUpstream) {
  await prisma.user.update({
    where: { id: user.user.id },
    data: { rateLimitRequestsPerMinute: 1 }
  });
  const token = await createToken(user.cookie, `${prefix}_user_limit`, {
    modelNames: [publicModel]
  });

  const first = await relayChat(token.apiKey, 'user limit first');
  assert(first.status === 200, `first user-limited request failed with ${first.status}`);

  const beforeBlocked = await snapshotUserBilling(user.user.id);
  const upstreamBeforeBlocked = upstream.getRequestCount();
  const blocked = await relayChat<RelayErrorResponse>(token.apiKey, 'user limit blocked');
  assert(blocked.status === 429, `user limit should return 429, got ${blocked.status}`);
  assert(blocked.json.error?.code === 'rate_limit_exceeded', `user limit error code mismatch: ${blocked.json.error?.code}`);
  await assertNoBillingOrUpstreamChange(user.user.id, beforeBlocked, upstreamBeforeBlocked, upstream);
  checks.push('user_rpm_blocks_without_affecting_other_users');
}

async function verifyRiskBreaker(user: QaUser, upstream: TemporaryUpstream) {
  const token = await createToken(user.cookie, `${prefix}_risk_breaker`, {
    modelNames: [publicModel]
  });

  await seedFailedUsageEvents(user.user.id, token.token.id);
  const beforeBlocked = await snapshotUserBilling(user.user.id);
  const upstreamBeforeBlocked = upstream.getRequestCount();
  const blocked = await relayChat<RelayErrorResponse>(token.apiKey, 'risk breaker blocked');
  assert(blocked.status === 429, `risk breaker should return 429, got ${blocked.status}`);
  assert(blocked.json.error?.code === 'risk_limit_exceeded', `risk breaker error code mismatch: ${blocked.json.error?.code}`);
  await assertNoBillingOrUpstreamChange(user.user.id, beforeBlocked, upstreamBeforeBlocked, upstream);
  checks.push('risk_breaker_uses_real_recent_failed_usage_events');
}

async function verifyConcurrentTokenLimit(user: QaUser, upstream: TemporaryUpstream) {
  const token = await createToken(user.cookie, `${prefix}_concurrent`, {
    rateLimitRequestsPerMinute: 1,
    modelNames: [publicModel]
  });

  const before = upstream.getRequestCount();
  const [a, b] = await Promise.all([
    relayChat<RelayErrorResponse>(token.apiKey, 'concurrent a'),
    relayChat<RelayErrorResponse>(token.apiKey, 'concurrent b')
  ]);
  const statuses = [a.status, b.status].sort((left, right) => left - right);
  assert(statuses[0] === 200 && statuses[1] === 429, `expected one success and one 429, got ${statuses.join(',')}`);
  assert(upstream.getRequestCount() === before + 1, 'concurrent token limit should allow exactly one upstream request');
  checks.push('concurrent_token_rpm_is_serialized_by_database_lock');
}

async function verifyListModelsIpPolicy(user: QaUser) {
  const token = await createToken(user.cookie, `${prefix}_models_ip_policy`, {
    ipWhitelist: ['203.0.113.30'],
    modelNames: [publicModel]
  });

  const blocked = await request<RelayErrorResponse>('GET', '/v1/models', undefined, undefined, token.apiKey, '203.0.113.31');
  assert(blocked.status === 403, `models IP policy should return 403, got ${blocked.status}`);
  assert(blocked.json.error?.code === 'ip_not_allowed', `models IP policy error code mismatch: ${blocked.json.error?.code}`);

  const allowed = await request('GET', '/v1/models', undefined, undefined, token.apiKey, '203.0.113.30');
  assert(allowed.status === 200, `models IP policy allowed request failed with ${allowed.status}`);
  checks.push('models_endpoint_uses_same_real_token_ip_policy');
}

async function createUsers(labels: string[]): Promise<QaUser[]> {
  const users: QaUser[] = [];
  for (const label of labels) {
    const username = `${prefix}_user_${label}`;
    const registered = await register(username);
    const user = await getUser(username);
    users.push({ cookie: registered.cookie!, user });
  }
  return users;
}

async function register(username: string) {
  const result = await post<RegisterResponse>('/auth/register', { username, password });
  assert(result.status >= 200 && result.status < 300, `register ${username} failed with ${result.status}`);
  assert(result.cookie, `register ${username} did not return a session cookie`);
  return result;
}

async function getUser(username: string) {
  return prisma.user.findUniqueOrThrow({
    where: { username },
    include: { group: true, wallet: true }
  });
}

async function seedModelAndUpstream(users: Array<User & { group: { id: string } }>, baseUrl: string) {
  const modelPrice = await prisma.modelPrice.create({
    data: {
      model: publicModel,
      displayName: publicModel,
      inputPriceCentsPer1k: 10,
      outputPriceCentsPer1k: 20,
      modelMultiplier: '1.0',
      status: ModelStatus.ACTIVE
    }
  });

  const groupIds = [...new Set(users.map((user) => user.group.id))];
  await prisma.modelGroupAccess.createMany({
    data: groupIds.map((groupId) => ({
      modelPriceId: modelPrice.id,
      groupId
    })),
    skipDuplicates: true
  });

  const provider = await prisma.upstreamProvider.create({
    data: {
      name: providerName,
      baseUrl,
      encryptedApiKey: encryptUpstreamApiKey(TEMP_UPSTREAM_KEY),
      apiKeyPreview: maskUpstreamApiKey(TEMP_UPSTREAM_KEY),
      status: UpstreamProviderStatus.ACTIVE,
      healthStatus: UpstreamHealthStatus.HEALTHY,
      createdByAdminId: users[0]!.id
    }
  });
  providerId = provider.id;

  await prisma.upstreamModel.create({
    data: {
      providerId: provider.id,
      publicModel,
      upstreamModel,
      status: ModelStatus.ACTIVE,
      supportsStream: false
    }
  });
}

async function createToken(cookie: string, name: string, body: Record<string, unknown>) {
  const result = await post<CreateTokenResponse>('/tokens', { name, ...body }, cookie);
  assert(result.status >= 200 && result.status < 300, `create token ${name} failed with ${result.status}`);
  assert(result.json.apiKey, `create token ${name} did not return apiKey`);
  return result.json;
}

async function relayChat<T = unknown>(apiKey: string, content: string, clientIp?: string) {
  return request<T>(
    'POST',
    '/v1/chat/completions',
    {
      model: publicModel,
      messages: [{ role: 'user', content }]
    },
    undefined,
    apiKey,
    clientIp
  );
}

async function post<T = unknown>(path: string, body: unknown, cookie?: string) {
  return request<T>('POST', path, body, cookie);
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  cookieOrUndefined?: string,
  bearerApiKey?: string,
  clientIp?: string
): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookieOrUndefined ? { cookie: cookieOrUndefined } : {}),
      ...(bearerApiKey ? { authorization: `Bearer ${bearerApiKey}` } : {}),
      ...(clientIp ? { 'x-forwarded-for': clientIp } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  const requestId = response.headers.get('x-request-id') ?? ((json as RelayErrorResponse).error?.request_id ?? null);
  if (requestId && !requestIds.includes(requestId)) {
    requestIds.push(requestId);
  }
  return {
    status: response.status,
    json,
    headers: response.headers,
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}

async function snapshotUserBilling(userId: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId }, select: { balanceCents: true } });
  return {
    balanceCents: wallet.balanceCents,
    usageEvents: await prisma.usageEvent.count({ where: { userId } }),
    walletTransactions: await prisma.walletTransaction.count({ where: { userId } })
  };
}

async function assertNoBillingOrUpstreamChange(
  userId: string,
  before: Awaited<ReturnType<typeof snapshotUserBilling>>,
  upstreamBefore: number,
  upstream: TemporaryUpstream
) {
  const after = await snapshotUserBilling(userId);
  assert(after.balanceCents === before.balanceCents, 'blocked request changed wallet balance');
  assert(after.usageEvents === before.usageEvents, 'blocked request created a usage event');
  assert(after.walletTransactions === before.walletTransactions, 'blocked request created a wallet transaction');
  assert(upstream.getRequestCount() === upstreamBefore, 'blocked request reached upstream');
}

async function seedFailedUsageEvents(userId: string, tokenId: string) {
  await prisma.usageEvent.createMany({
    data: Array.from({ length: RISK_FAILURE_THRESHOLD }, (_, index) => ({
      requestId: `${prefix}_risk_failed_${index}`,
      userId,
      tokenId,
      upstreamProviderId: providerId,
      model: publicModel,
      upstreamModel,
      status: UsageEventStatus.FAILED,
      errorCode: 'upstream_error',
      priceSnapshot: {
        qa: 't18-risk-breaker',
        index
      }
    }))
  });
}

async function countResidual() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  const providers = await prisma.upstreamProvider.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true }
  });
  const providerIds = providers.map((provider) => provider.id);
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
          { model: publicModel }
        ]
      },
      select: { id: true }
    })
  ).map((event) => event.id);

  return {
    users: users.length,
    sessions: await prisma.session.count({ where: { userId: { in: userIds } } }),
    wallets: await prisma.wallet.count({ where: { userId: { in: userIds } } }),
    api_tokens: await prisma.apiToken.count({ where: { id: { in: tokenIds } } }),
    api_token_model_accesses: await prisma.apiTokenModelAccess.count({
      where: { OR: [{ apiTokenId: { in: tokenIds } }, { model: publicModel }] }
    }),
    relay_rate_limit_events: await prisma.relayRateLimitEvent.count({
      where: { OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }, { model: publicModel }] }
    }),
    usage_events: usageIds.length,
    wallet_transactions: await prisma.walletTransaction.count({
      where: { OR: [{ userId: { in: userIds } }, { usageEventId: { in: usageIds } }] }
    }),
    request_logs: await prisma.requestLog.count({
      where: {
        OR: [
          { userId: { in: userIds } },
          { tokenId: { in: tokenIds } },
          { upstreamProviderId: { in: providerIds } },
          { model: publicModel },
          { requestId: { in: requestIds } }
        ]
      }
    }),
    upstream_providers: providers.length,
    upstream_models: await prisma.upstreamModel.count({
      where: { OR: [{ providerId: { in: providerIds } }, { publicModel }] }
    }),
    model_prices: await prisma.modelPrice.count({ where: { model: publicModel } })
  };
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  const providers = await prisma.upstreamProvider.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true }
  });
  const providerIds = providers.map((provider) => provider.id);
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
          { model: publicModel }
        ]
      },
      select: { id: true }
    })
  ).map((event) => event.id);
  const modelPrice = await prisma.modelPrice.findUnique({
    where: { model: publicModel },
    select: { id: true }
  });

  await prisma.requestLog.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { tokenId: { in: tokenIds } },
        { upstreamProviderId: { in: providerIds } },
        { model: publicModel },
        { requestId: { in: requestIds } }
      ]
    }
  });
  await prisma.walletTransaction.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { usageEventId: { in: usageIds } }] }
  });
  await prisma.usageEvent.deleteMany({ where: { id: { in: usageIds } } });
  await prisma.relayRateLimitEvent.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }, { model: publicModel }] }
  });
  await prisma.apiTokenModelAccess.deleteMany({
    where: { OR: [{ apiTokenId: { in: tokenIds } }, { model: publicModel }] }
  });
  await prisma.apiToken.deleteMany({ where: { id: { in: tokenIds } } });
  await prisma.upstreamModel.deleteMany({
    where: { OR: [{ providerId: { in: providerIds } }, { publicModel }] }
  });
  if (modelPrice) {
    await prisma.modelGroupAccess.deleteMany({ where: { modelPriceId: modelPrice.id } });
  }
  await prisma.modelPrice.deleteMany({ where: { model: publicModel } });
  await prisma.upstreamProvider.deleteMany({ where: { id: { in: providerIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

type QaUser = {
  cookie: string;
  user: Awaited<ReturnType<typeof getUser>>;
};

type TemporaryUpstream = {
  baseUrl: string;
  close: () => void;
  getRequestCount: () => number;
};

async function startTemporaryUpstream(): Promise<TemporaryUpstream> {
  let requestCount = 0;
  const server = createServer(async (request, response) => {
    try {
      const counted = await handleTemporaryUpstream(request, response);
      if (counted) {
        requestCount += 1;
      }
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'temporary upstream failed' } }));
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '0.0.0.0', resolve);
  });

  const address = server.address();
  assert(address && typeof address === 'object', 'temporary upstream did not expose a port');

  return {
    baseUrl: `http://${TEMP_UPSTREAM_PUBLIC_HOST}:${address.port}`,
    close: () => server.close(),
    getRequestCount: () => requestCount
  };
}

async function handleTemporaryUpstream(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'not found' } }));
    return false;
  }

  const authorization = request.headers.authorization;
  if (authorization !== `Bearer ${TEMP_UPSTREAM_KEY}`) {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'bad upstream key' } }));
    return true;
  }

  const body = await readJsonBody(request);
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      id: `chatcmpl-${randomBytes(6).toString('hex')}`,
      object: 'chat.completion',
      model: body.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150
      }
    })
  );
  return true;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
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
