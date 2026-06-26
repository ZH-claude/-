import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { AnnouncementCategory, PrismaClient, UserRole } from '../src/generated/prisma/client';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  cookie?: string;
};

type PublicAnnouncementCategory = 'announcement' | 'update_log' | 'usage_guide';

type AnnouncementScheduleMetadata = {
  scheduledAt?: string | null;
  scheduledPublishAt?: string | null;
  isPinned?: boolean;
  pinned?: boolean;
  pinOrder?: number | null;
};

type CreatedAnnouncementResponse = {
  id: string;
  title: string;
  content: string;
  category: PublicAnnouncementCategory;
  status: string;
  publishedAt: string | null;
  createdByAdminId?: string;
  createdAt: string;
} & AnnouncementScheduleMetadata;

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
} & AnnouncementScheduleMetadata;

type PublicAnnouncementFeedResponse = {
  generatedAt: string;
  total: number;
  sections: Array<{
    key: PublicAnnouncementCategory;
    title: string;
    items: PublicAnnouncement[];
  }>;
};

type AnnouncementCreatePayload = {
  title: string;
  content: string;
  category: PublicAnnouncementCategory;
  status: 'draft' | 'published' | 'archived';
  scheduledAt?: string | null;
  scheduledPublishAt?: string | null;
  isPinned?: boolean;
  pinned?: boolean;
  pinOrder?: number;
};

type AnnouncementUpdatePayload = {
  title?: string;
  content?: string;
  category?: PublicAnnouncementCategory;
  status?: 'draft' | 'published' | 'archived';
  scheduledAt?: string | null;
  scheduledPublishAt?: string | null;
  isPinned?: boolean;
  pinned?: boolean;
  pinOrder?: number;
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
      title: `${prefix} published announcement`,
      content: 'normal published announcement content',
      category: 'announcement',
      status: 'published'
    });
    const publishedUpdate = await createAnnouncement(adminCookie, {
      title: `${prefix} update log`,
      content: 'normal update-log content',
      category: 'update_log',
      status: 'published'
    });
    const publishedGuide = await createAnnouncement(adminCookie, {
      title: `${prefix} usage guide`,
      content: 'normal usage-guide content',
      category: 'usage_guide',
      status: 'published'
    });

    const scheduledPastRequestAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const scheduledFutureRequestAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const scheduleDraft = await createAnnouncement(adminCookie, {
      title: `${prefix} schedule draft`,
      content: 'will be scheduled by update',
      category: 'announcement',
      status: 'draft'
    });
    const scheduledPastAnnouncement = await updateAnnouncement(adminCookie, scheduleDraft.id, {
      status: 'published',
      title: scheduleDraft.title,
      content: scheduleDraft.content,
      category: scheduleDraft.category,
      scheduledAt: scheduledPastRequestAt,
      scheduledPublishAt: scheduledPastRequestAt
    });
    checks.push('admin_updates_announcement_with_optional_scheduled_publish_field');

    const scheduledFutureAnnouncement = await createAnnouncement(adminCookie, {
      title: `${prefix} scheduled future announcement`,
      content: 'will be hidden until future publish time',
      category: 'announcement',
      status: 'published',
      scheduledAt: scheduledFutureRequestAt,
      scheduledPublishAt: scheduledFutureRequestAt
    });
    checks.push('admin_creates_announcement_with_optional_scheduled_publish_field');

    const pinnedAnnouncement = await createAnnouncement(adminCookie, {
      title: `${prefix} pinned announcement`,
      content: 'should appear before non-pinned when visible',
      category: 'announcement',
      status: 'published',
      isPinned: true,
      pinned: true,
      pinOrder: 1
    });

    const draftAnnouncement = await createAnnouncement(adminCookie, {
      title: `${prefix} draft announcement`,
      content: 'should stay out of public feed',
      category: 'announcement',
      status: 'draft'
    });
    const archivedAnnouncement = await createAnnouncement(adminCookie, {
      title: `${prefix} archived announcement`,
      content: 'should stay out of public feed',
      category: 'update_log',
      status: 'archived'
    });
    checks.push('admin_creates_real_announcement_categories_and_statuses');

    const dbAnnouncements = await prisma.announcement.findMany({
      where: { id: { in: knownAnnouncementIds } },
      orderBy: { createdAt: 'asc' }
    });
    assert(dbAnnouncements.length === 8, `expected 8 DB announcements, got ${dbAnnouncements.length}`);
    assert(dbAnnouncements.some((item) => item.category === AnnouncementCategory.UPDATE_LOG), 'update_log category was not stored');
    assert(dbAnnouncements.some((item) => item.category === AnnouncementCategory.USAGE_GUIDE), 'usage_guide category was not stored');
    checks.push('database_stores_real_announcement_categories');

    const adminList = await get<AdminAnnouncementListResponse>('/admin/announcements', adminCookie);
    assert(adminList.status === 200, `admin announcement list failed with ${adminList.status}`);
    const adminKnownItems = adminList.json.items.filter((item) => knownAnnouncementIds.includes(item.id));
    assert(adminKnownItems.length === 8, `admin list should include all created statuses, got ${adminKnownItems.length}`);
    assert(adminKnownItems.some((item) => item.status === 'draft'), 'admin list did not include draft announcement');
    assert(adminKnownItems.some((item) => item.status === 'archived'), 'admin list did not include archived announcement');
    checks.push('admin_list_keeps_full_operational_visibility');

    const adminKnownById = new Map(adminKnownItems.map((item) => [item.id, item]));
    const scheduledPastAt = extractScheduledAt(adminKnownById.get(scheduledPastAnnouncement.id));
    const scheduledFutureAt = extractScheduledAt(adminKnownById.get(scheduledFutureAnnouncement.id));
    assert(scheduledPastAt !== undefined && scheduledPastAt.length > 0, 'admin list should preserve scheduled past publish metadata');
    assert(scheduledFutureAt !== undefined && scheduledFutureAt.length > 0, 'admin list should preserve scheduled future publish metadata');
    const requestedPastMs = new Date(scheduledPastRequestAt).getTime();
    const requestedFutureMs = new Date(scheduledFutureRequestAt).getTime();
    assert(Math.abs(new Date(scheduledPastAt).getTime() - requestedPastMs) < 60_000, 'scheduled past timestamp changed');
    assert(Math.abs(new Date(scheduledFutureAt).getTime() - requestedFutureMs) < 60_000, 'scheduled future timestamp changed');
    checks.push('admin_list_preserves_scheduled_publish_metadata');

    assert(
      getPinnedMetadata(adminKnownById.get(pinnedAnnouncement.id)) === true,
      'admin list should preserve pinned announcement metadata'
    );
    checks.push('admin_list_preserves_pinned_metadata');

    const publicFeed = await get<PublicAnnouncementFeedResponse>('/announcements');
    assert(publicFeed.status === 200, `public announcements failed with ${publicFeed.status}`);
    const publicVisibleIds = [
      pinnedAnnouncement.id,
      publishedAnnouncement.id,
      publishedUpdate.id,
      publishedGuide.id,
      scheduledPastAnnouncement.id
    ];
    const publicHiddenIds = [draftAnnouncement.id, archivedAnnouncement.id, scheduledFutureAnnouncement.id];
    assertPublishedFeed(publicFeed.json, {
      visibleIds: publicVisibleIds,
      hiddenIds: publicHiddenIds
    });
    checks.push('public_api_returns_only_published_real_announcements_by_category');
    assertPinnedItemsAppearBeforeUnpinned(publicFeed.json, publicVisibleIds, [pinnedAnnouncement.id]);
    checks.push('public_feed_places_pinned_before_non_pinned');

    const proxiedFeed = await requestFromBase<PublicAnnouncementFeedResponse>(WEB_BASE_URL, 'GET', '/api/announcements');
    assert(proxiedFeed.status === 200, `Next announcements proxy failed with ${proxiedFeed.status}`);
    assertPublishedFeed(proxiedFeed.json, {
      visibleIds: publicVisibleIds,
      hiddenIds: publicHiddenIds
    });
    checks.push('next_proxy_returns_same_published_announcement_feed');
    assertPinnedItemsAppearBeforeUnpinned(proxiedFeed.json, publicVisibleIds, [pinnedAnnouncement.id]);
    checks.push('next_proxy_announcements_feed_places_pinned_before_non_pinned');

    const serializedPublicFeed = JSON.stringify(proxiedFeed.json);
    for (const item of proxiedFeed.json.sections.flatMap((section) => section.items)) {
      assert(!('translations' in item), 'public feed should not expose internal translations metadata');
      assert(!('status' in item), 'public feed should not expose operational status metadata');
      assert(!('scheduledAt' in item), 'public feed should not expose internal scheduled publish metadata');
      assert(!('scheduledPublishAt' in item), 'public feed should not expose internal scheduled publish aliases');
      assert(!('isPinned' in item), 'public feed should not expose internal pinned metadata');
      assert(!('pinned' in item), 'public feed should not expose internal pinned aliases');
      if (item.id === scheduledFutureAnnouncement.id) {
        assert(!getScheduleVisibilityState(item), 'scheduled future announcement should not be visible');
      }
      if (item.id === scheduledPastAnnouncement.id) {
        assert(getScheduleVisibilityState(item), 'scheduled past announcement should be visible');
      }
    }
    for (const forbidden of ['createdByAdminId', 'createdBy', admin.id]) {
      assert(!serializedPublicFeed.includes(forbidden), `public feed leaked forbidden field or value: ${forbidden}`);
    }
    checks.push('public_announcement_feed_uses_sensitive_field_allowlist');
    checks.push('published_scheduled_announcements_respect_publish_window');

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

async function createAnnouncement(adminCookie: string, payload: AnnouncementCreatePayload) {
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

async function updateAnnouncement(adminCookie: string, announcementId: string, payload: AnnouncementUpdatePayload) {
  const result = await post<CreatedAnnouncementResponse>(
    `/admin/announcements/${announcementId}/update`,
    payload,
    adminCookie
  );
  assert(result.status >= 200 && result.status < 300, `update announcement failed with ${result.status}`);
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

function extractScheduledAt(item?: { scheduledAt?: unknown; scheduledPublishAt?: unknown }) {
  if (typeof item?.scheduledPublishAt === 'string' && item.scheduledPublishAt.length > 0) {
    return item.scheduledPublishAt;
  }
  if (typeof item?.scheduledAt === 'string' && item.scheduledAt.length > 0) {
    return item.scheduledAt;
  }
  return undefined;
}

function getPinnedMetadata(item?: { isPinned?: unknown; pinned?: unknown }) {
  if (typeof item?.isPinned === 'boolean') {
    return item.isPinned;
  }
  if (typeof item?.pinned === 'boolean') {
    return item.pinned;
  }
  return undefined;
}

function assertPinnedItemsAppearBeforeUnpinned(
  feed: PublicAnnouncementFeedResponse,
  visibleIds: string[],
  pinnedIds: string[]
) {
  const visibleIdSet = new Set(visibleIds);
  const pinnedIdSet = new Set(pinnedIds);

  for (const section of feed.sections) {
    const sectionItems = section.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => visibleIdSet.has(item.id));
    if (sectionItems.length <= 1) {
      continue;
    }

    const pinnedIndexes = sectionItems
      .filter(({ item }) => pinnedIdSet.has(item.id))
      .map(({ index }) => index);
    const unpinnedIndexes = sectionItems
      .filter(({ item }) => !pinnedIdSet.has(item.id))
      .map(({ index }) => index);

    if (pinnedIndexes.length === 0 || unpinnedIndexes.length === 0) {
      continue;
    }

    const maxPinnedIndex = Math.max(...pinnedIndexes);
    const minUnpinnedIndex = Math.min(...unpinnedIndexes);
    assert(
      maxPinnedIndex < minUnpinnedIndex,
      `section ${section.key} should keep pinned announcement before non-pinned announcements`
    );
  }
}

function getScheduleVisibilityState(item?: { scheduledAt?: unknown; scheduledPublishAt?: unknown }) {
  const scheduleValue = extractScheduledAt(item);
  if (!scheduleValue) {
    return true;
  }
  return new Date(scheduleValue).getTime() <= Date.now();
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
