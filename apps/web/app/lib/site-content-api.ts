import { createApiClientError } from './api-error-copy';

export type SiteFontFamily = 'system' | 'serif' | 'rounded' | 'mono';
export type LocaleText = string | null;
export type LocaleMap = Record<string, LocaleText>;
export type LocaleTextSource = LocaleText | LocaleMap;

type SiteContentLocaleCarrier = {
  i18n?: {
    title?: LocaleTextSource;
    subtitle?: LocaleTextSource;
    content?: LocaleTextSource;
  };
  translations?: {
    title?: LocaleTextSource;
    subtitle?: LocaleTextSource;
    content?: LocaleTextSource;
  };
  localized?: {
    title?: LocaleTextSource;
    subtitle?: LocaleTextSource;
    content?: LocaleTextSource;
  };
};

type SiteContentHomeBlock = {
  title: string;
  subtitle: string;
  content: string | null;
  fontFamily: SiteFontFamily;
  textColor: string;
  accentColor: string;
  titleI18n?: LocaleTextSource;
  subtitleI18n?: LocaleTextSource;
  contentI18n?: LocaleTextSource;
} & SiteContentLocaleCarrier;

type SiteContentPopupBlock = {
  enabled: boolean;
  title: string | null;
  content: string | null;
  fontFamily: SiteFontFamily;
  textColor: string;
  accentColor: string;
  titleI18n?: LocaleTextSource;
  contentI18n?: LocaleTextSource;
} & SiteContentLocaleCarrier;

export type SiteContentConfig = {
  id: string;
  home: SiteContentHomeBlock;
  popup: SiteContentPopupBlock;
  updatedAt: string | null;
};

export async function getSiteContentConfig(language?: string) {
  const response = await fetch(withLanguage('/api/site-content', language), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(language ? { 'Accept-Language': language } : {})
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw createApiClientError(language, response.status, body);
  }

  const body = await response.json().catch(() => ({}));
  return body as SiteContentConfig;
}

function withLanguage(path: string, language?: string) {
  if (!language) {
    return path;
  }

  const params = new URLSearchParams({ language });
  return `${path}?${params.toString()}`;
}

function normalizeLocale(value: string) {
  return value.trim().toLowerCase().replace('_', '-');
}

function collectLocaleCandidates(language: string) {
  const normalized = normalizeLocale(language);
  const splitLocale = normalized.split('-');
  const base = splitLocale[0];
  const region = splitLocale[1];
  const result = new Set<string>();
  const candidates = [
    normalized,
    base,
    normalized.replace('-', '_'),
    normalized.toLowerCase(),
    normalized.toUpperCase(),
    base
  ];

  candidates.forEach((entry) => {
    if (entry) {
      result.add(entry);
    }
  });

  if (normalized.startsWith('zh')) {
    if (region && ['tw', 'hk', 'mo', 'hant'].includes(region)) {
      result.add('zh-tw');
    } else {
      result.add('zh-cn');
    }
    result.add('zh');
  }

  result.add('en-us');
  result.add('en');

  return [...result];
}

function normalizeLocaleMap(value: LocaleTextSource) {
  if (value === null || typeof value === 'string') {
    return {};
  }

  const resolved: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (typeof rawValue === 'string' && rawValue.trim()) {
      const trimmed = rawValue.trim();
      const normalizedKey = normalizeLocale(rawKey);
      resolved[normalizedKey] = trimmed;
      resolved[normalizedKey.toUpperCase()] = trimmed;
      resolved[normalizedKey.replace('-', '_')] = trimmed;
    }
  }
  return resolved;
}

export function getLocalizedText(
  source: LocaleTextSource | undefined,
  language: string,
  fallback: string | null = null
) {
  if (typeof source === 'string') {
    return source.trim() || fallback;
  }

  if (!source || Array.isArray(source) || typeof source !== 'object') {
    return fallback;
  }

  const valueMap = normalizeLocaleMap(source);
  const candidates = collectLocaleCandidates(language);

  for (const candidate of candidates) {
    const localized = valueMap[candidate];
    if (localized) {
      return localized;
    }
  }

  return fallback;
}

export function getLocalizedSiteContentField(
  block: SiteContentHomeBlock,
  field: 'title' | 'subtitle' | 'content',
  language: string,
  fallback?: string | null
): string | null;

export function getLocalizedSiteContentField(
  block: SiteContentPopupBlock,
  field: 'title' | 'content',
  language: string,
  fallback?: string | null
): string | null;

export function getLocalizedSiteContentField(
  block: SiteContentHomeBlock | SiteContentPopupBlock,
  field: 'title' | 'subtitle' | 'content',
  language: string,
  fallback?: string | null
) {
  const directCandidates: Array<LocaleTextSource | undefined> = [];

  if (field === 'title') {
    directCandidates.push(block.titleI18n, block.i18n?.title, block.translations?.title, block.localized?.title, block.title as LocaleTextSource);
  } else if (field === 'subtitle') {
    const homeBlock = block as SiteContentHomeBlock;
    directCandidates.push(homeBlock.subtitleI18n, homeBlock.i18n?.subtitle, homeBlock.translations?.subtitle, homeBlock.localized?.subtitle, homeBlock.subtitle);
  } else {
    directCandidates.push(block.contentI18n, block.i18n?.content, block.translations?.content, block.localized?.content, block.content);
  }

  const fallbackValue =
    fallback ??
    (field === 'subtitle'
      ? (block as SiteContentHomeBlock).subtitle
      : field === 'title'
        ? (block as SiteContentHomeBlock).title
        : block.content);
  for (const candidate of directCandidates) {
    const localized = getLocalizedText(candidate, language, null);
    if (localized) {
      return localized;
    }
  }

  return fallbackValue ?? null;
}
