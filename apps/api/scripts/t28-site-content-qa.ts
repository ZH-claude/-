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

type SiteContentResponse = {
  id: string;
  home: {
    title: string;
    subtitle: string;
    content: string | null;
    fontFamily: string;
    textColor: string;
    accentColor: string;
  };
  popup: {
    enabled: boolean;
    title: string | null;
    content: string | null;
    fontFamily: string;
    textColor: string;
    accentColor: string;
  };
  updatedAt: string | null;
};

type LoginResponse = {
  user: {
    id: string;
    username: string;
    role: string;
    status: string;
  };
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

type ExistingSiteContent = Awaited<ReturnType<typeof readExistingSiteContent>>;

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T28 site content QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const usernamePrefix = `q28_${suffix}`;
const password = `qa-password-${suffix}`;
const checks: string[] = [];

let checksError: unknown;
let seeded: SeededContext | null = null;
let originalSiteContent: ExistingSiteContent | null = null;

const payload = {
  homeTitle: `${usernamePrefix} home title`,
  homeSubtitle: `${usernamePrefix} home subtitle`,
  homeContent: `${usernamePrefix} home content\nsecond line keeps newline coverage`,
  homeFontFamily: 'serif',
  homeTextColor: '#16a34a',
  homeAccentColor: '#e11d48',
  popupEnabled: true,
  popupTitle: `${usernamePrefix} popup title`,
  popupContent: `${usernamePrefix} popup content`,
  popupFontFamily: 'mono',
  popupTextColor: '#111827',
  popupAccentColor: '#7c3aed'
};

async function main() {
  try {
    originalSiteContent = await readExistingSiteContent();
    seeded = await seedFixture();
    checks.push('seeded_admin_and_user_accounts');

    const merchantLogin = await login(seeded.usernames.admin);
    assert(merchantLogin.status === 200 || merchantLogin.status === 201, `admin login failed with ${merchantLogin.status}`);
    assert(merchantLogin.cookie.length > 0, 'admin login should return session cookie');
    assert(merchantLogin.json.user.role.toLowerCase() === 'admin', 'admin login role mismatch');
    checks.push('merchant_login_uses_real_http_session');

    const userLogin = await login(seeded.usernames.user);
    assert(userLogin.status === 200 || userLogin.status === 201, `ordinary login failed with ${userLogin.status}`);
    assert(userLogin.cookie.length > 0, 'ordinary login should return session cookie');
    checks.push('ordinary_login_uses_real_http_session');

    const defaultPublic = await get<SiteContentResponse>('/site-content');
    assert(defaultPublic.status === 200, `public site content failed with ${defaultPublic.status}`);
    assert(defaultPublic.json.home.title.length > 0, 'public site content should include home defaults');
    checks.push('public_api_returns_site_content_defaults');

    const ordinaryAdminRead = await get('/admin/site-content', userLogin.cookie);
    assert(ordinaryAdminRead.status === 403, `ordinary admin site-content read should be 403, got ${ordinaryAdminRead.status}`);
    const ordinaryAdminWrite = await post('/admin/site-content', payload, userLogin.cookie);
    assert(ordinaryAdminWrite.status === 403, `ordinary admin site-content write should be 403, got ${ordinaryAdminWrite.status}`);
    checks.push('ordinary_user_is_forbidden_from_site_content_admin_endpoints');

    const invalidColor = await post('/admin/site-content', { ...payload, homeTextColor: 'red' }, merchantLogin.cookie);
    assert(invalidColor.status === 400, `invalid color should be 400, got ${invalidColor.status}`);
    const invalidPopup = await post('/admin/site-content', { ...payload, popupContent: '' }, merchantLogin.cookie);
    assert(invalidPopup.status === 400, `enabled popup without content should be 400, got ${invalidPopup.status}`);
    checks.push('site_content_validation_rejects_invalid_style_and_popup_payloads');

    const saved = await post<SiteContentResponse>('/admin/site-content', payload, merchantLogin.cookie);
    assert(saved.status === 200 || saved.status === 201, `admin site content save failed with ${saved.status}`);
    assertSiteContent(saved.json);
    checks.push('merchant_saves_site_content_config');

    const stored = await prisma.siteContentConfig.findUniqueOrThrow({ where: { id: 'default' } });
    assert(stored.updatedByAdminId === seeded.userIds.admin, 'stored site content updater mismatch');
    assert(stored.homeTitle === payload.homeTitle, 'stored homeTitle mismatch');
    assert(stored.popupEnabled === true, 'stored popupEnabled mismatch');
    checks.push('database_persists_site_content_config');

    const publicAfterSave = await get<SiteContentResponse>('/site-content');
    assert(publicAfterSave.status === 200, `public site content after save failed with ${publicAfterSave.status}`);
    assertSiteContent(publicAfterSave.json);
    const webPublicAfterSave = await getWeb<SiteContentResponse>('/api/site-content');
    assert(webPublicAfterSave.status === 200, `web proxy site content failed with ${webPublicAfterSave.status}`);
    assertSiteContent(webPublicAfterSave.json);
    checks.push('public_and_next_proxy_return_saved_site_content');

    const publicHomeAfterSave = await getWebPage('/?language=en-US');
    assert(
      publicHomeAfterSave.status >= 200 && publicHomeAfterSave.status < 300,
      `public home after site content save should render, got ${publicHomeAfterSave.status}`
    );
    for (const marker of [
      payload.homeTitle,
      payload.homeSubtitle,
      payload.homeContent.split('\n')[0],
      payload.popupTitle,
      payload.popupContent,
      'data-qa="public-home-site-content"',
      'data-qa="public-site-popup"'
    ]) {
      assert(publicHomeAfterSave.text.includes(marker), `public home missing saved site content marker: ${marker}`);
    }
    checks.push('public_home_renders_saved_site_content_and_popup');

    const merchantPage = await getWebPage('/merchant/announcements', merchantLogin.cookie);
    assert(merchantPage.status >= 200 && merchantPage.status < 300, `merchant announcements page should render, got ${merchantPage.status}`);
    for (const marker of ['merchant-shell-page', 'merchant-announcements-page', 'site-content-admin-panel', 'site-content-form']) {
      assert(merchantPage.text.includes(marker), `merchant page missing marker: ${marker}`);
    }
    const ordinaryMerchantPage = await getWebPage('/merchant/announcements', userLogin.cookie);
    assertRedirect(ordinaryMerchantPage, '/account/profile', 'ordinary merchant announcements page');
    checks.push('merchant_site_content_page_renders_and_ordinary_user_redirects');

    const adminAuditText = JSON.stringify(await get('/admin/audit-logs?page=1&limit=50', merchantLogin.cookie));
    assert(adminAuditText.includes('site_content_config_updated'), 'admin audit should include site_content_config_updated');
    checks.push('site_content_update_writes_admin_audit');
  } catch (error) {
    checksError = error;
  } finally {
    await restoreSiteContent(originalSiteContent);
    await cleanup();
    await prisma.$disconnect();
  }

  const result = {
    ok: checksError === undefined,
    checks,
    usernamePrefix
  };
  console.log(JSON.stringify(result, null, 2));

  if (checksError !== undefined) {
    throw checksError;
  }
}

async function readExistingSiteContent() {
  return prisma.siteContentConfig.findUnique({
    where: { id: 'default' }
  });
}

async function restoreSiteContent(original: ExistingSiteContent | null) {
  if (original) {
    await prisma.siteContentConfig.upsert({
      where: { id: original.id },
      update: {
        homeTitle: original.homeTitle,
        homeSubtitle: original.homeSubtitle,
        homeContent: original.homeContent,
        homeFontFamily: original.homeFontFamily,
        homeTextColor: original.homeTextColor,
        homeAccentColor: original.homeAccentColor,
        popupEnabled: original.popupEnabled,
        popupTitle: original.popupTitle,
        popupContent: original.popupContent,
        popupFontFamily: original.popupFontFamily,
        popupTextColor: original.popupTextColor,
        popupAccentColor: original.popupAccentColor,
        updatedByAdminId: original.updatedByAdminId,
        createdAt: original.createdAt,
        updatedAt: original.updatedAt
      },
      create: {
        id: original.id,
        homeTitle: original.homeTitle,
        homeSubtitle: original.homeSubtitle,
        homeContent: original.homeContent,
        homeFontFamily: original.homeFontFamily,
        homeTextColor: original.homeTextColor,
        homeAccentColor: original.homeAccentColor,
        popupEnabled: original.popupEnabled,
        popupTitle: original.popupTitle,
        popupContent: original.popupContent,
        popupFontFamily: original.popupFontFamily,
        popupTextColor: original.popupTextColor,
        popupAccentColor: original.popupAccentColor,
        updatedByAdminId: original.updatedByAdminId,
        createdAt: original.createdAt,
        updatedAt: original.updatedAt
      }
    });
    return;
  }

  await prisma.siteContentConfig.deleteMany({ where: { id: 'default' } });
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
        name: 'Default group'
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

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: usernamePrefix } },
    select: { id: true }
  });
  const userIds = users.map((entry) => entry.id);

  if (!userIds.length) {
    return;
  }

  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminUserId: { in: userIds } },
        { action: 'site_content_config_updated', adminUserId: { in: userIds } }
      ]
    }
  });
  await prisma.securityAuditLog.deleteMany({
    where: {
      OR: [{ actorUserId: { in: userIds } }, { targetId: { in: userIds } }]
    }
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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

function assertSiteContent(config: SiteContentResponse) {
  assert(config.home.title === payload.homeTitle, 'home title mismatch');
  assert(config.home.subtitle === payload.homeSubtitle, 'home subtitle mismatch');
  assert(config.home.content === payload.homeContent, 'home content mismatch');
  assert(config.home.fontFamily === payload.homeFontFamily, 'home font mismatch');
  assert(config.home.textColor === payload.homeTextColor, 'home text color mismatch');
  assert(config.home.accentColor === payload.homeAccentColor, 'home accent color mismatch');
  assert(config.popup.enabled === true, 'popup enabled mismatch');
  assert(config.popup.title === payload.popupTitle, 'popup title mismatch');
  assert(config.popup.content === payload.popupContent, 'popup content mismatch');
  assert(config.popup.fontFamily === payload.popupFontFamily, 'popup font mismatch');
  assert(config.popup.textColor === payload.popupTextColor, 'popup text color mismatch');
  assert(config.popup.accentColor === payload.popupAccentColor, 'popup accent color mismatch');
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main();
