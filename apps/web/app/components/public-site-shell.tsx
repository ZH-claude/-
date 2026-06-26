import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  buildPublicHref,
  type PublicRoute,
  type PublicLanguageCode,
  getPublicCopy,
  publicNavItems
} from '../lib/public-copy';
import { supportedLanguages, translate, type LanguageCode } from '../lib/i18n';

export function PublicSiteShell({
  children,
  language,
  eyebrow,
  route,
  title,
  description
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  language: PublicLanguageCode;
  route: PublicRoute;
  title: string;
}) {
  const copy = getPublicCopy(language);
  const currentLanguage = supportedLanguages.find((entry) => entry.code === language);
  const languageLabel = translate(language as LanguageCode, 'language.label');

  return (
    <main className="public-page-shell" data-qa="public-site-shell">
      <header className="public-header">
        <Link className="public-brand" href={publicNavItems(language)[0].href}>
          <img alt="" aria-hidden="true" className="shell-logo-image" src="/brand-mark.svg" />
          <span>Azure Planet Relay</span>
        </Link>
        <div className="public-header-actions">
          <nav aria-label={copy.navPublicAria} className="public-nav" data-qa="public-nav">
            {publicNavItems(language).map((item) => (
              <Link href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
          <details className="public-language-menu" data-qa="public-language-menu">
            <summary>
              <span aria-hidden="true" className="public-language-icon">Aa</span>
              <span>{languageLabel}</span>
              <span>{currentLanguage?.label ?? language}</span>
            </summary>
            <div className="public-language-list">
              {supportedLanguages.map((entry) => (
                <Link
                  aria-current={entry.code === language ? 'true' : undefined}
                  data-language={entry.code}
                  href={buildPublicHref(route, entry.code as PublicLanguageCode)}
                  key={entry.code}
                >
                  <span>{entry.shortLabel}</span>
                  <strong>{entry.label}</strong>
                </Link>
              ))}
            </div>
          </details>
        </div>
      </header>

      <section className="public-hero" data-qa="public-hero">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="public-actions">
          <Link className="primary-button" href={publicNavItems(language)[1].href}>
            {copy.modelPricing}
          </Link>
          <Link className="secondary-button" href={publicNavItems(language)[2].href}>
            {copy.apiDocs}
          </Link>
        </div>
      </section>

      {children}
    </main>
  );
}
