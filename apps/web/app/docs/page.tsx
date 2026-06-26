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

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = await getLanguage(searchParams);
  const copy = getPublicCopy(language);
  return publicPageMetadata('/docs', language, copy.docsTitle, copy.docsDescription);
}

export default async function DocsPage({ searchParams }: PageProps) {
  const language = await getLanguage(searchParams);
  const copy = getPublicCopy(language);

  return (
    <PublicSiteShell
      description={copy.docsDescription}
      eyebrow={copy.apiDocs}
      language={language}
      route="/docs"
      title={copy.docsTitle}
    >
      <section className="public-section public-grid" data-qa="public-docs-page">
        <article>
          <h2>{copy.quickstart}</h2>
          <p>{copy.docsQuickstartBody}</p>
          <pre>
            <code>{`curl https://newaicode.com/v1/chat/completions \\
  -H "Authorization: Bearer $NEWAICODE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt5.5","messages":[{"role":"user","content":"Hello"}]}'`}</code>
          </pre>
        </article>

        <article>
          <h2>{copy.docsPathsTitle}</h2>
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
    </PublicSiteShell>
  );
}

async function getLanguage(searchParams: PageProps['searchParams']): Promise<PublicLanguageCode> {
  const params = await Promise.resolve(searchParams ?? {});
  return normalizePublicLanguage(params.language ?? params.lang ?? params.locale);
}
