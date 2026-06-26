import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicSiteShell } from '../components/public-site-shell';
import {
  type PublicLanguageCode,
  buildPublicHref,
  getPublicCopy,
  normalizePublicLanguage,
  publicPageMetadata
} from '../lib/public-copy';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = await getLanguage(searchParams);
  const copy = getPublicCopy(language);
  return publicPageMetadata('/pricing', language, copy.pricingTitle, copy.pricingDescription);
}

export default async function PublicPricingPage({ searchParams }: PageProps) {
  const language = await getLanguage(searchParams);
  const copy = getPublicCopy(language);

  return (
    <PublicSiteShell
      description={copy.pricingDescription}
      eyebrow={copy.navPricing}
      language={language}
      route="/pricing"
      title={copy.pricingTitle}
    >
      <section className="public-section public-grid" data-qa="public-pricing-page">
        <article>
          <h2>{copy.modelPricing}</h2>
          <p>{copy.pricingDescription}</p>
          <ul>
            <li>Claude / GPT / Gemini / DeepSeek / GLM</li>
            <li>USD / 1M tokens</li>
            <li>{copy.pricingBillingRule}</li>
          </ul>
        </article>

        <article>
          <h2>{copy.docsPathsTitle}</h2>
          <p>{copy.docsDescription}</p>
          <ul>
            <li>/v1/models</li>
            <li>/v1/chat/completions</li>
            <li>/v1/responses</li>
            <li>/v1/messages</li>
          </ul>
        </article>

        <article>
          <h2>{copy.docsChecklistTitle}</h2>
          <ul>
            {copy.docsChecklistItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="public-section public-grid" data-qa="public-pricing-integration">
        <article>
          <h2>{copy.quickstart}</h2>
          <p>{copy.docsQuickstartBody}</p>
          <Link className="secondary-button" href={buildPublicHref('/docs', language)}>
            {copy.apiDocs}
          </Link>
        </article>

        <article>
          <h2>{copy.statusMonitorTitle}</h2>
          <p>{copy.statusMonitorBody}</p>
          <Link className="secondary-button" href={buildPublicHref('/status', language)}>
            {copy.navStatus}
          </Link>
        </article>
      </section>
    </PublicSiteShell>
  );
}

async function getLanguage(searchParams: PageProps['searchParams']): Promise<PublicLanguageCode> {
  const params = await Promise.resolve(searchParams ?? {});
  return normalizePublicLanguage(params.language ?? params.lang ?? params.locale);
}
