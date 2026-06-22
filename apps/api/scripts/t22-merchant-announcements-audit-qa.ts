import { PrismaPg } from '@prisma/adapter-pg';
import { hash as bcryptHash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaClient, UserRole, UserStatus } from '../src/generated/prisma/client';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  text: string;
  cookie: string;
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
};

type LoginResponse = {
  user: {
    id: string;
    username: string;
    role: string;
    status: string;
  };
};

type AnnouncementResponse = {
  id: string;
  title: string;
  content: string;
  category: string;
  status: string;
  publishedAt: string | null;
};

type AnnouncementListResponse = {
  items: AnnouncementResponse[];
};

type PublicAnnouncementFeed = {
  total: number;
  sections: Array<{
    key: string;
    title: string;
    items: AnnouncementResponse[];
  }>;
};

type AuditListResponse = {
  items: Array<Record<string, unknown>>;
  total: number;
  page: number;
  limit: number;
};

type ResidualCounts = {
  users: number;
  wallets: number;
  sessions: number;
  announcements: number;
  adminAuditLogs: number;
  securityAuditLogs: number;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T22 merchant announcements/audit QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const usernamePrefix = `q22a_${suffix}`;
const password = `qa-password-${suffix}`;
const announcementIds: string[] = [];
const checks: string[] = [];

let checksError: unknown;
let residualBefore: ResidualCounts | null = null;
let residualAfter: ResidualCounts | null = null;

async function main() {
  let seeded: SeededContext | null = null;
  let merchantCookie = '';
  let userCookie = '';

  try {
    seeded = await seedFixture();
    checks.push('seeded_admin_and_user_accounts_with_wallets');

    const merchantLogin = await login(seeded.usernames.admin);
    assert(merchantLogin.status === 200 || merchantLogin.status === 201, `admin login failed with ${merchantLogin.status}`);
    assert(merchantLogin.cookie.length > 0, 'admin login should return session cookie');
    assert(merchantLogin.json.user.role.toLowerCase() === UserRole.ADMIN.toLowerCase(), 'admin login should return admin role');
    merchantCookie = merchantLogin.cookie;
    checks.push('merchant_login_uses_real_http_session');

    const userLogin = await login(seeded.usernames.user);
    assert(userLogin.status === 200 || userLogin.status === 201, `ordinary user login failed with ${userLogin.status}`);
    assert(userLogin.cookie.length > 0, 'ordinary user login should return session cookie');
    userCookie = userLogin.cookie;
    checks.push('ordinary_login_uses_real_http_session');

    await assertMerchantPageAccess('/merchant/announcements', merchantCookie, userCookie, [
      'merchant-shell-page',
      '公告与首页',
      '首页与弹窗公告',
      '发布公告',
      '公告记录'
    ]);
    await assertMerchantPageAccess('/merchant/audit', merchantCookie, userCookie, [
      'merchant-shell-page',
      '审计记录',
      '后台审计',
      '安全审计'
    ]);
    checks.push('merchant_pages_render_and_ordinary_user_is_redirected');

    const userCreateBlocked = await post('/admin/announcements', createAnnouncementPayload('blocked', 'published'), userCookie);
    assert(userCreateBlocked.status === 403, `ordinary user creating announcement should be 403, got ${userCreateBlocked.status}`);
    const userListBlocked = await get('/admin/announcements', userCookie);
    assert(userListBlocked.status === 403, `ordinary user reading admin announcements should be 403, got ${userListBlocked.status}`);
    const userAdminAuditBlocked = await get('/admin/audit-logs?limit=20', userCookie);
    assert(userAdminAuditBlocked.status === 403, `ordinary user reading admin audit should be 403, got ${userAdminAuditBlocked.status}`);
    const userSecurityAuditBlocked = await get('/admin/security-audit-logs?limit=20', userCookie);
    assert(
      userSecurityAuditBlocked.status === 403,
      `ordinary user reading security audit should be 403, got ${userSecurityAuditBlocked.status}`
    );
    checks.push('ordinary_user_is_forbidden_from_announcement_and_audit_admin_endpoints');

    const published = await createAnnouncementAsAdmin('published', merchantCookie);
    const draft = await createAnnouncementAsAdmin('draft', merchantCookie);
    const archived = await createAnnouncementAsAdmin('archived', merchantCookie);
    checks.push('merchant_creates_published_draft_and_archived_announcements');

    for (const item of [published, draft, archived]) {
      const stored = await prisma.announcement.findUniqueOrThrow({ where: { id: item.id } });
      assert(stored.createdByAdminId === seeded.userIds.admin, `announcement ${item.id} owner mismatch`);
      assert(stored.title === item.title, `announcement ${item.id} title mismatch`);
    }
    checks.push('announcements_are_persisted_in_database');

    const adminList = await get<AnnouncementListResponse>('/admin/announcements', merchantCookie);
    assert(adminList.status === 200, `admin announcement list failed with ${adminList.status}`);
    const listedStatuses = new Map(adminList.json.items.map((item) => [item.id, item.status]));
    assert(listedStatuses.get(published.id) === 'published', 'admin list should include published announcement');
    assert(listedStatuses.get(draft.id) === 'draft', 'admin list should include draft announcement');
    assert(listedStatuses.get(archived.id) === 'archived', 'admin list should include archived announcement');
    checks.push('merchant_announcement_list_includes_all_operational_statuses');

    const publicFeed = await get<PublicAnnouncementFeed>('/announcements');
    assert(publicFeed.status === 200, `public announcements failed with ${publicFeed.status}`);
    assertPublicFeedVisibility(publicFeed.json, published.title, draft.title, archived.title, 'backend public announcement feed');

    const webFeed = await getWeb<PublicAnnouncementFeed>('/api/announcements');
    assert(webFeed.status === 200, `web announcement proxy failed with ${webFeed.status}`);
    assertPublicFeedVisibility(webFeed.json, published.title, draft.title, archived.title, 'web public announcement feed');
    checks.push('public_feeds_show_only_published_real_announcements');

    const adminAudit = await get<AuditListResponse>('/admin/audit-logs?page=1&limit=100', merchantCookie);
    assert(adminAudit.status === 200, `admin audit logs failed with ${adminAudit.status}`);
    const seededAdminAuditItems = pickAdminAuditItems(adminAudit.json.items, seeded.userIds.admin, announcementIds);
    const adminAuditText = JSON.stringify(seededAdminAuditItems);
    assert(seededAdminAuditItems.length >= 3, 'admin audit should include seeded announcement audit entries');
    assert(adminAuditText.includes('announcement_created'), 'seeded admin audit entries should include announcement_created');
    assert(adminAudit.json.total >= 3, 'admin audit total should include created announcements');
    assertNoSensitiveText(adminAuditText, sensitiveMarkers(), 'admin audit response');

    const securityAudit = await get<AuditListResponse>('/admin/security-audit-logs?page=1&limit=100', merchantCookie);
    assert(securityAudit.status === 200, `security audit logs failed with ${securityAudit.status}`);
    const securityAuditText = JSON.stringify(securityAudit.json);
    assert(securityAudit.json.items.length > 0, 'security audit should include login records');
    assertNoSensitiveText(securityAuditText, sensitiveMarkers(), 'security audit response');
    checks.push('audit_logs_are_queryable_paginated_and_redacted');

    residualBefore = await countResidual();
    assert(residualBefore.users >= 2, `expected seeded users before cleanup, got ${residualBefore.users}`);
    assert(residualBefore.announcements >= 3, `expected seeded announcements before cleanup, got ${residualBefore.announcements}`);
    checks.push('residual_metrics_captured_before_cleanup');
  } catch (error) {
    checksError = error;
  } finally {
    if (seeded) {
      await cleanup(seeded.userIds.admin, seeded.userIds.user);
    } else {
      await cleanup();
    }
    residualAfter = await countResidual();
    await prisma.$disconnect();
  }

  assertResidualZero(residualAfter);
  const result = {
    ok: checksError === undefined,
    checks,
    usernamePrefix,
    residualBefore,
    residualAfter
  };
  console.log(JSON.stringify(result, null, 2));

  if (checksError !== undefined) {
    throw checksError;
  }
}

async function seedFixture(): Promise<SeededContext> {
  const adminUsername = `${usernamePrefix}_admin`;
  const userUsername = `${usernamePrefix}_user`;
  const passwordHash = await bcryptHash(password, 12);

  return prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.upsert({
      where: { code: 'default' },
      update: {},
      create: {
        code: 'default',
        name: '默认分组'
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

async function createAnnouncementAsAdmin(status: 'published' | 'draft' | 'archived', cookie: string) {
  const result = await post<AnnouncementResponse>('/admin/announcements', createAnnouncementPayload(status, status), cookie);
  assert(result.status === 200 || result.status === 201, `create ${status} announcement failed with ${result.status}`);
  assert(result.json.status === status, `created ${status} announcement returned status ${result.json.status}`);
  announcementIds.push(result.json.id);
  return result.json;
}

function createAnnouncementPayload(label: string, status: 'published' | 'draft' | 'archived') {
  return {
    title: `${usernamePrefix}_${label}_公告`,
    content: `${usernamePrefix}_${label}_真实公告内容`,
    category: 'announcement',
    status
  };
}

async function assertMerchantPageAccess(path: string, merchantCookie: string, userCookie: string, markers: string[]) {
  const noCookiePage = await getWebPage(path);
  assertRedirect(noCookiePage, '/login', `unauthenticated ${path}`);

  const ordinaryPage = await getWebPage(path, userCookie);
  assertRedirect(ordinaryPage, '/account/profile', `ordinary user ${path}`);

  const merchantPage = await getWebPage(path, merchantCookie);
  assert(merchantPage.status >= 200 && merchantPage.status < 300, `merchant ${path} should render, got ${merchantPage.status}`);
  const found = markers.filter((marker) => merchantPage.text.includes(marker)).length;
  assert(found >= markers.length - 1, `merchant ${path} missing expected markers, found ${found}`);
}

function assertPublicFeedVisibility(
  feed: PublicAnnouncementFeed,
  publishedTitle: string,
  draftTitle: string,
  archivedTitle: string,
  label: string
) {
  const text = JSON.stringify(feed);
  assert(text.includes(publishedTitle), `${label} should include published announcement`);
  assert(!text.includes(draftTitle), `${label} leaked draft announcement`);
  assert(!text.includes(archivedTitle), `${label} leaked archived announcement`);
  assert(!text.includes('"createdByAdminId"'), `${label} leaked createdByAdminId`);
  assert(!text.includes('"createdBy"'), `${label} leaked createdBy`);
}

function pickAdminAuditItems(items: AuditListResponse['items'], adminUserId: string, announcementIds: string[]) {
  return items.filter((entry) => {
    const item = entry as {
      action?: unknown;
      targetId?: unknown;
      admin?: { id?: unknown };
    };

    if (!item.admin || typeof item.admin.id !== 'string' || item.admin.id !== adminUserId) {
      return false;
    }

    if (item.action === 'announcement_created') {
      return true;
    }

    return typeof item.targetId === 'string' && announcementIds.includes(item.targetId);
  });
}

async function login(username: string) {
  return request<LoginResponse>('POST', '/auth/login', { username, password });
}

function get<T>(path: string, cookie?: string) {
  return request<T>('GET', path, undefined, cookie);
}

function post<T = unknown>(path: string, body: unknown, cookie?: string) {
  return request<T>('POST', path, body, cookie);
}

async function getWeb<T>(path: string, cookie?: string): Promise<HttpResult<T>> {
  const response = await fetch(`${WEB_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      ...(cookie ? { cookie } : {}),
      accept: 'application/json'
    }
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

async function getWebPage(path: string, cookie?: string) {
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

async function request<T>(method: string, path: string, body?: unknown, cookie?: string): Promise<HttpResult<T>> {
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

function extractSessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookieHeaders = headers.getSetCookie ? headers.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
  return cookieHeaders
    .filter(Boolean)
    .map((header) => header.split(';')[0])
    .join('; ');
}

function assertRedirect(response: { status: number; location: string }, expectedPath: string, label: string) {
  assert(response.status >= 300 && response.status < 400, `${label} should redirect, got ${response.status}`);
  assert(
    response.location === expectedPath || response.location.endsWith(expectedPath),
    `${label} should redirect to ${expectedPath}, got ${response.location || '<empty>'}`
  );
}

function sensitiveMarkers() {
  return [
    'password',
    'passwordHash',
    'tokenHash',
    'encryptedApiKey',
    'apiKey',
    'codeHash',
    'connectionString',
    'DATABASE_URL',
    'REDIS_URL',
    'postgresql://',
    'Bearer '
  ];
}

function assertNoSensitiveText(text: string, forbidden: string[], label: string) {
  const lowered = text.toLowerCase();
  for (const value of forbidden) {
    assert(!lowered.includes(value.toLowerCase()), `${label} leaked sensitive field/value: ${value}`);
  }
}

async function countResidual(): Promise<ResidualCounts> {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: usernamePrefix } },
    select: { id: true }
  });
  const userIds = users.map((entry) => entry.id);

  const base = {
    users: users.length,
    wallets: 0,
    sessions: 0,
    announcements: 0,
    adminAuditLogs: 0,
    securityAuditLogs: 0
  };

  if (userIds.length === 0 && announcementIds.length === 0) {
    return base;
  }

  const announcements = await prisma.announcement.count({
    where: {
      OR: [
        { id: { in: announcementIds } },
        { title: { startsWith: usernamePrefix } },
        { createdByAdminId: { in: userIds } }
      ]
    }
  });
  const wallets = userIds.length ? await prisma.wallet.count({ where: { userId: { in: userIds } } }) : 0;
  const sessions = userIds.length ? await prisma.session.count({ where: { userId: { in: userIds } } }) : 0;
  const adminAuditLogs = await prisma.adminAuditLog.count({
    where: {
      OR: [{ adminUserId: { in: userIds } }, { targetId: { in: announcementIds } }]
    }
  });
  const securityAuditLogs = await prisma.securityAuditLog.count({
    where: {
      OR: [{ actorUserId: { in: userIds } }, { targetId: { in: userIds } }]
    }
  });

  return {
    users: base.users,
    wallets,
    sessions,
    announcements,
    adminAuditLogs,
    securityAuditLogs
  };
}

async function cleanup(adminUserId = '', ordinaryUserId = '') {
  const userIds = [adminUserId, ordinaryUserId].filter(Boolean);

  if (!userIds.length && !announcementIds.length) {
    return;
  }

  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [{ adminUserId: { in: userIds } }, { targetId: { in: announcementIds } }]
    }
  });
  await prisma.securityAuditLog.deleteMany({
    where: {
      OR: [{ actorUserId: { in: userIds } }, { targetId: { in: userIds } }]
    }
  });
  await prisma.announcement.deleteMany({
    where: {
      OR: [
        { id: { in: announcementIds } },
        { title: { startsWith: usernamePrefix } },
        { createdByAdminId: { in: userIds } }
      ]
    }
  });
  await prisma.session.deleteMany({
    where: { userId: { in: userIds } }
  });
  await prisma.wallet.deleteMany({
    where: { userId: { in: userIds } }
  });
  await prisma.user.deleteMany({
    where: { id: { in: userIds } }
  });
}

function assertResidualZero(result: ResidualCounts | null) {
  if (!result) {
    return;
  }

  assert(result.users === 0, `residual users should be 0, got ${result.users}`);
  assert(result.wallets === 0, `residual wallets should be 0, got ${result.wallets}`);
  assert(result.sessions === 0, `residual sessions should be 0, got ${result.sessions}`);
  assert(result.announcements === 0, `residual announcements should be 0, got ${result.announcements}`);
  assert(result.adminAuditLogs === 0, `residual adminAuditLogs should be 0, got ${result.adminAuditLogs}`);
  assert(result.securityAuditLogs === 0, `residual securityAuditLogs should be 0, got ${result.securityAuditLogs}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main();
