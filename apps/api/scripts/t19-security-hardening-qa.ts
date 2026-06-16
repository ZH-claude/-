import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { PrismaClient, UserRole, AsyncTaskKind, AsyncTaskStatus } from '../src/generated/prisma/client';

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
  };
};

type ListResponse = {
  items: unknown[];
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;
const NOTIFICATION_SECRET = process.env.NOTIFICATION_SECRET_ENCRYPTION_SECRET ?? UPSTREAM_SECRET;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T19 security hardening QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

if (!NOTIFICATION_SECRET || NOTIFICATION_SECRET.length < 32) {
  throw new Error('NOTIFICATION_SECRET_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const prefix = `qa_t19_${suffix}`;
const password = `qa-password-${suffix}`;
const changedPassword = `qa-password-changed-${suffix}`;
const upstreamSecret = `qa-t19-upstream-secret-${suffix}`;
const webhookUrl = 'https://httpbingo.org/anything/t19-security';
const checks: string[] = [];

async function main() {
  try {
    const admin = await register(`${prefix}_admin`, password);
    await prisma.user.update({
      where: { id: admin.json.user.id },
      data: { role: UserRole.ADMIN }
    });
    const userA = await register(`${prefix}_user_a`, password);
    const userB = await register(`${prefix}_user_b`, password);

    const loginA = await post<RegisterResponse>('/auth/login', { username: userA.json.user.username, password }, undefined, '203.0.113.101');
    assert(loginA.status === 201 || loginA.status === 200, `login A failed with ${loginA.status}`);
    assert(loginA.cookie, 'login A did not set a session cookie');
    const userASessionCookie = loginA.cookie;

    const changed = await post('/auth/change-password', { currentPassword: password, newPassword: changedPassword }, userASessionCookie);
    assert(changed.status === 201 || changed.status === 200, `change password failed with ${changed.status}`);

    const token = await post<CreateTokenResponse>(
      '/tokens',
      {
        name: `${prefix}_token`,
        rateLimitRequestsPerMinute: 5
      },
      userASessionCookie
    );
    assert(token.status === 201 || token.status === 200, `create token failed with ${token.status}`);
    assert(token.json.apiKey, 'create token did not return one-time apiKey');

    const ordinaryDeleteForeignToken = await del(`/tokens/${token.json.token.id}`, userB.cookie);
    assert(
      ordinaryDeleteForeignToken.status === 404,
      `cross-user token delete should return 404, got ${ordinaryDeleteForeignToken.status}`
    );
    checks.push('cross_user_token_delete_is_blocked');

    const reset = await post<CreateTokenResponse>(`/tokens/${token.json.token.id}/reset`, undefined, userASessionCookie);
    assert(reset.status === 201 || reset.status === 200, `reset token failed with ${reset.status}`);
    assert(reset.json.apiKey, 'reset token did not return one-time apiKey');

    const disabled = await post(`/tokens/${token.json.token.id}/disable`, undefined, userASessionCookie);
    assert(disabled.status === 201 || disabled.status === 200, `disable token failed with ${disabled.status}`);

    const deleted = await del(`/tokens/${token.json.token.id}`, userASessionCookie);
    assert(deleted.status === 200, `delete token failed with ${deleted.status}`);

    await seedAsyncTasks(userA.json.user.id, userB.json.user.id);
    const userBTasks = await get<ListResponse>('/async-tasks', userB.cookie);
    assert(userBTasks.status === 200, `user B async tasks failed with ${userBTasks.status}`);
    assert(!JSON.stringify(userBTasks.json).includes(`${prefix}_user_a_task`), 'user B async tasks leaked user A task');
    assert(JSON.stringify(userBTasks.json).includes(`${prefix}_user_b_task`), 'user B async tasks did not include own task');
    checks.push('async_task_reads_are_user_scoped');

    const userBLogs = await get<ListResponse>(`/usage/logs?tokenId=${encodeURIComponent(token.json.token.id)}`, userB.cookie);
    assert(userBLogs.status === 200, `foreign token usage log query failed with ${userBLogs.status}`);
    assert(userBLogs.json.items.length === 0, 'foreign token usage log query leaked rows');
    checks.push('usage_log_foreign_token_query_does_not_leak_rows');

    const notificationSaved = await put(
      '/notifications/settings',
      {
        preference: {
          balanceLowEnabled: true,
          balanceLowThresholdCents: 100
        },
        webhook: {
          enabled: true,
          name: `${prefix} webhook`,
          url: webhookUrl
        }
      },
      userASessionCookie
    );
    assert(notificationSaved.status === 200, `saving user A notification settings failed with ${notificationSaved.status}`);
    const userBNotificationSettings = await get('/notifications/settings', userB.cookie);
    assert(userBNotificationSettings.status === 200, `user B notification settings failed with ${userBNotificationSettings.status}`);
    assert(!JSON.stringify(userBNotificationSettings.json).includes('httpbingo.org'), 'user B notification settings leaked user A webhook');
    checks.push('notification_settings_are_user_scoped');

    const ordinaryAdminUsers = await get('/admin/users', userASessionCookie);
    const ordinaryAdminAudit = await get('/admin/audit-logs', userASessionCookie);
    const ordinarySecurityAudit = await get('/admin/security-audit-logs', userASessionCookie);
    const ordinaryCreateAnnouncement = await post(
      '/admin/announcements',
      { title: `${prefix} blocked`, content: 'blocked', status: 'published' },
      userASessionCookie
    );
    const ordinaryCreateUpstream = await post(
      '/admin/upstreams',
      { name: `${prefix}_blocked_upstream`, baseUrl: 'https://example.com/v1', apiKey: upstreamSecret },
      userASessionCookie
    );
    assert(ordinaryAdminUsers.status === 403, `ordinary user admin users should be 403, got ${ordinaryAdminUsers.status}`);
    assert(ordinaryAdminAudit.status === 403, `ordinary user admin audit should be 403, got ${ordinaryAdminAudit.status}`);
    assert(ordinarySecurityAudit.status === 403, `ordinary user security audit should be 403, got ${ordinarySecurityAudit.status}`);
    assert(
      ordinaryCreateAnnouncement.status === 403,
      `ordinary user announcement create should be 403, got ${ordinaryCreateAnnouncement.status}`
    );
    assert(ordinaryCreateUpstream.status === 403, `ordinary user upstream create should be 403, got ${ordinaryCreateUpstream.status}`);
    checks.push('ordinary_user_cannot_read_or_forge_admin_security_surfaces');

    const adminAnnouncement = await post(
      '/admin/announcements',
      { title: `${prefix} admin announcement`, content: 'security audit announcement', status: 'published' },
      admin.cookie
    );
    assert(adminAnnouncement.status === 201 || adminAnnouncement.status === 200, `admin announcement failed with ${adminAnnouncement.status}`);

    const adminUpstream = await post(
      '/admin/upstreams',
      {
        name: `${prefix}_upstream`,
        baseUrl: 'https://example.com/v1',
        apiKey: upstreamSecret,
        status: 'active'
      },
      admin.cookie
    );
    assert(adminUpstream.status === 201 || adminUpstream.status === 200, `admin upstream failed with ${adminUpstream.status}`);

    const recharge = await post<{ items: Array<{ code: string }> }>(
      '/admin/recharge-codes',
      { amountCents: 100, count: 1 },
      admin.cookie
    );
    assert(recharge.status === 201 || recharge.status === 200, `admin recharge code failed with ${recharge.status}`);
    const plainRechargeCode = recharge.json.items[0]?.code;
    assert(plainRechargeCode, 'admin recharge code did not return one-time code');

    const adminAudit = await get('/admin/audit-logs?limit=100', admin.cookie);
    assert(adminAudit.status === 200, `admin audit logs failed with ${adminAudit.status}`);
    const adminAuditText = JSON.stringify(adminAudit.json);
    assert(adminAuditText.includes('announcement_created'), 'admin audit did not include announcement_created');
    assert(adminAuditText.includes('upstream_provider_created'), 'admin audit did not include upstream_provider_created');
    assert(adminAuditText.includes('recharge_code_created'), 'admin audit did not include recharge_code_created');
    assertNoSensitive(adminAuditText, [upstreamSecret, plainRechargeCode, 'encryptedApiKey', 'tokenHash', 'passwordHash', 'codeHash', 'https://example.com/v1'], 'admin audit logs');
    checks.push('admin_audit_logs_are_queryable_and_redacted');

    const securityAudit = await get('/admin/security-audit-logs?limit=100', admin.cookie);
    assert(securityAudit.status === 200, `security audit logs failed with ${securityAudit.status}`);
    const securityAuditText = JSON.stringify(securityAudit.json);
    for (const action of [
      'user_registered',
      'user_login_succeeded',
      'user_password_changed',
      'api_token_created',
      'api_token_reset',
      'api_token_disabled',
      'api_token_deleted'
    ]) {
      assert(securityAuditText.includes(action), `security audit did not include ${action}`);
    }
    assertNoSensitive(
      securityAuditText,
      [token.json.apiKey, reset.json.apiKey, password, changedPassword, 'tokenHash', 'passwordHash', 'encryptedApiKey'],
      'security audit logs'
    );
    checks.push('security_audit_logs_cover_auth_and_token_operations_without_secrets');

    const residualBeforeCleanup = await countResidual();
    console.log(JSON.stringify({ ok: true, suffix, checks, residualBeforeCleanup }, null, 2));
  } finally {
    await cleanup();
    const residualAfterCleanup = await countResidual();
    console.log(JSON.stringify({ cleanup: true, suffix, residualAfterCleanup }, null, 2));
    await prisma.$disconnect();
  }
}

async function register(username: string, userPassword: string) {
  const result = await post<RegisterResponse>('/auth/register', { username, password: userPassword });
  assert(result.status === 201 || result.status === 200, `register ${username} failed with ${result.status}`);
  assert(result.cookie, `register ${username} did not set a session cookie`);
  return result;
}

async function seedAsyncTasks(userAId: string, userBId: string) {
  await prisma.asyncTask.createMany({
    data: [
      {
        userId: userAId,
        externalTaskId: `${prefix}_user_a_task`,
        platform: 'qa',
        kind: AsyncTaskKind.GENERIC,
        status: AsyncTaskStatus.SUCCEEDED,
        model: `${prefix}_model`
      },
      {
        userId: userBId,
        externalTaskId: `${prefix}_user_b_task`,
        platform: 'qa',
        kind: AsyncTaskKind.GENERIC,
        status: AsyncTaskStatus.SUCCEEDED,
        model: `${prefix}_model`
      }
    ]
  });
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
  clientIp = '203.0.113.19'
): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      'x-forwarded-for': clientIp
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as T) : ({} as T);
  return {
    status: response.status,
    json,
    headers: response.headers,
    cookie: response.headers.get('set-cookie') ?? undefined
  };
}

function get<T = unknown>(path: string, cookie?: string) {
  return request<T>('GET', path, undefined, cookie);
}

function post<T = unknown>(path: string, body?: unknown, cookie?: string, clientIp?: string) {
  return request<T>('POST', path, body, cookie, clientIp);
}

function put<T = unknown>(path: string, body?: unknown, cookie?: string) {
  return request<T>('PUT', path, body, cookie);
}

function del<T = unknown>(path: string, cookie?: string) {
  return request<T>('DELETE', path, undefined, cookie);
}

function assertNoSensitive(text: string, forbiddenValues: string[], context: string) {
  for (const value of forbiddenValues) {
    if (value && text.includes(value)) {
      throw new Error(`${context} leaked sensitive value: ${value}`);
    }
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  const tokens = userIds.length
    ? await prisma.apiToken.findMany({ where: { userId: { in: userIds } }, select: { id: true } })
    : [];
  const tokenIds = tokens.map((token) => token.id);
  const usageEvents = userIds.length || tokenIds.length
    ? await prisma.usageEvent.findMany({
        where: { OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }] },
        select: { id: true }
      })
    : [];
  const usageIds = usageEvents.map((event) => event.id);

  await prisma.securityAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.adminAuditLog.deleteMany({ where: { adminUserId: { in: userIds } } });
  await prisma.notificationDelivery.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notificationChannel.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.asyncTask.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { externalTaskId: { startsWith: prefix } }] } });
  await prisma.announcement.deleteMany({ where: { OR: [{ createdByAdminId: { in: userIds } }, { title: { startsWith: prefix } }] } });
  await prisma.upstreamModel.deleteMany({ where: { provider: { name: { startsWith: prefix } } } });
  await prisma.upstreamProvider.deleteMany({ where: { OR: [{ createdByAdminId: { in: userIds } }, { name: { startsWith: prefix } }] } });
  await prisma.walletTransaction.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { usageEventId: { in: usageIds } }] } });
  await prisma.usageEvent.deleteMany({ where: { id: { in: usageIds } } });
  await prisma.relayRateLimitEvent.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }] } });
  await prisma.apiTokenModelAccess.deleteMany({ where: { apiTokenId: { in: tokenIds } } });
  await prisma.apiToken.deleteMany({ where: { id: { in: tokenIds } } });
  await prisma.rechargeCode.deleteMany({ where: { createdByAdminId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function countResidual() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  return {
    users: users.length,
    sessions: await prisma.session.count({ where: { userId: { in: userIds } } }),
    wallets: await prisma.wallet.count({ where: { userId: { in: userIds } } }),
    api_tokens: await prisma.apiToken.count({ where: { userId: { in: userIds } } }),
    security_audit_logs: await prisma.securityAuditLog.count({ where: { actorUserId: { in: userIds } } }),
    admin_audit_logs: await prisma.adminAuditLog.count({ where: { adminUserId: { in: userIds } } }),
    async_tasks: await prisma.asyncTask.count({ where: { externalTaskId: { startsWith: prefix } } }),
    notification_channels: await prisma.notificationChannel.count({ where: { userId: { in: userIds } } }),
    announcements: await prisma.announcement.count({ where: { title: { startsWith: prefix } } }),
    upstream_providers: await prisma.upstreamProvider.count({ where: { name: { startsWith: prefix } } }),
    recharge_codes: await prisma.rechargeCode.count({ where: { createdByAdminId: { in: userIds } } })
  };
}

void main();
