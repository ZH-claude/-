'use client';

import {
  ApiOutlined,
  GiftOutlined,
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
  getProfile,
  logout
} from '../lib/auth-api';
import type { PublicUser } from '../lib/auth-api';

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    void loadProfile();
  }, [router]);

  async function loadProfile() {
    setIsLoading(true);
    setError('');

    try {
      const result = await getProfile();
      setUser(result.user);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '会话已失效');
      router.replace('/login');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsChanging(true);

    try {
      const result = await changePassword({ currentPassword, newPassword });
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
    await logout().catch(() => undefined);
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
          <Link className="secondary-link-button metric-action" href="/account/topup/recharge">
            <GiftOutlined />
            充值
          </Link>
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
            <ApiOutlined />
            <h2>可用模型</h2>
          </div>
          <div className="model-list">
            {(user?.availableModels ?? []).map((model) => (
              <article className="model-item" key={model.model}>
                <div>
                  <strong>{model.model}</strong>
                  {model.displayName ? <span>{model.displayName}</span> : null}
                </div>
                <small>
                  输入 {formatCents(model.inputPriceCentsPer1k)}/1K · 输出 {formatCents(model.outputPriceCentsPer1k)}/1K · x
                  {model.modelMultiplier} · 分组 x{model.groupMultiplier} · {model.supportsStream ? 'stream' : 'no stream'}
                </small>
              </article>
            ))}
            {!isLoading && !(user?.availableModels ?? []).length ? <p className="empty-state">暂无可用模型</p> : null}
          </div>
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
