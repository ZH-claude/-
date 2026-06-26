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

type HealthPayload = {
  service?: string;
  status?: string;
  timestamp?: string;
};

const INTERNAL_API_BASE_URL =
  process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = await getLanguage(searchParams);
  const copy = getPublicCopy(language);
  return publicPageMetadata('/status', language, copy.statusTitle, copy.statusDescription);
}

export default async function StatusPage({ searchParams }: PageProps) {
  const language = await getLanguage(searchParams);
  const copy = getPublicCopy(language);
  const health = await getHealth();
  const isOperational = health.status === 'ok';

  return (
    <PublicSiteShell
      description={copy.statusDescription}
      eyebrow={copy.navStatus}
      language={language}
      route="/status"
      title={copy.statusTitle}
    >
      <section className="public-section public-status" data-qa="public-status-page">
        <div className={isOperational ? 'public-status-dot is-ok' : 'public-status-dot'} />
        <div>
          <h2>{isOperational ? copy.statusOperationalTitle : copy.statusUnavailableTitle}</h2>
          <p>
            {copy.statusServiceLabel}: {health.service ?? 'nested-api-relay-api'} - {copy.statusLastCheckLabel}:{' '}
            {health.timestamp ? new Date(health.timestamp).toISOString() : copy.statusNotAvailable}
          </p>
        </div>
      </section>

      <section className="public-section public-grid">
        <article>
          <h2>{copy.statusScopeTitle}</h2>
          <p>{copy.statusScopeBody}</p>
        </article>
        <article>
          <h2>{copy.statusMonitorTitle}</h2>
          <p>{copy.statusMonitorBody}</p>
        </article>
      </section>
    </PublicSiteShell>
  );
}

async function getHealth(): Promise<HealthPayload> {
  try {
    const response = await fetch(`${INTERNAL_API_BASE_URL}/health`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      return { status: 'unavailable', timestamp: new Date().toISOString() };
    }
    return (await response.json()) as HealthPayload;
  } catch {
    return { status: 'unavailable', timestamp: new Date().toISOString() };
  }
}

async function getLanguage(searchParams: PageProps['searchParams']): Promise<PublicLanguageCode> {
  const params = await Promise.resolve(searchParams ?? {});
  return normalizePublicLanguage(params.language ?? params.lang ?? params.locale);
}
