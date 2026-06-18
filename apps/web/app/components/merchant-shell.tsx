'use client';

import {
  ApiOutlined,
  BellOutlined,
  CloudServerOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  GiftOutlined,
  HomeOutlined,
  LogoutOutlined,
  PictureOutlined,
  ReloadOutlined,
  TeamOutlined
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { getProfile, logout } from '../lib/auth-api';

type NavigationItem = {
  href: string;
  label: string;
  icon: ReactNode;
  topbar?: boolean;
};

const merchantNavigationItems: NavigationItem[] = [
  { href: '/merchant', label: '商家首页', icon: <HomeOutlined />, topbar: true },
  { href: '/merchant/users', label: '用户管理', icon: <TeamOutlined />, topbar: true },
  { href: '/merchant/recharge-codes', label: '充值码', icon: <GiftOutlined />, topbar: true },
  { href: '/merchant/upstreams/deepseek', label: 'DeepSeek 上游', icon: <ExperimentOutlined />, topbar: true },
  { href: '/merchant/upstreams/relay', label: '中转站上游', icon: <CloudServerOutlined />, topbar: true },
  { href: '/merchant/model-config#merchant-model-prices', label: '模型发布', icon: <ApiOutlined />, topbar: true },
  { href: '/merchant/model-config#merchant-upstream-models', label: '模型映射', icon: <ApiOutlined /> },
  { href: '/merchant/request-logs', label: '请求日志', icon: <FileTextOutlined /> },
  { href: '/merchant/drawing-logs', label: '绘图日志', icon: <PictureOutlined /> },
  { href: '/merchant/announcements', label: '公告', icon: <BellOutlined />, topbar: true },
  { href: '/merchant/audit', label: '审计', icon: <FileTextOutlined />, topbar: true },
  { href: '/merchant/service-status', label: '服务状态', icon: <CloudServerOutlined />, topbar: true }
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
  const displayRole = formatRole(role !== undefined ? role : loadedProfile?.role ?? null);
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
          <span className="shell-logo-mark">中</span>
          <span>商家控制台</span>
        </Link>
        <nav className="merchant-primary-nav" aria-label="商家端主导航">
          {topbarItems.map((item) => (
            <Link
              className={isActive(activePath, activeHash, item.href) ? 'active' : ''}
              href={item.href}
              key={item.href}
              onClick={() => handleAnchorClick(item)}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="merchant-topbar-actions">
          {onRefresh ? (
            <button className="icon-button" disabled={isRefreshing} onClick={onRefresh} title="刷新商家端数据" type="button">
              <ReloadOutlined />
            </button>
          ) : null}
          <button className="ghost-button" onClick={logoutHandler} type="button">
            <LogoutOutlined />
            退出
          </button>
          <div className="merchant-account-chip" title={displayUsername ?? undefined}>
            <strong>{displayUsername ?? '-'}</strong>
            <span>{displayRole}</span>
          </div>
        </div>
      </header>

      <section className="merchant-shell-body">
        <aside className="merchant-sidebar" aria-label="商家端固定导航">
          {merchantNavigationItems.map((item) => (
            <Link
              className={isActive(activePath, activeHash, item.href) ? 'active' : ''}
              href={item.href}
              key={item.href}
              onClick={() => handleAnchorClick(item)}
            >
              {item.icon}
              <span>{item.label}</span>
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

function formatRole(role?: string | null) {
  if (role === 'admin') {
    return '管理员';
  }

  if (role === 'user') {
    return '普通用户';
  }

  return role ?? '管理员';
}

function getHrefPath(href: string) {
  return href.split('#')[0] || '/';
}

function getDefaultActiveHash(activePath: string) {
  if (activePath === '/merchant/model-config') {
    return 'merchant-upstreams';
  }

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

  return activePath === itemPath || activePath.startsWith(`${itemPath}/`);
}
