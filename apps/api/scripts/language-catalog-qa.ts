import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts = require('typescript');
import { pageTerm, type PageTermKey } from '../../web/app/lib/page-copy-terms';
import {
  getLanguageLabel,
  supportedLanguages as runtimeSupportedLanguages,
  type LanguageCode
} from '../../web/app/lib/i18n';

type SourceFile = {
  filePath: string;
  text: string;
  tree: ts.SourceFile;
};

type LanguageEntry = {
  code: string;
  direction: string | null;
  label: string;
  shortLabel: string;
};

const ROOT_DIR = path.resolve(__dirname, '../../..');
const checks: string[] = [];

async function main() {
  const i18n = await readSource('apps/web/app/lib/i18n.ts');
  const autoTranslate = await readSource('apps/api/src/i18n/auto-translate.ts');
  const releaseGate = await readSource('apps/api/scripts/release-gate-qa.ts');
  const releaseGateDoc = await readSource('docs/quality/release-gate.md');
  const publicCopy = await readSource('apps/web/app/lib/public-copy.ts');
  const publicDocsPage = await readSource('apps/web/app/docs/page.tsx');
  const userHomePage = await readSource('apps/web/app/account/page.tsx');
  const userLogPage = await readSource('apps/web/app/log/page.tsx');
  const userAiRechargePage = await readSource('apps/web/app/ai-recharge/page.tsx');
  const userModelsPage = await readSource('apps/web/app/models/page.tsx');
  const userRechargePage = await readSource('apps/web/app/account/topup/recharge/page.tsx');
  const userNotificationPage = await readSource('apps/web/app/account/notificationSettings/page.tsx');
  const userProfilePage = await readSource('apps/web/app/account/profile/page.tsx');
  const userExperiencePage = await readSource('apps/web/app/experience/page.tsx');
  const userTokenPage = await readSource('apps/web/app/token/page.tsx');
  const userExperienceApi = await readSource('apps/web/app/lib/experience-api.ts');
  const userAiRechargeApi = await readSource('apps/web/app/lib/ai-recharge-api.ts');
  const userAuthApi = await readSource('apps/web/app/lib/auth-api.ts');
  const userNotificationsApi = await readSource('apps/web/app/lib/notifications-api.ts');
  const userPricingApi = await readSource('apps/web/app/lib/pricing-api.ts');
  const userRechargeApi = await readSource('apps/web/app/lib/recharge-api.ts');
  const userTokenApi = await readSource('apps/web/app/lib/token-api.ts');
  const userUsageLogApi = await readSource('apps/web/app/lib/usage-log-api.ts');
  const userApiErrorCopy = await readSource('apps/web/app/lib/api-error-copy.ts');
  const publicAnnouncementsApi = await readSource('apps/web/app/lib/announcements-api.ts');
  const publicSiteContentApi = await readSource('apps/web/app/lib/site-content-api.ts');
  const pageCopyTerms = await readSource('apps/web/app/lib/page-copy-terms.ts');
  const billingFormat = await readSource('apps/web/app/lib/billing-format.ts');
  const announcementsService = await readSource('apps/api/src/announcements/announcements.service.ts');
  const loginPage = await readSource('apps/web/app/login/page.tsx');
  const registerPage = await readSource('apps/web/app/register/page.tsx');
  const consoleShell = await readSource('apps/web/app/components/console-shell.tsx');
  const merchantShell = await readSource('apps/web/app/components/merchant-shell.tsx');
  const languageProvider = await readSource('apps/web/app/components/language-provider.tsx');
  const languageSwitcher = await readSource('apps/web/app/components/language-switcher.tsx');
  const userNotificationProxy = await readSource('apps/web/app/api/notifications/[[...path]]/route.ts');
  const userRechargeProxy = await readSource('apps/web/app/api/recharge/[[...path]]/route.ts');
  const userTokenProxy = await readSource('apps/web/app/api/tokens/[[...path]]/route.ts');
  const userUsageProxy = await readSource('apps/web/app/api/usage/[[...path]]/route.ts');

  const supportedLanguages = extractLanguageEntries(i18n, 'supportedLanguages');
  const supportedCodes = supportedLanguages.map((entry) => entry.code);
  const draftTargetLanguages = extractStringArray(autoTranslate, 'DEFAULT_DRAFT_TARGET_LANGUAGES');

  assertUnique('supportedLanguages', supportedCodes);
  assert(
    supportedCodes.length >= 30,
    `supportedLanguages should cover mainstream global locales, got only ${supportedCodes.length}`
  );
  assert(supportedCodes.includes('ja-JP'), 'supportedLanguages must include ja-JP for Japanese users');
  assert(supportedCodes.includes('en-US'), 'supportedLanguages must include en-US for global English users');
  assert(supportedCodes.includes('zh-CN'), 'supportedLanguages must include zh-CN as the source/default user language');
  checks.push('frontend_supported_language_catalog_has_global_market_coverage');

  assertLanguageSelectorLabelsHaveReadableUnicode(supportedLanguages);
  checks.push('language_selector_labels_use_readable_native_unicode');

  assertConstString(i18n, 'defaultLanguage', 'zh-CN');
  checks.push('default_console_language_is_explicit');

  assertI18nCatalogHasNoMojibake(i18n);
  checks.push('i18n_catalog_labels_and_core_copy_do_not_render_mojibake');

  assertI18nCorePacksAvoidEnglishFallbacks(i18n, supportedCodes);
  checks.push('i18n_core_auth_nav_packs_do_not_fallback_to_english_only');

  const expectedDraftTargets = supportedCodes.filter((code) => code !== 'zh-CN');
  assertSameSet('DEFAULT_DRAFT_TARGET_LANGUAGES', draftTargetLanguages, expectedDraftTargets);
  checks.push('backend_translation_draft_targets_match_supported_languages');

  assert(
    i18n.text.includes('satisfies Record<LanguageCode, LanguagePack>'),
    'frontend language packs must keep compile-time coverage for every supported language'
  );
  checks.push('frontend_language_packs_have_compile_time_coverage');

  assertRtlCoverage(supportedLanguages);
  checks.push('rtl_language_direction_coverage_is_explicit');

  assertUserConsoleRuntimeCopyCoverage(
    userHomePage,
    userLogPage,
    userAiRechargePage,
    userModelsPage,
    userRechargePage,
    userNotificationPage,
    userProfilePage,
    userExperiencePage,
    userTokenPage,
    pageCopyTerms
  );
  checks.push('user_console_dynamic_sections_use_runtime_language_copy');

  assertUserHomeAnnouncementsFollowSelectedLanguage(userHomePage, consoleShell);
  checks.push('user_home_announcements_follow_selected_language');

  assertDefaultChinesePageTermsAvoidEnglishFallback(pageCopyTerms);
  checks.push('default_chinese_page_terms_do_not_fallback_to_language_label_plus_english');

  assertAllSupportedPageTermsAvoidEnglishFallback(pageCopyTerms, supportedCodes);
  checks.push('all_supported_page_terms_do_not_fallback_to_language_label_plus_english');

  assertUserProfileRequestsCarrySelectedLanguage([
    ['user AI recharge page', userAiRechargePage],
    ['user recharge page', userRechargePage],
    ['user profile page', userProfilePage],
    ['user experience page', userExperiencePage],
    ['user token page', userTokenPage],
    ['console shell', consoleShell]
  ]);
  checks.push('user_profile_requests_carry_selected_language');

  assertUserExperienceModelsCarrySelectedLanguage(userExperiencePage, userExperienceApi);
  checks.push('user_experience_models_carry_selected_language');

  assertUserNextApiProxiesForwardSelectedLanguage([
    ['notification proxy', userNotificationProxy],
    ['recharge proxy', userRechargeProxy],
    ['token proxy', userTokenProxy],
    ['usage proxy', userUsageProxy]
  ]);
  checks.push('user_next_api_proxies_forward_selected_language');

  assertModelPricingCopyCoverage(supportedCodes, userModelsPage);
  checks.push('model_marketplace_copy_overrides_cover_supported_language_catalog');

  assertVibePackageLabelCoverage(supportedCodes, userAiRechargePage);
  checks.push('vibecoding_package_labels_cover_supported_language_catalog');

  assertUserFacingLocalizedErrorFallbacks([
    ['user home page', userHomePage],
    ['login page', loginPage],
    ['register page', registerPage],
    ['user log page', userLogPage],
    ['user AI recharge page', userAiRechargePage],
    ['user models page', userModelsPage],
    ['user recharge page', userRechargePage],
    ['user notification settings page', userNotificationPage],
    ['user profile page', userProfilePage],
    ['user experience page', userExperiencePage],
    ['user token page', userTokenPage]
  ]);
  checks.push('user_facing_errors_use_localized_fallbacks_instead_of_raw_backend_messages');

  assertUserContentApiErrorsDoNotExposeRawBackendMessages([
    ['user auth API', userAuthApi],
    ['user experience API', userExperienceApi],
    ['user AI recharge API', userAiRechargeApi],
    ['user notification settings API', userNotificationsApi],
    ['user pricing API', userPricingApi],
    ['user recharge API', userRechargeApi],
    ['user token API', userTokenApi],
    ['user usage log API', userUsageLogApi],
    ['public announcements API', publicAnnouncementsApi],
    ['public site content API', publicSiteContentApi],
    ['user API error copy helper', userApiErrorCopy]
  ]);
  checks.push('user_content_api_errors_do_not_expose_raw_backend_messages');

  assertBillingFormatHasNoMojibake(billingFormat);
  checks.push('billing_format_outputs_do_not_render_mojibake');

  assertUserRechargeCopyHasNoMojibake(userRechargePage);
  checks.push('user_recharge_copy_outputs_do_not_render_mojibake');

  assertAnnouncementSectionTranslationCoverage(supportedCodes, announcementsService);
  checks.push('announcement_section_titles_cover_supported_language_catalog');

  assertPublicSiteCoreCopyNoMojibake(publicCopy, publicDocsPage);
  checks.push('public_site_core_copy_no_mojibake_for_supported_languages');
  checks.push('public_docs_core_copy_no_mojibake_for_zh_ja');

  assertPublicSearchOptimizationArtifactsRemoved();
  checks.push('public_search_optimization_artifacts_are_not_generated');

  assertLanguageSelectorBoundary(loginPage, registerPage, consoleShell, merchantShell, languageProvider, languageSwitcher);
  checks.push('user_entry_and_console_keep_language_selector_while_merchant_shell_has_none');
  checks.push('language_selector_uses_saas_menu_not_native_select');

  for (const phrase of [
    'qa:language-catalog',
    'language_catalog_matches_frontend_backend_translation_targets',
    'user_entry_and_console_keep_language_selector_while_merchant_shell_has_none',
    'user_next_api_proxies_forward_selected_language',
    'billing_format_outputs_do_not_render_mojibake',
    'user_recharge_copy_outputs_do_not_render_mojibake',
    'public_site_core_copy_no_mojibake_for_supported_languages',
    'public_docs_core_copy_no_mojibake_for_zh_ja',
    'all_supported_page_terms_do_not_fallback_to_language_label_plus_english',
    'user_home_announcements_follow_selected_language',
    'chrome_user_experience_localized_no_source_leak_smoke',
    'chrome_user_notification_settings_localized_no_source_leak_smoke',
    'chrome_user_recharge_localized_no_source_leak_smoke',
    'chrome_user_ai_recharge_localized_smoke',
    'chrome_user_log_localized_no_source_leak_smoke',
    'chrome_user_token_localized_no_source_leak_smoke',
    'language_selector_uses_saas_menu_not_native_select',
    'language_selector_labels_use_readable_native_unicode'
  ]) {
    assert(releaseGate.text.includes(phrase), `release-gate script missing ${phrase}`);
    assert(releaseGateDoc.text.includes(phrase), `release-gate doc missing ${phrase}`);
  }
  checks.push('release_gate_documents_and_runs_language_catalog_guard');

  console.log(JSON.stringify({ ok: true, languageCount: supportedCodes.length, checks }, null, 2));
}

async function readSource(relativePath: string): Promise<SourceFile> {
  const filePath = path.join(ROOT_DIR, relativePath);
  const text = await readFile(filePath, 'utf8');
  return {
    filePath,
    text,
    tree: ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  };
}

function extractLanguageEntries(source: SourceFile, name: string): LanguageEntry[] {
  const expression = unwrapExpression(findConstInitializer(source, name));
  assert(ts.isArrayLiteralExpression(expression), `${name} must be an array literal`);

  return expression.elements.map((element, index) => {
    const object = unwrapExpression(element);
    assert(ts.isObjectLiteralExpression(object), `${name}[${index}] must be an object literal`);
    const code = getObjectStringProperty(object, 'code');
    assert(code, `${name}[${index}].code must be a string literal`);
    const label = getObjectStringProperty(object, 'label');
    const shortLabel = getObjectStringProperty(object, 'shortLabel');
    assert(label, `${name}[${index}].label must be a string literal`);
    assert(shortLabel, `${name}[${index}].shortLabel must be a string literal`);
    return {
      code,
      direction: getObjectStringProperty(object, 'direction'),
      label,
      shortLabel
    };
  });
}

function extractStringArray(source: SourceFile, name: string): string[] {
  const expression = unwrapExpression(findConstInitializer(source, name));
  assert(ts.isArrayLiteralExpression(expression), `${name} must be an array literal`);

  return expression.elements.map((element, index) => {
    const value = unwrapExpression(element);
    assert(ts.isStringLiteralLike(value), `${name}[${index}] must be a string literal`);
    return value.text;
  });
}

function extractPageTermKeys(source: SourceFile): PageTermKey[] {
  const declaration = source.tree.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === 'PageTermKey'
  );
  assert(declaration, 'PageTermKey type alias must exist');
  assert(ts.isUnionTypeNode(declaration.type), 'PageTermKey must stay a string literal union');

  return declaration.type.types.map((node, index) => {
    assert(
      ts.isLiteralTypeNode(node) && ts.isStringLiteralLike(node.literal),
      `PageTermKey[${index}] must be a string literal`
    );
    return node.literal.text as PageTermKey;
  });
}

function assertAllSupportedPageTermsAvoidEnglishFallback(pageCopyTerms: SourceFile, supportedCodes: string[]) {
  const pageTermKeys = extractPageTermKeys(pageCopyTerms);
  assert(pageTermKeys.length >= 100, `PageTermKey coverage looks too small: ${pageTermKeys.length}`);

  const runtimeCodes = runtimeSupportedLanguages.map((entry) => entry.code);
  assertSameSet('runtime supportedLanguages', runtimeCodes, supportedCodes);

  for (const code of runtimeCodes) {
    const language = code as LanguageCode;
    const label = getLanguageLabel(language);
    const leakedKeys = pageTermKeys.filter((key) => pageTerm(language, key).startsWith(`${label} `));
    assert(
      leakedKeys.length === 0,
      `${code} page terms must not render language-label English fallback: ${leakedKeys.join(', ')}`
    );
  }
}

function assertConstString(source: SourceFile, name: string, expected: string) {
  const expression = unwrapExpression(findConstInitializer(source, name));
  assert(ts.isStringLiteralLike(expression), `${name} must be a string literal`);
  assert(expression.text === expected, `${name} should be ${expected}, got ${expression.text}`);
}

function findConstInitializer(source: SourceFile, name: string): ts.Expression {
  const queue: ts.Node[] = [...source.tree.statements];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      continue;
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      return node.initializer;
    }

    node.forEachChild((child) => {
      queue.push(child);
    });
  }

  throw new Error(`Could not find const initializer ${name} in ${source.filePath}`);
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let next = expression;
  while (
    ts.isAsExpression(next) ||
    ts.isSatisfiesExpression(next) ||
    ts.isParenthesizedExpression(next) ||
    ts.isTypeAssertionExpression(next)
  ) {
    next = next.expression;
  }
  return next;
}

function getObjectStringProperty(object: ts.ObjectLiteralExpression, name: string) {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const key = property.name;
    if (!ts.isIdentifier(key) && !ts.isStringLiteralLike(key)) {
      continue;
    }
    if (key.text !== name) {
      continue;
    }
    const value = unwrapExpression(property.initializer);
    return ts.isStringLiteralLike(value) ? value.text : null;
  }
  return null;
}

function assertSameSet(label: string, actual: string[], expected: string[]) {
  assertUnique(label, actual);
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((item) => !actualSet.has(item));
  const extra = actual.filter((item) => !expectedSet.has(item));
  assert(
    missing.length === 0 && extra.length === 0,
    `${label} mismatch. missing=${missing.join(', ') || '<none>'}; extra=${extra.join(', ') || '<none>'}`
  );
}

function assertUnique(label: string, values: string[]) {
  const seen = new Set<string>();
  const duplicates = values.filter((value) => {
    if (seen.has(value)) {
      return true;
    }
    seen.add(value);
    return false;
  });
  assert(duplicates.length === 0, `${label} contains duplicate languages: ${duplicates.join(', ')}`);
}

function assertRtlCoverage(supportedLanguages: LanguageEntry[]) {
  const rtlLanguages = supportedLanguages.filter((entry) => entry.direction === 'rtl').map((entry) => entry.code);
  assertSameSet('rtl supported languages', rtlLanguages, ['ar-EG', 'fa-IR']);
}

function assertLanguageSelectorLabelsHaveReadableUnicode(supportedLanguages: LanguageEntry[]) {
  const expectedNativeLabels: Record<string, { label: string; shortLabel: string }> = {
    'zh-CN': { label: '简体中文', shortLabel: '中文' },
    'zh-TW': { label: '繁體中文', shortLabel: '繁中' },
    'es-ES': { label: 'Español', shortLabel: 'ES' },
    'fr-FR': { label: 'Français', shortLabel: 'FR' },
    'pt-BR': { label: 'Português', shortLabel: 'PT' },
    'ja-JP': { label: '日本語', shortLabel: '日本語' },
    'ko-KR': { label: '한국어', shortLabel: '한국어' },
    'ru-RU': { label: 'Русский', shortLabel: 'RU' },
    'ar-EG': { label: 'العربية', shortLabel: 'AR' },
    'am-ET': { label: 'አማርኛ', shortLabel: 'AM' },
    'yo-NG': { label: 'Yorùbá', shortLabel: 'YO' },
    'hi-IN': { label: 'हिन्दी', shortLabel: 'HI' },
    'tr-TR': { label: 'Türkçe', shortLabel: 'TR' },
    'vi-VN': { label: 'Tiếng Việt', shortLabel: 'VI' },
    'th-TH': { label: 'ไทย', shortLabel: 'TH' },
    'uk-UA': { label: 'Українська', shortLabel: 'UK' },
    'fa-IR': { label: 'فارسی', shortLabel: 'FA' }
  };

  for (const [code, expected] of Object.entries(expectedNativeLabels)) {
    const entry = supportedLanguages.find((language) => language.code === code);
    assert(entry, `supportedLanguages missing native label check target ${code}`);
    assert(entry.label === expected.label, `${code} label must be readable native Unicode: ${entry.label}`);
    assert(entry.shortLabel === expected.shortLabel, `${code} shortLabel must be readable native Unicode: ${entry.shortLabel}`);
    assert(
      getLanguageLabel(code as LanguageCode) === expected.label,
      `${code} runtime language label must match readable native Unicode`
    );
  }
}

function assertUserConsoleRuntimeCopyCoverage(
  userHomePage: SourceFile,
  userLogPage: SourceFile,
  userAiRechargePage: SourceFile,
  userModelsPage: SourceFile,
  userRechargePage: SourceFile,
  userNotificationPage: SourceFile,
  userProfilePage: SourceFile,
  userExperiencePage: SourceFile,
  userTokenPage: SourceFile,
  pageCopyTerms: SourceFile
) {
  assert(userHomePage.text.includes("const { language, t } = useI18n()"), 'user home page must read selected runtime language');
  for (const key of [
    'admin',
    'leaderboard',
    'rank',
    'calls',
    'cost',
    'currentUser',
    'tokenManagement',
    'createToken',
    'availableModels',
    'notificationSettings',
    'notificationChannels',
    'eventSubscriptions',
    'deliveryRecords'
  ]) {
    assert(pageCopyTerms.text.includes(`| '${key}'`), `page copy terms missing ${key}`);
  }

  for (const phrase of ['Token leaderboard', '<th>Rank</th>', '<th>User</th>', '<th>Calls</th>', '<th>Cost</th>', '>You<', 'No leaderboard data']) {
    assert(!userLogPage.text.includes(phrase), `user log page still hardcodes runtime leaderboard copy: ${phrase}`);
  }

  for (const phrase of ['copy.leaderboard', 'copy.rank', 'copy.user', 'copy.calls', 'copy.cost', 'copy.currentUser', 'copy.noLeaderboardData']) {
    assert(userLogPage.text.includes(phrase), `user log page missing localized leaderboard copy binding: ${phrase}`);
  }

  assert(
    !userAiRechargePage.text.includes('Quota configurable by merchant'),
    'user AI recharge page still hardcodes quota fallback copy'
  );
  assert(
    userAiRechargePage.text.includes("pageTerm(language, 'quota')") &&
      userAiRechargePage.text.includes("pageTerm(language, 'notConfigured')") &&
      userAiRechargePage.text.includes("pageTerm(language, 'token')"),
    'user AI recharge quota fallback must use runtime language terms'
  );

  for (const phrase of [
    'const { language } = useI18n()',
    'const copy = getPricingCopy(language)',
    'getModelPricing(language)',
    'return applyCopyOverrides(base, PRICING_COPY_OVERRIDES[language]);',
    '<h1>{copy.title}</h1>',
    'copy.modelCount(pricing?.models.length ?? 0)',
    '<span>{copy.allModels}</span>',
    '<span>{copy.paidModels}</span>',
    '<span>{copy.searchResults}</span>',
    '<h2>{copy.billingPolicy}</h2>',
    '<strong>{copy.billingPolicyBody}</strong>',
    'placeholder={copy.searchPlaceholder}',
    'aria-label={copy.modelCategory}',
    '{copy.noModelsTitle}',
    '{copy.noModelsDescription}',
    '{copy.officialResource}',
    '<span>{copy.input}</span>',
    '<span>{copy.output}</span>',
    '{copy.supportsStreaming}',
    '{copy.standardOutput}',
    '{copy.copy}',
    '{copy.integrationHeading}',
    '{copy.integrationDescription}',
    'aria-label={copy.integrationExamples}',
    'copy.codeAria(guide.label)'
  ]) {
    assert(userModelsPage.text.includes(phrase), `user models page missing runtime language copy binding: ${phrase}`);
  }

  assert(
    !userRechargePage.text.includes("return parts.length ? parts.join(' / ') : 'VibeCoding package';"),
    'user recharge page still hardcodes VibeCoding package quota fallback'
  );
  assert(
    userRechargePage.text.includes("pageTerm(language, 'quota')") &&
      userRechargePage.text.includes("pageTerm(language, 'notConfigured')") &&
      userRechargePage.text.includes("pageTerm(language, 'token')"),
    'user recharge VibeCoding quota display must use runtime language terms'
  );
  for (const phrase of [
    "const { language } = useI18n()",
    'const copy = getRechargeCopy(language)',
    'return applyCopyOverrides(RECHARGE_COPY',
    "buyCodes: pageTerm(language, 'recharge')",
    "code: pageTerm(language, 'rechargeCode')",
    "empty: pageTerm(language, 'emptyRecords')",
    "records: pageTerm(language, 'records')",
    "redeem: pageTerm(language, 'apply')",
    "refresh: pageTerm(language, 'refresh')",
    "status: pageTerm(language, 'status')",
    "title: pageTerm(language, 'recharge')",
    '{copy.title}',
    '{copy.code}',
    '{copy.records}',
    '{copy.empty}',
    '{isRedeeming ? copy.redeeming : copy.redeem}',
    '<th>{copy.table.status}</th>',
    '<th>{copy.table.time}</th>'
  ]) {
    assert(userRechargePage.text.includes(phrase), `user recharge page missing runtime language copy binding: ${phrase}`);
  }

  for (const phrase of [
    'const { language } = useI18n()',
    'const copy = getTokenCopy(language)',
    'return applyCopyOverrides(base, getTokenCopyOverrides(language));',
    "title: pageTerm(language, 'tokenManagement')",
    "createToken: pageTerm(language, 'createToken')",
    "availableModels: pageTerm(language, 'availableModels')",
    '{copy.title}',
    '{copy.createToken}',
    '{copy.search}',
    'copy.statusLabels.active',
    'copy.table.availableModels'
  ]) {
    assert(userTokenPage.text.includes(phrase), `user token page missing runtime language copy binding: ${phrase}`);
  }
  assert(
    !userTokenPage.text.includes('return TOKEN_COPY[language];'),
    'user token page must not return the legacy zh-CN/zh-TW TOKEN_COPY object; it contains historical mojibake and must use runtime page terms'
  );
  assert(
    !userTokenPage.text.includes('nextError instanceof Error ? nextError.message'),
    'user token page must not expose raw backend Error.message in user-visible alerts; use localized copy fallbacks'
  );
  for (const phrase of [
    'setError(copy.loadFailed)',
    'setError(copy.saveFailed)',
    'setError(copy.resetFailed)',
    'setError(copy.deleteFailed)',
    'setError(copy.batchDeleteFailed)',
    'setError(copy.copyFullKeyFailed)',
    'setError(copy.copyFailed)'
  ]) {
    assert(userTokenPage.text.includes(phrase), `user token page missing localized error fallback: ${phrase}`);
  }

  for (const phrase of [
    'const { language } = useI18n()',
    'const copy = getNotificationCopy(language)',
    'return applyCopyOverrides(base, getNotificationCopyOverrides(language));',
    "title: pageTerm(language, 'notificationSettings')",
    "channels: pageTerm(language, 'notificationChannels')",
    "events: pageTerm(language, 'eventSubscriptions')",
    "deliveryRecords: pageTerm(language, 'deliveryRecords')",
    '{copy.title}',
    '{copy.events}',
    '{copy.channels}',
    '{copy.deliveryRecords}',
    'copy.channelStatuses.configured'
  ]) {
    assert(
      userNotificationPage.text.includes(phrase),
      `user notification settings page missing runtime language copy binding: ${phrase}`
    );
  }
  assert(
    !userNotificationPage.text.includes('email_sender_not_configured'),
    'user notification settings page must not expose the technical email_sender_not_configured fallback'
  );
  assert(
    userNotificationPage.text.includes("email?.lastTestError ?? copy.channelStatuses.notConfigured"),
    'user notification settings page email fallback must use localized notConfigured copy'
  );

  for (const phrase of [
    'unit="token"',
    'label={`${copy.rangeDays(rangeDays)} token`}',
    'value={`${formatNumber(todayUsage.totalTokens, language)} token`}',
    '<span>{formatNumber(entry.tokens, language)} token</span>',
    '<em>{entry.label}: {formatNumber(entry.tokens, language)} token</em>'
  ]) {
    assert(!userProfilePage.text.includes(phrase), `user profile page still hardcodes token unit copy: ${phrase}`);
  }

  for (const phrase of [
    "const tokenTerm = pageTerm(language, 'token')",
    'unit={tokenTerm}',
    'usageAverageDetail:',
    'usageFailureDetail:',
    'usageNote:'
  ]) {
    assert(userProfilePage.text.includes(phrase), `user profile page missing runtime language profile copy binding: ${phrase}`);
  }

  for (const phrase of [
    '<span>{copy.total} {formatTokenCount(message.usage.totalTokens, language)} token</span>',
    ' / Chat</small>'
  ]) {
    assert(!userExperiencePage.text.includes(phrase), `user experience page still hardcodes runtime copy: ${phrase}`);
  }

  for (const phrase of [
    "const tokenTerm = pageTerm(language, 'token')",
    'copy.modeChat',
    "billingNote: `${pageTerm(language, 'billing')}",
    "defaultAssistantReply: `${pageTerm(language, 'output')}",
    "defaultSystemPrompt: `AI ${pageTerm(language, 'model')}",
    "emptyPrompt: `${pageTerm(language, 'model')}",
    "promptPlaceholder: `${pageTerm(language, 'input')}",
    "requestFailed: `${pageTerm(language, 'send')}",
    "responding: `${pageTerm(language, 'loading')}"
  ]) {
    assert(userExperiencePage.text.includes(phrase), `user experience page missing runtime language copy binding: ${phrase}`);
  }
}

function assertDefaultChinesePageTermsAvoidEnglishFallback(pageCopyTerms: SourceFile) {
  for (const phrase of [
    'const ZH_CN_PAGE_TERMS',
    'const ZH_TW_PAGE_TERMS',
    "'zh-CN': ZH_CN_PAGE_TERMS",
    "'zh-TW': ZH_TW_PAGE_TERMS",
    "actions: '操作'",
    "balance: '余额'",
    "currentPassword: '当前密码'",
    "usageLogs: '使用日志'",
    "actions: '操作'",
    "balance: '餘額'",
    "currentPassword: '目前密碼'",
    "usageLogs: '使用日誌'"
  ]) {
    assert(pageCopyTerms.text.includes(phrase), `default Chinese page terms must avoid English fallback, missing: ${phrase}`);
  }
}

function assertVibePackageLabelCoverage(supportedCodes: string[], userAiRechargePage: SourceFile) {
  const labels = unwrapExpression(findConstInitializer(userAiRechargePage, 'VIBE_PACKAGE_LABELS'));
  assert(ts.isObjectLiteralExpression(labels), 'VIBE_PACKAGE_LABELS must be an object literal');

  const actualLanguages: string[] = [];
  const packageKeysByLanguage = new Map<string, Set<string>>();

  for (const property of labels.properties) {
    assert(ts.isPropertyAssignment(property), 'VIBE_PACKAGE_LABELS entries must be property assignments');
    const language = getPropertyNameText(property.name);
    assert(language, 'VIBE_PACKAGE_LABELS language key must be a string or identifier');
    const value = unwrapExpression(property.initializer);
    assert(ts.isObjectLiteralExpression(value), `VIBE_PACKAGE_LABELS.${language} must be an object literal`);

    actualLanguages.push(language);
    packageKeysByLanguage.set(
      language,
      new Set(
        value.properties.map((entry) => {
          assert(ts.isPropertyAssignment(entry), `VIBE_PACKAGE_LABELS.${language} package labels must be assignments`);
          const key = getPropertyNameText(entry.name);
          assert(key, `VIBE_PACKAGE_LABELS.${language} package key must be a string or identifier`);
          return key;
        })
      )
    );
  }

  assertSameSet('VIBE_PACKAGE_LABELS languages', actualLanguages, supportedCodes);

  for (const language of supportedCodes) {
    const keys = packageKeysByLanguage.get(language);
    assert(keys, `VIBE_PACKAGE_LABELS missing ${language}`);
    for (const preset of ['custom', 'daily', 'weekly']) {
      assert(keys.has(preset), `VIBE_PACKAGE_LABELS.${language} missing ${preset} label`);
    }
  }
}

function assertModelPricingCopyCoverage(supportedCodes: string[], userModelsPage: SourceFile) {
  const baseLanguages = new Set(['zh-CN', 'zh-TW', 'en-US']);
  const requiredOverrideLanguages = supportedCodes.filter((code) => !baseLanguages.has(code));
  const requiredFields = [
    'allModels',
    'billingPolicy',
    'billingPolicyBody',
    'billingPolicyHint',
    'close',
    'copy',
    'currentAccountAvailable',
    'input',
    'inputPrice',
    'integrationExamples',
    'loading',
    'loadFailed',
    'modelCategory',
    'officialResource',
    'output',
    'outputPrice',
    'paidModels',
    'pricingEyebrow',
    'refreshPrices',
    'searchPlaceholder',
    'searchResults',
    'supportsStreaming',
    'title'
  ];
  const expression = unwrapExpression(findConstInitializer(userModelsPage, 'PRICING_COPY_OVERRIDES'));
  assert(ts.isObjectLiteralExpression(expression), 'PRICING_COPY_OVERRIDES must be an object literal');

  const languageFields = new Map<string, Set<string>>();
  for (const property of expression.properties) {
    assert(ts.isPropertyAssignment(property), 'PRICING_COPY_OVERRIDES entries must be property assignments');
    const language = getPropertyNameText(property.name);
    assert(language, 'PRICING_COPY_OVERRIDES language key must be a string or identifier');
    const value = unwrapExpression(property.initializer);
    assert(ts.isObjectLiteralExpression(value), `PRICING_COPY_OVERRIDES.${language} must be an object literal`);
    languageFields.set(
      language,
      new Set(
        value.properties.map((entry) => {
          assert(ts.isPropertyAssignment(entry), `PRICING_COPY_OVERRIDES.${language} fields must be property assignments`);
          const field = getPropertyNameText(entry.name);
          assert(field, `PRICING_COPY_OVERRIDES.${language} field key must be a string or identifier`);
          return field;
        })
      )
    );
  }

  const missingLanguages = requiredOverrideLanguages.filter((language) => !languageFields.has(language));
  assert(
    missingLanguages.length === 0,
    `PRICING_COPY_OVERRIDES missing supported languages: ${missingLanguages.join(', ')}`
  );

  for (const language of requiredOverrideLanguages) {
    const fields = languageFields.get(language);
    assert(fields, `PRICING_COPY_OVERRIDES missing ${language}`);
    const missingFields = requiredFields.filter((field) => !fields.has(field));
    assert(
      missingFields.length === 0,
      `PRICING_COPY_OVERRIDES.${language} missing model marketplace copy fields: ${missingFields.join(', ')}`
    );
  }
}

function getPropertyNameText(name: ts.PropertyName) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function assertLanguageSelectorBoundary(
  loginPage: SourceFile,
  registerPage: SourceFile,
  consoleShell: SourceFile,
  merchantShell: SourceFile,
  languageProvider: SourceFile,
  languageSwitcher: SourceFile
) {
  for (const [label, source] of [
    ['login page', loginPage],
    ['register page', registerPage]
  ] as const) {
    for (const phrase of ["import { LanguageSwitcher } from '../components/language-switcher';", '<LanguageSwitcher variant="auth" />']) {
      assert(source.text.includes(phrase), `${label} must keep auth language selector binding: ${phrase}`);
    }
  }

  for (const phrase of ["import { LanguageSwitcher } from './language-switcher';", '<LanguageSwitcher />']) {
    assert(consoleShell.text.includes(phrase), `user console shell must keep language selector binding: ${phrase}`);
  }

  for (const phrase of ['LanguageSwitcher', 'language-switcher']) {
    assert(!merchantShell.text.includes(phrase), `merchant shell must not expose a language selector: ${phrase}`);
  }

  for (const phrase of ['<details', '<summary', 'role="listbox"', 'aria-selected={active}', 'language-switcher-menu']) {
    assert(languageSwitcher.text.includes(phrase), `language switcher must render a SaaS menu selector: ${phrase}`);
  }

  assert(!languageSwitcher.text.includes('<select'), 'language switcher must not regress to the native select UI');
  assert(languageSwitcher.text.includes('supportedLanguages.map'), 'language switcher must render every supported language option');

  for (const phrase of [
    "useState<LanguageCode>(defaultLanguage)",
    "window.addEventListener('relay-language-url-change', syncRequestedLanguage)",
    'window.history.pushState = function pushStateWithLanguageSync',
    'window.history.replaceState = function replaceStateWithLanguageSync',
    'window.removeEventListener(\'relay-language-url-change\', syncRequestedLanguage)'
  ]) {
    assert(
      languageProvider.text.includes(phrase),
      `language provider must sync URL-selected language across console navigation without hydration mismatch, missing: ${phrase}`);
  }
}

function assertUserProfileRequestsCarrySelectedLanguage(sources: Array<readonly [string, SourceFile]>) {
  for (const [label, source] of sources) {
    assert(
      !source.text.includes('getProfile()'),
      `${label} must pass the selected language into getProfile(language) so user-visible model/profile data localizes with the language selector`
    );
  }
}

function assertUserExperienceModelsCarrySelectedLanguage(experiencePage: SourceFile, experienceApi: SourceFile) {
  assert(
    experiencePage.text.includes('listExperienceModels(language)'),
    'user experience page must pass the selected language into listExperienceModels(language)'
  );
  assert(
    experienceApi.text.includes("withLanguage('/experience/models', language)") &&
      experienceApi.text.includes("headers['Accept-Language'] = language"),
    'experience model API helper must send selected language through query string and Accept-Language'
  );
}

function assertUserNextApiProxiesForwardSelectedLanguage(sources: Array<readonly [string, SourceFile]>) {
  for (const [label, source] of sources) {
    for (const phrase of [
      "request.headers.get('accept-language')",
      "headers.set('Accept-Language', acceptLanguage)"
    ]) {
      assert(source.text.includes(phrase), `${label} must forward selected Accept-Language through the Next API proxy`);
    }
  }
}

function assertUserFacingLocalizedErrorFallbacks(sources: Array<readonly [string, SourceFile]>) {
  for (const [label, source] of sources) {
    for (const forbidden of [
      'setError(loadError instanceof Error ? loadError.message',
      'setError(nextError instanceof Error ? nextError.message',
      'setError(nextMessage)',
      'setError(message)'
    ]) {
      assert(!source.text.includes(forbidden), `${label} must not expose raw backend Error.message through ${forbidden}`);
    }
  }
}

function assertUserContentApiErrorsDoNotExposeRawBackendMessages(sources: Array<readonly [string, SourceFile]>) {
  for (const [label, source] of sources) {
    const isSharedHelper = source.filePath.endsWith('api-error-copy.ts');
    if (!isSharedHelper) {
      assert(
        source.text.includes('createApiClientError('),
        `${label} must use createApiClientError(language, status, data) for user-visible API failure copy`
      );
    } else {
      assert(
        source.text.includes('getApiErrorMessage(') &&
          source.text.includes('class ApiClientError') &&
          source.text.includes('isAuthenticationApiError'),
        `${label} must centralize localized API failure copy and structured auth detection`
      );
    }

    for (const forbidden of [
      "body?.message",
      "'message' in data",
      'String((data as { message: unknown }).message)',
      '璇锋眰澶辫触',
      '璜嬫眰澶辨晽',
      'Failed to load announcements',
      'Failed to load site content',
      'Request failed'
    ]) {
      assert(!source.text.includes(forbidden), `${label} must not expose raw backend messages through ${forbidden}`);
    }
  }
}

function assertUserHomeAnnouncementsFollowSelectedLanguage(userHomePage: SourceFile, consoleShell: SourceFile) {
  for (const phrase of [
    "import { ConsoleShell } from '../components/console-shell'",
    "listPublishedAnnouncements(currentLanguage)",
    'useEffect(() => {',
    'void loadAnnouncements(language)',
    '}, [language])',
    "getLocalizedAnnouncementField(item, 'title', language)",
    "getLocalizedAnnouncementField(item, 'content', language)",
    'data-qa="user-home-announcement-popup"',
    'data-qa="user-home-announcements"'
  ]) {
    assert(userHomePage.text.includes(phrase), `user home announcements must follow selected language, missing: ${phrase}`);
  }

  assert(
    consoleShell.text.includes("{ href: '/account', labelKey: 'nav.home'") &&
      consoleShell.text.includes('<Link className="relay-console-brand" href="/account">'),
    'console shell home navigation must route logged-in users to the localized user home'
  );
}

function assertBillingFormatHasNoMojibake(source: SourceFile) {
  const mojibakeMarkers = [
    '\u00c2',
    '\u697c',
    '\u951f',
    '\u68f0',
    '\u8e47',
    '\u74d2',
    '\u7f07',
    '\u6d93',
    '\u93c4',
    '\ufffd'
  ];

  for (const marker of mojibakeMarkers) {
    assert(!source.text.includes(marker), `billing format must not contain mojibake marker ${marker}`);
  }

  for (const phrase of [
    'CNY ${',
    'non-negative CNY amount',
    'non-negative USD number',
    'minimum precision is 0.001 USD / 1M tokens',
    'stripCurrencyPrefix'
  ]) {
    assert(source.text.includes(phrase), `billing format missing readable currency guard: ${phrase}`);
  }
}

function assertUserRechargeCopyHasNoMojibake(source: SourceFile) {
  const mojibakeMarkers = [
    '褰撳墠',
    '鍏戞崲',
    '鍏屾彌',
    '鐝惧湪',
    '銉併儯',
    '鏀粯',
    '\ufffd'
  ];

  for (const marker of mojibakeMarkers) {
    assert(!source.text.includes(marker), `user recharge copy must not contain mojibake marker ${marker}`);
  }

  for (const phrase of [
    '当前账号',
    '目前帳號',
    '現在のアカウント',
    'チャージコード',
    'Recharge code'
  ]) {
    assert(source.text.includes(phrase), `user recharge copy missing readable localized phrase: ${phrase}`);
  }
}

function assertI18nCatalogHasNoMojibake(source: SourceFile) {
  const mojibakeMarkers = [
    '缁犫偓',
    '閺冦儲',
    '闋冩粔',
    '涓曡潮',
    '鏍℃郴',
    '\ufffd'
  ];

  for (const marker of mojibakeMarkers) {
    assert(!source.text.includes(marker), `i18n catalog/core copy must not contain mojibake marker ${marker}`);
  }

  for (const phrase of [
    '简体中文',
    '繁體中文',
    'Español',
    'Français',
    'Português',
    '日本語',
    '한국어',
    'Русский',
    'العربية',
    'हिन्दी',
    'Tiếng Việt',
    'ไทย',
    'فارسی',
    '蔚蓝星球中转站',
    'Azure Planet Relay'
  ]) {
    assert(source.text.includes(phrase), `i18n catalog/core copy missing readable UTF-8 phrase ${phrase}`);
  }
}
function assertI18nCorePacksAvoidEnglishFallbacks(source: SourceFile, supportedCodes: string[]) {
  assert(!source.text.includes('makeSimplePack('), 'i18n packs must not use simple language-only packs that leave core UI in English');
  assert(!source.text.includes('makeEuropeanPack('), 'i18n packs must not use partial helper packs that leave auth UI in English');
  assert(source.text.includes('const localizedCoreOverrides'), 'i18n packs must define localized core auth/common/nav overrides');
  assert(source.text.includes('function makeCorePack'), 'i18n packs must merge localized core overrides through makeCorePack');

  const manualLanguages = new Set(['zh-CN', 'zh-TW', 'en-US', 'es-ES']);
  const requiredCorePackLanguages = supportedCodes.filter((code) => !manualLanguages.has(code));
  const corePackLanguages = new Set(
    [...source.text.matchAll(/makeCorePack\('([^']+)'/g)].map((match) => match[1])
  );
  const missingCorePacks = requiredCorePackLanguages.filter((code) => !corePackLanguages.has(code));
  assert(
    missingCorePacks.length === 0,
    `i18n core auth/nav packs missing makeCorePack coverage: ${missingCorePacks.join(', ')}`
  );

  for (const code of requiredCorePackLanguages) {
    assert(
      source.text.includes(`'${code}':`) && source.text.includes(`makeCorePack('${code}'`),
      `i18n core pack must have localized override and makeCorePack binding for ${code}`
    );
  }

  for (const phrase of ['ログイン', '비밀번호', 'Войти', 'سجل الدخول', 'Tiếng Việt', 'ไทย', 'हिन्दी']) {
    assert(source.text.includes(phrase), `i18n core packs missing non-English auth phrase: ${phrase}`);
  }
}

function assertAnnouncementSectionTranslationCoverage(supportedCodes: string[], announcementsService: SourceFile) {
  const translationBlocks = [...announcementsService.text.matchAll(/translations:\s*\{([\s\S]*?)\n\s*\}/g)];
  assert(translationBlocks.length === 3, `announcement service should define 3 translated public sections, got ${translationBlocks.length}`);

  translationBlocks.forEach((block, index) => {
    const languageKeys = new Set(
      [...block[1].matchAll(/(?:'([^']+)'|([a-z]{2,3}(?:-[A-Z]{2})?))\s*:/g)]
        .map((match) => match[1] ?? match[2])
        .filter(Boolean)
    );
    const missing = supportedCodes.filter((code) => {
      if (code === 'zh-CN') {
        return false;
      }
      const base = code.split('-')[0];
      return !languageKeys.has(code) && !languageKeys.has(base);
    });
    assert(
      missing.length === 0,
      `announcement section ${index + 1} is missing translated titles for supported languages: ${missing.join(', ')}`
    );
  });
}

function assertPublicSiteCoreCopyNoMojibake(publicCopy: SourceFile, publicDocsPage: SourceFile) {
  for (const phrase of [
    'const readablePublicCopyOverrides',
    'readablePublicCopyOverrides[language] ?? publicCopies[language]',
    'const spanishPublicCopy',
    'const simplifiedChinesePublicCopy',
    'const traditionalChinesePublicCopy',
    'const japanesePublicCopy',
    "'es-ES': spanishPublicCopy",
    "'zh-CN': simplifiedChinesePublicCopy",
    "'zh-TW': traditionalChinesePublicCopy",
    "'ja-JP': japanesePublicCopy",
    'La entrada y la salida se facturan por separado.',
    'Crea un token dedicado para cada aplicacion.',
    'Supervisa fallos de upstream',
    '输入和输出分开计费。',
    '輸入和輸出分開計費。',
    '入力と出力は別々に課金されます。',
    'アプリごとに専用トークンを作成します。',
    '本番チェックリスト',
    '最終確認',
    '公開 API は正常です',
    '上流障害',
    "'zh-CN': { ...englishTerms",
    "'zh-TW': { ...englishTerms",
    "'ja-JP': { ...englishTerms",
    "'es-ES': { ...englishTerms",
    'OpenAI 兼容路径',
    'OpenAI 相容路徑',
    'OpenAI 互換パス',
    '快速开始',
    '快速開始',
    'クイックスタート',
    '生产检查清单',
    '生產檢查清單'
  ]) {
    assert(publicCopy.text.includes(phrase), `public site/docs copy missing readable core phrase: ${phrase}`);
  }

  const publicMojibakeMarkers = [
    '楠炲啿褰',
    '閺傚洦',
    '閵夊',
    '閵囧﹦',
    '娑擃叀娴',
    '閹恒儱鍙',
    'Mant鑼卬',
    'Og鑹',
    '琚ㄨ皭',
    '璩靛洘',
    '鍟剁亴',
    '鍠旀稄',
    'Ti宀',
    '鑹',
    '瑜岃',
    '璩辫巢'
  ];
  for (const marker of publicMojibakeMarkers) {
    assert(!publicCopy.text.includes(marker), `public site copy must not contain mojibake marker: ${marker}`);
  }

  for (const phrase of [
    'const copy = getPublicCopy(language)',
    '{copy.docsQuickstartBody}',
    '{copy.docsPathsTitle}',
    '{copy.docsChecklistTitle}',
    'copy.docsChecklistItems.map'
  ]) {
    assert(publicDocsPage.text.includes(phrase), `docs page must render localized public copy binding: ${phrase}`);
  }
}
function assertPublicSearchOptimizationArtifactsRemoved() {
  for (const relativePath of [
    'apps/web/app/sitemap.ts',
    'apps/web/app/robots.ts',
    'apps/web/public/og-image.svg'
  ]) {
    assert(!existsSync(path.join(ROOT_DIR, relativePath)), `search optimization artifact should not be generated: ${relativePath}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});


