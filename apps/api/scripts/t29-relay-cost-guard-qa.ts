import { PrismaPg } from '@prisma/adapter-pg';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { ModelStatus, PrismaClient, UpstreamHealthStatus, UpstreamProviderStatus } from '../src/generated/prisma/client';
import { encryptUpstreamApiKey, maskUpstreamApiKey } from '../src/admin/upstream-key-crypto';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  headers: Headers;
  text: string;
};

type RegisterResponse = {
  user: {
    id: string;
    username: string;
  };
};

type TokenResponse = {
  apiKey: string;
  token: {
    id: string;
    name: string;
  };
};

type TemporaryUpstream = {
  baseUrl: string;
  close: () => void;
  getRequestCount: () => number;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;
const TEMP_UPSTREAM_PUBLIC_HOST = process.env.TEMP_UPSTREAM_PUBLIC_HOST ?? '127.0.0.1';

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T29 relay cost guard QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const prefix = `qa_t29_${suffix}`;
const userPrefix = `q29_${suffix.slice(-10)}`;
const password = `qa-password-${suffix}`;
const TEMP_UPSTREAM_API_KEY = `qa-t29-upstream-key-${suffix}`;
const publicModel = `${prefix}-model`;
const upstreamModel = `${prefix}-upstream-model`;
const providerName = `${prefix}-provider`;
const requestIds: string[] = [];
const checks: string[] = [];

async function main() {
  const upstream = await startTemporaryUpstream();

  try {
    const lowBalanceUser = await register(`${userPrefix}_low`);
    const normalUser = await register(`${userPrefix}_normal`);
    const quotaUser = await register(`${userPrefix}_quota`);
    const riskLockedUser = await register(`${userPrefix}_risk`);

    const [lowBalanceProfile, normalProfile, quotaProfile, riskLockedProfile] = await Promise.all([
      getUser(lowBalanceUser.user.username),
      getUser(normalUser.user.username),
      getUser(quotaUser.user.username),
      getUser(riskLockedUser.user.username)
    ]);

    await prisma.wallet.update({
      where: { userId: lowBalanceProfile.id },
      data: { balanceCents: 0 }
    });
    await prisma.wallet.updateMany({
      where: { userId: { in: [normalProfile.id, quotaProfile.id, riskLockedProfile.id] } },
      data: { balanceCents: 100_000, totalSpendCents: 0 }
    });
    await prisma.user.update({
      where: { id: riskLockedProfile.id },
      data: {
        riskLockedUntil: new Date(Date.now() + 10 * 60 * 1000),
        riskReason: 'QA temporary risk lock'
      }
    });

    await seedModelAndUpstream([lowBalanceProfile, normalProfile, quotaProfile, riskLockedProfile], upstream.baseUrl);

    const lowBalanceToken = await createToken(lowBalanceUser.cookie!, `${prefix}_low_balance_token`);
    const normalDisabledToken = await createToken(normalUser.cookie!, `${prefix}_normal_token_disabled`);
    const quotaToken = await createToken(quotaUser.cookie!, `${prefix}_quota_token`, { quotaCents: 1 });
    await prisma.apiToken.update({
      where: { id: quotaToken.token.id },
      data: { usedCents: 1 }
    });
    const riskLockedToken = await createToken(riskLockedUser.cookie!, `${prefix}_risk_locked_token`);
    const disableResp = await post<void>(`/tokens/${normalDisabledToken.token.id}/disable`, undefined, normalUser.cookie!);
    assert(disableResp.status === 200 || disableResp.status === 201, `disable token failed with ${disableResp.status}`);

    const chatBody = {
      model: publicModel,
      messages: [{ role: 'user', content: 'hello' }]
    };

    const lowBalanceBefore = await snapshotUsageAndTransaction(lowBalanceProfile.id);
    const normalBefore = await snapshotUsageAndTransaction(normalProfile.id);
    const upstreamBefore = upstream.getRequestCount();

    const lowBalanceRelay = await request<unknown>('POST', '/v1/chat/completions', chatBody, undefined, lowBalanceToken.apiKey);
    const lowBalanceRequestId = requireRequestId(lowBalanceRelay, 'low balance relay');
    assert(lowBalanceRelay.status === 402, `low balance relay should be blocked with 402, got ${lowBalanceRelay.status}`);
    assert(isInsufficientBalanceError(lowBalanceRelay), 'low balance relay should return insufficient_balance error');
    assert(upstream.getRequestCount() === upstreamBefore, `low balance relay unexpectedly reached upstream`);

    const lowBalanceAfter = await snapshotUsageAndTransaction(lowBalanceProfile.id);
    assert(
      lowBalanceAfter.usageEvents === lowBalanceBefore.usageEvents,
      `low balance relay changed usage events (${lowBalanceBefore.usageEvents} => ${lowBalanceAfter.usageEvents})`
    );
    assert(
      lowBalanceAfter.walletTransactions === lowBalanceBefore.walletTransactions,
      `low balance relay changed wallet transactions (${lowBalanceBefore.walletTransactions} => ${lowBalanceAfter.walletTransactions})`
    );
    assert(
      (await prisma.usageEvent.count({ where: { requestId: lowBalanceRequestId } })) === 0,
      'low balance blocked relay should not create usage event'
    );
    requestIds.push(lowBalanceRequestId);
    checks.push('low_balance_relay_is_blocked_before_upstream_and_without_billing');

    const disabledUpstreamBefore = upstream.getRequestCount();
    const disabledRelay = await request<unknown>('POST', '/v1/chat/completions', chatBody, undefined, normalDisabledToken.apiKey);
    const disabledRelayRequestId = requireRequestId(disabledRelay, 'disabled relay');
    assert(
      disabledRelay.status === 401 || disabledRelay.status === 403,
      `disabled token relay should be blocked with 401/403, got ${disabledRelay.status}`
    );
    assert(isDisabledTokenError(disabledRelay), 'disabled token relay should return token disabled error');
    assert(upstream.getRequestCount() === disabledUpstreamBefore, `disabled token relay unexpectedly reached upstream`);

    const normalAfter = await snapshotUsageAndTransaction(normalProfile.id);
    assert(
      normalAfter.usageEvents === normalBefore.usageEvents,
      `disabled token relay changed usage events (${normalBefore.usageEvents} => ${normalAfter.usageEvents})`
    );
    assert(
      normalAfter.walletTransactions === normalBefore.walletTransactions,
      `disabled token relay changed wallet transactions (${normalBefore.walletTransactions} => ${normalAfter.walletTransactions})`
    );
    assert(
      (await prisma.usageEvent.count({ where: { requestId: disabledRelayRequestId } })) === 0,
      'disabled token relay should not create usage event'
    );
    requestIds.push(disabledRelayRequestId);
    checks.push('disabled_token_relay_is_blocked_before_upstream_and_without_billing');

    const quotaBefore = await snapshotUsageAndTransaction(quotaProfile.id);
    const quotaUpstreamBefore = upstream.getRequestCount();
    const quotaRelay = await request<unknown>('POST', '/v1/chat/completions', chatBody, undefined, quotaToken.apiKey);
    const quotaRequestId = requireRequestId(quotaRelay, 'quota exhausted relay');
    assert(quotaRelay.status === 402, `quota exhausted relay should be blocked with 402, got ${quotaRelay.status}`);
    assert(isInsufficientBalanceError(quotaRelay), 'quota exhausted relay should return insufficient_balance error');
    assert(upstream.getRequestCount() === quotaUpstreamBefore, 'quota exhausted relay unexpectedly reached upstream');
    await assertNoBillingChange(quotaProfile.id, quotaBefore, 'quota exhausted relay');
    assert(
      (await prisma.usageEvent.count({ where: { requestId: quotaRequestId } })) === 0,
      'quota exhausted relay should not create usage event'
    );
    requestIds.push(quotaRequestId);
    checks.push('token_quota_exhaustion_blocks_before_upstream_and_without_billing');

    const riskBefore = await snapshotUsageAndTransaction(riskLockedProfile.id);
    const riskUpstreamBefore = upstream.getRequestCount();
    const riskRelay = await request<unknown>('POST', '/v1/chat/completions', chatBody, undefined, riskLockedToken.apiKey);
    const riskRequestId = requireRequestId(riskRelay, 'risk locked relay');
    assert(riskRelay.status === 429, `risk locked relay should be blocked with 429, got ${riskRelay.status}`);
    assert(isRiskLimitError(riskRelay), 'risk locked relay should return risk_limit_exceeded error');
    assert(upstream.getRequestCount() === riskUpstreamBefore, 'risk locked relay unexpectedly reached upstream');
    await assertNoBillingChange(riskLockedProfile.id, riskBefore, 'risk locked relay');
    assert(
      (await prisma.usageEvent.count({ where: { requestId: riskRequestId } })) === 0,
      'risk locked relay should not create usage event'
    );
    requestIds.push(riskRequestId);
    checks.push('risk_locked_user_is_blocked_before_upstream_and_without_billing');

    const residualBeforeCleanup = await countResidual();
    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          checks,
          requestIds,
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

async function snapshotUsageAndTransaction(userId: string) {
  return {
    usageEvents: await prisma.usageEvent.count({ where: { userId } }),
    walletTransactions: await prisma.walletTransaction.count({ where: { userId } })
  };
}

async function assertNoBillingChange(
  userId: string,
  before: { usageEvents: number; walletTransactions: number },
  label: string
) {
  const after = await snapshotUsageAndTransaction(userId);
  assert(after.usageEvents === before.usageEvents, `${label} changed usage events (${before.usageEvents} => ${after.usageEvents})`);
  assert(
    after.walletTransactions === before.walletTransactions,
    `${label} changed wallet transactions (${before.walletTransactions} => ${after.walletTransactions})`
  );
}

async function register(username: string) {
  const result = await request<RegisterResponse>('POST', '/auth/register', { username, password });
  assert(result.status === 200 || result.status === 201, `register ${username} failed with ${result.status}`);
  const cookie = result.headers.get('set-cookie')?.split(';')[0];
  assert(cookie, `register ${username} did not return session cookie`);
  return { ...result.json, cookie };
}

async function getUser(username: string) {
  return prisma.user.findUniqueOrThrow({
    where: { username },
    include: { group: true }
  });
}

async function createToken(cookie: string, name: string, extra: Record<string, unknown> = {}) {
  const response = await post<TokenResponse>(
    '/tokens',
    {
      name,
      modelNames: [publicModel],
      ...extra
    },
    cookie
  );
  assert(response.status === 200 || response.status === 201, `create token ${name} failed with ${response.status}`);
  assert(response.json.apiKey, `create token ${name} missing apiKey`);
  return response.json;
}

async function seedModelAndUpstream(users: Array<{ id: string; group: { id: string } }>, baseUrl: string) {
  const modelPrice = await prisma.modelPrice.create({
    data: {
      model: publicModel,
      displayName: publicModel,
      inputPriceCentsPer1k: 10,
      outputPriceCentsPer1k: 10,
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
      encryptedApiKey: encryptUpstreamApiKey(TEMP_UPSTREAM_API_KEY),
      apiKeyPreview: maskUpstreamApiKey(TEMP_UPSTREAM_API_KEY),
      status: UpstreamProviderStatus.ACTIVE,
      healthStatus: UpstreamHealthStatus.HEALTHY,
      createdByAdminId: users[0]?.id
    }
  });

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

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  cookieOrUndefined?: string,
  bearerApiKey?: string
): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookieOrUndefined ? { cookie: cookieOrUndefined } : {}),
      ...(bearerApiKey ? { authorization: `Bearer ${bearerApiKey}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const json = text ? (JSON.parse(text) as T) : ({} as T);
  return { status: response.status, headers: response.headers, text, json };
}

async function post<T = unknown>(path: string, body?: unknown, cookie?: string) {
  return request<T>('POST', path, body, cookie);
}

function requireRequestId(result: HttpResult, label: string) {
  const requestId = result.headers.get('x-request-id');
  assert(requestId, `${label} response missing x-request-id`);
  return requestId;
}

function isInsufficientBalanceError(result: HttpResult<unknown>) {
  const error = result.json as { error?: { code?: string } };
  return error.error?.code === 'insufficient_balance';
}

function isDisabledTokenError(result: HttpResult<unknown>) {
  const error = result.json as { error?: { code?: string } };
  return error.error?.code === 'invalid_api_key' || error.error?.code === 'token_disabled';
}

function isRiskLimitError(result: HttpResult<unknown>) {
  const error = result.json as { error?: { code?: string } };
  return error.error?.code === 'risk_limit_exceeded';
}

async function startTemporaryUpstream(): Promise<TemporaryUpstream> {
  let upstreamRequestCount = 0;
  const server = createServer(async (request, response) => {
    try {
      const shouldCount = await handleTemporaryUpstream(request, response);
      if (shouldCount) {
        upstreamRequestCount += 1;
      }
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: {
            message: error instanceof Error ? error.message : 'temporary upstream failed'
          }
        })
      );
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  const address = server.address();
  assert(address && typeof address === 'object', 'temporary upstream did not expose a TCP port');

  return {
    baseUrl: `http://${TEMP_UPSTREAM_PUBLIC_HOST}:${address.port}`,
    close: () => server.close(),
    getRequestCount: () => upstreamRequestCount
  };
}

async function handleTemporaryUpstream(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'not found' } }));
    return false;
  }

  const authorization = request.headers.authorization;
  if (authorization !== `Bearer ${TEMP_UPSTREAM_API_KEY}`) {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'bad upstream key' } }));
    return true;
  }

  await readJsonBody(request);
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      id: `chatcmpl-${suffix}`,
      object: 'chat.completion',
      model: publicModel,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 7,
        completion_tokens: 3,
        total_tokens: 10
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
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function countResidual() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: userPrefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  const providerIds = (await prisma.upstreamProvider.findMany({ where: { name: { startsWith: prefix } }, select: { id: true } })).map(
    (provider) => provider.id
  );
  const tokenIds = (
    await prisma.apiToken.findMany({
      where: { userId: { in: userIds } },
      select: { id: true }
    })
  ).map((token) => token.id);
  const usageEventIds = (
    await prisma.usageEvent.findMany({
      where: {
        OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }, { model: publicModel }]
      },
      select: { id: true }
    })
  ).map((event) => event.id);
  const modelPriceIds = (await prisma.modelPrice.findMany({ where: { model: publicModel }, select: { id: true } })).map(
    (modelPrice) => modelPrice.id
  );

  return {
    users: users.length,
    wallets: await prisma.wallet.count({ where: { userId: { in: userIds } } }),
    upstreamProviders: providerIds.length,
    apiTokens: await prisma.apiToken.count({ where: { userId: { in: userIds } } }),
    usageEvents: usageEventIds.length,
    walletTransactions: await prisma.walletTransaction.count({
      where: { OR: [{ userId: { in: userIds } }, { usageEventId: { in: usageEventIds } }] }
    }),
    relayRateLimitEvents: await prisma.relayRateLimitEvent.count({
      where: { OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }, { requestId: { in: requestIds } }] }
    }),
    requestLogs: await prisma.requestLog.count({
      where: {
        OR: [
          { userId: { in: userIds } },
          { tokenId: { in: tokenIds } },
          { requestId: { in: requestIds } },
          { model: publicModel },
          { upstreamProviderId: { in: providerIds } }
        ]
      }
    }),
    upstreamModels: await prisma.upstreamModel.count({
      where: { OR: [{ providerId: { in: providerIds } }, { publicModel }] }
    }),
    modelPrices: modelPriceIds.length,
    requestIds: requestIds.length
  };
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: userPrefix } },
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
  const usageEventIds = (
    await prisma.usageEvent.findMany({
      where: {
        OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }, { model: publicModel }]
      },
      select: { id: true }
    })
  ).map((event) => event.id);
  const modelPriceIds = (await prisma.modelPrice.findMany({ where: { model: publicModel }, select: { id: true } })).map(
    (modelPrice) => modelPrice.id
  );

  await prisma.requestLog.deleteMany({
    where: {
      OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }, { requestId: { in: requestIds } }, { model: publicModel }]
    }
  });
  await prisma.walletTransaction.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { usageEventId: { in: usageEventIds } }] }
  });
  await prisma.usageEvent.deleteMany({ where: { id: { in: usageEventIds } } });
  await prisma.apiTokenModelAccess.deleteMany({
    where: { OR: [{ apiTokenId: { in: tokenIds } }, { model: publicModel }] }
  });
  await prisma.relayRateLimitEvent.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }, { requestId: { in: requestIds } }] }
  });
  await prisma.apiToken.deleteMany({ where: { id: { in: tokenIds } } });
  await prisma.upstreamModel.deleteMany({
    where: { OR: [{ providerId: { in: providerIds } }, { publicModel }] }
  });
  await prisma.modelGroupAccess.deleteMany({
    where: { modelPriceId: { in: modelPriceIds } }
  });
  await prisma.modelPrice.deleteMany({ where: { model: publicModel } });
  await prisma.upstreamProvider.deleteMany({ where: { id: { in: providerIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
