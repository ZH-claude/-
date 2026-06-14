'use client';

import {
  KeyOutlined,
  LogoutOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  changePassword,
  clearStoredToken,
  getProfile,
  getStoredToken,
  logout
} from '../lib/auth-api';
import type { PublicUser } from '../lib/auth-api';

export default function AccountPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    const storedToken = getStoredToken();
    if (!storedToken) {
      router.replace('/login');
      return;
    }

    setToken(storedToken);
    void loadProfile(storedToken);
  }, [router]);

  async function loadProfile(nextToken = token) {
    if (!nextToken) {
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await getProfile(nextToken);
      setUser(result.user);
    } catch (nextError) {
      clearStoredToken();
      setError(nextError instanceof Error ? nextError.message : '会话已失效');
      router.replace('/login');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setError('');
    setMessage('');
    setIsChanging(true);

    try {
      const result = await changePassword(token, { currentPassword, newPassword });
      setUser(result.user);
      setCurrentPassword('');
      setNewPassword('');
      setMessage('密码已修改，其他已登录会话已失效');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '修改密码失败');
    } finally {
      setIsChanging(false);
    }
  }

  async function handleLogout() {
    if (token) {
      await logout(token).catch(() => undefined);
    }

    clearStoredToken();
    router.replace('/login');
  }

  return (
    <main className="account-page">
      <header className="topbar">
        <Link className="auth-brand compact" href="/">
          <span className="shell-logo-mark">R</span>
          <span>Relay Console</span>
        </Link>
        <button className="ghost-button" onClick={handleLogout} type="button">
          <LogoutOutlined />
          退出
        </button>
      </header>

      <section className="account-grid">
        <div className="account-panel account-summary">
          <div>
            <p className="eyebrow">账户中心</p>
            <h1>{isLoading ? '加载中' : user?.username ?? '未登录'}</h1>
          </div>
          <button className="icon-button" onClick={() => void loadProfile()} title="刷新账户" type="button">
            <ReloadOutlined />
          </button>
        </div>

        <div className="metric-panel">
          <span>分组</span>
          <strong>{user?.group.name ?? '-'}</strong>
          <small>{user?.group.code ?? '-'}</small>
        </div>
        <div className="metric-panel">
          <span>余额</span>
          <strong>{formatCents(user?.wallet.balanceCents ?? 0)}</strong>
          <small>累计消费 {formatCents(user?.wallet.totalSpendCents ?? 0)}</small>
        </div>
        <div className="metric-panel">
          <span>状态</span>
          <strong>{user?.status ?? '-'}</strong>
          <small>角色 {user?.role ?? '-'}</small>
        </div>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <SafetyCertificateOutlined />
            <h2>用户信息</h2>
          </div>
          <dl className="info-list">
            <div>
              <dt>邀请码</dt>
              <dd>{user?.inviteCode ?? '-'}</dd>
            </div>
            <div>
              <dt>时区</dt>
              <dd>{user?.timezone ?? '-'}</dd>
            </div>
            <div>
              <dt>上次登录</dt>
              <dd>{user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '-'}</dd>
            </div>
          </dl>
        </section>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <KeyOutlined />
            <h2>修改密码</h2>
          </div>
          <form className="auth-form compact-form" onSubmit={handleChangePassword}>
            <label>
              当前密码
              <input
                autoComplete="current-password"
                maxLength={128}
                minLength={8}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                type="password"
                value={currentPassword}
              />
            </label>
            <label>
              新密码
              <input
                autoComplete="new-password"
                maxLength={128}
                minLength={8}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            {message ? <p className="form-success">{message}</p> : null}
            <button className="primary-button" disabled={isChanging} type="submit">
              <KeyOutlined />
              {isChanging ? '保存中' : '保存新密码'}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

function formatCents(value: number) {
  return `${(value / 100).toFixed(2)} 元`;
}
