import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaClient, UserRole, UserStatus } from '../src/generated/prisma/client';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  text: string;
  headers: Headers;
  cookie: string;
};

type LoginResponse = {
  user: {
    id: string;
    username: string;
    role: string;
  };
};

type AdminUsersResponse = {
  items: Array<{
    id: string;
    username: string;
    role: string;
    status: string;
    timezone: string;
    group: {
      id: string;
      code: string;
      name: string;
    };
    wallet: {
      balanceCents: number;
      totalSpendCents: number;
    };
    lastLoginAt: string | null;
    createdAt: string;
  }>;
  total: number;
  page: number;
  limit: number;
};

type AdminGroupsResponse = {
  items: Array<{
    id: string;
    code: string;
    name: string;
    multiplier: string;
    status: string;
    userCount: number;
    modelAccessCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
};

type SeededContext = {
  usernames: {
    admin: string;
    user: string;
  };
  userIds: {
    admin: string;
    user: string;
  };
  groups: {
    primaryId: string;
    secondaryId: string;
  };
};

type Residual = {
  users: number;
  wallets: number;
  sessions: number;
  apiTokens: number;
  adminAuditLogs: number;
  securityAuditLogs: number;
  userGroups: number;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T22 merchant users QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
const prefix = `q22_m04_${suffix}`;
const password = `qa-password-${suffix}`;
const checks: string[] = [];
const groupAName = `${prefix}_group_a`;
const groupBName = `${prefix}_group_b`;

let checksError: unknown;
let residualBefore: Residual | null = null;
let residualAfter: Residual | null = null;

async function main() {
  let seeded: SeededContext;

  try {
    seeded = await seedFixture();
    checks.push('seeded_temporary_admin_user_and_user_with_two_groups_and_wallets');

    const adminLogin = await login(seeded.usernames.admin);
    assert(adminLogin.status >= 200 && adminLogin.status < 300, `admin login failed with ${adminLogin.status}`);
    assert(adminLogin.cookie.length > 0, 'admin login did not return session cookie');
    checks.push('admin_login_returned_real_session_cookie');

    const userLogin = await login(seeded.usernames.user);
    assert(userLogin.status >= 200 && userLogin.status < 300, `user login failed with ${userLogin.status}`);
    assert(userLogin.cookie.length > 0, 'user login did not return session cookie');
    checks.push('ordinary_user_login_returned_real_session_cookie');

    const listByAdmin = await getAdminUsers(adminLogin.cookie);
    assert(listByAdmin.status === 200, `admin /admin/users should return 200, got ${listByAdmin.status}`);
    const adminList = toAdminUsersResponse(listByAdmin.json);
    assert(adminList.items.length >= 2, `admin users list should include created users, got ${adminList.items.length}`);
    assertNoSensitiveLeak(listByAdmin.text, 'admin /admin/users list response');
    checks.push('admin_can_read_admin_users_and_response_is_not_sensitive');

    const noCookieMerchantUsersPage = await getMerchantUsersPage();
    assertRedirect(noCookieMerchantUsersPage, '/login', 'unauthenticated /merchant/users page');
    checks.push('merchant_users_page_rejects_missing_session');

    const adminMerchantUsersPage = await getMerchantUsersPage(adminLogin.cookie);
    assert(
      adminMerchantUsersPage.status >= 200 && adminMerchantUsersPage.status < 300,
      `admin /merchant/users page should render, got ${adminMerchantUsersPage.status}`
    );
    assertMerchantUsersHtml(adminMerchantUsersPage.text);
    checks.push('admin_can_render_merchant_users_page');

    const groupsByAdmin = await getAdminGroups(adminLogin.cookie);
    assert(groupsByAdmin.status === 200, `admin /admin/groups should return 200, got ${groupsByAdmin.status}`);
    assertNoSensitiveLeak(groupsByAdmin.text, 'admin /admin/groups list response');
    const adminGroups = toAdminGroupsResponse(groupsByAdmin.json);
    assert(
      adminGroups.items.some((entry) => entry.id === seeded.groups.primaryId),
      'primary QA group missing from /admin/groups'
    );
    assert(
      adminGroups.items.some((entry) => entry.id === seeded.groups.secondaryId),
      'secondary QA group missing from /admin/groups'
    );
    checks.push('admin_can_read_real_user_groups_without_sensitive_fields');

    const listedAdmin = adminList.items.find((entry) => entry.id === seeded.userIds.admin);
    const listedUser = adminList.items.find((entry) => entry.id === seeded.userIds.user);
    assert(listedAdmin !== undefined, 'admin account missing from /admin/users');
    assert(listedUser !== undefined, 'ordinary user account missing from /admin/users');
    assert(listedUser.group.id === seeded.groups.primaryId, 'seeded user should start in primary group');
    checks.push('admin_users_list_contains_both_users_with_expected_initial_group');

    const ordinaryList = await getAdminUsers(userLogin.cookie);
    assert(ordinaryList.status === 403, `ordinary user should get 403 from /admin/users, got ${ordinaryList.status}`);
    checks.push('ordinary_user_cannot_access_admin_users');

    const ordinaryMerchantUsersPage = await getMerchantUsersPage(userLogin.cookie);
    assertRedirect(ordinaryMerchantUsersPage, '/account/profile', 'ordinary user /merchant/users page');
    checks.push('ordinary_user_cannot_render_merchant_users_page');

    const ordinaryGroups = await getAdminGroups(userLogin.cookie);
    assert(ordinaryGroups.status === 403, `ordinary user should get 403 from /admin/groups, got ${ordinaryGroups.status}`);
    checks.push('ordinary_user_cannot_access_admin_groups');

    const ordinaryAssign = await assignUserGroup(seeded.userIds.user, seeded.groups.secondaryId, userLogin.cookie);
    assert(
      ordinaryAssign.status === 401 || ordinaryAssign.status === 403,
      `ordinary user should not be able to call /admin/users/:id/group, got ${ordinaryAssign.status}`
    );
    checks.push('ordinary_user_cannot_mutate_user_group');

    const assigned = await assignUserGroup(seeded.userIds.user, seeded.groups.secondaryId, adminLogin.cookie);
    assert(
      assigned.status >= 200 && assigned.status < 300,
      `admin /admin/users/:id/group should return 2xx, got ${assigned.status}`
    );
    assertNoSensitiveLeak(assigned.text, 'admin /admin/users/:id/group response');
    const assignedUser = toAssignedUser(assigned.json);
    assert(assignedUser.id === seeded.userIds.user, `admin assignment returned wrong user: ${assignedUser.id}`);
    assert(assignedUser.group.id === seeded.groups.secondaryId, 'user should be assigned to secondary group');
    checks.push('admin_can_assign_user_group_via_api');

    const refreshedList = await getAdminUsers(adminLogin.cookie);
    assert(refreshedList.status === 200, `admin /admin/users second read should be 200, got ${refreshedList.status}`);
    const refreshed = toAdminUsersResponse(refreshedList.json);
    const refreshedUser = refreshed.items.find((entry) => entry.id === seeded.userIds.user);
    assert(
      refreshedUser?.group.id === seeded.groups.secondaryId,
      'persisted group assignment was not visible in a fresh /admin/users response'
    );
    checks.push('admin_users_refetch_reflects_persisted_group_change');

    const persisted = await prisma.user.findUnique({
      where: { id: seeded.userIds.user },
      include: {
        group: true,
        wallet: true,
        sessions: true
      }
    });
    assert(persisted !== null, 'seeded user should exist in database after assignment');
    assert(persisted.groupId === seeded.groups.secondaryId, 'database did not persist user groupId change');
    assert(!!persisted.wallet, 'seeded user should still have wallet in DB');
    assert(persisted.sessions.length > 0, 'seeded user should have at least one session in DB');
    checks.push('group_change_persists_in_database');

    const allSeededUsers = await prisma.user.findMany({
      where: { id: { in: [seeded.userIds.admin, seeded.userIds.user] } },
      include: {
        wallet: true,
        sessions: true
      }
    });
    assert(allSeededUsers.length === 2, `expected two seeded users in DB, got ${allSeededUsers.length}`);
    assert(allSeededUsers.every((entry) => entry.wallet !== null), 'seeded users should all have wallet records');
    assert(allSeededUsers.every((entry) => entry.sessions.length > 0), 'seeded users should all have session records');
    checks.push('temporary_users_have_wallets_and_sessions_after_real_logins');

    residualBefore = await countResidual();
    checks.push('residual_counts_captured_before_cleanup');

    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          checks,
          residualBefore
        },
        null,
        2
      )
    );
  } catch (error) {
    checksError = error;
  } finally {
    await cleanup();
    residualAfter = await countResidual();
    await prisma.$disconnect();

    if (residualBefore || residualAfter) {
      console.log(JSON.stringify({ residualAfter }, null, 2));
    }
  }

  const finalResult = {
    ok: checksError === undefined,
    suffix,
    checks,
    residualBefore,
    residualAfter
  };

  console.log(JSON.stringify(finalResult, null, 2));

  if (checksError) {
    throw checksError;
  }
}

async function seedFixture(): Promise<SeededContext> {
  const passwordHash = await bcrypt.hash(password, 12);
  const adminUsername = `${prefix}_admin`;
  const ordinaryUsername = `${prefix}_user`;

  const seed = await prisma.$transaction(async (tx) => {
    const primaryGroup = await tx.userGroup.create({
      data: {
        code: groupAName,
        name: 'QA Merchant Users Primary Group',
        multiplier: '1.0000'
      }
    });
    const secondaryGroup = await tx.userGroup.create({
      data: {
        code: groupBName,
        name: 'QA Merchant Users Secondary Group',
        multiplier: '1.0000'
      }
    });

    const admin = await tx.user.create({
      data: {
        username: adminUsername,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        groupId: primaryGroup.id,
        inviteCode: `m04_admin_${suffix}`
      }
    });

    const user = await tx.user.create({
      data: {
        username: ordinaryUsername,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        groupId: primaryGroup.id,
        inviteCode: `m04_user_${suffix}`
      }
    });

    await tx.wallet.createMany({
      data: [{ userId: admin.id }, { userId: user.id }]
    });

    return {
      usernames: {
        admin: adminUsername,
        user: ordinaryUsername
      },
      userIds: {
        admin: admin.id,
        user: user.id
      },
      groups: {
        primaryId: primaryGroup.id,
        secondaryId: secondaryGroup.id
      }
    } satisfies SeededContext;
  });

  return seed;
}

async function login(username: string): Promise<HttpResult<LoginResponse>> {
  return request<LoginResponse>(
    'POST',
    '/auth/login',
    {
      username,
      password
    },
    undefined,
    { accept: 'application/json' }
  );
}

function getAdminUsers(cookie: string): Promise<HttpResult<AdminUsersResponse>> {
  return request<AdminUsersResponse>('GET', '/admin/users?limit=100', undefined, cookie, { accept: 'application/json' });
}

function getAdminGroups(cookie: string): Promise<HttpResult<AdminGroupsResponse>> {
  return request<AdminGroupsResponse>('GET', '/admin/groups', undefined, cookie, { accept: 'application/json' });
}

async function getMerchantUsersPage(cookie?: string) {
  const response = await fetch(`${WEB_BASE_URL}/merchant/users`, {
    headers: cookie ? { Cookie: cookie } : undefined,
    redirect: 'manual'
  });

  return {
    status: response.status,
    text: await response.text(),
    location: response.headers.get('location') ?? ''
  };
}

async function assignUserGroup(userId: string, groupId: string, cookie: string): Promise<HttpResult<unknown>> {
  return request('POST', `/admin/users/${userId}/group`, { groupId }, cookie, { accept: 'application/json' });
}

function toAdminUsersResponse(json: unknown): AdminUsersResponse {
  assert(typeof json === 'object' && json !== null && 'items' in json, 'admin users response shape is invalid');
  const response = json as AdminUsersResponse;
  assert(Array.isArray(response.items), 'admin users response.items is not an array');
  assert(typeof response.total === 'number', 'admin users response.total is not a number');
  return response;
}

function toAssignedUser(json: unknown): AdminUsersResponse['items'][number] {
  assert(typeof json === 'object' && json !== null, 'admin assign user response is not an object');
  const user = json as AdminUsersResponse['items'][number];
  assert(typeof user.id === 'string', 'assigned response id is missing');
  assert(typeof user.group?.id === 'string', 'assigned response group id is missing');
  return user;
}

function assertRedirect(
  response: { status: number; location: string },
  expectedPath: string,
  label: string
) {
  assert(response.status >= 300 && response.status < 400, `${label} should redirect, got ${response.status}`);
  assert(
    response.location === expectedPath || response.location.endsWith(expectedPath),
    `${label} should redirect to ${expectedPath}, got ${response.location || '<empty>'}`
  );
}

function assertMerchantUsersHtml(text: string) {
  const markers = ['merchant-shell-page', '用户管理', '用户列表', '客户额度'];
  const found = markers.filter((marker) => text.includes(marker)).length;
  assert(found >= 3, `merchant users page missing expected markers, found ${found}`);
}

function toAdminGroupsResponse(json: unknown): AdminGroupsResponse {
  assert(typeof json === 'object' && json !== null && 'items' in json, 'admin groups response shape is invalid');
  const response = json as AdminGroupsResponse;
  assert(Array.isArray(response.items), 'admin groups response.items is not an array');
  return response;
}

function assertNoSensitiveLeak(serialized: string, label: string) {
  const text = serialized.toLowerCase();
  const forbidden = [
    'passwordhash',
    'tokenhash',
    'encryptedapikey',
    'codehash',
    'session token',
    'sessiontoken',
    'api token hash',
    'connection string',
    'postgres://',
    'postgresql://',
    'mysql://',
    'redis://'
  ];

  for (const value of forbidden) {
    assert(!text.includes(value), `${label} leaked sensitive text: ${value}`);
  }
}

async function countResidual(): Promise<Residual> {
  const users = await prisma.user.findMany({
    where: {
      username: {
        startsWith: prefix
      }
    },
    select: {
      id: true
    }
  });
  const userIds = users.map((entry) => entry.id);

  const tokenIds =
    userIds.length === 0
      ? []
      : await prisma.apiToken.findMany({
          where: { userId: { in: userIds } },
          select: { id: true }
        });
  const tokenIdList = tokenIds.map((token) => token.id);

  return {
    users: users.length,
    wallets: userIds.length === 0 ? 0 : await prisma.wallet.count({ where: { userId: { in: userIds } } }),
    sessions: userIds.length === 0 ? 0 : await prisma.session.count({ where: { userId: { in: userIds } } }),
    apiTokens: tokenIdList.length === 0 ? 0 : await prisma.apiToken.count({ where: { id: { in: tokenIdList } } }),
    adminAuditLogs: userIds.length === 0 ? 0 : await prisma.adminAuditLog.count({
      where: {
        OR: [{ adminUserId: { in: userIds } }, { targetId: { in: userIds } }]
      }
    }),
    securityAuditLogs: userIds.length === 0 ? 0 : await prisma.securityAuditLog.count({
      where: {
        OR: [{ actorUserId: { in: userIds } }, { targetId: { in: userIds } }]
      }
    }),
    userGroups: await prisma.userGroup.count({ where: { OR: [{ code: groupAName }, { code: groupBName }] } })
  };
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((entry) => entry.id);
  const tokenIds = userIds.length
    ? await prisma.apiToken.findMany({
        where: { userId: { in: userIds } },
        select: { id: true }
      })
    : [];

  if (userIds.length > 0) {
    await prisma.securityAuditLog.deleteMany({
      where: {
        OR: [{ actorUserId: { in: userIds } }, { targetId: { in: userIds } }]
      }
    });

    await prisma.adminAuditLog.deleteMany({
      where: {
        OR: [{ adminUserId: { in: userIds } }, { targetId: { in: userIds } }]
      }
    });
  }

  if (tokenIds.length > 0) {
    const tokenIdList = tokenIds.map((token) => token.id);
    await prisma.apiTokenModelAccess.deleteMany({ where: { apiTokenId: { in: tokenIdList } } });
    await prisma.apiToken.deleteMany({ where: { id: { in: tokenIdList } } });
  }

  if (userIds.length > 0) {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.userGroup.deleteMany({ where: { OR: [{ code: groupAName }, { code: groupBName }] } });
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
  extraHeaders?: Record<string, string>
): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...(extraHeaders ?? {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let json = {} as T;

  if (text.length > 0) {
    try {
      json = JSON.parse(text) as T;
    } catch (error) {
      json = {} as T;
    }
  }

  return {
    status: response.status,
    json,
    text,
    headers: response.headers,
    cookie: extractCookie(response)
  };
}

function extractCookie(response: Response) {
  const headerAccessor = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookieHeaders = headerAccessor.getSetCookie ? headerAccessor.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
  return cookieHeaders.filter(Boolean).map((entry) => entry.split(';')[0]).join('; ');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main();
