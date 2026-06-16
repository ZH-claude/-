import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  ModelStatus,
  PrismaClient,
  UpstreamHealthStatus,
  UpstreamProviderStatus,
  User
} from '../src/generated/prisma/client';
import { encryptUpstreamApiKey, maskUpstreamApiKey } from '../src/admin/upstream-key-crypto';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  headers: Headers;
  cookie?: string;
  text: string;
};

type RegisterResponse = {
  user: {
    id: string;
    username: string;
    group: { id: string };
  };
};

type CreateTokenResponse = {
  apiKey: string;
  token: {
    id: string;
    name: string;
    keyPreview: string;
  };
};

type TraceResponse = {
  requestId: string;
  usageEvent: null | {
    id: string;
    status: string;
    costCents: number;
    errorCode: string | null;
    walletTransaction: null | {
      id: string;
      amountCents: number;
    };
  };
  requestLog: null | {
    id: string;
    method: string;
    path: string;
    model: string | null;
    statusCode: number | null;
    errorCode: string | null;
    latencyMs: number | null;
  };
  upstream: null | {
    status: string | null;
    statusCode: number | null;
    latencyMs: number | null;
  };
  trace: {
    hasUsageEvent: boolean;
    hasWalletTransaction: boolean;
    hasRequestLog: boolean;
  };
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;
const TEMP_UPSTREAM_PUBLIC_HOST = process.env.TEMP_UPSTREAM_PUBLIC_HOST ?? 'host.docker.internal';

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T20 observability QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const TEMP_UPSTREAM_KEY = `qa-t20-upstream-key-${suffix}`;
const prefix = `qa_t20_${suffix}`;
const password = `qa-password-${suffix}`;
const publicModel = `${prefix}-model`;
const upstreamModel = `${prefix}-upstream`;
const providerName = `${prefix}-provider`;
const requestIds: string[] = [];
const checks: string[] = [];

async function main() {
  const upstream = await startTemporaryUpstream();

  try {
    const userACookie = await register(`${prefix}_user_a`);
    const userBCookie = await register(`${prefix}_user_b`);
    const userA = await getUser(`${prefix}_user_a`);
    const userB = await getUser(`${prefix}_user_b`);

    await seedModelAndUpstream([userA, userB], upstream.baseUrl);
    await prisma.wallet.update({ where: { userId: userA.id }, data: { balanceCents: 100_000 } });
    await prisma.wallet.update({ where: { userId: userB.id }, data: { balanceCents: 100_000 } });

    const userAToken = await createToken(userACookie, `${prefix}_token_a`);
    const userBToken = await createToken(userBCookie, `${prefix}_token_b`);

    const models = await relayModels(userAToken.apiKey);
    assert(models.status === 200, `models relay call failed with ${models.status}`);
    const modelsRequestId = requireRequestId(models, 'models');
    requestIds.push(modelsRequestId);

    const rejected = await relayChat(userAToken.apiKey, 'model not allowed', `${prefix}-not-allowed`);
    assert(rejected.status === 403, `pre-upstream rejected relay call should be 403, got ${rejected.status}`);
    const rejectedRequestId = requireRequestId(rejected, 'pre-upstream rejected');
    requestIds.push(rejectedRequestId);

    const billable = await relayChat(userAToken.apiKey, 'billable request');
    assert(billable.status === 200, `billable relay call failed with ${billable.status}`);
    const billableRequestId = requireRequestId(billable, 'billable');
    requestIds.push(billableRequestId);

    const failed = await relayChat(userAToken.apiKey, 'force failure');
    assert(failed.status === 502, `failed relay call should be 502, got ${failed.status}`);
    const failedRequestId = requireRequestId(failed, 'failed');
    requestIds.push(failedRequestId);

    const malformed = await relayChat(userAToken.apiKey, 'malformed response');
    assert(malformed.status === 502, `malformed relay call should be 502, got ${malformed.status}`);
    const malformedRequestId = requireRequestId(malformed, 'malformed');
    requestIds.push(malformedRequestId);

    const modelsTrace = await get<TraceResponse>(`/usage/logs/${modelsRequestId}/trace`, userACookie);
    assert(modelsTrace.status === 200, `models trace failed with ${modelsTrace.status}`);
    assert(modelsTrace.json.usageEvent === null, 'models trace should not have usage event');
    assert(modelsTrace.json.requestLog?.path === '/v1/models', 'models trace missing request log path');
    assert(modelsTrace.json.upstream?.status === 'not_required', 'models trace upstream status mismatch');
    checks.push('models_endpoint_writes_request_log_without_fake_usage_event');

    const rejectedTrace = await get<TraceResponse>(`/usage/logs/${rejectedRequestId}/trace`, userACookie);
    assert(rejectedTrace.status === 200, `pre-upstream rejected trace failed with ${rejectedTrace.status}`);
    assert(rejectedTrace.json.usageEvent === null, 'pre-upstream rejected trace should not have usage event');
    assert(rejectedTrace.json.requestLog?.statusCode === 403, 'pre-upstream rejected trace request status mismatch');
    assert(rejectedTrace.json.requestLog.errorCode === 'model_not_allowed', 'pre-upstream rejected trace error code mismatch');
    assert(rejectedTrace.json.upstream?.status === 'rejected', 'pre-upstream rejected trace upstream status mismatch');
    checks.push('pre_upstream_rejection_writes_request_log_without_usage_or_upstream_call');

    const billableTrace = await get<TraceResponse>(`/usage/logs/${billableRequestId}/trace`, userACookie);
    assert(billableTrace.status === 200, `billable trace failed with ${billableTrace.status}`);
    assert(billableTrace.json.trace.hasUsageEvent, 'billable trace missing usage event');
    assert(billableTrace.json.trace.hasWalletTransaction, 'billable trace missing wallet transaction');
    assert(billableTrace.json.trace.hasRequestLog, 'billable trace missing request log');
    assert(billableTrace.json.usageEvent?.status === 'billable', 'billable trace usage status mismatch');
    assert(billableTrace.json.requestLog?.statusCode === 200, 'billable trace request status mismatch');
    assert(billableTrace.json.upstream?.status === 'success', 'billable trace upstream status mismatch');
    checks.push('billable_trace_links_request_usage_wallet_and_upstream_status');

    const failedTrace = await get<TraceResponse>(`/usage/logs/${failedRequestId}/trace`, userACookie);
    assert(failedTrace.status === 200, `failed trace failed with ${failedTrace.status}`);
    assert(failedTrace.json.usageEvent?.status === 'failed', 'failed trace usage status mismatch');
    assert(failedTrace.json.usageEvent.walletTransaction === null, 'failed trace should not have wallet transaction');
    assert(failedTrace.json.requestLog?.statusCode === 502, 'failed trace request status mismatch');
    assert(failedTrace.json.upstream?.status === 'http_error', 'failed trace upstream status mismatch');
    assert(failedTrace.json.upstream.statusCode === 500, 'failed trace upstream HTTP status mismatch');
    checks.push('failed_trace_links_error_usage_and_upstream_http_status');

    const malformedTrace = await get<TraceResponse>(`/usage/logs/${malformedRequestId}/trace`, userACookie);
    assert(malformedTrace.status === 200, `malformed trace failed with ${malformedTrace.status}`);
    assert(malformedTrace.json.usageEvent?.status === 'failed', 'malformed trace usage status mismatch');
    assert(malformedTrace.json.requestLog?.statusCode === 502, 'malformed trace request status mismatch');
    assert(malformedTrace.json.upstream?.status === 'malformed_response', 'malformed trace upstream status mismatch');
    assert(malformedTrace.json.upstream.statusCode === 200, 'malformed trace upstream HTTP status mismatch');
    checks.push('malformed_trace_records_safe_error_classification');

    const foreignTrace = await get(`/usage/logs/${billableRequestId}/trace`, userBCookie);
    assert(foreignTrace.status === 404, `foreign trace should be 404, got ${foreignTrace.status}`);
    checks.push('trace_endpoint_is_user_scoped');

    const databaseRows = await prisma.requestLog.findMany({
      where: { requestId: { in: requestIds } },
      orderBy: { createdAt: 'asc' }
    });
    assert(databaseRows.length === requestIds.length, `expected ${requestIds.length} request_logs, got ${databaseRows.length}`);
    assert(databaseRows.every((row) => row.userId === userA.id), 'request log rows should belong to user A');
    assert(databaseRows.every((row) => row.tokenId === userAToken.token.id), 'request log rows should belong to user A token');
    checks.push('request_logs_are_real_database_rows_with_token_and_user_correlation');

    const serialized = JSON.stringify({
      modelsTrace: modelsTrace.json,
      billableTrace: billableTrace.json,
      failedTrace: failedTrace.json,
      malformedTrace: malformedTrace.json,
      databaseRows: databaseRows.map((row) => ({
        requestId: row.requestId,
        method: row.method,
        path: row.path,
        model: row.model,
        statusCode: row.statusCode,
        errorCode: row.errorCode,
        upstreamStatus: row.upstreamStatus,
        upstreamStatusCode: row.upstreamStatusCode
      }))
    });
    for (const forbidden of [
      TEMP_UPSTREAM_KEY,
      upstream.baseUrl,
      'encryptedApiKey',
      'tokenHash',
      'passwordHash',
      'priceSnapshot',
      'idempotencyKey',
      'upstreamProviderId',
      'DATABASE_URL',
      'REDIS_URL'
    ]) {
      assert(!serialized.includes(forbidden), `trace response leaked forbidden field/value: ${forbidden}`);
    }
    checks.push('trace_response_uses_sensitive_field_allowlist');

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

async function register(username: string) {
  const result = await post<RegisterResponse>('/auth/register', { username, password });
  assert(result.status >= 200 && result.status < 300, `register ${username} failed with ${result.status}`);
  assert(result.cookie, `register ${username} did not return a session cookie`);
  return result.cookie!;
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

async function createToken(cookie: string, name: string) {
  const result = await post<CreateTokenResponse>(
    '/tokens',
    {
      name,
      modelNames: [publicModel]
    },
    cookie
  );
  assert(result.status >= 200 && result.status < 300, `create token ${name} failed with ${result.status}`);
  assert(result.json.apiKey, `create token ${name} did not return apiKey`);
  return result.json;
}

async function relayModels(apiKey: string) {
  return request('GET', '/v1/models', undefined, undefined, apiKey);
}

async function relayChat(apiKey: string, content: string, model = publicModel) {
  return request(
    'POST',
    '/v1/chat/completions',
    {
      model,
      messages: [{ role: 'user', content }]
    },
    undefined,
    apiKey
  );
}

async function get<T = unknown>(path: string, cookie?: string) {
  return request<T>('GET', path, undefined, cookie);
}

async function post<T = unknown>(path: string, body: unknown, cookie?: string) {
  return request<T>('POST', path, body, cookie);
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  cookieOrUndefined?: string,
  bearerApiKey?: string
): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookieOrUndefined ? { cookie: cookieOrUndefined } : {}),
      ...(bearerApiKey ? { authorization: `Bearer ${bearerApiKey}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const json = text ? (JSON.parse(text) as T) : ({} as T);
  return {
    status: response.status,
    json,
    headers: response.headers,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
    text
  };
}

function requireRequestId(result: HttpResult, label: string) {
  const requestId = result.headers.get('x-request-id');
  assert(requestId, `${label} response missing x-request-id`);
  return requestId;
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
          { model: publicModel },
          { requestId: { in: requestIds } }
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
    usage_events: usageIds.length,
    wallet_transactions: await prisma.walletTransaction.count({
      where: { OR: [{ userId: { in: userIds } }, { usageEventId: { in: usageIds } }] }
    }),
    request_logs: await prisma.requestLog.count({
      where: { OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }, { requestId: { in: requestIds } }] }
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
          { model: publicModel },
          { requestId: { in: requestIds } }
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
    where: { OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }, { requestId: { in: requestIds } }] }
  });
  await prisma.walletTransaction.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { usageEventId: { in: usageIds } }] }
  });
  await prisma.usageEvent.deleteMany({ where: { id: { in: usageIds } } });
  await prisma.securityAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
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

async function startTemporaryUpstream() {
  const server = createServer(async (request, response) => {
    try {
      await handleTemporaryUpstream(request, response);
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
    close: () => server.close()
  };
}

async function handleTemporaryUpstream(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'not found' } }));
    return;
  }

  const authorization = request.headers.authorization;
  if (authorization !== `Bearer ${TEMP_UPSTREAM_KEY}`) {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'bad upstream key' } }));
    return;
  }

  const body = await readJsonBody(request);
  const content = JSON.stringify(body.messages ?? []);

  if (content.includes('force failure')) {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'forced upstream failure' } }));
    return;
  }

  if (content.includes('malformed response')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{not valid json');
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      id: `chatcmpl-${suffix}`,
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

void main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
