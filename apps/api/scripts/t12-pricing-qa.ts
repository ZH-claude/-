import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import {
  ModelStatus,
  PrismaClient,
  UpstreamHealthStatus,
  UpstreamProviderStatus
} from '../src/generated/prisma/client';
import { encryptUpstreamApiKey, maskUpstreamApiKey } from '../src/admin/upstream-key-crypto';
import { BILLING_FORMULA, BILLING_ROUNDING } from '../src/billing/billing.constants';

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

type PricingModel = {
  model: string;
  displayName: string | null;
  inputPriceCentsPer1k: number;
  outputPriceCentsPer1k: number;
  modelMultiplier: string;
  groupMultiplier: string;
  supportsStream: boolean;
};

type PricingResponse = {
  group: {
    code: string;
    name: string;
    multiplier: string;
  };
  currency: string;
  unit: string;
  billingFormula: {
    totalCostCents: string;
    rounding: string;
  };
  models: PricingModel[];
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T12 pricing QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const prefix = `qa_t12_${suffix}`;
const password = `qa-password-${suffix}`;
const upstreamKey = `qa-t12-upstream-key-${suffix}`;
const groupACode = `${prefix}_group_a`;
const groupBCode = `${prefix}_group_b`;
const allowedModel = `${prefix}-allowed`;
const deniedModel = `${prefix}-denied`;
const disabledModel = `${prefix}-disabled`;
const noUpstreamModel = `${prefix}-no-upstream`;
const inactiveProviderModel = `${prefix}-inactive-provider`;
const checks: string[] = [];

async function main() {
  let residualBeforeCleanup: Record<string, number> | null = null;

  try {
    const groupA = await prisma.userGroup.create({
      data: {
        code: groupACode,
        name: 'QA T12 Group A',
        multiplier: '1.2500'
      }
    });
    const groupB = await prisma.userGroup.create({
      data: {
        code: groupBCode,
        name: 'QA T12 Group B',
        multiplier: '2.0000'
      }
    });

    const userACookie = await register(`${prefix}_user_a`);
    const userBCookie = await register(`${prefix}_user_b`);
    await prisma.user.update({ where: { username: `${prefix}_user_a` }, data: { groupId: groupA.id } });
    await prisma.user.update({ where: { username: `${prefix}_user_b` }, data: { groupId: groupB.id } });

    const seeded = await seedPricingModels(groupA.id, groupB.id);

    const unauthenticated = await get<PricingResponse>('/pricing/models');
    assert(unauthenticated.status === 401, `unauthenticated pricing request should be 401, got ${unauthenticated.status}`);
    checks.push('unauthenticated_pricing_request_is_rejected');

    const pricingA = await get<PricingResponse>('/pricing/models', userACookie);
    assert(pricingA.status === 200, `user A pricing request failed with ${pricingA.status}`);
    assert(pricingA.json.group.code === groupACode, 'user A pricing group code mismatch');
    assert(pricingA.json.group.name === 'QA T12 Group A', 'user A pricing group name mismatch');
    assertDecimalEquals(pricingA.json.group.multiplier, '1.2500', 'user A group multiplier mismatch');
    assert(pricingA.json.currency === 'USD', 'pricing currency mismatch');
    assert(pricingA.json.unit === 'cents_per_1k_tokens', 'pricing unit mismatch');
    assert(pricingA.json.billingFormula.totalCostCents === BILLING_FORMULA, 'pricing formula drifted from BillingService constant');
    assert(pricingA.json.billingFormula.rounding === BILLING_ROUNDING, 'pricing rounding policy mismatch');
    checks.push('pricing_formula_reuses_billing_source_of_truth');

    const modelA = requireModel(pricingA.json, allowedModel);
    assert(modelA.displayName === 'QA Allowed Model', 'allowed model display name mismatch');
    assert(modelA.inputPriceCentsPer1k === 12, 'allowed model input price mismatch');
    assert(modelA.outputPriceCentsPer1k === 34, 'allowed model output price mismatch');
    assertDecimalEquals(modelA.modelMultiplier, '1.5000', 'allowed model multiplier mismatch');
    assertDecimalEquals(modelA.groupMultiplier, '1.2500', 'allowed model group multiplier mismatch');
    assert(modelA.supportsStream === true, 'allowed model stream capability mismatch');
    checks.push('pricing_response_reflects_real_model_price_and_group_multiplier');

    for (const forbiddenModel of [deniedModel, disabledModel, noUpstreamModel, inactiveProviderModel]) {
      assert(
        !pricingA.json.models.some((model) => model.model === forbiddenModel),
        `user A pricing leaked unavailable model: ${forbiddenModel}`
      );
    }
    checks.push('pricing_filters_by_user_group_active_price_and_active_upstream');

    const pricingB = await get<PricingResponse>('/pricing/models', userBCookie);
    assert(pricingB.status === 200, `user B pricing request failed with ${pricingB.status}`);
    assertDecimalEquals(requireModel(pricingB.json, deniedModel).groupMultiplier, '2.0000', 'user B group multiplier mismatch');
    assert(!pricingB.json.models.some((model) => model.model === allowedModel), 'user B can see user A model');
    checks.push('pricing_blocks_cross_group_model_visibility');

    const serialized = JSON.stringify({ userA: pricingA.json, userB: pricingB.json });
    for (const forbidden of [
      'encryptedApiKey',
      'apiKeyPreview',
      'priceSnapshot',
      'upstreamModel',
      'upstreamProviderId',
      'providerId',
      'provider',
      'tokenHash',
      'passwordHash',
      'baseUrl',
      upstreamKey,
      seeded.allowedModelPriceId,
      seeded.allowedProviderId,
      groupA.id,
      groupB.id
    ]) {
      assert(!serialized.includes(forbidden), `pricing response leaked forbidden field/value: ${forbidden}`);
    }
    checks.push('pricing_response_uses_sensitive_field_allowlist');

    residualBeforeCleanup = await countResidual();

    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          checks,
          allowedModel,
          deniedModel,
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

async function seedPricingModels(groupAId: string, groupBId: string) {
  const allowed = await seedModel({
    model: allowedModel,
    displayName: 'QA Allowed Model',
    groupId: groupAId,
    inputPriceCentsPer1k: 12,
    outputPriceCentsPer1k: 34,
    modelMultiplier: '1.5000',
    providerStatus: UpstreamProviderStatus.ACTIVE,
    modelStatus: ModelStatus.ACTIVE,
    createUpstream: true,
    supportsStream: true
  });

  await seedModel({
    model: deniedModel,
    displayName: 'QA Denied Model',
    groupId: groupBId,
    inputPriceCentsPer1k: 20,
    outputPriceCentsPer1k: 40,
    modelMultiplier: '1.1000',
    providerStatus: UpstreamProviderStatus.ACTIVE,
    modelStatus: ModelStatus.ACTIVE,
    createUpstream: true,
    supportsStream: false
  });

  await seedModel({
    model: disabledModel,
    displayName: 'QA Disabled Model',
    groupId: groupAId,
    inputPriceCentsPer1k: 30,
    outputPriceCentsPer1k: 60,
    modelMultiplier: '1.0000',
    providerStatus: UpstreamProviderStatus.ACTIVE,
    modelStatus: ModelStatus.DISABLED,
    createUpstream: true,
    supportsStream: true
  });

  await seedModel({
    model: noUpstreamModel,
    displayName: 'QA No Upstream Model',
    groupId: groupAId,
    inputPriceCentsPer1k: 40,
    outputPriceCentsPer1k: 80,
    modelMultiplier: '1.0000',
    providerStatus: UpstreamProviderStatus.ACTIVE,
    modelStatus: ModelStatus.ACTIVE,
    createUpstream: false,
    supportsStream: true
  });

  await seedModel({
    model: inactiveProviderModel,
    displayName: 'QA Inactive Provider Model',
    groupId: groupAId,
    inputPriceCentsPer1k: 50,
    outputPriceCentsPer1k: 90,
    modelMultiplier: '1.0000',
    providerStatus: UpstreamProviderStatus.DISABLED,
    modelStatus: ModelStatus.ACTIVE,
    createUpstream: true,
    supportsStream: true
  });

  return {
    allowedModelPriceId: allowed.modelPriceId,
    allowedProviderId: allowed.providerId
  };
}

async function seedModel(input: {
  model: string;
  displayName: string;
  groupId: string;
  inputPriceCentsPer1k: number;
  outputPriceCentsPer1k: number;
  modelMultiplier: string;
  providerStatus: UpstreamProviderStatus;
  modelStatus: ModelStatus;
  createUpstream: boolean;
  supportsStream: boolean;
}) {
  const modelPrice = await prisma.modelPrice.create({
    data: {
      model: input.model,
      displayName: input.displayName,
      inputPriceCentsPer1k: input.inputPriceCentsPer1k,
      outputPriceCentsPer1k: input.outputPriceCentsPer1k,
      modelMultiplier: input.modelMultiplier,
      status: input.modelStatus
    }
  });

  await prisma.modelGroupAccess.create({
    data: {
      modelPriceId: modelPrice.id,
      groupId: input.groupId
    }
  });

  if (!input.createUpstream) {
    return { modelPriceId: modelPrice.id, providerId: null };
  }

  const provider = await prisma.upstreamProvider.create({
    data: {
      name: `${input.model}-provider`,
      baseUrl: `https://${input.model}.qa.invalid`,
      encryptedApiKey: encryptUpstreamApiKey(upstreamKey),
      apiKeyPreview: maskUpstreamApiKey(upstreamKey),
      status: input.providerStatus,
      healthStatus: UpstreamHealthStatus.HEALTHY,
      createdByAdminId: (await prisma.user.findFirstOrThrow({ where: { username: { startsWith: prefix } }, select: { id: true } })).id
    }
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

  return { modelPriceId: modelPrice.id, providerId: provider.id };
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

function requireModel(pricing: PricingResponse, modelName: string) {
  const model = pricing.models.find((item) => item.model === modelName);
  assert(model, `missing pricing model ${modelName}`);
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

  return {
    users: users.length,
    groups: groups.length,
    sessions: await prisma.session.count({ where: { userId: { in: userIds } } }),
    wallets: await prisma.wallet.count({ where: { userId: { in: userIds } } }),
    model_prices: modelPrices.length,
    model_group_accesses: await prisma.modelGroupAccess.count({
      where: { OR: [{ modelPriceId: { in: modelPriceIds } }, { groupId: { in: groupIds } }] }
    }),
    upstream_providers: providers.length,
    upstream_models: await prisma.upstreamModel.count({
      where: { OR: [{ providerId: { in: providerIds } }, { publicModel: { startsWith: prefix } }] }
    }),
    api_tokens: await prisma.apiToken.count({ where: { userId: { in: userIds } } })
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

function assertDecimalEquals(actual: string, expected: string, message: string) {
  assert(Number(actual) === Number(expected), `${message}: expected ${expected}, got ${actual}`);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
