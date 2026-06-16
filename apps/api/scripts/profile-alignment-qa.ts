import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes } from 'node:crypto';
import {
  ApiTokenStatus,
  ModelStatus,
  PrismaClient,
  ReferralRewardStatus,
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

type ProfileResponse = {
  user: {
    id: string;
    username: string;
    inviteCode: string;
    timezone: string;
    lastLoginIp: string | null;
    metrics: {
      totalCallCount: number;
      activeTokenCount: number;
    };
    referral: {
      invitedUserCount: number;
      pendingRewardCents: number;
      pendingRewardCount: number;
      settledRewardCents: number;
      settledRewardCount: number;
    };
    availableModels: Array<{
      model: string;
      displayName: string | null;
      inputPriceCentsPer1k: number;
      outputPriceCentsPer1k: number;
      modelMultiplier: string;
      groupMultiplier: string;
      supportsStream: boolean;
    }>;
  };
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the profile alignment QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const prefix = `qap_${suffix}`;
const password = `qa-password-${suffix}`;
const upstreamKey = `qa-profile-upstream-key-${suffix}`;
const groupCode = `${prefix}_group`;
const modelName = `${prefix}-model`;
const checks: string[] = [];

async function main() {
  try {
    const inviter = await register(`${prefix}_inviter`);
    const invitee = await register(`${prefix}_invitee`, inviter.json.user.inviteCode);

    const group = await prisma.userGroup.create({
      data: {
        code: groupCode,
        name: 'QA Profile Group',
        multiplier: '1.7500'
      }
    });
    await prisma.user.update({ where: { id: inviter.json.user.id }, data: { groupId: group.id } });
    await prisma.user.update({ where: { id: invitee.json.user.id }, data: { groupId: group.id } });

    const seeded = await seedModelAndUsage(inviter.json.user.id, group.id);
    await prisma.referralReward.createMany({
      data: [
        {
          inviterUserId: inviter.json.user.id,
          inviteeUserId: invitee.json.user.id,
          amountCents: 123,
          status: ReferralRewardStatus.PENDING,
          source: `${prefix}_pending`
        },
        {
          inviterUserId: inviter.json.user.id,
          inviteeUserId: invitee.json.user.id,
          amountCents: 456,
          status: ReferralRewardStatus.SETTLED,
          source: `${prefix}_settled`,
          settledAt: new Date()
        }
      ]
    });

    const unauthenticated = await get<ProfileResponse>('/auth/me');
    assert(unauthenticated.status === 401, `unauthenticated profile should be 401, got ${unauthenticated.status}`);
    checks.push('unauthenticated_profile_is_rejected');

    const profile = await get<ProfileResponse>('/auth/me', inviter.cookie);
    assert(profile.status === 200, `profile request failed with ${profile.status}`);
    assert(profile.json.user.username === `${prefix}_inviter`, 'profile username mismatch');
    assert(profile.json.user.metrics.totalCallCount === 2, 'profile totalCallCount did not come from usage_events');
    assert(
      profile.json.user.metrics.activeTokenCount === 1,
      'profile activeTokenCount did not exclude expired api_tokens'
    );
    assert(profile.json.user.referral.invitedUserCount === 1, 'profile invitedUserCount did not come from invited users');
    assert(profile.json.user.referral.pendingRewardCents === 123, 'profile pendingRewardCents did not come from referral_rewards');
    assert(profile.json.user.referral.settledRewardCents === 456, 'profile settledRewardCents did not come from referral_rewards');
    assert(profile.json.user.referral.pendingRewardCount === 1, 'profile pendingRewardCount mismatch');
    assert(profile.json.user.referral.settledRewardCount === 1, 'profile settledRewardCount mismatch');
    checks.push('profile_metrics_reflect_real_database_rows');

    const profileModel = profile.json.user.availableModels.find((model) => model.model === modelName);
    assert(profileModel, 'profile availableModels did not include seeded model');
    assert(profileModel!.displayName === 'QA Profile Model', 'profile model displayName mismatch');
    assert(profileModel!.inputPriceCentsPer1k === 11, 'profile model input price mismatch');
    assert(profileModel!.outputPriceCentsPer1k === 22, 'profile model output price mismatch');
    assert(Number(profileModel!.modelMultiplier) === 1.2, 'profile model multiplier mismatch');
    assert(Number(profileModel!.groupMultiplier) === 1.75, 'profile group multiplier mismatch');
    assert(profileModel!.supportsStream === true, 'profile model stream capability mismatch');
    checks.push('profile_models_reflect_real_model_catalog');

    const timezone = await post<ProfileResponse>('/auth/timezone', { timezone: 'Asia/Shanghai' }, inviter.cookie);
    assert(timezone.status === 201 || timezone.status === 200, `timezone update failed with ${timezone.status}`);
    assert(timezone.json.user.timezone === 'Asia/Shanghai', 'timezone response did not update');
    const savedTimezone = await prisma.user.findUniqueOrThrow({
      where: { id: inviter.json.user.id },
      select: { timezone: true }
    });
    assert(savedTimezone.timezone === 'Asia/Shanghai', 'timezone was not persisted to users table');
    const timezoneAudit = await prisma.securityAuditLog.count({
      where: {
        actorUserId: inviter.json.user.id,
        action: 'user_timezone_updated'
      }
    });
    assert(timezoneAudit === 1, 'timezone update did not write security audit log');
    checks.push('timezone_update_persists_and_audits_real_user_row');

    const invalidTimezone = await post('/auth/timezone', { timezone: 'Not/A_Real_Zone' }, inviter.cookie);
    assert(invalidTimezone.status === 400, `invalid timezone should be 400, got ${invalidTimezone.status}`);
    checks.push('invalid_timezone_is_rejected');

    const serialized = JSON.stringify(profile.json);
    for (const forbidden of [
      'passwordHash',
      'tokenHash',
      'encryptedApiKey',
      'upstreamProviderId',
      'providerId',
      'upstreamModel',
      'priceSnapshot',
      upstreamKey,
      seeded.tokenHash,
      seeded.expiredTokenHash,
      seeded.providerId,
      seeded.tokenId
    ]) {
      assert(!serialized.includes(forbidden), `profile response leaked forbidden field/value: ${forbidden}`);
    }
    checks.push('profile_response_uses_sensitive_field_allowlist');

    const residualBeforeCleanup = await countResidual();
    console.log(JSON.stringify({ ok: true, suffix, checks, residualBeforeCleanup }, null, 2));
  } finally {
    await cleanup();
    const residualAfterCleanup = await countResidual();
    console.log(JSON.stringify({ cleanup: true, suffix, residualAfterCleanup }, null, 2));
    await prisma.$disconnect();
  }
}

async function register(username: string, inviteCode?: string) {
  const result = await post<ProfileResponse>('/auth/register', { username, password, inviteCode });
  assert(result.status >= 200 && result.status < 300, `register ${username} failed with ${result.status}`);
  assert(result.cookie, `register ${username} did not return a session cookie`);
  return result;
}

async function seedModelAndUsage(userId: string, groupId: string) {
  const modelPrice = await prisma.modelPrice.create({
    data: {
      model: modelName,
      displayName: 'QA Profile Model',
      inputPriceCentsPer1k: 11,
      outputPriceCentsPer1k: 22,
      modelMultiplier: '1.2000',
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
      name: `${prefix}_provider`,
      baseUrl: `https://${prefix}.qa.invalid`,
      encryptedApiKey: encryptUpstreamApiKey(upstreamKey),
      apiKeyPreview: maskUpstreamApiKey(upstreamKey),
      status: UpstreamProviderStatus.ACTIVE,
      healthStatus: UpstreamHealthStatus.HEALTHY,
      lastHealthCheckAt: new Date(),
      createdByAdminId: userId
    }
  });
  await prisma.upstreamModel.create({
    data: {
      providerId: provider.id,
      publicModel: modelName,
      upstreamModel: `${modelName}-upstream`,
      status: ModelStatus.ACTIVE,
      supportsStream: true
    }
  });

  const tokenHash = createHash('sha256').update(`${prefix}_token`).digest('hex');
  const token = await prisma.apiToken.create({
    data: {
      userId,
      name: `${prefix}_token`,
      tokenHash,
      keyPreview: `qa_${suffix.slice(-8)}`,
      status: ApiTokenStatus.ACTIVE
    }
  });
  const expiredTokenHash = createHash('sha256').update(`${prefix}_expired_token`).digest('hex');
  await prisma.apiToken.create({
    data: {
      userId,
      name: `${prefix}_expired_token`,
      tokenHash: expiredTokenHash,
      keyPreview: `qa_exp_${suffix.slice(-4)}`,
      status: ApiTokenStatus.ACTIVE,
      expiresAt: new Date(Date.now() - 60_000)
    }
  });

  for (const index of [1, 2]) {
    await prisma.usageEvent.create({
      data: {
        requestId: `${prefix}_request_${index}`,
        userId,
        tokenId: token.id,
        upstreamProviderId: provider.id,
        model: modelName,
        upstreamModel: `${modelName}-upstream`,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        costCents: index,
        status: UsageEventStatus.BILLABLE,
        priceSnapshot: {
          source: 'profile-alignment-qa'
        }
      }
    });
  }

  return {
    providerId: provider.id,
    tokenId: token.id,
    tokenHash,
    expiredTokenHash
  };
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
    referral_rewards: await prisma.referralReward.count({
      where: {
        OR: [{ inviterUserId: { in: userIds } }, { inviteeUserId: { in: userIds } }]
      }
    }),
    security_audit_logs: await prisma.securityAuditLog.count({ where: { actorUserId: { in: userIds } } }),
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

  await prisma.referralReward.deleteMany({
    where: {
      OR: [{ inviterUserId: { in: userIds } }, { inviteeUserId: { in: userIds } }]
    }
  });
  await prisma.securityAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
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
