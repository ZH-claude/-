'use client';

import {
  AppstoreOutlined,
  BellOutlined,
  FileTextOutlined,
  HomeOutlined,
  KeyOutlined,
  LogoutOutlined,
  MessageOutlined,
  ReloadOutlined,
  ShoppingOutlined,
  UserOutlined,
  WalletOutlined
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { getProfile, logout } from '../lib/auth-api';
import type { TranslationKey } from '../lib/i18n';
import { useI18n } from './language-provider';
import { LanguageSwitcher } from './language-switcher';

type NavigationItem = {
  href: string;
  labelKey: TranslationKey;
  icon: ReactNode;
};

const primaryNavItems: NavigationItem[] = [
  { href: '/account', labelKey: 'nav.home', icon: <HomeOutlined /> },
  { href: '/models', labelKey: 'nav.pricing', icon: <AppstoreOutlined /> },
  { href: '/experience', labelKey: 'nav.experience', icon: <MessageOutlined /> },
  { href: '/token', labelKey: 'nav.token', icon: <KeyOutlined /> },
  { href: '/log', labelKey: 'nav.log', icon: <FileTextOutlined /> },
  { href: '/account/profile', labelKey: 'nav.account', icon: <UserOutlined /> },
  { href: '/ai-recharge', labelKey: 'nav.aiRecharge', icon: <ShoppingOutlined /> }
];

const accountNavItems: NavigationItem[] = [
  { href: '/account/profile', labelKey: 'nav.profile', icon: <UserOutlined /> },
  { href: '/account/topup/recharge', labelKey: 'nav.recharge', icon: <WalletOutlined /> },
  { href: '/account/notificationSettings', labelKey: 'nav.notificationSettings', icon: <BellOutlined /> }
];

export function ConsoleShell({
  activePath,
  username,
  isRefreshing,
  onRefresh,
  onLogout,
  children
}: {
  activePath: string;
  username?: string | null;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onLogout?: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const { language, t } = useI18n();
  const [loadedUsername, setLoadedUsername] = useState<string | null>(null);

  useEffect(() => {
    if (username !== undefined) {
      return;
    }

    let cancelled = false;

    async function loadShellProfile() {
      try {
        const result = await getProfile(language);
        if (!cancelled) {
          setLoadedUsername(result.user.username);
        }
      } catch {
        if (!cancelled) {
          setLoadedUsername(null);
        }
      }
    }

    void loadShellProfile();

    return () => {
      cancelled = true;
    };
  }, [language, username]);

  const displayUsername = username !== undefined ? username : loadedUsername;
  const logoutHandler = useMemo(() => onLogout ?? (displayUsername ? handleDefaultLogout : undefined), [displayUsername, onLogout]);

  async function handleDefaultLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <main className="relay-console-page">
      <header className="relay-console-topbar">
        <Link className="relay-console-brand" href="/account">
          <img alt="" aria-hidden="true" className="shell-logo-image" src="/brand-mark.svg" />
          <span>{t('app.userConsoleName')}</span>
        </Link>
        <nav className="relay-primary-nav" aria-label={t('nav.primaryAria')}>
          {primaryNavItems.map((item) => (
            <Link className={isActive(activePath, item.href) ? 'active' : ''} href={item.href} key={item.href}>
              {item.icon}
              <span>{t(item.labelKey)}</span>
            </Link>
          ))}
        </nav>
        <div className="relay-topbar-actions">
          <LanguageSwitcher />
          {onRefresh ? (
            <button className="icon-button" disabled={isRefreshing} onClick={onRefresh} title={t('common.refresh')} type="button">
              <ReloadOutlined />
            </button>
          ) : null}
          {logoutHandler ? (
            <button className="ghost-button" onClick={logoutHandler} type="button">
              <LogoutOutlined />
              {t('common.logout')}
            </button>
          ) : null}
          <span className="relay-user-chip">{displayUsername ?? '-'}</span>
        </div>
      </header>

      <section className="relay-console-body">
        <aside className="relay-account-sidebar" aria-label={t('nav.accountAria')}>
          {accountNavItems.map((item) => (
            <Link className={isActive(activePath, item.href) ? 'active' : ''} href={item.href} key={item.href}>
              {item.icon}
              <span>{t(item.labelKey)}</span>
            </Link>
          ))}
        </aside>

        <section className="profile-content">{children}</section>
      </section>
    </main>
  );
}

function isActive(activePath: string, itemHref: string) {
  if (itemHref === '/account') {
    return activePath === '/account';
  }

  if (itemHref === '/account/profile') {
    return activePath === '/account/profile' || activePath.startsWith('/account/profile/');
  }

  return activePath === itemHref || activePath.startsWith(`${itemHref}/`);
}
