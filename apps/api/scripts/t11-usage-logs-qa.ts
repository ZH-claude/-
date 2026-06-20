import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  ModelPricingMode,
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

type UsageLogEntry = {
  id: string;
  requestId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costCents: number;
  status: string;
  errorCode: string | null;
  token: {
    id: string;
    name: string;
    keyPreview: string;
  };
  walletTransaction: {
    id: string;
    amountCents: number;
    balanceAfterCents: number;
  } | null;
};

type UsageLogsResponse = {
  items: UsageLogEntry[];
  summary: {
    total: number;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalCostCents: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    statusCounts: Record<string, number>;
  };
  filters: {
    models: string[];
    tokens: Array<{ id: string; name: string; keyPreview: string }>;
  };
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;
const TEMP_UPSTREAM_PUBLIC_HOST = process.env.TEMP_UPSTREAM_PUBLIC_HOST ?? '127.0.0.1';

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T11 usage logs QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const TEMP_UPSTREAM_KEY = `qa-t11-upstream-key-${suffix}`;
const prefix = `qa_t11_${suffix}`;
const password = `qa-password-${suffix}`;
const publicModel = `${prefix}-model`;
const upstreamModel = `${prefix}-upstream`;
const providerName = `${prefix}-provider`;
const checks: string[] = [];

async function main() {
  const upstream = await startTemporaryUpstream();
  let residualBeforeCleanup: Record<string, number> | null = null;

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

    const billable = await relayChat(userAToken.apiKey, 'billable request');
    assert(billable.status === 200, `billable relay call failed with ${billable.status}: ${JSON.stringify(billable.json)}`);
    assert(Boolean(billable.headers.get('x-request-id')), 'billable relay call missing x-request-id');
    assert(Boolean(billable.headers.get('x-usage-event-id')), 'billable relay call missing x-usage-event-id');
    checks.push('real_billable_relay_call_created_usage_headers');

    const failed = await relayChat(userAToken.apiKey, 'force failure');
    assert(failed.status === 502, `failed relay call should normalize to 502, got ${failed.status}`);
    assert(Boolean(failed.headers.get('x-request-id')), 'failed relay call missing x-request-id');
    checks.push('real_failed_relay_call_created_request_id');

    const meteringUnknown = await relayChat(userAToken.apiKey, 'missing usage');
    assert(meteringUnknown.status === 200, `metering unknown relay call failed with ${meteringUnknown.status}`);
    assert(Boolean(meteringUnknown.headers.get('x-usage-event-id')), 'metering unknown relay call missing usage event id');
    checks.push('real_metering_unknown_relay_call_created_usage_event');

    const allLogs = await get<UsageLogsResponse>(`/usage/logs?model=${encodeURIComponent(publicModel)}&limit=100`, userACookie);
    assert(allLogs.status === 200, `usage logs query failed with ${allLogs.status}`);
    assert(allLogs.json.items.length >= 3, `expected at least 3 usage log rows, got ${allLogs.json.items.length}`);

    const billableRow = requireRow(allLogs.json, billable.headers.get('x-request-id'), 'billable');
    assert(billableRow.token.id === userAToken.token.id, 'billable row token mismatch');
    assert(billableRow.walletTransaction !== null, 'billable row missing wallet transaction');
    assert(billableRow.walletTransaction!.amountCents === -billableRow.costCents, 'billable wallet debit amount mismatch');
    assert(billableRow.id === billable.headers.get('x-usage-event-id'), 'billable usage event id mismatch');
    assert(
      billableRow.costCents === 7,
      `billable row should use upstream route pricing instead of public model pricing, got ${billableRow.costCents}`
    );
    checks.push('real_relay_call_uses_route_level_pricing');

    const failedRow = requireRow(allLogs.json, failed.headers.get('x-request-id'), 'failed');
    assert(failedRow.walletTransaction === null, 'failed row should not have wallet transaction');
    assert(failedRow.errorCode === 'upstream_error', `failed row error code mismatch: ${failedRow.errorCode}`);

    const unknownRow = requireRow(allLogs.json, meteringUnknown.headers.get('x-request-id'), 'metering_unknown');
    assert(unknownRow.walletTransaction === null, 'metering unknown row should not have wallet transaction');
    assert(unknownRow.costCents === 0, 'metering unknown row should not cost money');
    checks.push('usage_logs_link_request_usage_and_wallet_truthfully');

    assert(allLogs.json.summary.total === 3, `summary should count all three rows, got ${allLogs.json.summary.total}`);
    assert(allLogs.json.summary.totalRequests === 3, `summary totalRequests should count all three rows, got ${allLogs.json.summary.totalRequests}`);
    assert(
      allLogs.json.summary.successfulRequests === 1,
      `summary successfulRequests should count only billable/free rows, got ${allLogs.json.summary.successfulRequests}`
    );
    assert(
      allLogs.json.summary.failedRequests === 2,
      `summary failedRequests should count failed and metering unknown rows, got ${allLogs.json.summary.failedRequests}`
    );
    assert(allLogs.json.summary.totalCostCents === 7, `summary should only charge billable rows, got ${allLogs.json.summary.totalCostCents}`);
    assert(allLogs.json.summary.promptTokens === 100, `summary should only include billable prompt tokens, got ${allLogs.json.summary.promptTokens}`);
    assert(
      allLogs.json.summary.completionTokens === 50,
      `summary should only include billable completion tokens, got ${allLogs.json.summary.completionTokens}`
    );
    assert(allLogs.json.summary.totalTokens === 150, `summary should only include billable total tokens, got ${allLogs.json.summary.totalTokens}`);
    checks.push('usage_summary_excludes_failed_and_metering_unknown_consumption');

    const filteredByStatus = await get<UsageLogsResponse>(
      `/usage/logs?model=${encodeURIComponent(publicModel)}&status=billable&limit=100`,
      userACookie
    );
    assert(filteredByStatus.status === 200, `status filter failed with ${filteredByStatus.status}`);
    assert(filteredByStatus.json.items.length >= 1, 'status filter returned no billable rows');
    assert(filteredByStatus.json.items.every((item) => item.status === 'billable'), 'status filter leaked non-billable rows');
    checks.push('status_filter_returns_only_requested_status');

    const filteredByToken = await get<UsageLogsResponse>(
      `/usage/logs?model=${encodeURIComponent(publicModel)}&tokenId=${userAToken.token.id}&limit=100`,
      userACookie
    );
    assert(filteredByToken.status === 200, `token filter failed with ${filteredByToken.status}`);
    assert(filteredByToken.json.items.length >= 3, 'token filter did not return user A rows');
    assert(filteredByToken.json.items.every((item) => item.token.id === userAToken.token.id), 'token filter returned wrong token');
    checks.push('token_filter_returns_only_requested_owned_token');

    const foreignTokenQuery = await get<UsageLogsResponse>(
      `/usage/logs?model=${encodeURIComponent(publicModel)}&tokenId=${userBToken.token.id}&limit=100`,
      userACookie
    );
    assert(foreignTokenQuery.status === 200, `foreign token query failed with ${foreignTokenQuery.status}`);
    assert(foreignTokenQuery.json.items.length === 0, 'user A can see rows by user B token id');
    checks.push('foreign_token_id_query_does_not_leak_rows');

    const userBLogs = await get<UsageLogsResponse>(`/usage/logs?model=${encodeURIComponent(publicModel)}&limit=100`, userBCookie);
    assert(userBLogs.status === 200, `user B usage logs query failed with ${userBLogs.status}`);
    const userARequestIds = new Set([
      billable.headers.get('x-request-id'),
      failed.headers.get('x-request-id'),
      meteringUnknown.headers.get('x-request-id')
    ]);
    assert(!userBLogs.json.items.some((item) => userARequestIds.has(item.requestId)), 'user B can see user A request ids');
    checks.push('user_scope_blocks_cross_account_log_reads');

    const serializedLogs = JSON.stringify(allLogs.json);
    for (const forbidden of [
      'tokenHash',
      'encryptedApiKey',
      TEMP_UPSTREAM_KEY,
      'priceSnapshot',
      'idempotencyKey',
      'upstreamProviderId',
      'upstreamModel'
    ]) {
      assert(!serializedLogs.includes(forbidden), `usage logs response leaked forbidden field/value: ${forbidden}`);
    }
    checks.push('usage_logs_response_uses_sensitive_field_allowlist');

    residualBeforeCleanup = await countResidual();

    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          checks,
          model: publicModel,
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
      pricingMode: ModelPricingMode.MANUAL,
      inputPriceCentsPer1k: 17,
      outputPriceCentsPer1k: 31,
      modelMultiplier: '2.0000',
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

async function relayChat(apiKey: string, content: string) {
  return request('POST', '/v1/chat/completions', {
    model: publicModel,
    messages: [{ role: 'user', content }]
  }, undefined, apiKey);
}

async function get<T>(path: string, cookie?: string) {
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
  const json = text ? JSON.parse(text) : {};
  return {
    status: response.status,
    json,
    headers: response.headers,
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}

function requireRow(logs: UsageLogsResponse, requestId: string | null, status: string) {
  assert(requestId, `missing request id for ${status}`);
  const row = logs.items.find((item) => item.requestId === requestId);
  assert(row, `missing usage log row for ${status} request ${requestId}`);
  assert(row!.status === status, `expected ${status} status for ${requestId}, got ${row!.status}`);
  return row!;
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
          { model: publicModel }
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
        { model: publicModel }
      ]
    }
  });
  await prisma.walletTransaction.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { usageEventId: { in: usageIds } }] }
  });
  await prisma.usageEvent.deleteMany({ where: { id: { in: usageIds } } });
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
      ...(content.includes('missing usage')
        ? {}
        : {
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150
            }
          })
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

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
