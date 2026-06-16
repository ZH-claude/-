import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  ModelStatus,
  NotificationDeliveryStatus,
  NotificationEventType,
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

type NotificationSettingsResponse = {
  wallet: {
    balanceCents: number;
    totalSpendCents: number;
  };
  preference: {
    balanceLowEnabled: boolean;
    balanceLowThresholdCents: number | null;
    balanceLowLastNotifiedAt: string | null;
    securityAlertsEnabled: boolean;
    systemAnnouncementsEnabled: boolean;
    promotionsEnabled: boolean;
    modelPriceUpdatesEnabled: boolean;
  };
  channels: {
    webhook: {
      type: 'webhook';
      name: string;
      enabled: boolean;
      configured: boolean;
      supported: boolean;
      targetPreview: string | null;
      lastTestStatus: 'sent' | 'failed' | null;
      lastTestAt: string | null;
      lastTestError: string | null;
    };
    email: {
      type: 'email';
      enabled: boolean;
      configured: boolean;
      supported: boolean;
      lastTestError: string | null;
    };
  };
  deliveries: Array<{
    id: string;
    eventType: string;
    status: string;
    targetPreview: string | null;
    responseStatus: number | null;
    errorMessage: string | null;
    createdAt: string;
  }>;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;
const TEMP_UPSTREAM_PUBLIC_HOST = process.env.TEMP_UPSTREAM_PUBLIC_HOST ?? 'host.docker.internal';
const SUCCESS_WEBHOOK_URL = process.env.QA_WEBHOOK_URL ?? 'https://httpbingo.org/status/200';
const FAILURE_WEBHOOK_URL = process.env.QA_WEBHOOK_FAILURE_URL ?? 'https://httpbingo.org/status/500';

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T14 notifications QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const TEMP_UPSTREAM_KEY = `qa-t14-upstream-key-${suffix}`;
const prefix = `qa_t14_${suffix}`;
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
    await prisma.wallet.update({ where: { userId: userA.id }, data: { balanceCents: 101 } });
    await prisma.wallet.update({ where: { userId: userB.id }, data: { balanceCents: 5_000 } });

    const unauthenticatedGet = await get<NotificationSettingsResponse>('/notifications/settings');
    assert(unauthenticatedGet.status === 401, `unauthenticated settings GET should be 401, got ${unauthenticatedGet.status}`);
    const unauthenticatedPut = await put<NotificationSettingsResponse>('/notifications/settings', {
      preference: { balanceLowEnabled: true, balanceLowThresholdCents: 100 },
      webhook: { enabled: true, name: 'bad', url: SUCCESS_WEBHOOK_URL }
    });
    assert(unauthenticatedPut.status === 401, `unauthenticated settings PUT should be 401, got ${unauthenticatedPut.status}`);
    const unauthenticatedTest = await post('/notifications/test-webhook', undefined, undefined);
    assert(unauthenticatedTest.status === 401, `unauthenticated webhook test should be 401, got ${unauthenticatedTest.status}`);
    checks.push('unauthenticated_notification_requests_are_rejected');

    const defaultSettings = await get<NotificationSettingsResponse>('/notifications/settings', userACookie);
    assert(defaultSettings.status === 200, `default settings failed with ${defaultSettings.status}`);
    assert(defaultSettings.json.wallet.balanceCents === 101, 'settings wallet balance should come from real wallet');
    assert(defaultSettings.json.channels.email.supported === false, 'email should be unsupported instead of reporting success');
    assert(defaultSettings.json.channels.webhook.configured === false, 'webhook should start unconfigured');
    checks.push('settings_get_uses_real_wallet_and_unconfigured_channels');

    const blockedPrivateUrl = await put<NotificationSettingsResponse>(
      '/notifications/settings',
      {
        preference: { balanceLowEnabled: true, balanceLowThresholdCents: 100 },
        webhook: { enabled: true, name: 'blocked', url: 'http://127.0.0.1:9999/webhook' }
      },
      userACookie
    );
    assert(blockedPrivateUrl.status === 400, `private webhook URL should be rejected, got ${blockedPrivateUrl.status}`);
    checks.push('private_or_local_webhook_urls_are_rejected');

    const saved = await put<NotificationSettingsResponse>(
      '/notifications/settings',
      {
        preference: {
          balanceLowEnabled: true,
          balanceLowThresholdCents: 100,
          securityAlertsEnabled: true,
          systemAnnouncementsEnabled: true,
          promotionsEnabled: false,
          modelPriceUpdatesEnabled: true
        },
        webhook: {
          enabled: true,
          name: `${prefix} webhook`,
          url: SUCCESS_WEBHOOK_URL
        }
      },
      userACookie
    );
    assert(saved.status === 200, `saving notification settings failed with ${saved.status}`);
    assert(saved.json.preference.balanceLowEnabled === true, 'balance low enabled was not persisted');
    assert(saved.json.preference.balanceLowThresholdCents === 100, 'balance low threshold was not persisted');
    assert(saved.json.channels.webhook.enabled === true, 'webhook enabled was not persisted');
    assert(saved.json.channels.webhook.configured === true, 'webhook configured flag mismatch');
    assert(saved.json.channels.webhook.targetPreview?.includes('httpbingo.org'), 'webhook preview should include host');
    assert(!JSON.stringify(saved.json).includes(SUCCESS_WEBHOOK_URL), 'settings response leaked full webhook URL');
    checks.push('settings_put_persists_real_preference_and_masks_webhook_target');

    const webhookChannel = await prisma.notificationChannel.findFirstOrThrow({
      where: { userId: userA.id }
    });
    assert(Boolean(webhookChannel.encryptedTarget), 'webhook encrypted target was not stored');
    assert(webhookChannel.encryptedTarget !== SUCCESS_WEBHOOK_URL, 'webhook URL was stored in plaintext');
    assert(webhookChannel.targetPreview !== SUCCESS_WEBHOOK_URL, 'webhook preview stored full target');
    checks.push('webhook_target_is_encrypted_and_preview_only_in_database');

    const testResult = await post<{ delivery: { id: string; status: string; responseStatus: number | null } }>(
      '/notifications/test-webhook',
      undefined,
      userACookie
    );
    assert(testResult.status === 201 || testResult.status === 200, `webhook test failed with ${testResult.status}`);
    assert(testResult.json.delivery.status === 'sent', `webhook test status mismatch: ${testResult.json.delivery.status}`);
    assert(
      testResult.json.delivery.responseStatus === 204 || testResult.json.delivery.responseStatus === 200,
      `webhook test response status mismatch: ${testResult.json.delivery.responseStatus}`
    );
    const testDelivery = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: testResult.json.delivery.id }
    });
    assert(testDelivery.status === NotificationDeliveryStatus.SENT, 'test delivery was not recorded as SENT');
    assert(testDelivery.eventType === NotificationEventType.TEST, 'test delivery event type mismatch');
    checks.push('configured_webhook_test_sends_real_request_and_records_delivery');

    const userBUnconfiguredTest = await post('/notifications/test-webhook', undefined, userBCookie);
    assert(userBUnconfiguredTest.status === 400, `unconfigured webhook test should fail, got ${userBUnconfiguredTest.status}`);
    const userBSettings = await get<NotificationSettingsResponse>('/notifications/settings', userBCookie);
    assert(userBSettings.status === 200, `user B settings failed with ${userBSettings.status}`);
    assert(userBSettings.json.deliveries.length === 0, 'user B can see user A notification deliveries');
    checks.push('unconfigured_channel_cannot_report_success_and_cross_user_deliveries_are_hidden');

    const failureSaved = await put<NotificationSettingsResponse>(
      '/notifications/settings',
      {
        preference: {
          balanceLowEnabled: false,
          balanceLowThresholdCents: null,
          securityAlertsEnabled: true,
          systemAnnouncementsEnabled: true,
          promotionsEnabled: false,
          modelPriceUpdatesEnabled: false
        },
        webhook: {
          enabled: true,
          name: `${prefix} failure webhook`,
          url: FAILURE_WEBHOOK_URL
        }
      },
      userBCookie
    );
    assert(failureSaved.status === 200, `saving failure webhook failed with ${failureSaved.status}`);
    const failureTest = await post('/notifications/test-webhook', undefined, userBCookie);
    assert(failureTest.status === 400, `failed webhook test should return 400, got ${failureTest.status}`);
    const failedDelivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { userId: userB.id, eventType: NotificationEventType.TEST },
      orderBy: { createdAt: 'desc' }
    });
    assert(failedDelivery.status === NotificationDeliveryStatus.FAILED, 'failed webhook test was not recorded');
    assert(failedDelivery.responseStatus === 500, `failed webhook response status mismatch: ${failedDelivery.responseStatus}`);
    checks.push('failed_webhook_test_records_failed_delivery_in_database');

    const userAToken = await createToken(userACookie, `${prefix}_token_a`);
    const relayResponse = await relayChat(userAToken.apiKey);
    assert(relayResponse.status === 200, `billable relay call failed with ${relayResponse.status}`);
    const walletAfter = await prisma.wallet.findUniqueOrThrow({
      where: { userId: userA.id },
      select: { balanceCents: true }
    });
    assert(walletAfter.balanceCents === 99, `wallet balance after relay should be 99 cents, got ${walletAfter.balanceCents}`);
    const balanceDelivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { userId: userA.id, eventType: NotificationEventType.BALANCE_LOW },
      orderBy: { createdAt: 'desc' }
    });
    assert(balanceDelivery.status === NotificationDeliveryStatus.SENT, 'balance low delivery should be SENT');
    assert(balanceDelivery.responseStatus === 204 || balanceDelivery.responseStatus === 200, 'balance low delivery HTTP status mismatch');
    const preferenceAfter = await prisma.notificationPreference.findUniqueOrThrow({
      where: { userId: userA.id }
    });
    assert(preferenceAfter.balanceLowLastNotifiedAt !== null, 'balance low last notified timestamp was not updated');
    checks.push('real_billable_relay_debit_triggers_balance_low_webhook');

    const refreshed = await get<NotificationSettingsResponse>('/notifications/settings', userACookie);
    assert(refreshed.status === 200, `refresh settings failed with ${refreshed.status}`);
    assert(
      refreshed.json.deliveries.some((delivery) => delivery.eventType === 'balance_low' && delivery.status === 'sent'),
      'settings response did not include real balance low delivery history'
    );
    const serialized = JSON.stringify({ saved: saved.json, refreshed: refreshed.json, test: testResult.json });
    for (const forbidden of [
      'encryptedTarget',
      'encrypted_target',
      'encryptedApiKey',
      'tokenHash',
      'passwordHash',
      SUCCESS_WEBHOOK_URL,
      FAILURE_WEBHOOK_URL,
      TEMP_UPSTREAM_KEY,
      userA.id,
      userAToken.apiKey
    ]) {
      assert(!serialized.includes(forbidden), `notification response leaked forbidden field/value: ${forbidden}`);
    }
    checks.push('notification_responses_use_sensitive_field_allowlist');

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

async function relayChat(apiKey: string) {
  return request('POST', '/v1/chat/completions', {
    model: publicModel,
    messages: [{ role: 'user', content: 'trigger balance low notification' }]
  }, undefined, apiKey);
}

async function get<T>(path: string, cookie?: string) {
  return request<T>('GET', path, undefined, cookie);
}

async function post<T = unknown>(path: string, body?: unknown, cookie?: string) {
  return request<T>('POST', path, body, cookie);
}

async function put<T = unknown>(path: string, body?: unknown, cookie?: string) {
  return request<T>('PUT', path, body, cookie);
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
    notification_preferences: await prisma.notificationPreference.count({ where: { userId: { in: userIds } } }),
    notification_channels: await prisma.notificationChannel.count({ where: { userId: { in: userIds } } }),
    notification_deliveries: await prisma.notificationDelivery.count({ where: { userId: { in: userIds } } }),
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
  await prisma.notificationDelivery.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notificationChannel.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
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

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
