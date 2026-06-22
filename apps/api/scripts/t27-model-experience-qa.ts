import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  ModelPricingMode,
  ModelStatus,
  PrismaClient,
  UpstreamHealthStatus,
  UpstreamProviderKind,
  UpstreamProviderStatus,
  UsageEventStatus
} from '../src/generated/prisma/client';
import { encryptUpstreamApiKey, maskUpstreamApiKey } from '../src/admin/upstream-key-crypto';
import { DEFAULT_USD_TO_CNY_RATE, USD_UNITS_PER_USD } from '../src/billing/token-pricing';
import { BASE_TOKEN_UNITS_PER_CNY } from '../src/billing/token-units';

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

type ExperienceModelsResponse = {
  items: Array<{
    model: string;
    displayName: string | null;
    inputPriceCentsPer1k: number;
    outputPriceCentsPer1k: number;
    groupMultiplier: string;
  }>;
};

type ExperienceChatResponse = {
  requestId: string;
  model: string;
  message: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  billing: {
    usageEventId: string | null;
    costCents: number;
    status: string;
    walletTransactionId: string | null;
    balanceAfterCents: number | null;
  };
  token: {
    id: string;
    name: string;
    keyPreview: string;
  };
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;
const TEMP_UPSTREAM_PUBLIC_HOST = process.env.TEMP_UPSTREAM_PUBLIC_HOST ?? '127.0.0.1';

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T27 model experience QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const prefix = `qa_t27_${suffix}`;
const password = `qa-password-${suffix}`;
const publicModel = `${prefix}-experience`;
const upstreamModel = `${prefix}-upstream`;
const providerName = `${prefix}-provider`;
const upstreamKey = `qa-t27-upstream-${suffix}`;
const promptTokens = 1000;
const completionTokens = 2000;
const totalTokens = promptTokens + completionTokens;
const inputUsdUnitsPer1k = 5000;
const outputUsdUnitsPer1k = 25000;
const startingBalance = 1_000_000;
const expectedCostCents = calculateExpectedCost();
const checks: string[] = [];

async function main() {
  const upstream = await startTemporaryUpstream();
  let residualBeforeCleanup: Record<string, number> | null = null;

  try {
    const cookie = await register(`${prefix}_user`);
    const user = await prisma.user.findUniqueOrThrow({
      where: { username: `${prefix}_user` },
      include: { group: true, wallet: true }
    });

    await seedModelAndRoute(user.id, user.group.id, upstream.baseUrl);
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { balanceCents: startingBalance, totalSpendCents: 0 }
    });

    const models = await get<ExperienceModelsResponse>('/experience/models', cookie);
    assert(models.status === 200, `experience models failed with ${models.status}: ${JSON.stringify(models.json)}`);
    const model = models.json.items.find((item) => item.model === publicModel);
    assert(model, 'experience model list did not include seeded model');
    assert(model!.inputPriceCentsPer1k === inputUsdUnitsPer1k, 'experience model input route price mismatch');
    assert(model!.outputPriceCentsPer1k === outputUsdUnitsPer1k, 'experience model output route price mismatch');
    checks.push('experience_model_list_uses_route_level_usd_prices');

    const firstChat = await post<ExperienceChatResponse>(
      '/experience/chat',
      {
        model: publicModel,
        messages: [{ role: 'user', content: 'hello from model experience' }],
        maxTokens: 128,
        temperature: 0.4
      },
      cookie
    );
    await assertExperienceChat(firstChat, user.id, expectedCostCents, startingBalance - expectedCostCents);
    assert(upstream.getCallCount() === 1, `upstream should be called once, got ${upstream.getCallCount()}`);
    checks.push('experience_chat_routes_to_real_upstream_and_bills_wallet');

    const secondChat = await post<ExperienceChatResponse>(
      '/experience/chat',
      {
        model: publicModel,
        systemPrompt: 'Reply briefly.',
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'second model experience call' }
        ],
        maxTokens: 64,
        temperature: 0.2
      },
      cookie
    );
    await assertExperienceChat(secondChat, user.id, expectedCostCents, startingBalance - expectedCostCents * 2);
    assert(upstream.getCallCount() === 2, `upstream should be called twice, got ${upstream.getCallCount()}`);

    const activeExperienceTokens = await prisma.apiToken.findMany({
      where: {
        userId: user.id,
        name: firstChat.json.token.name,
        deletedAt: null,
        revokedAt: null
      },
      select: { id: true, usedCents: true }
    });
    assert(activeExperienceTokens.length === 1, `experience token should be reused, got ${activeExperienceTokens.length}`);
    assert(activeExperienceTokens[0]!.usedCents === expectedCostCents * 2, 'experience token used amount mismatch');
    checks.push('experience_token_is_created_once_and_reused');

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: user.id },
      select: { balanceCents: true, totalSpendCents: true }
    });
    assert(wallet.balanceCents === startingBalance - expectedCostCents * 2, 'wallet balance mismatch after two chats');
    assert(wallet.totalSpendCents === expectedCostCents * 2, 'wallet total spend mismatch after two chats');
    checks.push('wallet_cny_balance_tracks_usd_price_converted_cost');

    residualBeforeCleanup = await countResidual();
    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          publicModel,
          expectedCostCents,
          checks,
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

async function seedModelAndRoute(userId: string, groupId: string, baseUrl: string) {
  const modelPrice = await prisma.modelPrice.create({
    data: {
      model: publicModel,
      displayName: 'QA Model Experience',
      pricingMode: ModelPricingMode.MANUAL,
      inputPriceCentsPer1k: 1,
      outputPriceCentsPer1k: 1,
      modelMultiplier: '1.0000',
      status: ModelStatus.ACTIVE
    }
  });

  await prisma.modelGroupAccess.create({
    data: {
      modelPriceId: modelPrice.id,
      groupId
    }
  });

  const provider = await prisma.upstreamProvider.create({
    data: {
      name: providerName,
      kind: UpstreamProviderKind.RELAY,
      baseUrl,
      encryptedApiKey: encryptUpstreamApiKey(upstreamKey),
      apiKeyPreview: maskUpstreamApiKey(upstreamKey),
      status: UpstreamProviderStatus.ACTIVE,
      healthStatus: UpstreamHealthStatus.HEALTHY,
      createdByAdminId: userId
    }
  });

  await prisma.upstreamModel.create({
    data: {
      providerId: provider.id,
      publicModel,
      upstreamModel,
      priority: 1,
      timeoutMs: 1000,
      pricingMode: ModelPricingMode.MANUAL,
      inputPriceCentsPer1k: inputUsdUnitsPer1k,
      outputPriceCentsPer1k: outputUsdUnitsPer1k,
      modelMultiplier: '1.0000',
      status: ModelStatus.ACTIVE,
      supportsStream: false
    }
  });
}

async function assertExperienceChat(
  result: HttpResult<ExperienceChatResponse>,
  userId: string,
  expectedCost: number,
  expectedBalanceAfter: number
) {
  assert(result.status === 200, `experience chat failed with ${result.status}: ${JSON.stringify(result.json)}`);
  assert(result.json.model === publicModel, 'experience response model mismatch');
  assert(result.json.message === 'experience ok', `assistant message mismatch: ${result.json.message}`);
  assert(result.json.usage.promptTokens === promptTokens, 'prompt token mismatch');
  assert(result.json.usage.completionTokens === completionTokens, 'completion token mismatch');
  assert(result.json.usage.totalTokens === totalTokens, 'total token mismatch');
  assert(result.json.billing.usageEventId, 'missing usage event id');
  assert(result.json.billing.costCents === expectedCost, `cost should be ${expectedCost}, got ${result.json.billing.costCents}`);
  assert(result.json.billing.status === 'billable', `billing status should be billable, got ${result.json.billing.status}`);
  assert(result.json.billing.balanceAfterCents === expectedBalanceAfter, 'balanceAfterCents mismatch');

  const usage = await prisma.usageEvent.findUniqueOrThrow({
    where: { id: result.json.billing.usageEventId! },
    include: { walletTransaction: true }
  });
  assert(usage.requestId === result.json.requestId, 'usage requestId mismatch');
  assert(usage.userId === userId, 'usage userId mismatch');
  assert(usage.tokenId === result.json.token.id, 'usage token id mismatch');
  assert(usage.status === UsageEventStatus.BILLABLE, 'usage status mismatch');
  assert(usage.costCents === expectedCost, 'usage cost mismatch');
  assert(usage.walletTransaction !== null, 'usage wallet transaction missing');
  assert(usage.walletTransaction!.amountCents === -expectedCost, 'wallet transaction amount mismatch');
  assert(usage.walletTransaction!.balanceAfterCents === expectedBalanceAfter, 'wallet transaction balance mismatch');

  const requestLog = await prisma.requestLog.findUniqueOrThrow({
    where: { requestId: result.json.requestId }
  });
  assert(requestLog.path === '/experience/chat', `request log path mismatch: ${requestLog.path}`);
  assert(requestLog.userId === userId, 'request log user mismatch');
  assert(requestLog.tokenId === result.json.token.id, 'request log token mismatch');
  assert(requestLog.model === publicModel, 'request log model mismatch');
  assert(requestLog.statusCode === 200, 'request log status mismatch');
  assert(requestLog.upstreamStatus === 'success', 'request log upstream status mismatch');
}

function calculateExpectedCost() {
  return Math.ceil(
    (((promptTokens * inputUsdUnitsPer1k + completionTokens * outputUsdUnitsPer1k) / 1000)
      * DEFAULT_USD_TO_CNY_RATE
      * BASE_TOKEN_UNITS_PER_CNY)
      / USD_UNITS_PER_USD
  );
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

async function startTemporaryUpstream() {
  let callCount = 0;
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        callCount += 1;
      }
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
    getCallCount: () => callCount,
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
  if (authorization !== `Bearer ${upstreamKey}`) {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'bad upstream key' } }));
    return;
  }

  const body = await readJsonBody(request);
  assert(body.model === upstreamModel, `upstream received wrong model: ${body.model}`);
  assert(Array.isArray(body.messages), 'upstream received no messages');

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      id: `chatcmpl-${suffix}`,
      object: 'chat.completion',
      model: body.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'experience ok' },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens
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
  const modelPrice = await prisma.modelPrice.findUnique({
    where: { model: publicModel },
    select: { id: true }
  });

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
    model_prices: await prisma.modelPrice.count({ where: { model: publicModel } }),
    model_group_accesses: modelPrice
      ? await prisma.modelGroupAccess.count({ where: { modelPriceId: modelPrice.id } })
      : 0
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
