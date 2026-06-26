import { createApiClientError } from './api-error-copy';
import { getLocalizedText, type LocaleTextSource } from './site-content-api';

export type AnnouncementCategory = 'announcement' | 'update_log' | 'usage_guide';

type AnnouncementLocaleCarrier = {
  titleI18n?: LocaleTextSource;
  contentI18n?: LocaleTextSource;
  i18n?: {
    title?: LocaleTextSource;
    content?: LocaleTextSource;
  };
  translations?: {
    title?: LocaleTextSource;
    content?: LocaleTextSource;
  };
  localized?: {
    title?: LocaleTextSource;
    content?: LocaleTextSource;
  };
};

export type PublicAnnouncement = {
  id: string;
  title: string;
  content: string;
  category: AnnouncementCategory;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
} & AnnouncementLocaleCarrier;

export type AnnouncementSection = {
  key: AnnouncementCategory;
  title: string;
  items: PublicAnnouncement[];
};

export type AnnouncementFeedResponse = {
  generatedAt: string;
  total: number;
  sections: AnnouncementSection[];
};

export async function listPublishedAnnouncements(language?: string) {
  const response = await fetch(withLanguage('/api/announcements', language), {
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
  return body as AnnouncementFeedResponse;
}

function withLanguage(path: string, language?: string) {
  if (!language) {
    return path;
  }

  const params = new URLSearchParams({ language });
  return `${path}?${params.toString()}`;
}

export function getLocalizedAnnouncementField(
  announcement: PublicAnnouncement,
  field: 'title' | 'content',
  language: string
) {
  const raw = {
    title: announcement.title,
    content: announcement.content
  };
  const candidates =
    field === 'title'
      ? [
          announcement.titleI18n,
          announcement.i18n?.title,
          announcement.translations?.title,
          announcement.localized?.title
        ]
      : [
          announcement.contentI18n,
          announcement.i18n?.content,
          announcement.translations?.content,
          announcement.localized?.content
        ];

  for (const candidate of candidates) {
    const localized = getLocalizedText(candidate, language, null);
    if (localized) {
      return localized;
    }
  }

  return raw[field];
}
