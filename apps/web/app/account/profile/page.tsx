'use client';

import {
  ApiOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  GiftOutlined,
  KeyOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { ConsoleShell } from '../../components/console-shell';
import { changePassword, getProfile, logout, updateTimezone } from '../../lib/auth-api';
import type { AvailableModel, PublicUser } from '../../lib/auth-api';

const commonTimezones = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Singapore',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London'
];

export default function AccountProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [timezone, setTimezone] = useState('UTC');
  const [modelQuery, setModelQuery] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingTimezone, setIsSavingTimezone] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    void loadProfile();
  }, []);

  const filteredModels = useMemo(() => {
    const keyword = modelQuery.trim().toLowerCase();
    const models = user?.availableModels ?? [];
    if (!keyword) {
      return models;
    }

    return models.filter((model) =>
      [model.model, model.displayName ?? ''].some((value) => value.toLowerCase().includes(keyword))
    );
  }, [modelQuery, user?.availableModels]);

  const groupMultiplier = user?.availableModels[0]?.groupMultiplier ?? '1';

  async function loadProfile() {
    setIsLoading(true);
    setError('');

    try {
      const result = await getProfile();
      setUser(result.user);
      setTimezone(result.user.timezone);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '会话已失效');
      router.replace('/login');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleTimezoneChange(nextTimezone: string) {
    if (!user || nextTimezone === user.timezone) {
      setTimezone(nextTimezone);
      return;
    }

    setTimezone(nextTimezone);
    setError('');
    setMessage('');
    setIsSavingTimezone(true);

    try {
      const result = await updateTimezone({ timezone: nextTimezone });
      setUser(result.user);
      setMessage('时区已保存');
    } catch (nextError) {
      setTimezone(user.timezone);
      setError(nextError instanceof Error ? nextError.message : '时区保存失败');
    } finally {
      setIsSavingTimezone(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsChangingPassword(true);

    try {
      const result = await changePassword({ currentPassword, newPassword });
      setUser(result.user);
      setCurrentPassword('');
      setNewPassword('');
      setMessage('密码已修改，其他已登录会话已失效');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '修改密码失败');
    } finally {
      setIsChangingPassword(false);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  async function copyText(value: string, label: string) {
    setError('');
    setMessage('');
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label}已复制`);
    } catch {
      setError(`${label}复制失败，请手动选中`);
    }
  }

  async function copyInviteLink() {
    if (!user) {
      return;
    }

    const origin = window.location.origin;
    await copyText(`${origin}/register?inviteCode=${encodeURIComponent(user.inviteCode)}`, '邀请链接');
  }

  async function copyAllModels() {
    const modelNames = filteredModels.map((model) => model.model);
    if (!modelNames.length) {
      setError('当前没有可复制的模型');
      return;
    }

    await copyText(modelNames.join('\n'), '模型列表');
  }

  return (
    <ConsoleShell
      activePath="/account/profile"
      isRefreshing={isLoading}
      onLogout={() => void handleLogout()}
      onRefresh={() => void loadProfile()}
      username={user?.username}
    >
          {error ? <p className="form-error">{error}</p> : null}
          {message ? <p className="form-success">{message}</p> : null}

          <section className="profile-card profile-identity">
            <div className="profile-avatar" aria-hidden="true">
              {user?.username.slice(0, 1).toUpperCase() ?? 'R'}
            </div>
            <div className="profile-identity-main">
              <h1>{isLoading ? '加载中' : user?.username ?? '未登录'}</h1>
              <div className="profile-tag-row">
                <span className="profile-tag blue">
                  <CheckCircleOutlined />
                  {formatRole(user?.role)}
                </span>
                <span className="profile-tag green">
                  <TeamOutlined />
                  分组：{user?.group.code ?? '-'}
                </span>
              </div>
            </div>
            <div className="profile-helper-panel">
              <span>API 中转账户</span>
              <strong>{user?.status ?? '-'}</strong>
            </div>
          </section>

          <section className="profile-card profile-metrics">
            <MetricBlock label="账户余额" value={formatCents(user?.wallet.balanceCents ?? 0)} tone="green" detail="长期有效" />
            <MetricBlock label="累计消费" value={formatCents(user?.wallet.totalSpendCents ?? 0)} tone="red" />
            <MetricBlock label="调用次数" value={`${user?.metrics.totalCallCount ?? 0} 次`} icon={<CheckCircleOutlined />} />
            <MetricBlock label="邀请用户" value={`${user?.referral.invitedUserCount ?? 0} 人`} icon={<TeamOutlined />} />
          </section>

          <section className="profile-card profile-referral">
            <div className="profile-section-title">
              <GiftOutlined />
              <h2>推广信息</h2>
            </div>
            <div className="profile-referral-actions">
              <div>
                <span>邀请码：</span>
                <strong>{user?.inviteCode ?? '-'}</strong>
              </div>
              <button
                className="ghost-button compact-button"
                disabled={!user}
                onClick={() => user && void copyText(user.inviteCode, '邀请码')}
                type="button"
              >
                <CopyOutlined />
                复制邀请码
              </button>
              <button className="primary-button compact-button" disabled={!user} onClick={() => void copyInviteLink()} type="button">
                <GiftOutlined />
                邀请链接
              </button>
            </div>
            <div className="profile-referral-stats">
              <span>待使用收益：{formatCents(user?.referral.pendingRewardCents ?? 0)}</span>
              <span>总收益：{formatCents(user?.referral.settledRewardCents ?? 0)}</span>
              <span>返利记录：{(user?.referral.pendingRewardCount ?? 0) + (user?.referral.settledRewardCount ?? 0)} 条</span>
            </div>
          </section>

          <section className="profile-card profile-user-info">
            <div className="profile-section-title">
              <UserOutlined />
              <h2>用户信息</h2>
            </div>
            <div className="profile-info-grid">
              <label>
                <span>时区</span>
                <select
                  disabled={!user || isSavingTimezone}
                  onChange={(event) => void handleTimezoneChange(event.target.value)}
                  value={timezone}
                >
                  {Array.from(new Set([timezone, ...commonTimezones])).map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span>上次登录 IP</span>
                <strong>{user?.lastLoginIp ?? '-'}</strong>
              </div>
              <div>
                <span>上次登录时间</span>
                <strong>{formatDateTime(user?.lastLoginAt)}</strong>
              </div>
            </div>
          </section>

          <section className="profile-card profile-models">
            <div className="profile-section-title">
              <ApiOutlined />
              <h2>可用模型</h2>
            </div>
            <label className="profile-search">
              <SearchOutlined />
              <input
                aria-label="搜索分组或模型"
                onChange={(event) => setModelQuery(event.target.value)}
                placeholder="搜索分组或模型"
                type="search"
                value={modelQuery}
              />
            </label>
            <div className="profile-model-tabs">
              <button className="active" type="button">
                {user?.group.code ?? 'default'}
                <span>{formatMultiplier(groupMultiplier)}x</span>
              </button>
            </div>
            <div className="profile-model-summary">
              <span>可用模型数量：{filteredModels.length}</span>
              <button className="ghost-button compact-button" onClick={() => void copyAllModels()} type="button">
                <CopyOutlined />
                复制全部模型
              </button>
            </div>
            <div className="profile-model-chip-list">
              {filteredModels.map((model) => (
                <ModelChip key={model.model} model={model} />
              ))}
              {!isLoading && filteredModels.length === 0 ? <p className="empty-state">暂无可用模型</p> : null}
            </div>
          </section>

          <section className="profile-card profile-model-config">
            <div className="profile-section-title">
              <SettingOutlined />
              <h2>模型配置</h2>
            </div>
            <label>
              <span>接受未配置倍率的模型</span>
              <select disabled value="global">
                <option value="global">使用全局配置</option>
              </select>
            </label>
          </section>

          <section className="profile-card profile-options">
            <div className="profile-section-title">
              <KeyOutlined />
              <h2>账户选项</h2>
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
              <div className="profile-option-actions">
                <button className="primary-button" disabled={isChangingPassword} type="submit">
                  <KeyOutlined />
                  {isChangingPassword ? '保存中' : '修改密码'}
                </button>
                <Link className="secondary-link-button" href="/token">
                  <KeyOutlined />
                  系统令牌
                </Link>
              </div>
            </form>
          </section>
    </ConsoleShell>
  );
}

function MetricBlock({
  label,
  value,
  detail,
  tone,
  icon
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'green' | 'red';
  icon?: ReactNode;
}) {
  return (
    <div className="profile-metric-block">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : ''}>
        {icon}
        {value}
      </strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function ModelChip({ model }: { model: AvailableModel }) {
  return (
    <button
      className="profile-model-chip"
      onClick={() => void navigator.clipboard.writeText(model.model)}
      title="复制模型名"
      type="button"
    >
      {model.model}
    </button>
  );
}

function formatRole(role?: string) {
  if (role === 'admin') {
    return '管理员';
  }

  if (role === 'user') {
    return '普通用户';
  }

  return '-';
}

function formatMultiplier(value: string) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return value;
  }

  return numericValue.toLocaleString('zh-CN', {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0
  });
}

function formatCents(value: number) {
  return `${(value / 100).toFixed(2)} 元`;
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
}
