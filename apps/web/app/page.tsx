import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicSitePopup } from './components/public-site-popup';
import { PublicSiteShell } from './components/public-site-shell';
import { translate, type LanguageCode } from './lib/i18n';
import {
  type PublicLanguageCode,
  buildPublicHref,
  getPublicCopy,
  normalizePublicLanguage,
  publicPageMetadata
} from './lib/public-copy';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = await getLanguage(searchParams);
  const copy = getPublicCopy(language);
  return publicPageMetadata('/', language, copy.homeTitle, copy.homeDescription);
}

export default async function PublicHomePage({ searchParams }: PageProps) {
  const language = await getLanguage(searchParams);
  const copy = getPublicCopy(language);
  const siteContent = await getSiteContent(language);
  const heroTitle = siteContent?.home.title || copy.homeTitle;
  const heroDescription = siteContent?.home.subtitle || copy.homeDescription;
  const homeContent = siteContent?.home.content;
  const popup = siteContent?.popup;

  return (
    <PublicSiteShell
      description={heroDescription}
      eyebrow={copy.navHome}
      language={language}
      route="/"
      title={heroTitle}
    >
      {popup?.enabled && popup.title && popup.content ? (
        <PublicSitePopup
          accentColor={popup.accentColor}
          closeLabel={translate(language as LanguageCode, 'common.ok')}
          content={popup.content}
          fontFamily={popup.fontFamily}
          textColor={popup.textColor}
          title={popup.title}
        />
      ) : null}
      {homeContent ? (
        <section
          className="public-section public-site-content"
          data-qa="public-home-site-content"
          style={{
            borderColor: siteContent?.home.accentColor,
            color: siteContent?.home.textColor,
            fontFamily: toCssFontFamily(siteContent?.home.fontFamily)
          }}
        >
          <p>{homeContent}</p>
        </section>
      ) : null}
      <section className="public-section public-grid" data-qa="public-home-page">
        <article data-qa="public-home-pricing">
          <h2>{copy.modelPricing}</h2>
          <p>{copy.pricingDescription}</p>
          <Link className="secondary-button" href={buildPublicHref('/pricing', language)}>
            {copy.navPricing}
          </Link>
        </article>

        <article data-qa="public-home-docs">
          <h2>{copy.apiDocs}</h2>
          <p>{copy.docsQuickstartBody}</p>
          <Link className="secondary-button" href={buildPublicHref('/docs', language)}>
            {copy.navDocs}
          </Link>
        </article>

        <article data-qa="public-home-status">
          <h2>{copy.statusOperationalTitle}</h2>
          <p>{copy.statusOperationalBody}</p>
          <Link className="secondary-button" href={buildPublicHref('/status', language)}>
            {copy.navStatus}
          </Link>
        </article>
      </section>

      <section className="public-section public-grid" data-qa="public-home-trust">
        <article>
          <h2>{copy.docsChecklistTitle}</h2>
          <ul>
            {copy.docsChecklistItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article>
          <h2>{copy.statusMonitorTitle}</h2>
          <p>{copy.statusMonitorBody}</p>
        </article>

        <article>
          <h2>{copy.announcementsSectionTitle}</h2>
          <p>{copy.announcementsDescription}</p>
          <Link className="secondary-button" href={buildPublicHref('/announcements', language)}>
            {copy.navAnnouncements}
          </Link>
        </article>
      </section>
    </PublicSiteShell>
  );
}

type SiteContentResponse = {
  home: {
    accentColor: string;
    content: string | null;
    fontFamily: string;
    subtitle: string;
    textColor: string;
    title: string;
  };
  popup: {
    accentColor: string;
    content: string | null;
    enabled: boolean;
    fontFamily: string;
    textColor: string;
    title: string | null;
  };
};

const INTERNAL_API_BASE_URL =
  process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

async function getSiteContent(language: PublicLanguageCode): Promise<SiteContentResponse | null> {
  const url = new URL('/site-content', INTERNAL_API_BASE_URL);
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
      return null;
    }
    return (await response.json()) as SiteContentResponse;
  } catch {
    return null;
  }
}

async function getLanguage(searchParams: PageProps['searchParams']): Promise<PublicLanguageCode> {
  const params = await Promise.resolve(searchParams ?? {});
  return normalizePublicLanguage(params.language ?? params.lang ?? params.locale);
}

function toCssFontFamily(fontFamily: string | undefined) {
  if (fontFamily === 'serif') {
    return 'Georgia, "Times New Roman", serif';
  }
  if (fontFamily === 'rounded') {
    return '"Trebuchet MS", "Segoe UI", sans-serif';
  }
  if (fontFamily === 'mono') {
    return '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
  }
  return undefined;
}
