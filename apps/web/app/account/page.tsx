'use client';

import {
  AppstoreOutlined,
  BellOutlined,
  CloseOutlined,
  FileTextOutlined,
  KeyOutlined,
  MessageOutlined,
  ShoppingOutlined
} from '@ant-design/icons';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ConsoleShell } from '../components/console-shell';
import { useI18n } from '../components/language-provider';
import {
  getLocalizedAnnouncementField,
  listPublishedAnnouncements,
  type AnnouncementFeedResponse,
  type PublicAnnouncement
} from '../lib/announcements-api';
import type { LanguageCode } from '../lib/i18n';

const documentEntrances = [
  { href: '/models', icon: <AppstoreOutlined />, labelKey: 'home.entry.pricing' },
  { href: '/experience', icon: <MessageOutlined />, labelKey: 'home.entry.experience' },
  { href: '/token', icon: <KeyOutlined />, labelKey: 'home.entry.token' },
  { href: '/log', icon: <FileTextOutlined />, labelKey: 'home.entry.log' },
  { href: '/ai-recharge', icon: <ShoppingOutlined />, labelKey: 'home.entry.aiRecharge' },
  { href: '/account/notificationSettings', icon: <BellOutlined />, labelKey: 'home.entry.notificationSettings' }
] as const;

export default function AccountHomePage() {
  const { language, t } = useI18n();
  const [feed, setFeed] = useState<AnnouncementFeedResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [dismissedPopupKey, setDismissedPopupKey] = useState<string | null>(null);

  async function loadAnnouncements(currentLanguage: LanguageCode) {
    setIsLoading(true);
    setError('');
    try {
      const nextFeed = await listPublishedAnnouncements(currentLanguage);
      setFeed(nextFeed);
    } catch (loadError) {
      setFeed(null);
      void loadError;
      setError(t('home.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAnnouncements(language);
  }, [language]);

  const allItems = useMemo(() => feed?.sections.flatMap((section) => section.items) ?? [], [feed]);
  const latestItem = allItems[0] ?? null;
  const popupKey = latestItem ? `${language}:${latestItem.id}:${latestItem.updatedAt}` : null;
  const shouldShowPopup = Boolean(latestItem && popupKey !== dismissedPopupKey);

  return (
    <ConsoleShell activePath="/account" isRefreshing={isLoading} onRefresh={() => void loadAnnouncements(language)}>
      {latestItem && shouldShowPopup ? (
        <AnnouncementPopup
          announcement={latestItem}
          closeLabel={t('home.closeAnnouncement')}
          language={language}
          onClose={() => setDismissedPopupKey(popupKey)}
          title={t('home.announcement')}
        />
      ) : null}

      <section className="profile-card profile-identity" data-qa="user-home-hero">
        <div className="profile-identity-main">
          <span className="eyebrow">{t('nav.home')}</span>
          <h1>{t('app.userConsoleName')}</h1>
          <p>{t('home.defaultSubtitle')}</p>
        </div>
      </section>

      {error ? <p className="form-error">{error}</p> : null}

      <section className="profile-metrics" data-qa="user-home-summary">
        <SummaryBlock label={t('home.contentCount')} value={`${feed?.total ?? 0} ${t('home.contentUnit')}`} />
        <SummaryBlock
          label={t('home.latestPublished')}
          value={latestItem ? formatDate(latestItem.publishedAt ?? latestItem.createdAt, language) : t('common.none')}
        />
        <SummaryBlock label={t('home.documentEntrances')} value={`${documentEntrances.length} ${t('home.documentUnit')}`} />
      </section>

      <section className="profile-card" data-qa="user-home-announcements">
        <div className="section-heading">
          <h2>{t('home.section.announcement')}</h2>
        </div>
        <div className="public-announcement-list">
          {(feed?.sections ?? []).map((section) => (
            <article className="public-announcement-section" key={section.key}>
              <h3>{section.title}</h3>
              {section.items.length ? (
                section.items.map((item) => (
                  <div className="public-announcement-item" data-qa="user-home-announcement-item" key={item.id}>
                    <time dateTime={item.publishedAt ?? item.createdAt}>
                      {formatDate(item.publishedAt ?? item.createdAt, language)}
                    </time>
                    <strong>{getLocalizedAnnouncementField(item, 'title', language)}</strong>
                    <p>{getLocalizedAnnouncementField(item, 'content', language)}</p>
                  </div>
                ))
              ) : (
                <p className="public-muted">{t('home.emptyPublished')}</p>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="profile-card" data-qa="user-home-document-entrances">
        <div className="section-heading">
          <h2>{t('home.documentEntrances')}</h2>
        </div>
        <div className="recharge-package-grid">
          {documentEntrances.map((entry) => (
            <Link className="ghost-button" href={entry.href} key={entry.href}>
              {entry.icon}
              <span>{t(entry.labelKey)}</span>
            </Link>
          ))}
        </div>
      </section>
    </ConsoleShell>
  );
}

function SummaryBlock({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-block">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function AnnouncementPopup({
  announcement,
  closeLabel,
  language,
  onClose,
  title
}: {
  announcement: PublicAnnouncement;
  closeLabel: string;
  language: LanguageCode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="site-announcement-backdrop" data-qa="user-home-announcement-popup" role="presentation">
      <section aria-labelledby="user-home-announcement-title" aria-modal="true" className="site-announcement-modal" role="dialog">
        <button aria-label={closeLabel} className="site-announcement-close" onClick={onClose} type="button">
          <CloseOutlined aria-hidden="true" />
        </button>
        <span className="eyebrow">{title}</span>
        <h2 id="user-home-announcement-title">{getLocalizedAnnouncementField(announcement, 'title', language)}</h2>
        <p>{getLocalizedAnnouncementField(announcement, 'content', language)}</p>
        <button className="primary-button" onClick={onClose} type="button">
          {closeLabel}
        </button>
      </section>
    </div>
  );
}

function formatDate(value: string, language: LanguageCode) {
  return new Date(value).toLocaleString(language);
}
