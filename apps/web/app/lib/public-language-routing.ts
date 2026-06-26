export const publicRoutes = ['/', '/pricing', '/docs', '/status', '/announcements'] as const;

export type PublicRoute = (typeof publicRoutes)[number];

export const publicLanguageCodes = [
  'zh-CN',
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
] as const;

export type PublicLanguageCode = (typeof publicLanguageCodes)[number];

export const defaultPublicLanguage: PublicLanguageCode = 'en-US';
export const publicLanguageHeader = 'x-public-language';

const languageByLowercase = new Map<string, PublicLanguageCode>(
  publicLanguageCodes.map((language) => [language.toLowerCase(), language])
);

export function isPublicLanguageCode(value: string | null | undefined): value is PublicLanguageCode {
  return Boolean(value && languageByLowercase.has(value.trim().replace(/_/g, '-').toLowerCase()));
}

export function normalizePublicLanguage(language: string | string[] | undefined): PublicLanguageCode {
  const rawLanguage = Array.isArray(language) ? language[0] : language;
  const normalized = rawLanguage?.trim().replace(/_/g, '-').toLowerCase();
  if (!normalized) {
    return defaultPublicLanguage;
  }

  const exact = languageByLowercase.get(normalized);
  if (exact) {
    return exact;
  }

  const base = normalized.split('-')[0];
  if (base === 'zh') {
    return normalized.includes('tw') || normalized.includes('hk') || normalized.includes('hant') ? 'zh-TW' : 'zh-CN';
  }

  return publicLanguageCodes.find((code) => code.toLowerCase().startsWith(`${base}-`)) ?? defaultPublicLanguage;
}

export function getPublicLanguageDirection(language: PublicLanguageCode) {
  return language === 'ar-EG' || language === 'fa-IR' ? 'rtl' : 'ltr';
}

export function isPublicRoute(pathname: string): pathname is PublicRoute {
  return publicRoutes.includes(normalizePath(pathname) as PublicRoute);
}

export function normalizePath(pathname: string) {
  const normalized = new URL(`http://example.com${pathname.startsWith('/') ? pathname : `/${pathname}`}`).pathname.replace(/\/+$/g, '');
  return normalized || '/';
}
