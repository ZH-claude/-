import type { Metadata } from 'next';
import { headers } from 'next/headers';
import 'antd/dist/antd.css';
import './globals.css';
import { LanguageProvider } from './components/language-provider';
import {
  getPublicSiteUrl,
  getPublicCopy,
  publicPageMetadata
} from './lib/public-copy';
import {
  defaultPublicLanguage,
  getPublicLanguageDirection,
  normalizePublicLanguage,
  publicLanguageHeader
} from './lib/public-language-routing';

export async function generateMetadata(): Promise<Metadata> {
  const language = await getRequestPublicLanguage();
  const copy = getPublicCopy(language);

  return {
    ...publicPageMetadata('/', language, copy.homeTitle, copy.homeDescription),
    icons: {
      icon: '/favicon.svg'
    },
    metadataBase: new URL(getPublicSiteUrl()),
    title: {
      default: copy.homeTitle,
      template: '%s | Azure Planet Relay'
    }
  };
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const language = await getRequestPublicLanguage();

  return (
    <html dir={getPublicLanguageDirection(language)} lang={language}>
      <body>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}

async function getRequestPublicLanguage() {
  const requestHeaders = await headers();
  return normalizePublicLanguage(requestHeaders.get(publicLanguageHeader) ?? defaultPublicLanguage);
}
