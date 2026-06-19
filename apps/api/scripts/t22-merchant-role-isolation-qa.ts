import { PrismaPg } from '@prisma/adapter-pg';
import { hash as bcryptHash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaClient, UserRole, UserStatus } from '../src/generated/prisma/client';
import { getPostLoginPath } from '../../web/app/lib/role-routing';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  text: string;
  cookie: string;
};

type WebResult = {
  status: number;
  text: string;
  location: string;
};

type LoginResponse = {
  user: {
    id: string;
    username: string;
    role: string;
    status: string;
  };
};

type AuthMeResponse = LoginResponse;

type SeededContext = {
  usernames: {
    admin: string;
    user: string;
  };
  userIds: {
    admin: string;
    user: string;
  };
};

type ResidualCounts = {
  users: number;
  wallets: number;
  sessions: number;
  securityAuditLogs: number;
};

type WebPageCheck = {
  path: string;
  markers: string[];
};

type ApiCheck = {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
  adminExpectedStatus?: number;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T22 merchant role isolation QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const usernamePrefix = `q22m9_${suffix}`;
const password = `qa-password-${suffix}`;
const checks: string[] = [];

let checksError: unknown;
let residualBefore: ResidualCounts | null = null;
let residualAfter: ResidualCounts | null = null;

const merchantPages: WebPageCheck[] = [
  { path: '/merchant', markers: ['merchant-shell-page', '商家工作台'] },
  { path: '/merchant/users', markers: ['merchant-shell-page', '用户管理'] },
  { path: '/merchant/recharge-codes', markers: ['merchant-shell-page', '充值码'] },
  { path: '/merchant/model-config', markers: ['merchant-shell-page', '模型发布'] },
  { path: '/merchant/upstreams/deepseek', markers: ['merchant-shell-page', 'DeepSeek 上游接入', '上游名称'] },
  { path: '/merchant/upstreams/relay', markers: ['merchant-shell-page', '中转站上游接入', '上游名称'] },
  { path: '/merchant/model-routes', markers: ['merchant-shell-page', '模型映射（上游线路）'] },
  { path: '/merchant/announcements', markers: ['merchant-shell-page', '公告'] },
  { path: '/merchant/audit', markers: ['merchant-shell-page', '审计'] },
  { path: '/merchant/service-status', markers: ['merchant-shell-page', '服务状态'] },
  { path: '/merchant/request-logs', markers: ['merchant-shell-page', '请求日志'] },
  { path: '/merchant/drawing-logs', markers: ['merchant-shell-page', '绘图日志'] }
];

const userPages: WebPageCheck[] = [
  { path: '/account/profile', markers: ['console-shell-page', '余额'] },
  { path: '/account/topup/recharge', markers: ['console-shell-page', '余额充值'] },
  { path: '/token', markers: ['console-shell-page', '令牌'] },
  { path: '/log', markers: ['console-shell-page', '日志'] },
  { path: '/account/pricing', markers: ['console-shell-page', '费用'] },
  { path: '/account/notificationSettings', markers: ['console-shell-page', '通知'] },
  { path: '/midjourney', markers: ['console-shell-page', '绘图'] },
  { path: '/uptimeStatus', markers: ['console-shell-page', '服务'] }
];

const merchantApiChecks: ApiCheck[] = [
  { method: 'GET', path: '/admin/dashboard-summary' },
  { method: 'GET', path: '/admin/users' },
  { method: 'GET', path: '/admin/announcements' },
  { method: 'GET', path: '/admin/audit-logs' },
  { method: 'GET', path: '/admin/security-audit-logs' },
  { method: 'GET', path: '/admin/request-logs' },
  { method: 'GET', path: '/admin/image-tasks' },
  { method: 'GET', path: '/admin/upstreams' },
  { method: 'GET', path: '/admin/model-config' },
  { method: 'GET', path: '/admin/groups' },
  { method: 'GET', path: '/admin/recharge-codes' },
  {
    method: 'POST',
    path: '/admin/announcements',
    body: {
      title: `${usernamePrefix} announcement`,
      content: `${usernamePrefix} content`,
      category: 'announcement',
      status: 'draft'
    },
    adminExpectedStatus: 201
  },
  { method: 'POST', path: '/admin/upstreams', body: {}, adminExpectedStatus: 400 },
  { method: 'POST', path: '/admin/upstreams/not-real/health-check', body: {}, adminExpectedStatus: 400 },
  { method: 'POST', path: '/admin/groups', body: {}, adminExpectedStatus: 400 },
  { method: 'POST', path: '/admin/users/not-real/group', body: {}, adminExpectedStatus: 400 },
  { method: 'POST', path: '/admin/models', body: {}, adminExpectedStatus: 400 },
  { method: 'POST', path: '/admin/upstream-models', body: {}, adminExpectedStatus: 400 },
  { method: 'POST', path: '/admin/recharge-codes', body: {}, adminExpectedStatus: 400 },
  { method: 'POST', path: '/admin/recharge-codes/not-real/disable', body: {}, adminExpectedStatus: 400 }
];

const userApiChecks: ApiCheck[] = [
  { method: 'GET', path: '/auth/me' },
  { method: 'GET', path: '/tokens' },
  { method: 'GET', path: '/recharge/records' },
  { method: 'GET', path: '/usage/logs' },
  { method: 'GET', path: '/pricing/models' },
  { method: 'GET', path: '/notifications/settings' },
  { method: 'GET', path: '/async-tasks?kind=image' },
  { method: 'GET', path: '/service-status' }
];

async function main() {
  let seeded: SeededContext | null = null;
  let merchantCookie = '';
  let userCookie = '';

  try {
    seeded = await seedUsers();
    checks.push('seeded_real_user_and_merchant_accounts');

    const merchantLogin = await login(seeded.usernames.admin);
    assert(merchantLogin.status === 200 || merchantLogin.status === 201, `merchant login failed with ${merchantLogin.status}`);
    assert(merchantLogin.cookie.length > 0, 'merchant login should return session cookie');
    assert(merchantLogin.json.user.role.toLowerCase() === UserRole.ADMIN.toLowerCase(), 'merchant login role mismatch');
    assert(getPostLoginPath(merchantLogin.json.user) === '/merchant', 'merchant post-login route should be /merchant');
    merchantCookie = merchantLogin.cookie;
    checks.push('merchant_login_and_role_route_verified');

    const userLogin = await login(seeded.usernames.user);
    assert(userLogin.status === 200 || userLogin.status === 201, `ordinary user login failed with ${userLogin.status}`);
    assert(userLogin.cookie.length > 0, 'ordinary user login should return session cookie');
    assert(userLogin.json.user.role.toLowerCase() === UserRole.USER.toLowerCase(), 'ordinary user login role mismatch');
    assert(getPostLoginPath(userLogin.json.user) === '/account/profile', 'ordinary user post-login route should be /account/profile');
    userCookie = userLogin.cookie;
    checks.push('ordinary_login_and_role_route_verified');

    const merchantProfile = await get<AuthMeResponse>('/auth/me', merchantCookie);
    const userProfile = await get<AuthMeResponse>('/auth/me', userCookie);
    assert(merchantProfile.status === 200, `merchant /auth/me failed with ${merchantProfile.status}`);
    assert(userProfile.status === 200, `ordinary /auth/me failed with ${userProfile.status}`);
    assert(merchantProfile.json.user.username === seeded.usernames.admin, 'merchant /auth/me username mismatch');
    assert(userProfile.json.user.username === seeded.usernames.user, 'ordinary /auth/me username mismatch');
    checks.push('real_sessions_match_database_users');

    for (const page of merchantPages) {
      await assertMerchantPageIsolation(page, merchantCookie, userCookie);
    }
    checks.push('all_merchant_pages_render_for_merchant_and_redirect_for_ordinary_user');

    const merchantUserSiteEntry = await getWebPage('/', merchantCookie);
    assertRedirect(merchantUserSiteEntry, '/merchant', 'merchant / user-site entry redirect');
    checks.push('merchant_account_is_kept_out_of_user_site_entry');

    const merchantLegacyAdmin = await getWebPage('/admin', merchantCookie);
    assertRedirect(merchantLegacyAdmin, '/merchant', 'merchant legacy /admin redirect');
    const ordinaryRemovedGroupPage = await getWebPage('/groupAvailability', userCookie);
    assertRedirect(ordinaryRemovedGroupPage, '/account/profile', 'ordinary user removed group page redirect');
    const merchantRemovedGroupPage = await getWebPage('/groupAvailability', merchantCookie);
    assertRedirect(merchantRemovedGroupPage, '/merchant', 'merchant removed group page redirect');
    checks.push('removed_group_and_legacy_admin_pages_redirect_to_correct_sites');

    for (const page of userPages) {
      await assertUserPageRenders(page, userCookie);
    }
    checks.push('ordinary_user_core_pages_render');

    for (const apiCheck of merchantApiChecks) {
      await assertMerchantApiIsolation(apiCheck, merchantCookie, userCookie);
    }
    checks.push('merchant_admin_capabilities_reject_ordinary_user_and_allow_merchant');

    for (const apiCheck of userApiChecks) {
      const response = await request(apiCheck.method, apiCheck.path, apiCheck.body, userCookie);
      assert(response.status >= 200 && response.status < 300, `ordinary user ${apiCheck.path} should be 2xx, got ${response.status}`);
    }
    checks.push('ordinary_user_core_capabilities_remain_available');

    const adminPageAsOrdinary = await getWebPage('/admin', userCookie);
    assertRedirect(adminPageAsOrdinary, '/account/profile', 'ordinary user /admin compatibility page');
    checks.push('legacy_admin_page_is_server_side_role_guarded');

    const dbUsers = await prisma.user.findMany({
      where: { id: { in: [seeded.userIds.admin, seeded.userIds.user] } },
      include: {
        sessions: true,
        wallet: true
      }
    });
    assert(dbUsers.length === 2, `expected 2 seeded users, got ${dbUsers.length}`);
    assert(dbUsers.every((entry) => entry.wallet), 'each seeded user should have a wallet');
    assert(dbUsers.every((entry) => entry.sessions.length >= 1), 'each seeded user should have a real login session');
    checks.push('database_wallet_and_session_consistency_verified');

    residualBefore = await countResidual();
    assert(residualBefore.users >= 2, `expected seeded users before cleanup, got ${residualBefore.users}`);
    assert(residualBefore.wallets >= 2, `expected seeded wallets before cleanup, got ${residualBefore.wallets}`);
    assert(residualBefore.sessions >= 2, `expected seeded sessions before cleanup, got ${residualBefore.sessions}`);
    checks.push('residual_metrics_captured_before_cleanup');
  } catch (error) {
    checksError = error;
  } finally {
    await cleanup(seeded);
    residualAfter = await countResidual();
    await prisma.$disconnect();
  }

  assertResidualZero(residualAfter);

  const result = {
    ok: checksError === undefined,
    checks,
    usernamePrefix,
    pages: {
      merchant: merchantPages.map((entry) => entry.path),
      user: userPages.map((entry) => entry.path)
    },
    merchantCapabilitiesChecked: merchantApiChecks.map((entry) => `${entry.method} ${entry.path}`),
    userCapabilitiesChecked: userApiChecks.map((entry) => `${entry.method} ${entry.path}`),
    residualBefore,
    residualAfter
  };

  console.log(JSON.stringify(result, null, 2));

  if (checksError !== undefined) {
    throw checksError;
  }
}

async function seedUsers(): Promise<SeededContext> {
  const adminUsername = `${usernamePrefix}_admin`;
  const userUsername = `${usernamePrefix}_user`;
  const passwordHash = await bcryptHash(password, 12);

  return prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.upsert({
      where: { code: 'default' },
      update: {},
      create: {
        code: 'default',
        name: '默认归属'
      }
    });

    const admin = await tx.user.create({
      data: {
        username: adminUsername,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${usernamePrefix}_admin_invite`
      }
    });

    const user = await tx.user.create({
      data: {
        username: userUsername,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${usernamePrefix}_user_invite`
      }
    });

    await tx.wallet.createMany({
      data: [{ userId: admin.id }, { userId: user.id }]
    });

    return {
      usernames: {
        admin: adminUsername,
        user: userUsername
      },
      userIds: {
        admin: admin.id,
        user: user.id
      }
    };
  });
}

async function login(username: string) {
  return request<LoginResponse>('POST', '/auth/login', { username, password });
}

function get<T = unknown>(path: string, cookie?: string) {
  return request<T>('GET', path, undefined, cookie);
}

async function request<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  cookie?: string
): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      accept: 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const json = text ? (JSON.parse(text) as T) : ({} as T);

  return {
    status: response.status,
    json,
    text,
    cookie: extractSessionCookie(response)
  };
}

async function getWebPage(path: string, cookie?: string): Promise<WebResult> {
  const response = await fetch(`${WEB_BASE_URL}${path}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
    redirect: 'manual'
  });

  return {
    status: response.status,
    text: await response.text(),
    location: response.headers.get('location') ?? ''
  };
}

async function assertMerchantPageIsolation(page: WebPageCheck, merchantCookie: string, userCookie: string) {
  const noSession = await getWebPage(page.path);
  assertRedirect(noSession, '/login', `unauthenticated ${page.path}`);

  const ordinary = await getWebPage(page.path, userCookie);
  assertRedirect(ordinary, '/account/profile', `ordinary user ${page.path}`);

  const merchant = await getWebPage(page.path, merchantCookie);
  assert(merchant.status >= 200 && merchant.status < 300, `merchant ${page.path} should render, got ${merchant.status}`);
  assert(!merchant.text.includes('500: Internal server error'), `merchant ${page.path} rendered a 500 error`);
  assert(!merchant.text.includes('Relay Console'), `merchant ${page.path} leaked old brand text`);
  const found = page.markers.filter((marker) => merchant.text.includes(marker)).length;
  assert(found >= page.markers.length - 1, `merchant ${page.path} missing expected markers, found ${found}`);
}

async function assertUserPageRenders(page: WebPageCheck, userCookie: string) {
  const response = await getWebPageFollowingSingleRedirect(page.path, userCookie);
  assert(response.status >= 200 && response.status < 300, `ordinary user ${page.path} should render, got ${response.status}`);
  assert(!response.text.includes('500: Internal server error'), `ordinary user ${page.path} rendered a 500 error`);
  const found = page.markers.filter((marker) => response.text.includes(marker)).length;
  assert(found >= 1, `ordinary user ${page.path} missing expected markers`);
}

async function getWebPageFollowingSingleRedirect(path: string, cookie?: string): Promise<WebResult> {
  const first = await getWebPage(path, cookie);
  if (first.status < 300 || first.status >= 400) {
    return first;
  }

  const nextPath = normalizeRedirectPath(first.location, path);
  return getWebPage(nextPath, cookie);
}

function normalizeRedirectPath(location: string, sourcePath: string) {
  assert(location, `${sourcePath} redirected without a location header`);
  if (location.startsWith('/')) {
    return location;
  }

  const parsed = new URL(location, WEB_BASE_URL);
  const expectedOrigin = new URL(WEB_BASE_URL).origin;
  assert(parsed.origin === expectedOrigin, `${sourcePath} redirected outside the web app: ${location}`);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function assertMerchantApiIsolation(apiCheck: ApiCheck, merchantCookie: string, userCookie: string) {
  const noSession = await request(apiCheck.method, apiCheck.path, apiCheck.body);
  assert(noSession.status === 401, `unauthenticated ${apiCheck.method} ${apiCheck.path} should be 401, got ${noSession.status}`);

  const ordinary = await request(apiCheck.method, apiCheck.path, apiCheck.body, userCookie);
  assert(ordinary.status === 403, `ordinary user ${apiCheck.method} ${apiCheck.path} should be 403, got ${ordinary.status}`);

  const merchant = await request(apiCheck.method, apiCheck.path, apiCheck.body, merchantCookie);
  const expectedStatus = apiCheck.adminExpectedStatus ?? 200;
  assert(
    merchant.status === expectedStatus,
    `merchant ${apiCheck.method} ${apiCheck.path} should be ${expectedStatus}, got ${merchant.status}: ${merchant.text}`
  );
}

function extractSessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookieHeaders = headers.getSetCookie ? headers.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
  return cookieHeaders
    .filter(Boolean)
    .map((header) => header.split(';')[0])
    .join('; ');
}

function assertRedirect(response: WebResult, expectedPath: string, label: string) {
  assert(response.status >= 300 && response.status < 400, `${label} should redirect, got ${response.status}`);
  assert(
    response.location === expectedPath || response.location.endsWith(expectedPath),
    `${label} should redirect to ${expectedPath}, got ${response.location || '<empty>'}`
  );
}

async function countResidual(): Promise<ResidualCounts> {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: usernamePrefix } },
    select: { id: true }
  });
  const userIds = users.map((entry) => entry.id);

  return {
    users: users.length,
    wallets: userIds.length ? await prisma.wallet.count({ where: { userId: { in: userIds } } }) : 0,
    sessions: userIds.length ? await prisma.session.count({ where: { userId: { in: userIds } } }) : 0,
    securityAuditLogs: userIds.length
      ? await prisma.securityAuditLog.count({
          where: {
            OR: [
              { actorUserId: { in: userIds } },
              { targetId: { in: userIds } }
            ]
          }
        })
      : 0
  };
}

async function cleanup(seeded: SeededContext | null) {
  const userIds = seeded ? [seeded.userIds.admin, seeded.userIds.user] : [];
  if (!userIds.length) {
    return;
  }

  await prisma.adminAuditLog.deleteMany({
    where: {
      adminUserId: { in: userIds }
    }
  });
  await prisma.announcement.deleteMany({
    where: {
      title: { startsWith: usernamePrefix }
    }
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.securityAuditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { targetId: { in: userIds } }
      ]
    }
  });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function assertResidualZero(result: ResidualCounts | null) {
  if (!result) {
    return;
  }

  assert(result.users === 0, `residual users should be 0, got ${result.users}`);
  assert(result.wallets === 0, `residual wallets should be 0, got ${result.wallets}`);
  assert(result.sessions === 0, `residual sessions should be 0, got ${result.sessions}`);
  assert(result.securityAuditLogs === 0, `residual securityAuditLogs should be 0, got ${result.securityAuditLogs}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main();
