import { resolveLocalizedText, type TranslationScalar } from './localized-content';

type TranslationFields = Record<string, string | null | undefined>;
type TranslationRecord = Record<string, Record<string, TranslationScalar>>;
type AutoTranslateProvider = 'google-public' | 'custom-http' | 'disabled' | 'not-configured';

type AutoTranslateInput = {
  translations: unknown;
  language?: string | null;
  fields: TranslationFields;
  maxLengths?: Record<string, number>;
  glossary?: Record<string, string> | null;
};

type PrepareTranslationDraftsInput = {
  translations: unknown;
  fields: TranslationFields;
  maxLengths?: Record<string, number>;
  targetLanguages?: string[] | null;
  glossary?: Record<string, string> | null;
};

export type AutoTranslateResult = {
  values: Record<string, string | null>;
  translations: TranslationRecord | null;
  changed: boolean;
  errors: string[];
};

const DEFAULT_TIMEOUT_MS = 6000;
const GOOGLE_TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const DEFAULT_DRAFT_TARGET_LANGUAGES = [
  'zh-TW',
  'en-US',
  'es-ES',
  'fr-FR',
  'de-DE',
  'pt-BR',
  'ja-JP',
  'ko-KR',
  'ru-RU',
  'ar-EG',
  'sw-KE',
  'am-ET',
  'ha-NG',
  'yo-NG',
  'ig-NG',
  'zu-ZA',
  'af-ZA',
  'so-SO',
  'rw-RW',
  'om-ET',
  'hi-IN',
  'id-ID',
  'tr-TR',
  'vi-VN',
  'th-TH',
  'it-IT',
  'nl-NL',
  'pl-PL',
  'uk-UA',
  'ms-MY',
  'fa-IR'
];
const BUILT_IN_GLOSSARY: Record<string, string> = {
  'Azure Planet Relay': 'Azure Planet Relay',
  'Azure Planet': 'Azure Planet',
  API: 'API',
  GPT: 'GPT',
  Claude: 'Claude',
  Gemini: 'Gemini'
};
const SOURCE_FALLBACK_DRAFT_SOURCE = 'source_fallback_draft';
const SOURCE_FALLBACK_DRAFT_SOURCES = new Set([
  SOURCE_FALLBACK_DRAFT_SOURCE,
  'provider_disabled',
  'provider_not_configured'
]);
const PUBLIC_GOOGLE_IN_PRODUCTION_OPT_IN = 'AUTO_TRANSLATE_ALLOW_PUBLIC_GOOGLE_IN_PRODUCTION';
const CUSTOM_TRANSLATE_URL_KEY = 'AUTO_TRANSLATE_CUSTOM_URL';
const CUSTOM_TRANSLATE_API_KEY_KEY = 'AUTO_TRANSLATE_CUSTOM_API_KEY';
const CUSTOM_TRANSLATE_API_KEY_HEADER_KEY = 'AUTO_TRANSLATE_CUSTOM_API_KEY_HEADER';

export async function resolveAutoTranslatedFields(input: AutoTranslateInput): Promise<AutoTranslateResult> {
  const language = normalizeLanguageCode(input.language);
  const targetLanguage = getProviderTargetLanguage(language);
  const provider = getAutoTranslateProvider();
  const nextTranslations = cloneTranslations(input.translations);
  const values: Record<string, string | null> = {};
  const errors: string[] = [];
  let changed = false;

  for (const [field, rawFallback] of Object.entries(input.fields)) {
    const fallback = normalizeSourceText(rawFallback);
    const directValue = findLocalizedField(nextTranslations, language, field);
    if (directValue) {
      values[field] = directValue;
      continue;
    }

    if (!language || !targetLanguage || !fallback || !isActiveTranslateProvider(provider) || isTranslationLocked(nextTranslations, language)) {
      values[field] = resolveLocalizedText(nextTranslations, language, field, fallback);
      continue;
    }

    const protectedSource = protectGlossaryTerms(fallback, input.glossary);
    const translated = await translateText(provider, protectedSource.text, targetLanguage);
    if (!translated.text) {
      errors.push(`${field}: ${translated.error ?? 'empty translation'}`);
      values[field] = resolveLocalizedText(nextTranslations, language, field, fallback);
      continue;
    }

    const normalizedTranslation = truncateToMaxLength(
      restoreGlossaryTerms(translated.text, protectedSource.terms),
      input.maxLengths?.[field]
    );
    if (!normalizedTranslation) {
      values[field] = resolveLocalizedText(nextTranslations, language, field, fallback);
      continue;
    }

    const existingLanguageRecord = nextTranslations[language] ?? {};
    nextTranslations[language] = {
      ...existingLanguageRecord,
      [field]: normalizedTranslation,
      _locked: existingLanguageRecord._locked === true,
      _status: 'machine_draft',
      _source: provider,
      _updatedAt: new Date().toISOString()
    };
    values[field] = normalizedTranslation;
    changed = true;
  }

  return {
    values,
    translations: Object.keys(nextTranslations).length > 0 ? nextTranslations : null,
    changed,
    errors
  };
}

export async function prepareAutoTranslationDrafts(input: PrepareTranslationDraftsInput): Promise<{
  translations: TranslationRecord | null;
  changed: boolean;
  errors: string[];
  preparedLanguages: string[];
}> {
  let nextTranslations = cloneTranslations(input.translations);
  const errors: string[] = [];
  const preparedLanguages: string[] = [];
  const updatedAt = new Date().toISOString();
  const shouldTranslateDraftText = shouldUseProviderForPreparedDrafts();
  let changed = false;

  for (const language of getAutoTranslateTargetLanguages(input.targetLanguages)) {
    if (isTranslationLocked(nextTranslations, language)) {
      continue;
    }

    if (shouldTranslateDraftText) {
      const translated = await resolveAutoTranslatedFields({
        translations: nextTranslations,
        language,
        fields: input.fields,
        maxLengths: input.maxLengths,
        glossary: input.glossary
      });
      if (translated.translations) {
        nextTranslations = translated.translations;
      }
      if (translated.changed) {
        changed = true;
      }
      errors.push(...translated.errors.map((error) => `${language}: ${error}`));
    }

    const draftFields = Object.keys(input.fields);
    if (hasAllTranslationText(nextTranslations, language, draftFields)) {
      preparedLanguages.push(language);
      continue;
    }

    const languageRecord = getTranslationRecord(nextTranslations, language) ?? {};
    const canonicalLanguage = normalizeLanguageCode(language) ?? language;
    const sourceFallbackFields = buildSourceFallbackDraftFields(
      languageRecord,
      input.fields,
      input.maxLengths,
      input.glossary
    );
    nextTranslations[canonicalLanguage] = {
      ...languageRecord,
      ...sourceFallbackFields,
      _locked: languageRecord._locked === true,
      _status: 'machine_draft',
      _source: Object.keys(sourceFallbackFields).length > 0 ? SOURCE_FALLBACK_DRAFT_SOURCE : getPreparedDraftSource(),
      _updatedAt: updatedAt
    };
    preparedLanguages.push(canonicalLanguage);
    changed = true;
  }

  return {
    translations: Object.keys(nextTranslations).length > 0 ? nextTranslations : null,
    changed,
    errors,
    preparedLanguages: Array.from(new Set(preparedLanguages))
  };
}

function shouldUseProviderForPreparedDrafts() {
  return isActiveTranslateProvider(getAutoTranslateProvider());
}

function getPreparedDraftSource() {
  const provider = getAutoTranslateProvider();
  if (isActiveTranslateProvider(provider)) {
    return provider;
  }
  if (provider === 'not-configured') {
    return 'provider_not_configured';
  }
  return SOURCE_FALLBACK_DRAFT_SOURCE;
}

function getAutoTranslateProvider(): AutoTranslateProvider {
  if (process.env.AUTO_TRANSLATE_DISABLED?.trim().toLowerCase() === 'true') {
    return 'disabled';
  }

  const provider = process.env.AUTO_TRANSLATE_PROVIDER?.trim().toLowerCase();
  if (provider === 'none' || provider === 'disabled') {
    return 'disabled';
  }
  if (provider === 'google-public') {
    return isProductionEnvironment() && !isPublicGoogleAllowedInProduction() ? 'disabled' : 'google-public';
  }
  if (provider === 'custom-http') {
    return getCustomTranslateUrl() ? 'custom-http' : 'not-configured';
  }
  if (provider) {
    return 'disabled';
  }

  return process.env.NODE_ENV === 'production' ? 'disabled' : 'google-public';
}

function isProductionEnvironment() {
  return process.env.NODE_ENV?.trim().toLowerCase() === 'production';
}

function isPublicGoogleAllowedInProduction() {
  return process.env[PUBLIC_GOOGLE_IN_PRODUCTION_OPT_IN]?.trim().toLowerCase() === 'true';
}

function isActiveTranslateProvider(provider: AutoTranslateProvider): provider is 'google-public' | 'custom-http' {
  return provider === 'google-public' || provider === 'custom-http';
}

function getAutoTranslateTargetLanguages(targetLanguages?: string[] | null) {
  const configured = targetLanguages?.length ? targetLanguages : parseTargetLanguages(process.env.AUTO_TRANSLATE_TARGET_LANGUAGES);
  const languages = configured.length ? configured : DEFAULT_DRAFT_TARGET_LANGUAGES;
  return Array.from(
    new Set(
      languages
        .map((language) => normalizeDraftLanguageCode(language))
        .filter((language): language is string => Boolean(language && language.toLowerCase() !== 'zh-cn'))
    )
  );
}

function normalizeDraftLanguageCode(value: string | null | undefined) {
  const normalized = normalizeLanguageCode(value);
  if (!normalized) {
    return null;
  }

  const [baseLanguage] = normalized.split('-');
  if (baseLanguage === 'zh') {
    return normalized.toLowerCase().includes('-tw') ||
      normalized.toLowerCase().includes('-hk') ||
      normalized.toLowerCase().includes('-mo') ||
      normalized.toLowerCase().includes('-hant')
      ? 'zh-TW'
      : 'zh-CN';
  }
  if (baseLanguage === 'en') {
    return 'en-US';
  }
  return baseLanguage;
}

function parseTargetLanguages(value: string | undefined) {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((language) => language.trim())
    .filter(Boolean);
}

function getProviderTargetLanguage(language: string | null) {
  if (!language) {
    return null;
  }

  const lowerLanguage = language.toLowerCase();
  const [baseLanguage] = lowerLanguage.split('-');
  if (baseLanguage === 'zh') {
    if (
      lowerLanguage.includes('-tw') ||
      lowerLanguage.includes('-hk') ||
      lowerLanguage.includes('-mo') ||
      lowerLanguage.includes('-hant')
    ) {
      return 'zh-TW';
    }
    return null;
  }
  return baseLanguage;
}

async function translateText(
  provider: 'google-public' | 'custom-http',
  text: string,
  targetLanguage: string
): Promise<{ text: string | null; error?: string }> {
  if (provider === 'custom-http') {
    return translateWithCustomHttp(text, targetLanguage);
  }
  return translateWithPublicGoogle(text, targetLanguage);
}

async function translateWithPublicGoogle(text: string, targetLanguage: string): Promise<{ text: string | null; error?: string }> {
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(GOOGLE_TRANSLATE_URL);
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', 'auto');
    url.searchParams.set('tl', targetLanguage);
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', text);

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'nested-relay-localizer/1.0'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return { text: null, error: `provider ${response.status}` };
    }

    const parsed = parseGoogleTranslation(await response.json());
    return parsed ? { text: parsed } : { text: null, error: 'provider returned no text' };
  } catch (error) {
    return {
      text: null,
      error: error instanceof Error ? error.message : 'provider request failed'
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function translateWithCustomHttp(text: string, targetLanguage: string): Promise<{ text: string | null; error?: string }> {
  const endpoint = getCustomTranslateUrl();
  if (!endpoint) {
    return { text: null, error: 'custom provider url is not configured' };
  }

  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...getCustomTranslateAuthHeaders()
      },
      body: JSON.stringify({
        sourceLanguage: 'auto',
        targetLanguage,
        text
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return { text: null, error: `provider ${response.status}` };
    }

    const parsed = parseCustomHttpTranslation(await response.json());
    return parsed ? { text: parsed } : { text: null, error: 'provider returned no text' };
  } catch (error) {
    return {
      text: null,
      error: error instanceof Error ? error.message : 'provider request failed'
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getCustomTranslateUrl() {
  const rawUrl = process.env[CUSTOM_TRANSLATE_URL_KEY]?.trim();
  if (!rawUrl) {
    return null;
  }

  try {
    return new URL(rawUrl).toString();
  } catch {
    return null;
  }
}

function getCustomTranslateAuthHeaders() {
  const apiKey = process.env[CUSTOM_TRANSLATE_API_KEY_KEY]?.trim();
  if (!apiKey) {
    return {};
  }

  const configuredHeader = process.env[CUSTOM_TRANSLATE_API_KEY_HEADER_KEY]?.trim();
  const headerName = configuredHeader || 'Authorization';
  const headerValue = headerName.toLowerCase() === 'authorization' ? `Bearer ${apiKey}` : apiKey;
  return { [headerName]: headerValue };
}

function parseCustomHttpTranslation(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  for (const field of ['translatedText', 'translation', 'text']) {
    const candidate = value[field];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  const data = value.data;
  if (isRecord(data)) {
    for (const field of ['translatedText', 'translation', 'text']) {
      const candidate = data[field];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return null;
}

function parseGoogleTranslation(value: unknown) {
  if (!Array.isArray(value) || !Array.isArray(value[0])) {
    return null;
  }

  const text = value[0]
    .map((segment) => {
      if (!Array.isArray(segment)) {
        return '';
      }
      return typeof segment[0] === 'string' ? segment[0] : '';
    })
    .join('')
    .trim();

  return text || null;
}

function isTranslationLocked(translations: TranslationRecord, language: string) {
  return getLanguageCandidates(language).some((languageKey) => {
    const fields = getTranslationRecord(translations, languageKey);
    return fields?._locked === true || fields?._status === 'manual_locked';
  });
}

function protectGlossaryTerms(text: string, glossary?: Record<string, string> | null) {
  const terms: Array<{ placeholder: string; replacement: string }> = [];
  let nextText = text;

  for (const [source, replacement] of getGlossaryTerms(glossary)) {
    const term = source.trim();
    if (!term || !nextText.includes(term)) {
      continue;
    }

    const placeholder = `NRTTERM${terms.length}NRT`;
    nextText = nextText.replace(new RegExp(escapeRegExp(term), 'g'), placeholder);
    terms.push({ placeholder, replacement });
  }

  return { text: nextText, terms };
}

function restoreGlossaryTerms(text: string, terms: Array<{ placeholder: string; replacement: string }>) {
  let nextText = text;
  for (const term of terms) {
    nextText = nextText.replace(new RegExp(escapeRegExp(term.placeholder), 'g'), term.replacement);
  }
  return nextText;
}

function getGlossaryTerms(runtimeGlossary?: Record<string, string> | null) {
  const glossary = { ...BUILT_IN_GLOSSARY, ...getEnvGlossary(), ...normalizeRuntimeGlossary(runtimeGlossary) };
  return Object.entries(glossary).sort(([left], [right]) => right.length - left.length);
}

function getEnvGlossary() {
  const rawGlossary = process.env.AUTO_TRANSLATE_GLOSSARY?.trim();
  if (!rawGlossary) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawGlossary) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
  } catch {
    return {};
  }
}

function normalizeRuntimeGlossary(value?: Record<string, string> | null) {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([source, replacement]) => [source.trim(), replacement.trim()] as const)
      .filter(([source, replacement]) => source.length > 0 && replacement.length > 0)
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTimeoutMs() {
  const timeout = Number(process.env.AUTO_TRANSLATE_TIMEOUT_MS);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
}

function truncateToMaxLength(value: string, maxLength?: number) {
  const text = value.trim();
  if (!text) {
    return null;
  }
  return maxLength && text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

function normalizeSourceText(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  return text || null;
}

function findLocalizedField(translations: TranslationRecord, language: string | null, field: string) {
  if (!language) {
    return null;
  }

  for (const languageKey of getLanguageCandidates(language)) {
    const fields = getTranslationRecord(translations, languageKey);
    if (fields && isSourceFallbackDraftRecord(fields)) {
      continue;
    }
    const value = fields?.[field];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return null;
}

function hasAllTranslationText(translations: TranslationRecord, language: string, fields: string[]) {
  return getLanguageCandidates(language).some((languageKey) => {
    const record = getTranslationRecord(translations, languageKey);
    return Boolean(
      record &&
        fields.every((field) => {
          const value = record[field];
          return typeof value === 'string' && value.trim().length > 0;
        })
    );
  });
}

function buildSourceFallbackDraftFields(
  languageRecord: Record<string, TranslationScalar>,
  fields: TranslationFields,
  maxLengths?: Record<string, number>,
  glossary?: Record<string, string> | null
) {
  const draftFields: Record<string, string> = {};

  for (const [field, rawSource] of Object.entries(fields)) {
    const existingValue = languageRecord[field];
    if (typeof existingValue === 'string' && existingValue.trim()) {
      continue;
    }

    const source = normalizeSourceText(rawSource);
    if (!source) {
      continue;
    }

    const draft = truncateToMaxLength(applyGlossaryReplacements(source, glossary), maxLengths?.[field]);
    if (draft) {
      draftFields[field] = draft;
    }
  }

  return draftFields;
}

function applyGlossaryReplacements(text: string, glossary?: Record<string, string> | null) {
  let nextText = text;
  for (const [source, replacement] of getGlossaryTerms(glossary)) {
    const term = source.trim();
    if (!term || !nextText.includes(term)) {
      continue;
    }
    nextText = nextText.replace(new RegExp(escapeRegExp(term), 'g'), replacement);
  }
  return nextText;
}

function isSourceFallbackDraftRecord(record: Record<string, TranslationScalar>) {
  const status = typeof record._status === 'string' ? record._status.trim().toLowerCase() : '';
  const source = typeof record._source === 'string' ? record._source.trim().toLowerCase() : '';
  return status === 'machine_draft' && SOURCE_FALLBACK_DRAFT_SOURCES.has(source);
}

function getTranslationRecord(translations: TranslationRecord, languageKey: string) {
  const exactValue = translations[languageKey];
  if (exactValue) {
    return exactValue;
  }

  const matchedKey = Object.keys(translations).find((nextKey) => nextKey.toLowerCase() === languageKey.toLowerCase());
  return matchedKey ? translations[matchedKey] : null;
}

function getLanguageCandidates(language: string) {
  const normalized = normalizeLanguageCode(language);
  if (!normalized) {
    return [];
  }

  const baseLanguage = normalized.split('-')[0];
  const candidates = [normalized, normalized.toLowerCase(), baseLanguage, baseLanguage.toLowerCase()];
  if (baseLanguage === 'zh') {
    const normalizedLower = normalized.toLowerCase();
    if (
      normalizedLower.includes('-tw') ||
      normalizedLower.includes('-hk') ||
      normalizedLower.includes('-mo') ||
      normalizedLower.includes('-hant')
    ) {
      candidates.push('zh-TW', 'zh-tw', 'zh');
    } else {
      candidates.push('zh-CN', 'zh-cn', 'zh');
    }
  }

  return Array.from(new Set(candidates));
}

function normalizeLanguageCode(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) {
    return null;
  }

  const [base, ...regions] = text.replace(/_/g, '-').split('-');
  if (!base) {
    return null;
  }

  return [base.toLowerCase(), ...regions.map((region) => region.toUpperCase())].join('-');
}

function cloneTranslations(value: unknown): TranslationRecord {
  if (!isRecord(value)) {
    return {};
  }

  const next: TranslationRecord = {};
  for (const [language, fields] of Object.entries(value)) {
    if (typeof fields === 'string' && fields.trim()) {
      next[language] = { title: fields.trim() };
      continue;
    }
    if (!isRecord(fields)) {
      continue;
    }

    const nextFields: Record<string, TranslationScalar> = {};
    for (const [field, rawValue] of Object.entries(fields)) {
      if (typeof rawValue === 'string' && rawValue.trim()) {
        nextFields[field] = rawValue.trim();
        continue;
      }
      if (field.startsWith('_') && typeof rawValue === 'boolean') {
        nextFields[field] = rawValue;
      }
    }
    if (Object.keys(nextFields).length > 0) {
      next[language] = nextFields;
    }
  }

  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
