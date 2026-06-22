import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaClient, UserRole, UserStatus } from '../src/generated/prisma/client';
import { getPostLoginPath } from '../../web/app/lib/role-routing';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  headers: Headers;
  cookies: string;
};

type WebResult = {
  status: number;
  text: string;
  headers: Headers;
  cookies: string;
};

type LoginResponse = {
  user: {
    id: string;
    username: string;
    role: string;
    status: string;
  };
};

type AuthMeResponse = {
  user: {
    id: string;
    username: string;
    role: string;
    status: string;
  };
};

type ResidualCounts = {
  users: number;
  wallets: number;
  sessions: number;
  securityAuditLogs: number;
};

type SeededUsers = {
  userId: string;
  adminId: string;
  usernames: {
    user: string;
    admin: string;
  };
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T22 merchant shell QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const usernamePrefix = `q22s_${suffix}`;
const checks: string[] = [];
const checksPassword = `qa-password-${suffix}`;

let checksError: unknown;
let seededUserIds: string[] = [];
let residualBefore: ResidualCounts | null = null;
let residualAfter: ResidualCounts = { users: 0, wallets: 0, sessions: 0, securityAuditLogs: 0 };

async function main() {
  try {
    const seeded = await seedRealUsers();
    seededUserIds = [seeded.userId, seeded.adminId];
    checks.push('seeded_real_user_admin_rows_and_wallets');

    const adminLogin = await login(seeded.usernames.admin);
    assert(adminLogin.status === 200 || adminLogin.status === 201, `admin login failed with ${adminLogin.status}`);
    assert(adminLogin.cookies.length > 0, 'admin login did not return session cookie');

    const adminProfile = await getAuthMe(adminLogin.cookies);
    assert(adminProfile.status === 200, `admin /auth/me failed with ${adminProfile.status}`);
    assert(
      normalizeRole(adminProfile.json.user.role) === UserRole.ADMIN.toLowerCase(),
      `admin /auth/me role mismatch: ${adminProfile.json.user.role}`
    );
    assert(
      getPostLoginPath(adminProfile.json.user) === '/merchant',
      `admin post-login route changed: ${getPostLoginPath(adminProfile.json.user)}`
    );
    checks.push('admin_login_auth_and_role_verified');

    const adminMerchantEntry = await requestMerchantEntry(adminLogin.cookies);
    assert(adminMerchantEntry.status >= 200 && adminMerchantEntry.status < 300, `admin /merchant should render dashboard, got ${adminMerchantEntry.status}`);
    const adminMerchantEntryText = await adminMerchantEntry.text();
    assertMerchantDashboardHtml(adminMerchantEntryText);
    checks.push('admin_merchant_entry_renders_dashboard');

    const adminUserSiteEntry = await requestUserSiteEntry(adminLogin.cookies);
    assertRedirect(adminUserSiteEntry, '/merchant', 'admin user-site entry redirect');
    checks.push('admin_is_kept_inside_merchant_site_when_opening_user_entry');

    const adminPage = await requestAdminPage(adminLogin.cookies);
    assertRedirect(adminPage, '/merchant', 'legacy admin page for merchant');
    checks.push('legacy_admin_page_redirects_to_merchant_entry');

    const adminUsersApi = await requestAdminUsers(adminLogin.cookies);
    assert(adminUsersApi.status === 200, `admin /admin/users should be 200, got ${adminUsersApi.status}`);
    checks.push('admin_can_access_admin_users_api');

    const userLogin = await login(seeded.usernames.user);
    assert(userLogin.status === 200 || userLogin.status === 201, `user login failed with ${userLogin.status}`);
    assert(userLogin.cookies.length > 0, 'user login did not return session cookie');

    const userProfile = await getAuthMe(userLogin.cookies);
    assert(userProfile.status === 200, `user /auth/me failed with ${userProfile.status}`);
    assert(
      normalizeRole(userProfile.json.user.role) === UserRole.USER.toLowerCase(),
      `user /auth/me role mismatch: ${userProfile.json.user.role}`
    );
    assert(
      getPostLoginPath(userProfile.json.user) === '/account/profile',
      `non-admin post-login route changed: ${getPostLoginPath(userProfile.json.user)}`
    );
    checks.push('user_login_and_role_verified');

    const userMerchantEntry = await requestMerchantEntry(userLogin.cookies);
    assertRedirect(userMerchantEntry, '/account/profile', 'non-admin /merchant redirect');

    const userAdminUsersApi = await requestAdminUsers(userLogin.cookies);
    assert(userAdminUsersApi.status === 403, `user /admin/users should be 403, got ${userAdminUsersApi.status}`);
    checks.push('non_admin_forbidden_from_admin_users_api');

    const dbUsers = await prisma.user.findMany({
      where: { id: { in: seededUserIds } },
      include: {
        wallet: true,
        sessions: true
      }
    });
    assert(dbUsers.length === 2, `expected 2 seeded users, got ${dbUsers.length}`);
    assert(dbUsers.some((entry) => normalizeRole(entry.role) === UserRole.USER.toLowerCase()), 'missing USER row in database');
    assert(
      dbUsers.some((entry) => normalizeRole(entry.role) === UserRole.ADMIN.toLowerCase()),
      'missing ADMIN row in database'
    );
    assert(dbUsers.every((entry) => !!entry.wallet), 'seeded users should each have a wallet row');
    assert(dbUsers.every((entry) => entry.sessions.length >= 1), 'seeded users should have session rows after login');
    checks.push('database_records_and_sessions_reflect_real_logins');

    residualBefore = await countResidual();
  } catch (error) {
    checksError = error;
  } finally {
    await cleanup();
    residualAfter = await countResidual();
    await prisma.$disconnect();
  }

  const summary = {
    ok: checksError === undefined,
    suffix,
    checks,
    residual: {
      beforeCleanup: residualBefore,
      afterCleanup: residualAfter
    }
  };

  console.log(JSON.stringify(summary, null, 2));

  if (checksError) {
    throw checksError;
  }
}

async function seedRealUsers(): Promise<SeededUsers> {
  const passwordHash = await bcrypt.hash(checksPassword, 12);
  const userUsername = `${usernamePrefix}_user`;
  const adminUsername = `${usernamePrefix}_admin`;

  const created = await prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.upsert({
      where: { code: 'default' },
      update: {},
      create: {
        code: 'default',
        name: 'Default Group'
      }
    });

    const user = await tx.user.create({
      data: {
        username: userUsername,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `t22_user_${suffix}`
      }
    });

    const admin = await tx.user.create({
      data: {
        username: adminUsername,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `t22_admin_${suffix}`
      }
    });

    await tx.wallet.createMany({
      data: [{ userId: user.id }, { userId: admin.id }]
    });

    return { userId: user.id, adminId: admin.id };
  });

  return {
    userId: created.userId,
    adminId: created.adminId,
    usernames: {
      user: userUsername,
      admin: adminUsername
    }
  };
}

async function login(username: string) {
  const response = await request<LoginResponse>('POST', '/auth/login', {
    username,
    password: checksPassword
  });
  return response;
}

async function getAuthMe(cookie: string) {
  return request<AuthMeResponse>('GET', '/auth/me', undefined, cookie);
}

async function requestAdminUsers(cookie: string) {
  return request<unknown>('GET', '/admin/users', undefined, cookie);
}

async function requestMerchantEntry(cookie: string) {
  const response = await fetch(`${WEB_BASE_URL}/merchant`, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
  return response;
}

async function requestUserSiteEntry(cookie: string) {
  const response = await fetch(`${WEB_BASE_URL}/`, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
  return response;
}

async function requestAdminPage(cookie: string): Promise<WebResult> {
  const response = await fetch(`${WEB_BASE_URL}/admin`, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
  const text = await response.text();

  return {
    status: response.status,
    text,
    headers: response.headers,
    cookies: extractCookieHeader(response)
  };
}

function assertRedirect(response: { status: number; headers: Headers }, expectedPath: string, label: string) {
  assert(response.status >= 300 && response.status < 400, `${label} should be a redirect, got ${response.status}`);
  const location = response.headers.get('location') ?? '';
  assert(
    location === expectedPath || location.endsWith(expectedPath),
    `${label} should redirect to ${expectedPath}, got ${location || '<empty>'}`
  );
}

function assertIsShellHtml(text: string) {
  const markers = [
    'merchant-shell-page',
    'merchant-primary-nav',
    'merchant-sidebar',
    '商家控制台',
    'DeepSeek 上游',
    '模型发布',
    '充值码',
    '审计'
  ];
  const foundCount = markers.filter((marker) => text.includes(marker)).length;
  assert(foundCount >= 5, `admin page did not render expected merchant shell markers, found only ${foundCount} markers`);
  assertOrderedMarkers(text, ['充值码', '模型发布', 'DeepSeek 上游', '中转站上游', '模型映射'], 'merchant shell navigation order');
  const forbiddenUserMarkers = ['个人中心', '余额充值', '费用说明', '通知设置', '令牌入口'];
  const leakedMarkers = forbiddenUserMarkers.filter((marker) => text.includes(marker));
  assert(leakedMarkers.length === 0, `merchant shell leaked user-site markers: ${leakedMarkers.join(', ')}`);
}

function assertMerchantDashboardHtml(text: string) {
  const markers = ['merchant-shell-page', '商家工作台', '运营概览', '客户剩余 token', '第二步 A：接入 DeepSeek 上游', '第二步 B：接入中转站上游'];
  const foundCount = markers.filter((marker) => text.includes(marker)).length;
  assert(foundCount >= 4, `merchant dashboard page did not render expected markers, found only ${foundCount}`);
}

function assertOrderedMarkers(text: string, orderedMarkers: string[], label: string) {
  let lastIndex = -1;
  for (const marker of orderedMarkers) {
    const nextIndex = text.indexOf(marker);
    assert(nextIndex >= 0, `${label} missing marker: ${marker}`);
    assert(nextIndex > lastIndex, `${label} marker is out of order: ${marker}`);
    lastIndex = nextIndex;
  }
}

async function request<T>(method: string, path: string, body?: unknown, cookie?: string): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie: cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const responseText = await response.text();
  const json = responseText ? (JSON.parse(responseText) as T) : ({} as T);
  return {
    status: response.status,
    json,
    headers: response.headers,
    cookies: extractCookieHeader(response)
  };
}

function extractCookieHeader(response: Response) {
  const headerAccessor = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookieHeaders = headerAccessor.getSetCookie ? headerAccessor.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
  return cookieHeaders
    .filter(Boolean)
    .map((header) => header.split(';')[0])
    .join('; ');
}

function normalizeRole(role: string) {
  return (role ?? '').trim().toLowerCase();
}

async function countResidual() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: usernamePrefix } },
    select: { id: true }
  });
  const userIds = Array.from(new Set([...seededUserIds, ...users.map((user) => user.id)]));
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

async function cleanup() {
  if (!seededUserIds.length) {
    return;
  }

  await prisma.session.deleteMany({
    where: { userId: { in: seededUserIds } }
  });
  await prisma.securityAuditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: seededUserIds } },
        { targetId: { in: seededUserIds } }
      ]
    }
  });
  await prisma.wallet.deleteMany({
    where: { userId: { in: seededUserIds } }
  });
  await prisma.user.deleteMany({
    where: { id: { in: seededUserIds } }
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main();
