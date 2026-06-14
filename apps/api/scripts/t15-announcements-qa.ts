import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { AnnouncementCategory, PrismaClient, UserRole } from '../src/generated/prisma/client';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  cookie?: string;
};

type PublicAnnouncementCategory = 'announcement' | 'update_log' | 'usage_guide';

type CreatedAnnouncementResponse = {
  id: string;
  title: string;
  content: string;
  category: PublicAnnouncementCategory;
  status: string;
  publishedAt: string | null;
  createdByAdminId?: string;
  createdAt: string;
};

type AdminAnnouncementListResponse = {
  items: Array<CreatedAnnouncementResponse & { createdBy?: string; updatedAt?: string }>;
};

type PublicAnnouncement = {
  id: string;
  title: string;
  content: string;
  category: PublicAnnouncementCategory;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PublicAnnouncementFeedResponse = {
  generatedAt: string;
  total: number;
  sections: Array<{
    key: PublicAnnouncementCategory;
    title: string;
    items: PublicAnnouncement[];
  }>;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T15 announcements QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const prefix = `qa_t15_${suffix}`;
const password = `qa-password-${suffix}`;
const checks: string[] = [];
const knownAnnouncementIds: string[] = [];

async function main() {
  let residualBeforeCleanup: Record<string, number> | null = null;

  try {
    const adminCookie = await register(`${prefix}_admin`);
    const userCookie = await register(`${prefix}_user`);
    const admin = await prisma.user.update({
      where: { username: `${prefix}_admin` },
      data: { role: UserRole.ADMIN }
    });

    const blocked = await post(
      '/admin/announcements',
      {
        title: `${prefix} blocked announcement`,
        content: 'ordinary user must not publish announcements',
        category: 'announcement',
        status: 'published'
      },
      userCookie
    );
    assert(blocked.status === 403, `ordinary user publish should be 403, got ${blocked.status}`);
    checks.push('admin_guard_blocks_ordinary_user_announcement_publish');

    const publishedAnnouncement = await createAnnouncement(adminCookie, {
      title: `${prefix} 平台公告`,
      content: '真实平台公告内容',
      category: 'announcement',
      status: 'published'
    });
    const publishedUpdate = await createAnnouncement(adminCookie, {
      title: `${prefix} 更新日志`,
      content: '真实更新日志内容',
      category: 'update_log',
      status: 'published'
    });
    const publishedGuide = await createAnnouncement(adminCookie, {
      title: `${prefix} 使用建议`,
      content: '真实使用建议内容',
      category: 'usage_guide',
      status: 'published'
    });
    const draftAnnouncement = await createAnnouncement(adminCookie, {
      title: `${prefix} 草稿公告`,
      content: '草稿不能出现在首页',
      category: 'announcement',
      status: 'draft'
    });
    const archivedAnnouncement = await createAnnouncement(adminCookie, {
      title: `${prefix} 归档公告`,
      content: '归档不能出现在首页',
      category: 'update_log',
      status: 'archived'
    });
    checks.push('admin_creates_real_announcement_categories_and_statuses');

    const dbAnnouncements = await prisma.announcement.findMany({
      where: { id: { in: knownAnnouncementIds } },
      orderBy: { createdAt: 'asc' }
    });
    assert(dbAnnouncements.length === 5, `expected 5 DB announcements, got ${dbAnnouncements.length}`);
    assert(dbAnnouncements.some((item) => item.category === AnnouncementCategory.UPDATE_LOG), 'update_log category was not stored');
    assert(dbAnnouncements.some((item) => item.category === AnnouncementCategory.USAGE_GUIDE), 'usage_guide category was not stored');
    checks.push('database_stores_real_announcement_categories');

    const adminList = await get<AdminAnnouncementListResponse>('/admin/announcements', adminCookie);
    assert(adminList.status === 200, `admin announcement list failed with ${adminList.status}`);
    const adminKnownItems = adminList.json.items.filter((item) => knownAnnouncementIds.includes(item.id));
    assert(adminKnownItems.length === 5, `admin list should include all created statuses, got ${adminKnownItems.length}`);
    assert(adminKnownItems.some((item) => item.status === 'draft'), 'admin list did not include draft announcement');
    assert(adminKnownItems.some((item) => item.status === 'archived'), 'admin list did not include archived announcement');
    checks.push('admin_list_keeps_full_operational_visibility');

    const publicFeed = await get<PublicAnnouncementFeedResponse>('/announcements');
    assert(publicFeed.status === 200, `public announcements failed with ${publicFeed.status}`);
    assertPublishedFeed(publicFeed.json, {
      visibleIds: [publishedAnnouncement.id, publishedUpdate.id, publishedGuide.id],
      hiddenIds: [draftAnnouncement.id, archivedAnnouncement.id]
    });
    checks.push('public_api_returns_only_published_real_announcements_by_category');

    const proxiedFeed = await requestFromBase<PublicAnnouncementFeedResponse>(WEB_BASE_URL, 'GET', '/api/announcements');
    assert(proxiedFeed.status === 200, `Next announcements proxy failed with ${proxiedFeed.status}`);
    assertPublishedFeed(proxiedFeed.json, {
      visibleIds: [publishedAnnouncement.id, publishedUpdate.id, publishedGuide.id],
      hiddenIds: [draftAnnouncement.id, archivedAnnouncement.id]
    });
    checks.push('next_proxy_returns_same_published_announcement_feed');

    const serializedPublicFeed = JSON.stringify(proxiedFeed.json);
    for (const forbidden of ['createdByAdminId', 'createdBy', admin.id, 'draft', 'archived']) {
      assert(!serializedPublicFeed.includes(forbidden), `public feed leaked forbidden field or value: ${forbidden}`);
    }
    checks.push('public_announcement_feed_uses_sensitive_field_allowlist');

    residualBeforeCleanup = await countResidual(prefix);
    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          checks,
          visibleTitles: [publishedAnnouncement.title, publishedUpdate.title, publishedGuide.title],
          residualBeforeCleanup
        },
        null,
        2
      )
    );
  } finally {
    await cleanup(prefix);
    const residualAfterCleanup = await countResidual(prefix);
    console.log(JSON.stringify({ cleanup: true, suffix, residualAfterCleanup }, null, 2));
    await prisma.$disconnect();
  }
}

async function createAnnouncement(
  adminCookie: string,
  payload: {
    title: string;
    content: string;
    category: PublicAnnouncementCategory;
    status: 'draft' | 'published' | 'archived';
  }
) {
  const result = await post<CreatedAnnouncementResponse>('/admin/announcements', payload, adminCookie);
  assert(result.status >= 200 && result.status < 300, `create announcement failed with ${result.status}`);
  assert(result.json.title === payload.title, 'created announcement title mismatch');
  assert(result.json.category === payload.category, 'created announcement category mismatch');
  assert(result.json.status === payload.status, 'created announcement status mismatch');
  if (payload.status === 'published') {
    assert(Boolean(result.json.publishedAt), 'published announcement missing publishedAt');
  }
  knownAnnouncementIds.push(result.json.id);
  return result.json;
}

function assertPublishedFeed(
  feed: PublicAnnouncementFeedResponse,
  input: { visibleIds: string[]; hiddenIds: string[] }
) {
  assert(typeof feed.generatedAt === 'string' && feed.generatedAt.length > 0, 'public feed missing generatedAt');
  const sections = new Map(feed.sections.map((section) => [section.key, section]));
  for (const category of ['announcement', 'update_log', 'usage_guide'] as const) {
    assert(sections.has(category), `public feed missing ${category} section`);
  }

  const visibleItems = feed.sections.flatMap((section) => section.items);
  const visibleIds = new Set(visibleItems.map((item) => item.id));
  for (const id of input.visibleIds) {
    assert(visibleIds.has(id), `public feed missing published announcement ${id}`);
  }
  for (const id of input.hiddenIds) {
    assert(!visibleIds.has(id), `public feed exposed non-published announcement ${id}`);
  }

  const knownVisibleItems = visibleItems.filter((item) => input.visibleIds.includes(item.id));
  assert(knownVisibleItems.length === input.visibleIds.length, 'public feed duplicated or missed created published items');
  for (const item of knownVisibleItems) {
    assert(Boolean(item.title), 'public item missing title');
    assert(Boolean(item.content), 'public item missing content');
    assert(Boolean(item.publishedAt), 'public published item missing publishedAt');
  }
}

async function register(username: string) {
  const result = await post<{ user: { id: string } }>('/auth/register', { username, password });
  assert(result.status >= 200 && result.status < 300, `register ${username} failed with ${result.status}`);
  assert(result.cookie, `register ${username} did not return a session cookie`);
  return result.cookie!;
}

async function get<T>(path: string, cookie?: string) {
  return requestFromBase<T>(API_BASE_URL, 'GET', path, undefined, cookie);
}

async function post<T = unknown>(path: string, body: unknown, cookie?: string) {
  return requestFromBase<T>(API_BASE_URL, 'POST', path, body, cookie);
}

async function requestFromBase<T>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  cookie?: string
): Promise<HttpResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      accept: 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  return {
    status: response.status,
    json,
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}

async function countResidual(prefixValue: string) {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefixValue } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  return {
    users: users.length,
    sessions: await prisma.session.count({ where: { userId: { in: userIds } } }),
    wallets: await prisma.wallet.count({ where: { userId: { in: userIds } } }),
    announcements: await prisma.announcement.count({
      where: {
        OR: [
          { id: { in: knownAnnouncementIds } },
          { title: { startsWith: prefixValue } },
          { createdByAdminId: { in: userIds } }
        ]
      }
    }),
    admin_audit_logs: await prisma.adminAuditLog.count({
      where: {
        OR: [
          { adminUserId: { in: userIds } },
          { targetId: { in: knownAnnouncementIds } }
        ]
      }
    })
  };
}

async function cleanup(prefixValue: string) {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefixValue } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminUserId: { in: userIds } },
        { targetId: { in: knownAnnouncementIds } }
      ]
    }
  });
  await prisma.announcement.deleteMany({
    where: {
      OR: [
        { id: { in: knownAnnouncementIds } },
        { title: { startsWith: prefixValue } },
        { createdByAdminId: { in: userIds } }
      ]
    }
  });
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
