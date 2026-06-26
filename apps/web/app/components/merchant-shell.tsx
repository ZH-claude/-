'use client';

import {
  ApiOutlined,
  BellOutlined,
  GiftOutlined,
  HomeOutlined,
  LogoutOutlined,
  ReloadOutlined,
  ShoppingOutlined,
  TeamOutlined
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { getProfile, logout } from '../lib/auth-api';
import type { TranslationKey } from '../lib/i18n';
import { useI18n } from './language-provider';

type NavigationItem = {
  href: string;
  labelKey: TranslationKey;
  icon: ReactNode;
  topbar?: boolean;
};

const merchantNavigationItems: NavigationItem[] = [
  { href: '/merchant', labelKey: 'merchant.nav.dashboard', icon: <HomeOutlined />, topbar: true },
  { href: '/merchant/users', labelKey: 'merchant.nav.users', icon: <TeamOutlined />, topbar: true },
  { href: '/merchant/recharge-codes', labelKey: 'merchant.nav.rechargeCodes', icon: <GiftOutlined />, topbar: true },
  { href: '/merchant/model-config', labelKey: 'merchant.nav.modelConfig', icon: <ApiOutlined />, topbar: true },
  { href: '/merchant/announcements', labelKey: 'merchant.nav.announcements', icon: <BellOutlined />, topbar: true },
  { href: '/merchant/ai-recharge', labelKey: 'merchant.nav.aiRecharge', icon: <ShoppingOutlined />, topbar: true }
];

export function MerchantShell({
  activePath,
  username,
  role,
  isRefreshing,
  onRefresh,
  onLogout,
  children
}: {
  activePath: string;
  username?: string | null;
  role?: string | null;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onLogout?: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [loadedProfile, setLoadedProfile] = useState<{ username: string; role: string } | null>(null);
  const [activeHash, setActiveHash] = useState(() => getDefaultActiveHash(activePath));

  useEffect(() => {
    function syncHash() {
      setActiveHash(window.location.hash.replace(/^#/, '') || getDefaultActiveHash(activePath));
    }

    syncHash();
    window.addEventListener('hashchange', syncHash);

    return () => window.removeEventListener('hashchange', syncHash);
  }, [activePath]);

  useEffect(() => {
    if (username !== undefined && role !== undefined) {
      return;
    }

    let cancelled = false;

    async function loadShellProfile() {
      try {
        const result = await getProfile();
        if (!cancelled) {
          setLoadedProfile({
            username: result.user.username,
            role: result.user.role
          });
        }
      } catch {
        if (!cancelled) {
          setLoadedProfile(null);
        }
      }
    }

    void loadShellProfile();

    return () => {
      cancelled = true;
    };
  }, [role, username]);

  const displayUsername = username !== undefined ? username : loadedProfile?.username ?? null;
  const displayRole = formatRole(role !== undefined ? role : loadedProfile?.role ?? null, t);
  const logoutHandler = useMemo(() => onLogout ?? handleDefaultLogout, [onLogout]);
  const topbarItems = merchantNavigationItems.filter((item) => item.topbar);

  async function handleDefaultLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  function handleAnchorClick(item: NavigationItem) {
    const hash = getHrefHash(item.href);
    if (hash) {
      setActiveHash(hash);
    }
  }

  return (
    <main className="merchant-shell-page" data-console="merchant">
      <header className="merchant-shell-topbar">
        <Link className="merchant-shell-brand" href="/merchant" onClick={() => setActiveHash('merchant-dashboard')}>
          <img alt="" aria-hidden="true" className="shell-logo-image" src="/brand-mark.svg" />
          <span>{t('app.merchantConsoleName')}</span>
        </Link>
        <nav className="merchant-primary-nav" aria-label={t('merchant.nav.primaryAria')}>
          {topbarItems.map((item) => (
            <Link
              className={isActive(activePath, activeHash, item.href) ? 'active' : ''}
              href={item.href}
              key={item.href}
              onClick={() => handleAnchorClick(item)}
            >
              {item.icon}
              <span>{t(item.labelKey)}</span>
            </Link>
          ))}
        </nav>
        <div className="merchant-topbar-actions">
          {onRefresh ? (
            <button className="icon-button" disabled={isRefreshing} onClick={onRefresh} title={t('common.refresh')} type="button">
              <ReloadOutlined />
            </button>
          ) : null}
          <button className="ghost-button" onClick={logoutHandler} type="button">
            <LogoutOutlined />
            {t('common.logout')}
          </button>
          <div className="merchant-account-chip" title={displayUsername ?? undefined}>
            <strong>{displayUsername ?? '-'}</strong>
            <span>{displayRole}</span>
          </div>
        </div>
      </header>

      <section className="merchant-shell-body">
        <aside className="merchant-sidebar" aria-label={t('merchant.nav.sidebarAria')}>
          {merchantNavigationItems.map((item) => (
            <Link
              className={isActive(activePath, activeHash, item.href) ? 'active' : ''}
              href={item.href}
              key={item.href}
              onClick={() => handleAnchorClick(item)}
            >
              {item.icon}
              <span>{t(item.labelKey)}</span>
            </Link>
          ))}
        </aside>

        <section className="merchant-shell-content">{children}</section>
      </section>
    </main>
  );
}

function getHrefHash(href: string) {
  const [, hash] = href.split('#');
  return hash ?? '';
}

function formatRole(role: string | null | undefined, t: (key: TranslationKey) => string) {
  if (role === 'admin') {
    return t('role.admin');
  }

  if (role === 'user') {
    return t('role.user');
  }

  return role ?? t('role.admin');
}

function getHrefPath(href: string) {
  return href.split('#')[0] || '/';
}

function getDefaultActiveHash(_activePath: string) {
  return 'merchant-dashboard';
}

function isActive(activePath: string, activeHash: string, href: string) {
  const itemPath = getHrefPath(href);
  const itemHash = getHrefHash(href);

  if (itemPath === '/admin') {
    return activePath === '/admin' && (itemHash ? activeHash === itemHash : activeHash === 'merchant-dashboard');
  }

  if (itemHash) {
    return activePath === itemPath && activeHash === itemHash;
  }

  if (itemPath === '/merchant') {
    return activePath === '/merchant';
  }

  if (itemPath === '/merchant/model-config' && activePath === '/merchant/model-routes') {
    return true;
  }

  return activePath === itemPath || activePath.startsWith(`${itemPath}/`);
}
