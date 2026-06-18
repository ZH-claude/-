import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaClient, UserRole, UserStatus } from '../src/generated/prisma/client';
import { getPostLoginPath } from '../../web/app/lib/role-routing';

type LoginResponse = {
  user: {
    id: string;
    username: string;
    role: string;
    status: string;
  };
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T22 merchant routing QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const usernamePrefix = `qa_t22_${suffix}`;
const password = `qa-password-${suffix}`;
const checks: string[] = [];

async function main() {
  const userUsername = `${usernamePrefix}_user`;
  const merchantUsername = `${usernamePrefix}_merchant`;
  let userIds: string[] = [];

  try {
    const created = await seedRealUsers({
      userUsername,
      merchantUsername
    });
    userIds = [created.userId, created.merchantId];
    checks.push('seeded_real_user_and_merchant_rows_with_wallets');

    const ordinaryLogin = await login(userUsername);
    assert(ordinaryLogin.status === 201 || ordinaryLogin.status === 200, `ordinary login failed with ${ordinaryLogin.status}`);
    assert(ordinaryLogin.cookie, 'ordinary login did not set a session cookie');
    assert(ordinaryLogin.json.user.role === 'user', `ordinary role should be user, got ${ordinaryLogin.json.user.role}`);
    assert(getPostLoginPath(ordinaryLogin.json.user) === '/account/profile', 'ordinary user post-login route is not account profile');
    checks.push('ordinary_user_login_uses_real_role_and_routes_to_user_console');

    const merchantLogin = await login(merchantUsername);
    assert(merchantLogin.status === 201 || merchantLogin.status === 200, `merchant login failed with ${merchantLogin.status}`);
    assert(merchantLogin.cookie, 'merchant login did not set a session cookie');
    assert(merchantLogin.json.user.role === 'admin', `merchant role should be admin, got ${merchantLogin.json.user.role}`);
    assert(getPostLoginPath(merchantLogin.json.user) === '/merchant', 'merchant post-login route is not merchant entry');
    checks.push('merchant_login_uses_real_admin_role_and_routes_to_merchant_entry');

    const noCookieMerchantEntry = await getMerchantEntry();
    assertRedirect(noCookieMerchantEntry, '/login', 'unauthenticated merchant entry');
    checks.push('merchant_entry_rejects_missing_session');

    const ordinaryMerchantEntry = await getMerchantEntry(ordinaryLogin.cookie);
    assertRedirect(ordinaryMerchantEntry, '/account/profile', 'ordinary user merchant entry');
    checks.push('merchant_entry_sends_ordinary_user_back_to_user_console');

    const merchantEntry = await followWebRedirectIfNeeded(await getMerchantEntry(merchantLogin.cookie), merchantLogin.cookie, 'merchant entry');
    assert(merchantEntry.status >= 200 && merchantEntry.status < 300, `merchant entry should render dashboard, got ${merchantEntry.status}`);
    const merchantEntryText = await merchantEntry.text();
    assertMerchantDashboardHtml(merchantEntryText);
    checks.push('merchant_entry_renders_real_dashboard_for_admin');

    const merchantUserSiteEntry = await getUserSiteEntry(merchantLogin.cookie);
    assertRedirect(merchantUserSiteEntry, '/merchant', 'merchant user-site entry');
    checks.push('merchant_account_is_redirected_away_from_user_site_entry');

    const ordinaryAdminUsers = await getApi('/admin/users?limit=1', ordinaryLogin.cookie);
    assert(ordinaryAdminUsers.status === 403, `ordinary user admin API should be 403, got ${ordinaryAdminUsers.status}`);
    const merchantAdminUsers = await getApi('/admin/users?limit=1', merchantLogin.cookie);
    assert(merchantAdminUsers.status === 200, `merchant admin API should be 200, got ${merchantAdminUsers.status}`);
    checks.push('admin_api_permissions_remain_server_enforced');

    const dbUsers = await prisma.user.findMany({
      where: { id: { in: userIds } },
      include: {
        wallet: true,
        sessions: true
      },
      orderBy: { username: 'asc' }
    });
    assert(dbUsers.length === 2, `expected two seeded users, got ${dbUsers.length}`);
    assert(dbUsers.every((entry) => entry.wallet), 'seeded users should have wallets');
    assert(dbUsers.every((entry) => entry.sessions.length > 0), 'login should create real session rows');
    assert(dbUsers.some((entry) => entry.role === UserRole.USER), 'missing ordinary USER role in database');
    assert(dbUsers.some((entry) => entry.role === UserRole.ADMIN), 'missing merchant ADMIN role in database');
    checks.push('database_roles_wallets_and_sessions_are_consistent');

    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          checks
        },
        null,
        2
      )
    );
  } finally {
    await cleanup(userIds);
    const residualAfterCleanup = await countResidual(usernamePrefix);
    console.log(JSON.stringify({ cleanup: true, suffix, residualAfterCleanup }, null, 2));
    await prisma.$disconnect();
  }
}

async function seedRealUsers({
  userUsername,
  merchantUsername
}: {
  userUsername: string;
  merchantUsername: string;
}) {
  const passwordHash = await bcrypt.hash(password, 12);

  return prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.upsert({
      where: { code: 'default' },
      update: {},
      create: {
        code: 'default',
        name: 'Default Group'
      }
    });

    const ordinaryUser = await tx.user.create({
      data: {
        username: userUsername,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `t22u-${randomBytes(4).toString('hex')}`
      }
    });

    const merchantUser = await tx.user.create({
      data: {
        username: merchantUsername,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `t22m-${randomBytes(4).toString('hex')}`
      }
    });

    await tx.wallet.createMany({
      data: [{ userId: ordinaryUser.id }, { userId: merchantUser.id }]
    });

    return {
      userId: ordinaryUser.id,
      merchantId: merchantUser.id
    };
  });
}

async function login(username: string) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password })
  });

  return {
    status: response.status,
    cookie: extractSessionCookie(response),
    json: (await response.json()) as LoginResponse
  };
}

async function getMerchantEntry(cookie?: string) {
  return fetch(`${WEB_BASE_URL}/merchant`, {
    headers: cookie ? { Cookie: cookie } : undefined,
    redirect: 'manual'
  });
}

async function getUserSiteEntry(cookie?: string) {
  return fetch(`${WEB_BASE_URL}/`, {
    headers: cookie ? { Cookie: cookie } : undefined,
    redirect: 'manual'
  });
}

async function followWebRedirectIfNeeded(response: Response, cookie: string, label: string) {
  if (response.status < 300 || response.status >= 400) {
    return response;
  }

  const location = response.headers.get('location') ?? '';
  assert(location.length > 0, `${label} redirect should include location`);
  assert(!location.endsWith('/login') && !location.endsWith('/account/profile'), `${label} redirected to wrong console: ${location}`);
  const nextUrl = location.startsWith('http') ? location : `${WEB_BASE_URL}${location}`;
  return fetch(nextUrl, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
}

async function getApi(path: string, cookie: string) {
  return fetch(`${API_BASE_URL}${path}`, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
}

function extractSessionCookie(response: Response) {
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

function assertRedirect(response: Response, expectedPath: string, label: string) {
  const location = response.headers.get('location') ?? '';
  assert(
    response.status >= 300 && response.status < 400,
    `${label} should redirect, got ${response.status}`
  );
  assert(
    location === expectedPath || location.endsWith(expectedPath),
    `${label} should redirect to ${expectedPath}, got ${location || '<empty>'}`
  );
}

function assertMerchantDashboardHtml(text: string) {
  const markers = ['merchant-shell-page', '商家工作台', '运营概览', '客户剩余额度', '最近告警'];
  const found = markers.filter((marker) => text.includes(marker)).length;
  assert(found >= 4, `merchant dashboard HTML missing expected markers, found ${found}`);
}

async function cleanup(userIds: string[]) {
  if (!userIds.length) {
    return;
  }

  await prisma.securityAuditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { targetId: { in: userIds } }
      ]
    }
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function countResidual(usernamePrefix: string) {
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main();
