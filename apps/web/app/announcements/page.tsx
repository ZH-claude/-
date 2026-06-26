import type { Metadata } from 'next';
import { PublicSiteShell } from '../components/public-site-shell';
import {
  type PublicLanguageCode,
  getPublicCopy,
  normalizePublicLanguage,
  publicPageMetadata
} from '../lib/public-copy';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

type PublicAnnouncement = {
  id: string;
  title: string;
  content: string;
  publishedAt: string | null;
  createdAt: string;
};

type AnnouncementFeed = {
  sections: Array<{
    key: string;
    title: string;
    items: PublicAnnouncement[];
  }>;
  total: number;
};

const INTERNAL_API_BASE_URL =
  process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = await getLanguage(searchParams);
  const copy = getPublicCopy(language);
  return publicPageMetadata('/announcements', language, copy.announcementsTitle, copy.announcementsDescription);
}

export default async function AnnouncementsPage({ searchParams }: PageProps) {
  const language = await getLanguage(searchParams);
  const copy = getPublicCopy(language);
  const feed = await getAnnouncements(language);

  return (
    <PublicSiteShell
      description={copy.announcementsDescription}
      eyebrow={copy.navAnnouncements}
      language={language}
      route="/announcements"
      title={copy.announcementsTitle}
    >
      <section className="public-section" data-qa="public-announcements-page">
        <p className="public-muted">
          {feed.total} {copy.announcementsPublishedItems}
        </p>
        <div className="public-announcement-list">
          {feed.sections.map((section) => (
            <article className="public-announcement-section" key={section.key}>
              <h2>{section.title}</h2>
              {section.items.length ? (
                section.items.map((item) => (
                  <div className="public-announcement-item" key={item.id}>
                    <time dateTime={item.publishedAt ?? item.createdAt}>
                      {new Date(item.publishedAt ?? item.createdAt).toLocaleDateString(language)}
                    </time>
                    <h3>{item.title}</h3>
                    <p>{item.content}</p>
                  </div>
                ))
              ) : (
                <p className="public-muted">{copy.announcementsEmptySection}</p>
              )}
            </article>
          ))}
        </div>
      </section>
    </PublicSiteShell>
  );
}

async function getAnnouncements(language: PublicLanguageCode): Promise<AnnouncementFeed> {
  const url = new URL('/announcements', INTERNAL_API_BASE_URL);
  url.searchParams.set('language', language);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Accept-Language': language
      }
    });
    if (!response.ok) {
      return emptyFeed(getPublicCopy(language));
    }
    return (await response.json()) as AnnouncementFeed;
  } catch {
    return emptyFeed(getPublicCopy(language));
  }
}

function emptyFeed(copy: ReturnType<typeof getPublicCopy>): AnnouncementFeed {
  return {
    sections: [
      { key: 'announcement', title: copy.announcementsSectionTitle, items: [] },
      { key: 'update_log', title: copy.announcementsUpdateLogTitle, items: [] },
      { key: 'usage_guide', title: copy.announcementsUsageGuideTitle, items: [] }
    ],
    total: 0
  };
}

async function getLanguage(searchParams: PageProps['searchParams']): Promise<PublicLanguageCode> {
  const params = await Promise.resolve(searchParams ?? {});
  return normalizePublicLanguage(params.language ?? params.lang ?? params.locale);
}
