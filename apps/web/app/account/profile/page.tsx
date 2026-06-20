'use client';

import {
  ApiOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  GiftOutlined,
  KeyOutlined,
  LineChartOutlined,
  ReloadOutlined,
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
import { formatBillingUsd } from '../../lib/billing-format';
import { listUsageLogs, type UsageLogEntry, type UsageLogsResponse } from '../../lib/usage-log-api';

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
  const [usageData, setUsageData] = useState<UsageLogsResponse | null>(null);
  const [rangeDays, setRangeDays] = useState(7);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);
  const [isSavingTimezone, setIsSavingTimezone] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    void loadProfile();
  }, []);

  useEffect(() => {
    void loadUsageOverview(rangeDays);
  }, [rangeDays]);

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

  const usageRows = usageData?.items ?? [];
  const successfulUsageRows = useMemo(() => usageRows.filter(isSuccessfulUsage), [usageRows]);
  const todayUsage = useMemo(() => summarizeTodayUsage(successfulUsageRows), [successfulUsageRows]);
  const modelBreakdown = useMemo(() => getModelBreakdown(successfulUsageRows), [successfulUsageRows]);
  const tokenTrend = useMemo(() => getTokenTrend(successfulUsageRows, rangeDays), [rangeDays, successfulUsageRows]);
  const usageSummary = usageData?.summary;
  const periodChargedUsd = usageSummary?.totalCostCents ?? 0;
  const periodRawTokens = usageSummary?.totalTokens ?? 0;
  const periodAttemptCount = usageSummary?.totalRequests ?? usageSummary?.total ?? 0;
  const periodSuccessCount = useMemo(() => {
    if (usageSummary?.successfulRequests !== undefined) {
      return usageSummary.successfulRequests;
    }

    if (!usageSummary) {
      return 0;
    }

    return (usageSummary.statusCounts.billable ?? 0) + (usageSummary.statusCounts.free ?? 0);
  }, [usageSummary]);
  const periodFailureCount = useMemo(() => {
    if (usageSummary?.failedRequests !== undefined) {
      return usageSummary.failedRequests;
    }

    if (!usageSummary) {
      return 0;
    }

    return (usageSummary.statusCounts.failed ?? 0) + (usageSummary.statusCounts.metering_unknown ?? 0);
  }, [usageSummary]);
  const periodSuccessRate = useMemo(() => {
    if (periodAttemptCount === 0) {
      return 0;
    }

    return Math.round((periodSuccessCount / periodAttemptCount) * 1000) / 10;
  }, [periodAttemptCount, periodSuccessCount]);
  const periodAvgTokensPerCall = useMemo(() => {
    if (periodSuccessCount === 0) {
      return 0;
    }

    return Math.round(periodRawTokens / periodSuccessCount);
  }, [periodRawTokens, periodSuccessCount]);

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

  async function loadUsageOverview(days = rangeDays) {
    setIsLoadingUsage(true);

    try {
      const from = new Date();
      from.setDate(from.getDate() - days + 1);
      from.setHours(0, 0, 0, 0);

      const result = await listUsageLogs({
        from: from.toISOString(),
        limit: 100
      });
      setUsageData(result);
    } catch {
      setUsageData(null);
    } finally {
      setIsLoadingUsage(false);
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
              </div>
            </div>
            <div className="profile-helper-panel">
              <span>API 中转账户</span>
              <strong>{user?.status ?? '-'}</strong>
            </div>
          </section>

          <section className="profile-metrics">
            <MetricBlock
              accent="green"
              detail="账号可用余额"
              icon={<GiftOutlined />}
              label="余额"
              value={formatBillingUsd(user?.wallet.balanceCents ?? 0)}
            />
            <MetricBlock
              accent="red"
              detail="历史累计"
              icon={<BarChartOutlined />}
              label="累计消耗"
              value={formatBillingUsd(user?.wallet.totalSpendCents ?? 0)}
            />
            <MetricBlock
              accent="blue"
              detail={`原始 token，不乘价格倍率；扣费 ${formatBillingUsd(periodChargedUsd)}`}
              icon={<LineChartOutlined />}
              label={`近 ${rangeDays} 天 token`}
              unit="token"
              value={formatNumber(periodRawTokens)}
            />
            <MetricBlock
              accent="violet"
              detail="只统计真正成功返回的请求"
              icon={<TeamOutlined />}
              label="扣费成功"
              unit="次"
              value={formatNumber(periodSuccessCount)}
            />
            <MetricBlock
              accent="rose"
              detail={`成功 ${formatNumber(periodSuccessCount)} / 总尝试 ${formatNumber(periodAttemptCount)}，失败或未知 ${formatNumber(periodFailureCount)}`}
              icon={<CheckCircleOutlined />}
              label="成功率"
              value={formatRate(periodSuccessRate)}
            />
          </section>

          <section className="profile-usage-band">
            <div className="profile-usage-cards">
              <UsageTile
                accent="orange"
                detail={`原始输入 ${formatNumber(todayUsage.promptTokens)} / 输出 ${formatNumber(todayUsage.completionTokens)}`}
                icon={<ApiOutlined />}
                label="今日 token"
                value={`${formatNumber(todayUsage.totalTokens)} token`}
              />
              <UsageTile
                accent="blue"
                detail={`失败或未知 ${formatNumber(periodFailureCount)} 次，不参与 token 和扣费统计`}
                icon={<BarChartOutlined />}
                label="成功请求"
                value={formatNumber(periodSuccessCount)}
              />
              <UsageTile
                accent="violet"
                detail="按成功请求平均；包含客户端随请求发送的上下文"
                icon={<LineChartOutlined />}
                label="平均每次 token"
                value={formatNumber(periodAvgTokensPerCall)}
              />
              <UsageTile
                accent="rose"
                detail={`成功 ${formatNumber(periodSuccessCount)} / 总尝试 ${formatNumber(periodAttemptCount)}`}
                icon={<ReloadOutlined />}
                label="成功率"
                value={`${formatRate(periodSuccessRate)} 成功`}
              />
            </div>
            <p className="profile-usage-note">
              说明：token 显示上游返回的原始输入和输出，不会乘价格倍率；价格倍率只影响扣费金额。Claude Code
              如果开着长会话，会把历史上下文一起发送，所以屏幕上只看到一句话，也可能产生较高输入 token。新开空会话测试，短问句 token 会明显下降。
            </p>

            <div className="profile-usage-toolbar">
              <label>
                时间范围：
                <select onChange={(event) => setRangeDays(Number(event.target.value))} value={rangeDays}>
                  <option value={7}>近 7 天</option>
                  <option value={14}>近 14 天</option>
                  <option value={30}>近 30 天</option>
                </select>
              </label>
              <button className="ghost-button compact-button" disabled={isLoadingUsage} onClick={() => void loadUsageOverview()} type="button">
                <ReloadOutlined />
                刷新
              </button>
            </div>

            <div className="profile-usage-panels">
              <section className="profile-usage-panel">
                <div className="profile-usage-panel-title">
                  <h2>模型分布</h2>
                  <span>{modelBreakdown.length} 个模型</span>
                </div>
                {modelBreakdown.length ? (
                  <div className="profile-model-bars">
                    {modelBreakdown.map((entry) => (
                      <div className="profile-model-bar" key={entry.model}>
                        <div>
                          <strong>{entry.model}</strong>
                          <span>{formatNumber(entry.tokens)} token</span>
                        </div>
                        <i style={{ width: `${entry.percent}%` }} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="profile-chart-empty">暂无数据</p>
                )}
              </section>

              <section className="profile-usage-panel">
                <div className="profile-usage-panel-title">
                  <h2>token 使用趋势</h2>
                  <span>按天</span>
                </div>
                {tokenTrend.some((entry) => entry.tokens > 0) ? (
                  <div className="profile-token-trend">
                    {tokenTrend.map((entry) => (
                      <div className="profile-token-trend-item" key={entry.label}>
                        <i style={{ height: `${entry.percent}%` }} />
                        <span>{entry.label}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="profile-chart-empty">暂无数据</p>
                )}
              </section>
            </div>
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
              <span>待使用收益：{formatBillingUsd(user?.referral.pendingRewardCents ?? 0)}</span>
              <span>总收益：{formatBillingUsd(user?.referral.settledRewardCents ?? 0)}</span>
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
                aria-label="搜索模型"
                onChange={(event) => setModelQuery(event.target.value)}
                placeholder="搜索模型"
                type="search"
                value={modelQuery}
              />
            </label>
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

function UsageTile({
  accent,
  detail,
  icon,
  label,
  value
}: {
  accent: 'orange' | 'blue' | 'violet' | 'rose';
  detail: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className={`profile-usage-tile accent-${accent}`}>
      <div className="profile-usage-icon" aria-hidden="true">
        {icon}
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function MetricBlock({
  accent,
  label,
  value,
  unit,
  detail,
  icon
}: {
  accent: 'green' | 'red' | 'blue' | 'violet' | 'rose';
  label: string;
  value: string;
  unit?: string;
  detail?: string;
  icon?: ReactNode;
}) {
  return (
    <div className={`profile-metric-block accent-${accent}`}>
      <div className="profile-metric-icon" aria-hidden="true">
        {icon}
      </div>
      <div>
        <span>{label}</span>
        <strong>
          <span className="profile-metric-value">{value}</span>
          {unit ? <span className="profile-metric-unit">{unit}</span> : null}
        </strong>
        {detail ? <small>{detail}</small> : null}
      </div>
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

function isSuccessfulUsage(row: UsageLogEntry) {
  return row.status === 'billable' || row.status === 'free';
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

function summarizeTodayUsage(rows: UsageLogEntry[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return rows.reduce(
    (summary, row) => {
      if (new Date(row.createdAt) < today) {
        return summary;
      }

      summary.requests += 1;
      summary.promptTokens += row.promptTokens;
      summary.completionTokens += row.completionTokens;
      summary.totalTokens += row.totalTokens;
      return summary;
    },
    { completionTokens: 0, promptTokens: 0, requests: 0, totalTokens: 0 }
  );
}

function getModelBreakdown(rows: UsageLogEntry[]) {
  const totals = rows.reduce<Record<string, number>>((nextTotals, row) => {
    nextTotals[row.model] = (nextTotals[row.model] ?? 0) + row.totalTokens;
    return nextTotals;
  }, {});
  const maxTokens = Math.max(1, ...Object.values(totals));

  return Object.entries(totals)
    .map(([model, tokens]) => ({
      model,
      percent: Math.max(4, Math.round((tokens / maxTokens) * 100)),
      tokens
    }))
    .sort((left, right) => right.tokens - left.tokens)
    .slice(0, 5);
}

function getTokenTrend(rows: UsageLogEntry[], rangeDays: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayTotals = new Map<string, number>();

  for (const row of rows) {
    const rowDate = new Date(row.createdAt);
    rowDate.setHours(0, 0, 0, 0);
    const key = rowDate.toISOString().slice(0, 10);
    dayTotals.set(key, (dayTotals.get(key) ?? 0) + row.totalTokens);
  }

  const entries = Array.from({ length: rangeDays }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (rangeDays - index - 1));
    const key = date.toISOString().slice(0, 10);
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      tokens: dayTotals.get(key) ?? 0
    };
  });
  const maxTokens = Math.max(1, ...entries.map((entry) => entry.tokens));

  return entries.map((entry) => ({
    ...entry,
    percent: entry.tokens === 0 ? 4 : Math.max(10, Math.round((entry.tokens / maxTokens) * 100))
  }));
}

function formatRate(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
}
