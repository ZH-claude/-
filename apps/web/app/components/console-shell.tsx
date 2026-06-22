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

type NavigationItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

const primaryNavItems: NavigationItem[] = [
  { href: '/', label: '首页', icon: <HomeOutlined /> },
  { href: '/pricing', label: '模型广场', icon: <AppstoreOutlined /> },
  { href: '/experience', label: '体验', icon: <MessageOutlined /> },
  { href: '/token', label: '令牌', icon: <KeyOutlined /> },
  { href: '/log', label: '日志', icon: <FileTextOutlined /> },
  { href: '/account/profile', label: '账户', icon: <UserOutlined /> },
  { href: '/ai-recharge', label: 'AI代充', icon: <ShoppingOutlined /> }
];

const accountNavItems: NavigationItem[] = [
  { href: '/account/profile', label: '个人中心', icon: <UserOutlined /> },
  { href: '/account/topup/recharge', label: '余额充值', icon: <WalletOutlined /> },
  { href: '/account/notificationSettings', label: '通知设置', icon: <BellOutlined /> }
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
  const [loadedUsername, setLoadedUsername] = useState<string | null>(null);

  useEffect(() => {
    if (username !== undefined) {
      return;
    }

    let cancelled = false;

    async function loadShellProfile() {
      try {
        const result = await getProfile();
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
  }, [username]);

  const displayUsername = username !== undefined ? username : loadedUsername;
  const logoutHandler = useMemo(() => onLogout ?? (displayUsername ? handleDefaultLogout : undefined), [displayUsername, onLogout]);

  async function handleDefaultLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <main className="relay-console-page">
      <header className="relay-console-topbar">
        <Link className="relay-console-brand" href="/">
          <img alt="" aria-hidden="true" className="shell-logo-image" src="/brand-mark.svg" />
          <span>蔚蓝星球中转站</span>
        </Link>
        <nav className="relay-primary-nav" aria-label="主导航">
          {primaryNavItems.map((item) => (
            <Link className={isActive(activePath, item.href) ? 'active' : ''} href={item.href} key={item.href}>
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="relay-topbar-actions">
          {onRefresh ? (
            <button className="icon-button" disabled={isRefreshing} onClick={onRefresh} title="刷新" type="button">
              <ReloadOutlined />
            </button>
          ) : null}
          {logoutHandler ? (
            <button className="ghost-button" onClick={logoutHandler} type="button">
              <LogoutOutlined />
              退出
            </button>
          ) : null}
          <span className="relay-user-chip">{displayUsername ?? '-'}</span>
        </div>
      </header>

      <section className="relay-console-body">
        <aside className="relay-account-sidebar" aria-label="账户导航">
          {accountNavItems.map((item) => (
            <Link className={isActive(activePath, item.href) ? 'active' : ''} href={item.href} key={item.href}>
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </aside>

        <section className="profile-content">{children}</section>
      </section>
    </main>
  );
}

function isActive(activePath: string, itemHref: string) {
  if (itemHref === '/') {
    return activePath === '/';
  }

  if (itemHref === '/account/profile') {
    return activePath.startsWith('/account');
  }

  return activePath === itemHref || activePath.startsWith(`${itemHref}/`);
}
