import { PrismaPg } from '@prisma/adapter-pg';
import { hash as bcryptHash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient, UserRole, UserStatus } from '../src/generated/prisma/client';
import { prepareAutoTranslationDrafts, resolveAutoTranslatedFields } from '../src/i18n/auto-translate';

type TranslationValue = string | boolean;
type TranslationMap = Record<string, Record<string, TranslationValue>>;

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  text: string;
  cookie: string;
};

type AnnouncementResponse = {
  id: string;
  title: string;
  content: string;
  category: string;
  status: string;
  publishedAt: string | null;
  translations?: TranslationMap | null;
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

type AdminAnnouncementListResponse = {
  items: AnnouncementResponse[];
};

type AnnouncementFeedResponse = {
  generatedAt: string;
  total: number;
  sections: Array<{
    key: string;
    title: string;
    items: Array<{
      id: string;
      title: string;
      content: string;
      category: string;
    }>;
  }>;
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
  translations?: TranslationMap | null;
  updatedAt: string | null;
};

type TranslationGlossaryTermResponse = {
  id: string;
  sourceTerm: string;
  replacementTerm: string;
  note: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type TranslationGlossaryListResponse = {
  items: TranslationGlossaryTermResponse[];
  activeGlossary: Record<string, string>;
};

type LoginResponse = {
  user: {
    id: string;
    username: string;
    role: string;
  };
};

type SeededUsers = {
  adminId: string;
  userId: string;
  adminCookie: string;
  userCookie: string;
};

type SiteContentSnapshot = Awaited<ReturnType<typeof readExistingSiteContent>>;

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3011';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3010';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run i18n-content QA');
}

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const marker = `qa_i18n_${suffix}`;
const password = `qa-password-${suffix}`;
const checks: string[] = [];
const translationEnvRestore = new Map<string, string | undefined>();
const persistentGlossarySourceTerm = `${marker} SourceBrand`;
const persistentGlossaryReplacementV1 = `${marker} LockedBrandV1`;
const persistentGlossaryReplacementV2 = `${marker} LockedBrandV2`;

const sourceAnnouncement = {
  title: `${marker} \u516c\u544a\u6e90\u6587\u6807\u9898 Azure Planet Relay ${persistentGlossarySourceTerm}`,
  content: `${marker} \u516c\u544a\u6e90\u6587\u5185\u5bb9 Azure Planet Relay ${persistentGlossarySourceTerm}`
};

const sourceSiteContent = {
  homeTitle: `${marker} \u9996\u9875\u6e90\u6587\u6807\u9898`,
  homeSubtitle: `${marker} \u9996\u9875\u6e90\u6587\u526f\u6807\u9898`,
  homeContent: `${marker} \u9996\u9875\u6e90\u6587\u5185\u5bb9`,
  popupTitle: `${marker} \u5f39\u7a97\u6e90\u6587\u6807\u9898`,
  popupContent: `${marker} \u5f39\u7a97\u6e90\u6587\u5185\u5bb9`
};

const announcementTranslations: TranslationMap = {
  'en-US': {
    title: `${marker} English announcement title`,
    content: `${marker} English announcement content`,
    _locked: true,
    _status: 'human_reviewed',
    _source: 'qa-manual',
    _updatedAt: '2026-06-24T00:00:00.000Z'
  },
  es: {
    title: `${marker} Titulo de anuncio`,
    content: `${marker} Contenido de anuncio`,
    _locked: true,
    _status: 'human_reviewed',
    _source: 'qa-manual',
    _updatedAt: '2026-06-24T00:00:00.000Z'
  }
};

const siteContentTranslations: TranslationMap = {
  'en-US': {
    homeTitle: 'Azure Planet Relay',
    homeSubtitle: `${marker} English subtitle`,
    homeContent: `${marker} English home content`,
    popupTitle: `${marker} English popup title`,
    popupContent: `${marker} English popup content`,
    _locked: true,
    _status: 'human_reviewed',
    _source: 'qa-manual',
    _updatedAt: '2026-06-24T00:00:00.000Z'
  },
  es: {
    homeTitle: 'Azure Planet Relay',
    homeSubtitle: `${marker} Subtitulo en espanol`,
    homeContent: `${marker} Contenido de inicio`,
    popupTitle: `${marker} Titulo emergente`,
    popupContent: `${marker} Contenido emergente`,
    _locked: true,
    _status: 'human_reviewed',
    _source: 'qa-manual',
    _updatedAt: '2026-06-24T00:00:00.000Z'
  },
  fr: {
    homeTitle: 'Azure Planet Relay',
    homeSubtitle: `${marker} Sous-titre francais`,
    homeContent: `${marker} Contenu accueil francais`,
    popupTitle: `${marker} Titre popup francais`,
    popupContent: `${marker} Contenu popup francais`,
    _locked: true,
    _status: 'human_reviewed',
    _source: 'qa-manual',
    _updatedAt: '2026-06-24T00:00:00.000Z'
  }
};

let seededUsers: SeededUsers | null = null;
let originalSiteContent: SiteContentSnapshot | null = null;
let createdAnnouncementId: string | null = null;
let createdGlossaryTermId: string | null = null;
let restoreTranslationEnv: (() => void) | null = null;

async function main() {
  let failure: unknown = null;

  try {
    await assertProductionPublicGoogleGuard();
    checks.push('production_blocks_public_google_without_explicit_opt_in');

    await assertPublicGoogleOptInStillUsesGlossaryProtection();
    checks.push('explicit_google_provider_uses_glossary_protection');

    await assertCustomHttpProviderSupportsPrivateProductionTranslation();
    checks.push('custom_http_provider_supports_private_production_translation');

    await assertCustomHttpProviderRequiresConfiguredUrl();
    checks.push('custom_http_provider_requires_configured_url_before_fetching');

    restoreTranslationEnv = setQaTranslationEnv();
    checks.push('auto_translate_env_is_forced_deterministic_for_qa');
    assert(process.env.AUTO_TRANSLATE_PROVIDER === 'disabled', 'publish-time draft translation assertions require AUTO_TRANSLATE_PROVIDER=disabled');

    originalSiteContent = await readExistingSiteContent();
    seededUsers = await seedUsers();
    checks.push('seeded_real_admin_and_regular_user');

    await assertAdminGuards();
    checks.push('admin_guards_cover_announcement_and_site_content_i18n');

    await assertPersistentGlossaryManagement();
    checks.push('admin_can_manage_persistent_translation_glossary');

    const created = await createAnnouncement();
    createdAnnouncementId = created.id;
    await assertAnnouncementDraftPreparation(created.id, created.translations);
    await assertLockedManualTranslationsRemain({
      translations: created.translations,
      announcementId: created.id
    }, {
      operation: 'admin_create'
    });
    checks.push('admin_create_accepts_translation_metadata');
    checks.push('publish_time_prepares_non_manual_translation_drafts_when_provider_disabled');

    const updatedTranslations: TranslationMap = {
      ...announcementTranslations,
      fr: {
        title: `${marker} Titre francais`,
        content: `${marker} Contenu francais`,
        _locked: false,
        _status: 'machine_draft',
        _source: 'qa-draft',
        _updatedAt: '2026-06-24T00:00:01.000Z'
      }
    };
    const updated = await updateAnnouncementTranslations(created.id, updatedTranslations);
    assert(updated.translations?.fr?._status === 'machine_draft', 'announcement update should preserve draft status');
    await assertLockedManualTranslationsRemain({
      translations: updated.translations,
      announcementId: updated.id
    }, {
      operation: 'admin_update'
    });
    assert(updated.translations?.['en-US']?._locked === true, 'announcement update should preserve locked manual translation');
    checks.push('admin_update_can_modify_and_lock_existing_announcement_translations');

    await assertAdminListExposesTranslationWorkflowMetadata(created.id);
    checks.push('admin_list_exposes_translation_workflow_metadata');

    await updateSiteContent();
    checks.push('admin_site_content_accepts_translation_metadata');

    await assertInvalidTranslationPayloads(created.id);
    checks.push('invalid_language_and_metadata_are_rejected');

    await assertLocalizedPublicContent(created.id);
    checks.push('public_api_and_next_proxy_localize_without_chinese_source_leak');
    checks.push('public_announcements_page_html_localizes_real_content');

    await assertAcceptLanguageFallback(created.id);
    checks.push('accept_language_header_selects_supported_base_language');

    await assertPublicMetadataIsolation();
    checks.push('public_payloads_do_not_expose_translation_metadata');

    await assertAuditLogs(created.id);
    checks.push('manual_translation_update_writes_admin_audit');
  } catch (error) {
    failure = error;
  } finally {
    await restoreSiteContent(originalSiteContent);
    await cleanup();
    if (restoreTranslationEnv) {
      restoreTranslationEnv();
    }
    await db.$disconnect();
  }

  console.log(JSON.stringify({ ok: failure === null, marker, checks }, null, 2));
  if (failure !== null) {
    throw failure;
  }
}

async function assertProductionPublicGoogleGuard() {
  await withTranslationProviderTestEnv({
    NODE_ENV: 'production',
    AUTO_TRANSLATE_PROVIDER: 'google-public',
    AUTO_TRANSLATE_ALLOW_PUBLIC_GOOGLE_IN_PRODUCTION: undefined,
    AUTO_TRANSLATE_DISABLED: undefined
  }, async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('production public Google guard should not call fetch without explicit opt-in');
    }) as typeof fetch;

    try {
      const fields = {
        title: 'Azure Planet Relay 生产误配保护标题',
        content: 'Azure Planet Relay 生产误配保护内容'
      };
      const drafts = await prepareAutoTranslationDrafts({
        translations: {},
        fields,
        targetLanguages: ['ja']
      });
      const jaDraft = translationEntryOrNull(drafts.translations?.ja);
      assert(fetchCalls === 0, 'production public Google guard should not call provider during draft preparation');
      assert(jaDraft !== null, 'production guard should still prepare a source fallback draft for admin review');
      assert(jaDraft._source === 'source_fallback_draft', 'production guard should mark blocked public provider drafts as source fallback');
      assert(jaDraft.title === fields.title, 'production guard fallback title should preserve source text');
      assert(String(jaDraft.title).includes('Azure Planet Relay'), 'production guard fallback title should preserve brand term');

      const resolved = await resolveAutoTranslatedFields({
        translations: {},
        language: 'ja-JP',
        fields: { title: fields.title }
      });
      assert(fetchCalls === 0, 'production public Google guard should not call provider during runtime localization');
      assert(resolved.values.title === fields.title, 'production guard runtime localization should fall back to source text');
      assert(resolved.changed === false, 'production guard runtime localization should not persist a provider translation');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

async function assertPublicGoogleOptInStillUsesGlossaryProtection() {
  await withTranslationProviderTestEnv({
    NODE_ENV: 'production',
    AUTO_TRANSLATE_PROVIDER: 'google-public',
    AUTO_TRANSLATE_ALLOW_PUBLIC_GOOGLE_IN_PRODUCTION: 'true',
    AUTO_TRANSLATE_DISABLED: undefined
  }, async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      fetchCalls += 1;
      const url = fetchInputUrl(input);
      const query = url.searchParams.get('q') ?? '';
      assert(query.includes('NRTTERM0NRT'), 'glossary protection should replace brand term before provider call');
      assert(!query.includes('Azure Planet Relay'), 'provider request should not contain raw protected brand term');
      return new Response(JSON.stringify([[[`${query} translated`, null, null, null]]]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }) as typeof fetch;

    try {
      const resolved = await resolveAutoTranslatedFields({
        translations: {},
        language: 'ja-JP',
        fields: {
          title: 'Azure Planet Relay opt-in title'
        }
      });
      assert(fetchCalls === 1, 'explicit public Google production opt-in should allow one provider call');
      assert(
        resolved.values.title?.includes('Azure Planet Relay') === true,
        'glossary protection should restore brand term after provider call'
      );
      assert(
        resolved.values.title?.includes('NRTTERM0NRT') !== true,
        'glossary placeholder should not leak into resolved translation'
      );
      assert(resolved.changed === true, 'explicit opt-in provider translation should be persisted as a machine draft');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

async function assertCustomHttpProviderSupportsPrivateProductionTranslation() {
  await withTranslationProviderTestEnv({
    NODE_ENV: 'production',
    AUTO_TRANSLATE_PROVIDER: 'custom-http',
    AUTO_TRANSLATE_CUSTOM_URL: 'https://translator.internal.example/translate',
    AUTO_TRANSLATE_CUSTOM_API_KEY: 'qa-custom-translate-key',
    AUTO_TRANSLATE_CUSTOM_API_KEY_HEADER: undefined,
    AUTO_TRANSLATE_ALLOW_PUBLIC_GOOGLE_IN_PRODUCTION: undefined,
    AUTO_TRANSLATE_DISABLED: undefined
  }, async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      fetchCalls += 1;
      const url = fetchInputUrl(input);
      assert(url.toString() === 'https://translator.internal.example/translate', 'custom provider should call configured private URL');
      assert(init?.method === 'POST', 'custom provider should use POST');

      const headers = new Headers(init?.headers);
      assert(headers.get('authorization') === 'Bearer qa-custom-translate-key', 'custom provider should send bearer API key');

      const body = JSON.parse(String(init?.body ?? '{}')) as {
        sourceLanguage?: string;
        targetLanguage?: string;
        text?: string;
      };
      assert(body.sourceLanguage === 'auto', 'custom provider request should mark source language as auto');
      assert(body.targetLanguage === 'ja', `custom provider target language mismatch: ${body.targetLanguage ?? '<missing>'}`);
      assert(body.text?.includes('NRTTERM0NRT') === true, 'custom provider should receive glossary placeholder');
      assert(body.text?.includes('Azure Planet Relay') !== true, 'custom provider should not receive raw protected brand term');

      return new Response(JSON.stringify({ translatedText: `${body.text} private translated` }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }) as typeof fetch;

    try {
      const resolved = await resolveAutoTranslatedFields({
        translations: {},
        language: 'ja-JP',
        fields: {
          title: 'Azure Planet Relay private provider title'
        }
      });
      assert(fetchCalls === 1, `custom provider should be called once, got ${fetchCalls}`);
      assert(resolved.changed === true, 'custom provider translation should be persisted as a machine draft');
      assert(resolved.translations?.['ja-JP']?._source === 'custom-http', 'custom provider draft source should be custom-http');
      assert(
        resolved.values.title?.includes('Azure Planet Relay') === true,
        'custom provider should restore protected brand term after translation'
      );
      assert(
        resolved.values.title?.includes('NRTTERM0NRT') !== true,
        'custom provider should not leak glossary placeholder after translation'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

async function assertCustomHttpProviderRequiresConfiguredUrl() {
  await withTranslationProviderTestEnv({
    NODE_ENV: 'production',
    AUTO_TRANSLATE_PROVIDER: 'custom-http',
    AUTO_TRANSLATE_CUSTOM_URL: undefined,
    AUTO_TRANSLATE_CUSTOM_API_KEY: 'qa-custom-translate-key',
    AUTO_TRANSLATE_CUSTOM_API_KEY_HEADER: undefined,
    AUTO_TRANSLATE_ALLOW_PUBLIC_GOOGLE_IN_PRODUCTION: undefined,
    AUTO_TRANSLATE_DISABLED: undefined
  }, async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('custom provider should not fetch without AUTO_TRANSLATE_CUSTOM_URL');
    }) as typeof fetch;

    try {
      const resolved = await resolveAutoTranslatedFields({
        translations: {},
        language: 'ja-JP',
        fields: {
          title: 'Azure Planet Relay missing custom url title'
        }
      });
      assert(fetchCalls === 0, 'custom provider should not call fetch without configured URL');
      assert(resolved.changed === false, 'missing custom URL should not persist a provider translation');
      assert(
        resolved.values.title === 'Azure Planet Relay missing custom url title',
        'missing custom URL should fall back to source text'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

async function withTranslationProviderTestEnv(
  env: Record<string, string | undefined>,
  run: () => Promise<void>
) {
  const keys = [
    'NODE_ENV',
    'AUTO_TRANSLATE_PROVIDER',
    'AUTO_TRANSLATE_CUSTOM_URL',
    'AUTO_TRANSLATE_CUSTOM_API_KEY',
    'AUTO_TRANSLATE_CUSTOM_API_KEY_HEADER',
    'AUTO_TRANSLATE_ALLOW_PUBLIC_GOOGLE_IN_PRODUCTION',
    'AUTO_TRANSLATE_DISABLED'
  ];
  const previousValues = new Map<string, string | undefined>();
  for (const key of keys) {
    previousValues.set(key, process.env[key]);
  }

  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await run();
  } finally {
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function fetchInputUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === 'string') {
    return new URL(input);
  }
  if (input instanceof URL) {
    return input;
  }
  const requestLike = input as { url?: string };
  if (typeof requestLike.url === 'string') {
    return new URL(requestLike.url);
  }
  throw new Error('unsupported fetch input in i18n QA');
}

async function assertAdminGuards() {
  assert(seededUsers, 'seededUsers is required');
  const userCreate = await post('/admin/announcements', {
    title: `${marker} blocked`,
    content: `${marker} blocked`,
    category: 'announcement',
    status: 'published'
  }, seededUsers.userCookie);
  assert(userCreate.status === 403, `regular user announcement create should be 403, got ${userCreate.status}`);

  const userSiteWrite = await post('/admin/site-content', siteContentPayload(), seededUsers.userCookie);
  assert(userSiteWrite.status === 403, `regular user site-content update should be 403, got ${userSiteWrite.status}`);

  const anonymousSiteWrite = await post('/admin/site-content', siteContentPayload());
  assert(anonymousSiteWrite.status === 401, `anonymous site-content update should be 401, got ${anonymousSiteWrite.status}`);

  const userGlossaryWrite = await post('/admin/translation-glossary', {
    sourceTerm: `${marker} blocked glossary`,
    replacementTerm: `${marker} blocked glossary replacement`
  }, seededUsers.userCookie);
  assert(userGlossaryWrite.status === 403, `regular user glossary create should be 403, got ${userGlossaryWrite.status}`);

  const anonymousGlossaryWrite = await post('/admin/translation-glossary', {
    sourceTerm: `${marker} anonymous glossary`,
    replacementTerm: `${marker} anonymous glossary replacement`
  });
  assert(anonymousGlossaryWrite.status === 401, `anonymous glossary create should be 401, got ${anonymousGlossaryWrite.status}`);
}

async function assertPersistentGlossaryManagement() {
  assert(seededUsers, 'seededUsers is required');
  const created = await post<TranslationGlossaryTermResponse>('/admin/translation-glossary', {
    sourceTerm: persistentGlossarySourceTerm,
    replacementTerm: persistentGlossaryReplacementV1,
    note: `${marker} persistent glossary QA`,
    isActive: true
  }, seededUsers.adminCookie);
  assert(created.status === 200 || created.status === 201, `glossary create failed with ${created.status}: ${created.text}`);
  assert(created.json.id, 'glossary create should return id');
  createdGlossaryTermId = created.json.id;
  assert(created.json.sourceTerm === persistentGlossarySourceTerm, 'glossary create should preserve sourceTerm');
  assert(created.json.replacementTerm === persistentGlossaryReplacementV1, 'glossary create should preserve replacementTerm');
  assert(created.json.isActive === true, 'glossary create should default to active term');

  const duplicate = await post('/admin/translation-glossary', {
    sourceTerm: persistentGlossarySourceTerm,
    replacementTerm: `${persistentGlossaryReplacementV1} duplicate`
  }, seededUsers.adminCookie);
  assert(duplicate.status === 409, `duplicate glossary term should be 409, got ${duplicate.status}`);

  const updated = await post<TranslationGlossaryTermResponse>(
    `/admin/translation-glossary/${encodeURIComponent(created.json.id)}/update`,
    {
      replacementTerm: persistentGlossaryReplacementV2,
      note: `${marker} persistent glossary QA updated`
    },
    seededUsers.adminCookie
  );
  assert(updated.status === 200 || updated.status === 201, `glossary update failed with ${updated.status}: ${updated.text}`);
  assert(updated.json.replacementTerm === persistentGlossaryReplacementV2, 'glossary update should expose new replacementTerm');

  const list = await request<TranslationGlossaryListResponse>({
    method: 'GET',
    baseUrl: API_BASE_URL,
    path: '/admin/translation-glossary',
    cookie: seededUsers.adminCookie
  });
  assert(list.status === 200, `glossary list failed with ${list.status}: ${list.text}`);
  assert(
    list.json.items.some(
      (entry) =>
        entry.id === created.json.id &&
        entry.sourceTerm === persistentGlossarySourceTerm &&
        entry.replacementTerm === persistentGlossaryReplacementV2 &&
        entry.isActive === true
    ),
    'glossary list should include updated active term'
  );
  assert(
    list.json.activeGlossary[persistentGlossarySourceTerm] === persistentGlossaryReplacementV2,
    'activeGlossary map should include latest replacement'
  );
}

async function createAnnouncement() {
  assert(seededUsers, 'seededUsers is required');
  const result = await post<AnnouncementResponse>('/admin/announcements', {
    title: sourceAnnouncement.title,
    content: sourceAnnouncement.content,
    category: 'announcement',
    status: 'published',
    translations: announcementTranslations
  }, seededUsers.adminCookie);
  assert(result.status >= 200 && result.status < 300, `announcement create failed with ${result.status}: ${result.text}`);
  assert(result.json.id, 'created announcement should include id');
  return result.json;
}

async function updateAnnouncementTranslations(announcementId: string, translations: TranslationMap) {
  assert(seededUsers, 'seededUsers is required');
  const result = await post<AnnouncementResponse>(`/admin/announcements/${announcementId}/update`, {
    translations
  }, seededUsers.adminCookie);
  assert(result.status === 200 || result.status === 201, `announcement update failed with ${result.status}: ${result.text}`);
  return result.json;
}

async function updateSiteContent() {
  assert(seededUsers, 'seededUsers is required');
  const result = await post<SiteContentResponse>('/admin/site-content', siteContentPayload(), seededUsers.adminCookie);
  assert(result.status === 200 || result.status === 201, `site-content update failed with ${result.status}: ${result.text}`);
  assert(result.json.translations?.['en-US']?._locked === true, 'site-content should preserve _locked metadata');
}

async function assertAdminListExposesTranslationWorkflowMetadata(announcementId: string) {
  assert(seededUsers, 'seededUsers is required');
  const result = await request<AdminAnnouncementListResponse>({
    method: 'GET',
    baseUrl: API_BASE_URL,
    path: '/admin/announcements',
    cookie: seededUsers.adminCookie
  });
  assert(result.status === 200, `admin announcement list failed with ${result.status}: ${result.text}`);
  const item = result.json.items.find((entry) => entry.id === announcementId);
  assert(item, 'admin list should include the translated announcement');
  assert(item.translations?.fr?._status === 'machine_draft', 'admin list should expose fr machine_draft status');
  assert(item.translations?.fr?._locked !== true, 'admin list should expose fr as unlocked machine draft');
  assert(item.translations?.['en-US']?._status === 'human_reviewed', 'admin list should expose en-US human_reviewed status');
  assert(item.translations?.['en-US']?._locked === true, 'admin list should expose en-US locked status');
  assert(item.translationWorkflow, 'admin list should expose translation workflow summary');
  assert(item.translationWorkflow.languages.includes('fr'), 'translation workflow should list fr');
  assert(item.translationWorkflow.languages.includes('en-US'), 'translation workflow should list en-US');
  const frWorkflow = item.translationWorkflow.entries.find((entry) => entry.language === 'fr');
  const enWorkflow = item.translationWorkflow.entries.find((entry) => entry.language === 'en-US');
  assert(frWorkflow?.status === 'machine_draft', 'translation workflow should expose fr machine_draft status');
  assert(frWorkflow.locked === false, 'translation workflow should expose fr as unlocked machine draft');
  assert(enWorkflow?.status === 'human_reviewed', 'translation workflow should expose en-US human_reviewed status');
  assert(enWorkflow.locked === true, 'translation workflow should expose en-US locked status');
  assert(item.translationWorkflow.counts.machineDraft >= 1, 'translation workflow should count machine drafts');
  assert(item.translationWorkflow.counts.humanReviewed >= 1, 'translation workflow should count human reviewed entries');
  assert(item.translationWorkflow.counts.locked >= 1, 'translation workflow should count locked entries');
}

async function assertInvalidTranslationPayloads(announcementId: string) {
  assert(seededUsers, 'seededUsers is required');
  const invalidLanguage = await post(`/admin/announcements/${announcementId}/update`, {
    translations: {
      'bad language': {
        title: 'bad',
        content: 'bad'
      }
    }
  }, seededUsers.adminCookie);
  assert(invalidLanguage.status === 400, `invalid language should be 400, got ${invalidLanguage.status}`);

  const invalidMetadata = await post(`/admin/announcements/${announcementId}/update`, {
    translations: {
      'en-US': {
        title: 'bad',
        content: 'bad',
        _locked: 'not-a-boolean'
      }
    }
  }, seededUsers.adminCookie);
  assert(invalidMetadata.status === 400, `invalid _locked should be 400, got ${invalidMetadata.status}`);
}

async function assertLocalizedPublicContent(announcementId: string) {
  for (const language of ['zh-CN', 'en-US', 'es', 'es-ES', 'fr', 'fr-FR', 'ja', 'ja-JP'] as const) {
    const apiAnnouncement = await getAnnouncements(API_BASE_URL, '/announcements', language);
    assertAnnouncementLocale(apiAnnouncement.json, announcementId, language);
    assertAnnouncementSectionTitlesLocale(apiAnnouncement.json, language, `api announcement ${language}`);
    assertNoSourceLeak(apiAnnouncement.text, language, `api announcement ${language}`);

    const webAnnouncement = await getAnnouncements(WEB_BASE_URL, '/api/announcements', language);
    assertAnnouncementLocale(webAnnouncement.json, announcementId, language);
    assertAnnouncementSectionTitlesLocale(webAnnouncement.json, language, `web announcement ${language}`);
    assertNoSourceLeak(webAnnouncement.text, language, `web announcement ${language}`);

    const apiSite = await getSiteContent(API_BASE_URL, '/site-content', language);
    assertSiteContentLocale(apiSite.json, language);
    assertNoSourceLeak(apiSite.text, language, `api site ${language}`);

    const webSite = await getSiteContent(WEB_BASE_URL, '/api/site-content', language);
    assertSiteContentLocale(webSite.json, language);
    assertNoSourceLeak(webSite.text, language, `web site ${language}`);
  }

  for (const language of ['es-ES', 'fr-FR', 'ja-JP'] as const) {
    const html = await getPublicPageHtml('/announcements', language);
    assertPublicAnnouncementPageHtml(html, language);
    assertNoSourceLeak(html, language, `public announcements page ${language}`);
  }
}

async function assertAcceptLanguageFallback(announcementId: string) {
  const result = await request<AnnouncementFeedResponse>({
    method: 'GET',
    baseUrl: API_BASE_URL,
    path: '/announcements',
    headers: { 'accept-language': 'es-ES,es;q=0.9' }
  });
  assert(result.status === 200, `Accept-Language announcement request failed with ${result.status}`);
  assertAnnouncementLocale(result.json, announcementId, 'es');
  assertAnnouncementSectionTitlesLocale(result.json, 'es', 'Accept-Language announcement es');
}

async function assertPublicMetadataIsolation() {
  const announcement = await getAnnouncements(API_BASE_URL, '/announcements', 'en-US');
  assert(!announcement.text.includes('_locked'), 'public announcement feed leaked _locked');
  assert(!announcement.text.includes('_status'), 'public announcement feed leaked _status');
  assert(!announcement.text.includes('translations'), 'public announcement feed leaked translations');
  assert(!announcement.text.includes('_source'), 'public announcement feed leaked _source');
  assert(!announcement.text.includes('machine_draft'), 'public announcement feed leaked machine_draft');

  const site = await getSiteContent(API_BASE_URL, '/site-content', 'en-US');
  assert(!site.text.includes('_locked'), 'public site-content leaked _locked');
  assert(!site.text.includes('_status'), 'public site-content leaked _status');
  assert(!site.text.includes('translations'), 'public site-content leaked translations');
  assert(!site.text.includes('_source'), 'public site-content leaked _source');
  assert(!site.text.includes('machine_draft'), 'public site-content leaked machine_draft');
}

async function assertAuditLogs(announcementId: string) {
  const count = await db.adminAuditLog.count({
    where: {
      action: 'announcement_updated',
      targetId: announcementId
    }
  });
  assert(count > 0, 'announcement_updated audit log should exist');
}

function assertAnnouncementLocale(feed: AnnouncementFeedResponse, announcementId: string, language: string) {
  const item = feed.sections.flatMap((section) => section.items).find((entry) => entry.id === announcementId);
  assert(item, `announcement ${announcementId} missing for ${language}`);

  const expected = expectedAnnouncement(language);
  assert(item.title === expected.title, `announcement title mismatch for ${language}: ${item.title}`);
  assert(item.content === expected.content, `announcement content mismatch for ${language}: ${item.content}`);
}

function assertAnnouncementSectionTitlesLocale(feed: AnnouncementFeedResponse, language: string, label: string) {
  const sections = new Map(feed.sections.map((section) => [section.key, section.title]));
  const expected = expectedAnnouncementSections(language);
  const defaultChinese = expectedAnnouncementSections('zh-CN');
  const defaultEnglish = expectedAnnouncementSections('en-US');

  for (const [key, title] of Object.entries(expected)) {
    const actual = sections.get(key);
    assert(actual === title, `${label} section ${key} title mismatch: expected "${title}", got "${actual ?? '<missing>'}"`);
    if (!isChinese(language)) {
      assert(actual !== defaultChinese[key], `${label} section ${key} should not fall back to Chinese title`);
    }
    if (!isChinese(language) && getLanguageBase(language) !== 'en') {
      assert(actual !== defaultEnglish[key], `${label} section ${key} should not fall back to English title`);
    }
  }
}

function assertPublicAnnouncementPageHtml(html: string, language: string) {
  assert(html.includes('data-qa="public-announcements-page"'), `public announcements page missing body marker for ${language}`);

  const expectedAnnouncementCopy = expectedAnnouncement(language);
  assert(
    html.includes(expectedAnnouncementCopy.title),
    `public announcements page title mismatch for ${language}: expected ${expectedAnnouncementCopy.title}`
  );
  assert(
    html.includes(expectedAnnouncementCopy.content),
    `public announcements page content mismatch for ${language}: expected ${expectedAnnouncementCopy.content}`
  );

  const expectedSections = expectedAnnouncementSections(language);
  for (const [key, title] of Object.entries(expectedSections)) {
    assert(html.includes(title), `public announcements page section ${key} mismatch for ${language}: expected ${title}`);
  }
}

function assertSiteContentLocale(payload: SiteContentResponse, language: string) {
  const expected = expectedSiteContent(language);
  assert(payload.home.title === expected.homeTitle, `site home title mismatch for ${language}: ${payload.home.title}`);
  assert(payload.home.subtitle === expected.homeSubtitle, `site home subtitle mismatch for ${language}: ${payload.home.subtitle}`);
  assert(payload.home.content === expected.homeContent, `site home content mismatch for ${language}: ${payload.home.content}`);
  assert(payload.popup.enabled === true, 'site popup should remain enabled');
  assert(payload.popup.title === expected.popupTitle, `site popup title mismatch for ${language}: ${payload.popup.title}`);
  assert(payload.popup.content === expected.popupContent, `site popup content mismatch for ${language}: ${payload.popup.content}`);
}

function assertNoSourceLeak(text: string, language: string, label: string) {
  if (isChinese(language)) {
    return;
  }

  for (const forbidden of [
    sourceAnnouncement.title,
    sourceAnnouncement.content,
    sourceSiteContent.homeTitle,
    sourceSiteContent.homeSubtitle,
    sourceSiteContent.homeContent,
    sourceSiteContent.popupTitle,
    sourceSiteContent.popupContent
  ]) {
    assert(!text.includes(forbidden), `${label} leaked Chinese source text`);
  }
}

function setQaTranslationEnv() {
  const providerKey = 'AUTO_TRANSLATE_PROVIDER';
  const targetsKey = 'AUTO_TRANSLATE_TARGET_LANGUAGES';
  translationEnvRestore.set(providerKey, process.env[providerKey]);
  translationEnvRestore.set(targetsKey, process.env[targetsKey]);

  process.env[providerKey] = 'disabled';
  const existingTargets = process.env[targetsKey];
  const normalizedExistingTargets = (existingTargets ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const requiredTargets = ['en-US', 'es', 'fr', 'ja'];
  if (requiredTargets.some((target) => !normalizedExistingTargets.includes(target))) {
    process.env[targetsKey] = requiredTargets.join(',');
  }

  return () => {
    for (const [key, value] of translationEnvRestore.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    translationEnvRestore.clear();
  };
}

function getConfiguredAutoTranslateTargets() {
  return (process.env.AUTO_TRANSLATE_TARGET_LANGUAGES ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTranslationPayload(input: unknown): TranslationMap {
  if (input === null || input === undefined || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  return input as TranslationMap;
}

function translationEntryOrNull(value: unknown) {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, TranslationValue>;
}

function isBackendDraftSource(value: string) {
  const normalized = value.toLowerCase();
  return (
    normalized === 'custom-http' ||
    normalized.includes('backend') ||
    normalized.includes('auto') ||
    normalized.includes('draft') ||
    normalized.includes('system') ||
    normalized.includes('provider') ||
    normalized.includes('preparation')
  );
}

async function readAnnouncementTranslations(announcementId: string, fromResponse?: TranslationMap) {
  const direct = normalizeTranslationPayload(fromResponse);
  if (Object.keys(direct).length > 0) {
    return direct;
  }

  const row = await db.announcement.findUniqueOrThrow({
    where: { id: announcementId },
    select: { translations: true }
  });
  return normalizeTranslationPayload(row.translations);
}

async function assertAnnouncementDraftPreparation(announcementId: string, translationsFromCreate: TranslationMap | null | undefined) {
  const translations = await readAnnouncementTranslations(announcementId, translationsFromCreate ?? undefined);
  const configuredTargets = getConfiguredAutoTranslateTargets();
  const draftTargets = configuredTargets.filter((lang) => lang !== 'en-US' && lang !== 'es');
  const protectedBrandTerm = 'Azure Planet Relay';

  if (configuredTargets.includes('fr')) {
    assert(draftTargets.includes('fr'), 'configured translation targets must include fr draft coverage');
  }
  if (configuredTargets.includes('ja')) {
    assert(draftTargets.includes('ja'), 'configured translation targets must include ja draft coverage');
  }
  assert(draftTargets.length > 0, 'publish-time translation target list should include a non-manual language');

  for (const lang of draftTargets) {
    const entry = translationEntryOrNull(translations[lang]);
    assert(entry !== null, `published announcement should include draft metadata for ${lang}`);
    assert(entry._status === 'machine_draft', `${lang} draft metadata should be machine_draft`);
    assert(typeof entry.title === 'string', `${lang} draft metadata should include title`);
    assert(entry.title.trim().length > 0, `${lang} draft title should be non-empty`);
    assert(typeof entry.content === 'string', `${lang} draft metadata should include content`);
    assert(entry.content.trim().length > 0, `${lang} draft content should be non-empty`);
    assert(
      entry.title.includes(protectedBrandTerm),
      `${lang} draft title should preserve protected brand term "${protectedBrandTerm}"`
    );
    assert(
      entry.content.includes(protectedBrandTerm),
      `${lang} draft content should preserve protected brand term "${protectedBrandTerm}"`
    );
    assert(
      entry.title.includes(persistentGlossaryReplacementV2),
      `${lang} draft title should use latest persistent glossary replacement`
    );
    assert(
      !entry.title.includes(persistentGlossarySourceTerm),
      `${lang} draft title should not leak persistent glossary source term`
    );
    assert(
      entry.content.includes(persistentGlossaryReplacementV2),
      `${lang} draft content should use latest persistent glossary replacement`
    );
    assert(
      !entry.content.includes(persistentGlossarySourceTerm),
      `${lang} draft content should not leak persistent glossary source term`
    );
    assert(typeof entry._source === 'string', `${lang} draft metadata should include _source`);
    assert(entry._source.length > 0, `${lang} draft _source should be set`);
    assert(
      isBackendDraftSource(entry._source),
      `${lang} _source should indicate backend/preparation draft origin, got ${entry._source}`
    );
    assert(entry._locked !== true, `${lang} draft should remain unlocked`);
  }
}

async function assertLockedManualTranslationsRemain(
  input: {
    translations: TranslationMap | null | undefined;
    announcementId: string;
  },
  context: {
    operation: 'admin_create' | 'admin_update';
  }
) {
  const { announcementId, translations } = input;
  const normalized = await readAnnouncementTranslations(announcementId, translations ?? undefined);

  for (const language of ['en-US', 'es']) {
    const manual = translationEntryOrNull(normalized[language]);
    assert(manual !== null, `${context.operation} should preserve manual ${language} translation metadata`);
    assert(manual._locked === true, `${context.operation} should keep manual ${language} _locked=true`);
    assert(manual._status === 'human_reviewed', `${context.operation} should keep manual ${language} _status=human_reviewed`);
    assert(manual._source === 'qa-manual', `${context.operation} should keep manual ${language} _source='qa-manual'`);
  }
}

function expectedAnnouncement(language: string) {
  if (isChinese(language)) {
    return sourceAnnouncement;
  }

  const base = getLanguageBase(language);
  const translations = base === 'fr'
    ? { title: `${marker} Titre francais`, content: `${marker} Contenu francais` }
    : base === 'es'
      ? announcementTranslations.es
      : announcementTranslations['en-US'];

  return {
    title: String(translations.title),
    content: String(translations.content)
  };
}

function expectedAnnouncementSections(language: string): Record<string, string> {
  if (isChinese(language)) {
    return {
      announcement: '平台公告',
      update_log: '更新日志',
      usage_guide: '使用建议'
    };
  }

  const base = getLanguageBase(language);
  if (base === 'es') {
    return {
      announcement: 'Anuncios de la plataforma',
      update_log: 'Registro de actualizaciones',
      usage_guide: 'Consejos de uso'
    };
  }
  if (base === 'fr') {
    return {
      announcement: 'Annonces de la plateforme',
      update_log: 'Journal des mises a jour',
      usage_guide: 'Conseils d utilisation'
    };
  }
  if (base === 'ja') {
    return {
      announcement: 'プラットフォームのお知らせ',
      update_log: '更新履歴',
      usage_guide: '使い方のヒント'
    };
  }

  return {
    announcement: 'Platform announcements',
    update_log: 'Update log',
    usage_guide: 'Usage tips'
  };
}

function expectedSiteContent(language: string) {
  if (isChinese(language)) {
    return sourceSiteContent;
  }

  const base = getLanguageBase(language);
  const translations = base === 'fr'
    ? siteContentTranslations.fr
    : base === 'es'
      ? siteContentTranslations.es
      : siteContentTranslations['en-US'];
  return {
    homeTitle: String(translations.homeTitle),
    homeSubtitle: String(translations.homeSubtitle),
    homeContent: String(translations.homeContent),
    popupTitle: String(translations.popupTitle),
    popupContent: String(translations.popupContent)
  };
}

function siteContentPayload() {
  return {
    homeTitle: sourceSiteContent.homeTitle,
    homeSubtitle: sourceSiteContent.homeSubtitle,
    homeContent: sourceSiteContent.homeContent,
    homeFontFamily: 'system',
    homeTextColor: '#111827',
    homeAccentColor: '#2563eb',
    popupEnabled: true,
    popupTitle: sourceSiteContent.popupTitle,
    popupContent: sourceSiteContent.popupContent,
    popupFontFamily: 'system',
    popupTextColor: '#111827',
    popupAccentColor: '#2563eb',
    translations: siteContentTranslations
  };
}

async function seedUsers(): Promise<SeededUsers> {
  const passwordHash = await bcryptHash(password, 12);
  const adminUsername = `${marker}_admin`;
  const userUsername = `${marker}_user`;

  const group = await db.userGroup.upsert({
    where: { code: 'default' },
    update: {},
    create: { code: 'default', name: 'Default group' }
  });

  const admin = await db.user.create({
    data: {
      username: adminUsername,
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      groupId: group.id,
      inviteCode: `${marker}_admin_invite`
    }
  });

  const user = await db.user.create({
    data: {
      username: userUsername,
      passwordHash,
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      groupId: group.id,
      inviteCode: `${marker}_user_invite`
    }
  });

  await db.wallet.createMany({
    data: [{ userId: admin.id }, { userId: user.id }]
  });

  const adminCookie = await login(adminUsername);
  const userCookie = await login(userUsername);

  return {
    adminId: admin.id,
    userId: user.id,
    adminCookie,
    userCookie
  };
}

async function login(username: string) {
  const result = await post<LoginResponse>('/auth/login', { username, password });
  assert(result.status === 200 || result.status === 201, `login ${username} failed with ${result.status}: ${result.text}`);
  assert(result.json.user.username === username, `login username mismatch for ${username}`);
  assert(result.cookie.length > 0, `login ${username} should return cookie`);
  return result.cookie;
}

async function readExistingSiteContent() {
  return db.siteContentConfig.findUnique({ where: { id: 'default' } });
}

async function restoreSiteContent(snapshot: SiteContentSnapshot | null) {
  if (!snapshot) {
    await db.siteContentConfig.deleteMany({ where: { id: 'default' } });
    return;
  }

  const data = {
    homeTitle: snapshot.homeTitle,
    homeSubtitle: snapshot.homeSubtitle,
    homeContent: snapshot.homeContent,
    homeFontFamily: snapshot.homeFontFamily,
    homeTextColor: snapshot.homeTextColor,
    homeAccentColor: snapshot.homeAccentColor,
    popupEnabled: snapshot.popupEnabled,
    popupTitle: snapshot.popupTitle,
    popupContent: snapshot.popupContent,
    popupFontFamily: snapshot.popupFontFamily,
    popupTextColor: snapshot.popupTextColor,
    popupAccentColor: snapshot.popupAccentColor,
    translations: jsonOrDbNull(snapshot.translations),
    updatedByAdminId: snapshot.updatedByAdminId,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt
  };

  await db.siteContentConfig.upsert({
    where: { id: snapshot.id },
    update: data,
    create: { id: snapshot.id, ...data }
  });
}

async function cleanup() {
  const userIds = seededUsers ? [seededUsers.adminId, seededUsers.userId] : [];

  await db.adminAuditLog.deleteMany({
    where: {
      OR: [
        ...(userIds.length ? [{ adminUserId: { in: userIds } }] : []),
        ...(createdAnnouncementId ? [{ targetId: createdAnnouncementId }] : []),
        ...(createdGlossaryTermId ? [{ targetId: createdGlossaryTermId }] : [])
      ]
    }
  });
  await db.securityAuditLog.deleteMany({
    where: {
      OR: [
        ...(userIds.length ? [{ actorUserId: { in: userIds } }] : []),
        ...(createdAnnouncementId ? [{ targetId: createdAnnouncementId }] : [])
      ]
    }
  });
  if (createdAnnouncementId || userIds.length) {
    await db.announcement.deleteMany({
      where: {
        OR: [
          ...(createdAnnouncementId ? [{ id: createdAnnouncementId }] : []),
          ...(userIds.length ? [{ createdByAdminId: { in: userIds } }] : []),
          { title: { startsWith: marker } }
        ]
      }
    });
  }
  await db.translationGlossaryTerm.deleteMany({
    where: {
      OR: [
        ...(createdGlossaryTermId ? [{ id: createdGlossaryTermId }] : []),
        { sourceTerm: { startsWith: marker } },
        { replacementTerm: { startsWith: marker } }
      ]
    }
  });
  if (userIds.length) {
    await db.session.deleteMany({ where: { userId: { in: userIds } } });
    await db.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

function getAnnouncements(baseUrl: string, path: string, language: string) {
  return request<AnnouncementFeedResponse>({
    method: 'GET',
    baseUrl,
    path,
    query: { language }
  });
}

function getSiteContent(baseUrl: string, path: string, language: string) {
  return request<SiteContentResponse>({
    method: 'GET',
    baseUrl,
    path,
    query: { language }
  });
}

async function getPublicPageHtml(path: string, language: string) {
  const response = await fetch(buildUrl(WEB_BASE_URL, path, { language }), {
    headers: {
      accept: 'text/html',
      'accept-language': language
    }
  });
  const text = await response.text();
  assert(response.status === 200, `public page ${path} ${language} failed with ${response.status}: ${text.slice(0, 200)}`);
  return text;
}

function post<T = unknown>(path: string, body: unknown, cookie?: string) {
  return request<T>({
    method: 'POST',
    baseUrl: API_BASE_URL,
    path,
    body,
    cookie
  });
}

async function request<T>(input: {
  method: 'GET' | 'POST';
  baseUrl: string;
  path: string;
  body?: unknown;
  cookie?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}): Promise<HttpResult<T>> {
  const response = await fetch(buildUrl(input.baseUrl, input.path, input.query), {
    method: input.method,
    headers: {
      accept: 'application/json',
      ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(input.cookie ? { cookie: input.cookie } : {}),
      ...(input.headers ?? {})
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body)
  });

  const text = await response.text();
  let json: T;
  try {
    json = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    json = {} as T;
  }

  return {
    status: response.status,
    json,
    text,
    cookie: extractSessionCookie(response)
  };
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string>) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function extractSessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookieHeaders = headers.getSetCookie ? headers.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
  return cookieHeaders
    .filter(Boolean)
    .map((header) => header.split(';')[0])
    .join('; ');
}

function isChinese(language: string) {
  return language.toLowerCase().startsWith('zh');
}

function getLanguageBase(language: string) {
  return language.trim().split('-')[0]?.toLowerCase() ?? language.toLowerCase();
}

function jsonOrDbNull(value: unknown) {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
