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
import { calculateRelayTokenPricing, multiplierToBaseTokensPer1k } from '../src/billing/token-pricing';

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
  };
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;
const TEMP_UPSTREAM_PUBLIC_HOST = process.env.TEMP_UPSTREAM_PUBLIC_HOST ?? '127.0.0.1';

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T23 route metering QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const prefix = `qa_t23_${suffix}`;
const password = `qa-password-${suffix}`;
const publicModel = `${prefix}-gpt5.5`;
const deepProviderName = `${prefix}-deepseek`;
const relayProviderName = `${prefix}-relay`;
const deepKey = `qa-t23-deep-${suffix}`;
const relayKey = `qa-t23-relay-${suffix}`;
const promptTokens = 100;
const completionTokens = 50;
const startingBalance = 100_000;
const deepMultiplier = 5;
const relayPricing = calculateRelayTokenPricing({
  inputPricePerMillion: 5,
  outputPricePerMillion: 30,
  currency: 'USD',
  usdToCnyRate: 7.2,
  marginPercent: 10
});
const expectedDeepCost = 750;
const expectedRelayCost = 1980;
const checks: string[] = [];

async function main() {
  const deepUpstream = await startTemporaryUpstream({
    expectedKey: deepKey,
    providerLabel: 'deepseek',
    failWhenContentIncludes: 'force relay'
  });
  const relayUpstream = await startTemporaryUpstream({
    expectedKey: relayKey,
    providerLabel: 'relay'
  });
  let residualBeforeCleanup: Record<string, number> | null = null;

  try {
    const cookie = await register(`${prefix}_user`);
    const user = await getUser(`${prefix}_user`);
    await seedPublicModelWithTwoRoutes(user.id, user.group.id, deepUpstream.baseUrl, relayUpstream.baseUrl);
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { balanceCents: startingBalance, totalSpendCents: 0 }
    });
    const token = await createToken(cookie, `${prefix}_token`);

    const deepCall = await relayChat(token.apiKey, 'normal deepseek path');
    assert(deepCall.status === 200, `DeepSeek route call failed with ${deepCall.status}: ${JSON.stringify(deepCall.json)}`);
    const deepRequestId = requireHeader(deepCall, 'x-request-id');
    const deepUsageEventId = requireHeader(deepCall, 'x-usage-event-id');
    await assertBilledRoute({
      requestId: deepRequestId,
      usageEventId: deepUsageEventId,
      providerName: deepProviderName,
      upstreamModel: 'deepseek-v4-pro',
      expectedCost: expectedDeepCost,
      expectedInputPricePer1k: multiplierToBaseTokensPer1k(1),
      expectedOutputPricePer1k: multiplierToBaseTokensPer1k(1),
      expectedMultiplier: '5'
    });
    checks.push('same_public_model_uses_deepseek_route_when_first_route_is_healthy');

    const relayCall = await relayChat(token.apiKey, 'force relay after deepseek retryable failure');
    assert(relayCall.status === 200, `Relay route call failed with ${relayCall.status}: ${JSON.stringify(relayCall.json)}`);
    const relayRequestId = requireHeader(relayCall, 'x-request-id');
    const relayUsageEventId = requireHeader(relayCall, 'x-usage-event-id');
    await assertBilledRoute({
      requestId: relayRequestId,
      usageEventId: relayUsageEventId,
      providerName: relayProviderName,
      upstreamModel: 'relay-gpt5.5',
      expectedCost: expectedRelayCost,
      expectedInputPricePer1k: relayPricing.inputBaseTokensPer1k,
      expectedOutputPricePer1k: relayPricing.outputBaseTokensPer1k,
      expectedMultiplier: '1'
    });
    checks.push('same_public_model_fails_over_to_relay_route_with_relay_price');

    const refreshedWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: user.id },
      select: { balanceCents: true, totalSpendCents: true }
    });
    const totalCost = expectedDeepCost + expectedRelayCost;
    assert(refreshedWallet.balanceCents === startingBalance - totalCost, 'wallet balance did not match both route costs');
    assert(refreshedWallet.totalSpendCents === totalCost, 'wallet total spend did not match both route costs');

    const refreshedToken = await prisma.apiToken.findUniqueOrThrow({
      where: { id: token.token.id },
      select: { usedCents: true }
    });
    assert(refreshedToken.usedCents === totalCost, 'API token used amount did not match both route costs');
    checks.push('wallet_and_token_used_amount_match_two_route_costs');

    residualBeforeCleanup = await countResidual();
    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          publicModel,
          expectedDeepCost,
          expectedRelayCost,
          relayPricing,
          checks,
          residualBeforeCleanup
        },
        null,
        2
      )
    );
  } finally {
    deepUpstream.close();
    relayUpstream.close();
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

async function seedPublicModelWithTwoRoutes(userId: string, groupId: string, deepBaseUrl: string, relayBaseUrl: string) {
  const modelPrice = await prisma.modelPrice.create({
    data: {
      model: publicModel,
      displayName: 'QA GPT 5.5',
      pricingMode: ModelPricingMode.MANUAL,
      inputPriceCentsPer1k: multiplierToBaseTokensPer1k(1),
      outputPriceCentsPer1k: multiplierToBaseTokensPer1k(1),
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

  const deepProvider = await prisma.upstreamProvider.create({
    data: {
      name: deepProviderName,
      kind: UpstreamProviderKind.DEEPSEEK,
      baseUrl: deepBaseUrl,
      encryptedApiKey: encryptUpstreamApiKey(deepKey),
      apiKeyPreview: maskUpstreamApiKey(deepKey),
      status: UpstreamProviderStatus.ACTIVE,
      healthStatus: UpstreamHealthStatus.HEALTHY,
      createdByAdminId: userId
    }
  });

  const relayProvider = await prisma.upstreamProvider.create({
    data: {
      name: relayProviderName,
      kind: UpstreamProviderKind.RELAY,
      baseUrl: relayBaseUrl,
      encryptedApiKey: encryptUpstreamApiKey(relayKey),
      apiKeyPreview: maskUpstreamApiKey(relayKey),
      status: UpstreamProviderStatus.ACTIVE,
      healthStatus: UpstreamHealthStatus.HEALTHY,
      createdByAdminId: userId
    }
  });

  await prisma.upstreamModel.create({
    data: {
      providerId: deepProvider.id,
      publicModel,
      upstreamModel: 'deepseek-v4-pro',
      priority: 1,
      timeoutMs: 1000,
      pricingMode: ModelPricingMode.DEEPSEEK_BASE,
      inputPriceCentsPer1k: multiplierToBaseTokensPer1k(1),
      outputPriceCentsPer1k: multiplierToBaseTokensPer1k(1),
      modelMultiplier: deepMultiplier.toFixed(4),
      status: ModelStatus.ACTIVE,
      supportsStream: false
    }
  });

  await prisma.upstreamModel.create({
    data: {
      providerId: relayProvider.id,
      publicModel,
      upstreamModel: 'relay-gpt5.5',
      priority: 2,
      timeoutMs: 1000,
      pricingMode: ModelPricingMode.RELAY_PRICE,
      inputPriceCentsPer1k: relayPricing.inputBaseTokensPer1k,
      outputPriceCentsPer1k: relayPricing.outputBaseTokensPer1k,
      modelMultiplier: '1.0000',
      upstreamInputPricePerMillion: '5.0000',
      upstreamOutputPricePerMillion: '30.0000',
      upstreamCurrency: 'USD',
      upstreamExchangeRate: '7.200000',
      marginPercent: '10.0000',
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

async function assertBilledRoute(input: {
  requestId: string;
  usageEventId: string;
  providerName: string;
  upstreamModel: string;
  expectedCost: number;
  expectedInputPricePer1k: number;
  expectedOutputPricePer1k: number;
  expectedMultiplier: string;
}) {
  const provider = await prisma.upstreamProvider.findUniqueOrThrow({
    where: { name: input.providerName },
    select: { id: true }
  });
  const usage = await prisma.usageEvent.findUniqueOrThrow({
    where: { requestId: input.requestId },
    include: { walletTransaction: true }
  });
  assert(usage.id === input.usageEventId, 'usage event id header did not match database row');
  assert(usage.status === UsageEventStatus.BILLABLE, 'usage status should be billable');
  assert(usage.upstreamProviderId === provider.id, `usage provider should be ${input.providerName}`);
  assert(usage.upstreamModel === input.upstreamModel, `usage upstream model should be ${input.upstreamModel}`);
  assert(usage.promptTokens === promptTokens, 'prompt tokens mismatch');
  assert(usage.completionTokens === completionTokens, 'completion tokens mismatch');
  assert(usage.totalTokens === promptTokens + completionTokens, 'total tokens mismatch');
  assert(usage.costCents === input.expectedCost, `cost should be ${input.expectedCost}, got ${usage.costCents}`);
  assert(usage.walletTransaction !== null, 'billable usage should create wallet transaction');
  assert(usage.walletTransaction!.amountCents === -input.expectedCost, 'wallet transaction amount mismatch');

  const requestLog = await prisma.requestLog.findUniqueOrThrow({
    where: { requestId: input.requestId }
  });
  assert(requestLog.upstreamProviderId === provider.id, `request log provider should be ${input.providerName}`);
  assert(requestLog.statusCode === 200, 'request log status should be 200');
  assert(requestLog.upstreamStatus === 'success', 'request log upstream status should be success');

  const snapshot = usage.priceSnapshot as Record<string, unknown>;
  assert(snapshot.upstreamProviderId === provider.id, 'price snapshot provider mismatch');
  assert(snapshot.upstreamModel === input.upstreamModel, 'price snapshot upstream model mismatch');
  assert(snapshot.inputPriceCentsPer1k === input.expectedInputPricePer1k, 'price snapshot input price mismatch');
  assert(snapshot.outputPriceCentsPer1k === input.expectedOutputPricePer1k, 'price snapshot output price mismatch');
  assert(Number(snapshot.modelMultiplier) === Number(input.expectedMultiplier), 'price snapshot multiplier mismatch');
  assert(snapshot.meteringSource === 'upstream_usage', 'price snapshot metering source mismatch');
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

function requireHeader(result: HttpResult, headerName: string) {
  const value = result.headers.get(headerName);
  assert(value, `missing ${headerName}`);
  return value;
}

async function startTemporaryUpstream(input: {
  expectedKey: string;
  providerLabel: string;
  failWhenContentIncludes?: string;
}) {
  const server = createServer(async (request, response) => {
    try {
      await handleTemporaryUpstream(request, response, input);
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

async function handleTemporaryUpstream(
  request: IncomingMessage,
  response: ServerResponse,
  input: { expectedKey: string; providerLabel: string; failWhenContentIncludes?: string }
) {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'not found' } }));
    return;
  }

  const authorization = request.headers.authorization;
  if (authorization !== `Bearer ${input.expectedKey}`) {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'bad upstream key' } }));
    return;
  }

  const body = await readJsonBody(request);
  const content = JSON.stringify(body.messages ?? []);
  if (input.failWhenContentIncludes && content.includes(input.failWhenContentIncludes)) {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'forced retryable upstream failure' } }));
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      id: `chatcmpl-${input.providerLabel}-${suffix}`,
      object: 'chat.completion',
      model: body.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: `${input.providerLabel} ok` },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
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
    model_prices: modelPrice ? 1 : 0,
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
