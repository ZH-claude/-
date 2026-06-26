import { PrismaPg } from '@prisma/adapter-pg';
import { hash as bcryptHash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { AnnouncementCategory, AnnouncementStatus, PrismaClient, UserRole, UserStatus } from '../src/generated/prisma/client';

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
  translations?: Record<string, Record<string, string | boolean>> | null;
  translationWorkflow?: {
    languages: string[];
    counts: {
      total: number;
      machineDraft: number;
      humanReviewed: number;
      manualLocked: number;
      locked: number;
      untranslated: number;
    };
    entries: Array<{
      language: string;
      status: string;
      locked: boolean;
      source: string | null;
      hasTitle: boolean;
      hasContent: boolean;
      updatedAt: string | null;
    }>;
  } | null;
};

type AnnouncementCategoryInput = 'announcement' | 'update_log' | 'usage_guide';

type AnnouncementListResponse = {
  items: AnnouncementResponse[];
};

type PrepareAnnouncementTranslationsResponse = AnnouncementResponse & {
  preparedTranslationLanguages: string[];
  translationErrors: string[];
  changed: boolean;
};

type AnnouncementPreviewResponse = {
  id: string;
  language: string;
  title: string;
  content: string;
  fallback: boolean;
  category: string;
  translation: {
    language: string | null;
    status: string;
    locked: boolean;
    source: string | null;
    hasTitle: boolean;
    hasContent: boolean;
    updatedAt: string | null;
  };
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
      '公告记录',
      '公告已保存档案'
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
    const barePublished = await createBarePublishedAnnouncement(seeded.userIds.admin);
    const updateLog = await createAnnouncementAsAdmin('published', merchantCookie, 'update_log', 'update_log');
    const usageGuide = await createAnnouncementAsAdmin('published', merchantCookie, 'usage_guide', 'usage_guide');
    checks.push('merchant_creates_published_draft_and_archived_announcements');

    const merchantPageAfterCreate = await getWebPage('/merchant/announcements', merchantCookie);
    assert(
      merchantPageAfterCreate.status >= 200 && merchantPageAfterCreate.status < 300,
      `merchant announcements page after create should render, got ${merchantPageAfterCreate.status}`
    );
    for (const marker of ['公告已保存档案']) {
      assert(merchantPageAfterCreate.text.includes(marker), `merchant announcements archive page missing marker: ${marker}`);
    }
    checks.push('merchant_announcements_page_exposes_saved_archive_panel');
    const selectedArchivedPage = await getWebPage(
      `/merchant/announcements?selected=${encodeURIComponent(archived.id)}&saved=announcement`,
      merchantCookie
    );
    assert(selectedArchivedPage.status >= 200 && selectedArchivedPage.status < 300, 'selected archived announcement should render');
    assert(selectedArchivedPage.text.includes('data-announcement-draft-status'), 'merchant announcement page should expose draft marker');
    assert(selectedArchivedPage.text.includes('merchant-announcement-saved'), 'merchant announcement page should expose saved archive anchor');
    assert(selectedArchivedPage.text.includes('data-announcement-workflow-panel'), 'merchant announcement page should expose workflow panel');
    assert(
      selectedArchivedPage.text.includes('data-announcement-workflow-status-filter'),
      'merchant announcement page should expose workflow status filter'
    );
    assert(
      selectedArchivedPage.text.includes('data-announcement-workflow-category-filter'),
      'merchant announcement page should expose workflow category filter'
    );
    assert(
      selectedArchivedPage.text.includes('data-announcement-workflow-machine-draft-count'),
      'merchant announcement page should expose workflow machine draft count'
    );
    checks.push('merchant_announcements_page_exposes_selected_url_shell_and_draft_marker');

    for (const item of [published, draft, archived, barePublished, updateLog, usageGuide]) {
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
    const publishedListing = adminList.json.items.find((item) => item.id === published.id);
    assert(publishedListing, `admin list should include published announcement row ${published.id}`);
    assert(Boolean(publishedListing.translationWorkflow), 'admin list should expose translation workflow summary');
    assert(publishedListing.translationWorkflow?.languages.includes('en-US'), 'admin list should expose en-US workflow language');
    assert(publishedListing.translationWorkflow?.languages.includes('ja-JP'), 'admin list should expose ja-JP workflow language');
    assert(
      publishedListing.translationWorkflow?.counts.machineDraft >= 1,
      'admin list should report machine draft workflow count for published announcement'
    );
    assert(
      publishedListing.translationWorkflow?.counts.humanReviewed >= 1,
      'admin list should report human reviewed workflow count for published announcement'
    );
    assert(
      publishedListing.translationWorkflow?.counts.locked >= 1,
      'admin list should report locked translation workflow count for published announcement'
    );
    assert(publishedListing.translationWorkflow?.counts.total >= 2, 'admin list should report expected workflow entry count');
    const enWorkflowEntry = publishedListing.translationWorkflow?.entries.find((entry) => entry.language === 'en-US');
    const jaWorkflowEntry = publishedListing.translationWorkflow?.entries.find((entry) => entry.language === 'ja-JP');
    assert(enWorkflowEntry?.status === 'human_reviewed', 'published announcement should expose en-US human reviewed status');
    assert(jaWorkflowEntry?.status === 'machine_draft', 'published announcement should expose ja-JP machine draft status');
    assert(enWorkflowEntry?.locked === true, 'published announcement should expose en-US locked workflow flag');
    assert(jaWorkflowEntry?.locked === false, 'published announcement should expose ja-JP unlocked workflow flag');
    assert(enWorkflowEntry?.source === 'qa-manual', 'published announcement should expose en-US manual translation source');
    assert(jaWorkflowEntry?.source === 'qa-draft', 'published announcement should expose ja-JP machine draft source');
    checks.push('merchant_announcement_list_includes_operational_statuses_sources_and_workflow_summary');

    const updateLogListing = adminList.json.items.find((item) => item.id === updateLog.id);
    const usageGuideListing = adminList.json.items.find((item) => item.id === usageGuide.id);
    assertContentWorkflowCategory(updateLogListing, 'update_log', 'update log');
    assertContentWorkflowCategory(usageGuideListing, 'usage_guide', 'usage guide');
    checks.push('merchant_content_workflow_covers_announcements_update_logs_and_usage_guides');

    const userPrepareBlocked = await post(
      `/admin/announcements/${published.id}/prepare-translations`,
      { targetLanguages: ['fr-FR'] },
      userCookie
    );
    assert(
      userPrepareBlocked.status === 403,
      `ordinary user preparing announcement translations should be 403, got ${userPrepareBlocked.status}`
    );
    const preparedDrafts = await post<PrepareAnnouncementTranslationsResponse>(
      `/admin/announcements/${published.id}/prepare-translations`,
      { targetLanguages: ['en-US', 'fr-FR'] },
      merchantCookie
    );
    assert(
      preparedDrafts.status >= 200 && preparedDrafts.status < 300,
      `admin prepare translations failed with ${preparedDrafts.status}`
    );
    assert(
      preparedDrafts.json.preparedTranslationLanguages.some((language) => language === 'fr' || language === 'fr-FR'),
      'prepare translations should include requested French draft language'
    );
    const preparedEnTranslation = preparedDrafts.json.translations?.['en-US'];
    assert(preparedEnTranslation?.title === previewTranslationTitle('published', 'en-US'), 'prepare translations should preserve locked en title');
    assert(preparedEnTranslation?._locked === true, 'prepare translations should preserve locked en flag');
    assert(
      preparedDrafts.json.translationWorkflow?.entries.some((entry) => entry.language === 'fr' || entry.language === 'fr-FR'),
      'prepare translations should expose French workflow entry'
    );
    checks.push('admin_prepare_translations_endpoint_generates_drafts_and_preserves_locked_manual_copy');

    const userPreviewBlocked = await get(`/admin/announcements/${published.id}/preview?language=ja-JP`, userCookie);
    assert(userPreviewBlocked.status === 403, `ordinary user previewing announcement should be 403, got ${userPreviewBlocked.status}`);
    const jaPreview = await get<AnnouncementPreviewResponse>(`/admin/announcements/${published.id}/preview?language=ja-JP`, merchantCookie);
    assert(jaPreview.status === 200, `admin ja preview failed with ${jaPreview.status}`);
    assert(jaPreview.json.title === previewTranslationTitle('published', 'ja-JP'), 'ja preview should use translated title');
    assert(jaPreview.json.content === previewTranslationContent('published', 'ja-JP'), 'ja preview should use translated content');
    assert(jaPreview.json.fallback === false, 'ja preview should not fallback when translation exists');
    assert(jaPreview.json.translation.language === 'ja-JP', 'ja preview should report matched language');
    assert(jaPreview.json.translation.status === 'machine_draft', 'ja preview should expose machine draft status');
    assert(jaPreview.json.translation.locked === false, 'ja preview should expose unlocked draft');
    assert(jaPreview.json.translation.source === 'qa-draft', 'ja preview should expose machine draft source');

    const enPreview = await get<AnnouncementPreviewResponse>(`/admin/announcements/${published.id}/preview?language=en-US`, merchantCookie);
    assert(enPreview.status === 200, `admin en preview failed with ${enPreview.status}`);
    assert(enPreview.json.title === previewTranslationTitle('published', 'en-US'), 'en preview should use reviewed title');
    assert(enPreview.json.translation.status === 'human_reviewed', 'en preview should expose human reviewed status');
    assert(enPreview.json.translation.locked === true, 'en preview should expose locked manual translation');
    assert(enPreview.json.translation.source === 'qa-manual', 'en preview should expose locked manual translation source');

    const frPreview = await get<AnnouncementPreviewResponse>(`/admin/announcements/${published.id}/preview?language=fr-FR`, merchantCookie);
    assert(frPreview.status === 200, `admin fr preview failed with ${frPreview.status}`);
    assert(frPreview.json.title === published.title, 'fr preview should fallback to source title when missing translation');
    assert(frPreview.json.content === published.content, 'fr preview should fallback to source content when missing translation');
    assert(frPreview.json.fallback === true, 'fr preview should mark missing translation fallback');
    assert(frPreview.json.translation.language === null, 'fr preview should report no matched translation');

    const invalidPreview = await get(`/admin/announcements/${published.id}/preview?language=bad%20language`, merchantCookie);
    assert(invalidPreview.status === 400, `invalid preview language should be 400, got ${invalidPreview.status}`);

    const updateLogJaPreview = await get<AnnouncementPreviewResponse>(`/admin/announcements/${updateLog.id}/preview?language=ja-JP`, merchantCookie);
    assert(updateLogJaPreview.status === 200, `admin update log ja preview failed with ${updateLogJaPreview.status}`);
    assert(updateLogJaPreview.json.category === 'update_log', 'update log preview should preserve content category');
    assert(updateLogJaPreview.json.title === previewTranslationTitle('update_log', 'ja-JP'), 'update log preview should use translated title');

    const usageGuideJaPreview = await get<AnnouncementPreviewResponse>(`/admin/announcements/${usageGuide.id}/preview?language=ja-JP`, merchantCookie);
    assert(usageGuideJaPreview.status === 200, `admin usage guide ja preview failed with ${usageGuideJaPreview.status}`);
    assert(usageGuideJaPreview.json.category === 'usage_guide', 'usage guide preview should preserve content category');
    assert(usageGuideJaPreview.json.title === previewTranslationTitle('usage_guide', 'ja-JP'), 'usage guide preview should use translated title');
    checks.push('merchant_can_preview_announcement_by_language_with_workflow_status');

    const publicFeed = await get<PublicAnnouncementFeed>('/announcements');
    assert(publicFeed.status === 200, `public announcements failed with ${publicFeed.status}`);
    assertPublicFeedVisibility(publicFeed.json, published.id, draft.id, archived.id, 'backend public announcement feed');
    assertPublicSectionContains(publicFeed.json, 'update_log', updateLog.id, 'backend public announcement feed');
    assertPublicSectionContains(publicFeed.json, 'usage_guide', usageGuide.id, 'backend public announcement feed');

    const webFeed = await getWeb<PublicAnnouncementFeed>('/api/announcements');
    assert(webFeed.status === 200, `web announcement proxy failed with ${webFeed.status}`);
    assertPublicFeedVisibility(webFeed.json, published.id, draft.id, archived.id, 'web public announcement feed');
    assertPublicSectionContains(webFeed.json, 'update_log', updateLog.id, 'web public announcement feed');
    assertPublicSectionContains(webFeed.json, 'usage_guide', usageGuide.id, 'web public announcement feed');
    checks.push('public_feeds_show_only_published_real_announcements');

    const bareBeforePublicRead = await prisma.announcement.findUniqueOrThrow({ where: { id: barePublished.id } });
    assert(bareBeforePublicRead.translations === null, 'bare published announcement should start without translations');
    const localizedPublicFeed = await get<PublicAnnouncementFeed>('/announcements?language=fr-FR');
    assert(localizedPublicFeed.status === 200, `localized public announcements failed with ${localizedPublicFeed.status}`);
    const barePublicItem = localizedPublicFeed.json.sections
      .flatMap((section) => section.items)
      .find((item) => item.id === barePublished.id);
    assert(barePublicItem, 'localized public feed should include bare published announcement');
    assert(barePublicItem.title === barePublished.title, 'localized public feed should fallback to source title without live translation');
    assert(barePublicItem.content === barePublished.content, 'localized public feed should fallback to source content without live translation');
    const bareAfterPublicRead = await prisma.announcement.findUniqueOrThrow({ where: { id: barePublished.id } });
    assert(bareAfterPublicRead.translations === null, 'public feed should not persist translations during read');
    assert(
      bareAfterPublicRead.updatedAt.getTime() === bareBeforePublicRead.updatedAt.getTime(),
      'public feed should not update announcement row while localizing'
    );
    checks.push('public_announcement_feed_does_not_live_translate_or_write_translations');

    const adminAudit = await get<AuditListResponse>('/admin/audit-logs?page=1&limit=100', merchantCookie);
    assert(adminAudit.status === 200, `admin audit logs failed with ${adminAudit.status}`);
    const seededAdminAuditItems = pickAdminAuditItems(adminAudit.json.items, seeded.userIds.admin, announcementIds);
    const adminAuditText = JSON.stringify(seededAdminAuditItems);
    assert(seededAdminAuditItems.length >= 3, 'admin audit should include seeded announcement audit entries');
    assert(adminAuditText.includes('announcement_created'), 'seeded admin audit entries should include announcement_created');
    assert(
      adminAuditText.includes('announcement_translation_drafts_prepared'),
      'seeded admin audit entries should include translation draft preparation'
    );
    assert(adminAudit.json.total >= 3, 'admin audit total should include created announcements');
    assertNoSensitiveText(adminAuditText, sensitiveMarkers(), 'admin audit response');

    const securityAudit = await get<AuditListResponse>('/admin/security-audit-logs?page=1&limit=100', merchantCookie);
    assert(securityAudit.status === 200, `security audit logs failed with ${securityAudit.status}`);
    const seededSecurityAuditItems = pickSecurityAuditItems(securityAudit.json.items, [
      seeded.userIds.admin,
      seeded.userIds.user
    ]);
    const securityAuditText = JSON.stringify(seededSecurityAuditItems);
    assert(seededSecurityAuditItems.length >= 2, 'security audit should include seeded login records');
    assert(securityAuditText.includes('user_login_succeeded'), 'seeded security audit entries should include login success');
    assertNoSensitiveText(securityAuditText, sensitiveSecurityAuditMarkers(), 'security audit response');
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

async function createAnnouncementAsAdmin(
  status: 'published' | 'draft' | 'archived',
  cookie: string,
  category: AnnouncementCategoryInput = 'announcement',
  label = status
) {
  const result = await post<AnnouncementResponse>('/admin/announcements', createAnnouncementPayload(label, status, category), cookie);
  assert(result.status === 200 || result.status === 201, `create ${status} announcement failed with ${result.status}`);
  assert(result.json.status === status, `created ${status} announcement returned status ${result.json.status}`);
  assert(result.json.category === category, `created ${label} content returned category ${result.json.category}`);
  announcementIds.push(result.json.id);
  return result.json;
}

async function createBarePublishedAnnouncement(adminUserId: string): Promise<AnnouncementResponse> {
  const now = new Date();
  const announcement = await prisma.announcement.create({
    data: {
      title: `${usernamePrefix}_bare_source_Azure Planet Relay`,
      content: `${usernamePrefix}_bare_source_content_Azure Planet Relay`,
      category: AnnouncementCategory.ANNOUNCEMENT,
      status: AnnouncementStatus.PUBLISHED,
      publishedAt: now,
      createdByAdminId: adminUserId
    }
  });
  announcementIds.push(announcement.id);
  return {
    id: announcement.id,
    title: announcement.title,
    content: announcement.content,
    category: announcement.category.toLowerCase(),
    status: announcement.status.toLowerCase(),
    publishedAt: announcement.publishedAt?.toISOString() ?? null,
    translations: null
  };
}

function createAnnouncementPayload(
  label: string,
  status: 'published' | 'draft' | 'archived',
  category: AnnouncementCategoryInput = 'announcement'
) {
  return {
    title: `${usernamePrefix}_${label}_公告`,
    content: `${usernamePrefix}_${label}_真实公告内容`,
    category,
    status,
    translations: {
      'en-US': {
        title: previewTranslationTitle(label, 'en-US'),
        content: previewTranslationContent(label, 'en-US'),
        _locked: true,
        _status: 'human_reviewed',
        _source: 'qa-manual',
        _updatedAt: '2026-06-24T00:00:00.000Z'
      },
      'ja-JP': {
        title: previewTranslationTitle(label, 'ja-JP'),
        content: previewTranslationContent(label, 'ja-JP'),
        _locked: false,
        _status: 'machine_draft',
        _source: 'qa-draft',
        _updatedAt: '2026-06-24T00:00:01.000Z'
      }
    }
  };
}

function assertContentWorkflowCategory(
  item: AnnouncementResponse | undefined,
  category: AnnouncementCategoryInput,
  label: string
) {
  assert(item, `admin list should include ${label} row`);
  assert(item.category === category, `${label} row should preserve category ${category}`);
  assert(item.status === 'published', `${label} row should be published`);
  assert(Boolean(item.translationWorkflow), `${label} row should expose translation workflow summary`);
  assert(item.translationWorkflow?.languages.includes('en-US'), `${label} workflow should expose en-US`);
  assert(item.translationWorkflow?.languages.includes('ja-JP'), `${label} workflow should expose ja-JP`);
  assert(item.translationWorkflow?.counts.humanReviewed >= 1, `${label} workflow should count human reviewed translations`);
  assert(item.translationWorkflow?.counts.machineDraft >= 1, `${label} workflow should count machine draft translations`);
  assert(item.translationWorkflow?.counts.locked >= 1, `${label} workflow should count locked translations`);
}

function previewTranslationTitle(label: string, language: 'en-US' | 'ja-JP') {
  return `${usernamePrefix}_${label}_${language}_title`;
}

function previewTranslationContent(label: string, language: 'en-US' | 'ja-JP') {
  return `${usernamePrefix}_${label}_${language}_content`;
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
  publishedId: string,
  draftId: string,
  archivedId: string,
  label: string
) {
  const visibleIds = new Set(feed.sections.flatMap((section) => section.items.map((item) => item.id)));
  assert(visibleIds.has(publishedId), `${label} should include published announcement`);
  assert(!visibleIds.has(draftId), `${label} leaked draft announcement`);
  assert(!visibleIds.has(archivedId), `${label} leaked archived announcement`);
  const text = JSON.stringify(feed);
  assert(!text.includes('"createdByAdminId"'), `${label} leaked createdByAdminId`);
  assert(!text.includes('"createdBy"'), `${label} leaked createdBy`);
}

function assertPublicSectionContains(feed: PublicAnnouncementFeed, sectionKey: string, itemId: string, label: string) {
  const section = feed.sections.find((entry) => entry.key === sectionKey);
  assert(section, `${label} should include ${sectionKey} section`);
  assert(section.items.some((item) => item.id === itemId), `${label} should include ${itemId} in ${sectionKey} section`);
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

function pickSecurityAuditItems(items: AuditListResponse['items'], userIds: string[]) {
  return items.filter((entry) => {
    const item = entry as {
      actor?: { id?: unknown };
      targetId?: unknown;
    };

    const actorId = typeof item.actor?.id === 'string' ? item.actor.id : null;
    const targetId = typeof item.targetId === 'string' ? item.targetId : null;

    return (actorId !== null && userIds.includes(actorId)) || (targetId !== null && userIds.includes(targetId));
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

function sensitiveSecurityAuditMarkers() {
  return [
    password,
    ...sensitiveMarkers().filter((marker) => marker !== 'password')
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
