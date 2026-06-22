'use client';

import {
  ApiOutlined,
  DatabaseOutlined,
  GiftOutlined,
  ReloadOutlined,
  TeamOutlined
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MerchantShell } from '../components/merchant-shell';
import { getDashboardSummary, type DashboardSummary, type DashboardUserStats } from '../lib/admin-api';
import { logout } from '../lib/auth-api';
import { formatBillingUsd } from '../lib/billing-format';

export function MerchantDashboardView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadSummary();
  }, []);

  async function loadSummary() {
    setIsLoading(true);
    setError('');

    try {
      setSummary(await getDashboardSummary());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '商家端概览加载失败');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <MerchantShell
      activePath="/merchant"
      isRefreshing={isLoading}
      onLogout={handleLogout}
      onRefresh={() => void loadSummary()}
      role={role}
      username={username}
    >
      <section className="admin-content merchant-dashboard">
        <div className="admin-heading merchant-dashboard-heading">
          <div>
            <p className="eyebrow">商家工作台</p>
            <h1>运营数据</h1>
            <small>
              数据来自真实数据库，刷新时间 {summary ? formatDateTime(summary.generatedAt) : '-'}
            </small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadSummary()} title="刷新商家端概览" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="用户数" value={formatNumber(summary?.users.ordinary)} detail="普通用户账号" />
          <MetricPanel label="兑换充值" value={formatBillingUsd(summary?.totals.rechargeCents)} detail={`${summary?.totals.rechargeCount ?? 0} 次兑换码充值`} tone="green" />
          <MetricPanel label="实际消费" value={formatBillingUsd(summary?.totals.spendCents)} detail={`${summary?.totals.requestCount ?? 0} 条用量记录`} tone="red" />
          <MetricPanel label="Token 消耗" value={formatNumber(summary?.totals.totalTokens)} detail="输入 + 输出 token" />
        </section>

        <section className="admin-grid">
          <section className="admin-panel">
            <div className="panel-title">
              <TeamOutlined />
              <h2>用户统计</h2>
            </div>
            <DashboardRows
              rows={[
                ['普通用户', formatNumber(summary?.users.ordinary)],
                ['今日新增', formatNumber(summary?.users.newToday)],
                ['禁用/风控', `${summary?.users.disabled ?? 0} / ${summary?.users.riskLocked ?? 0}`],
                ['后台账号', formatNumber(summary?.users.admins)]
              ]}
            />
          </section>

          <section className="admin-panel">
            <div className="panel-title">
              <DatabaseOutlined />
              <h2>Token 与扣费</h2>
            </div>
            <DashboardRows
              rows={[
                ['输入 token', formatNumber(summary?.totals.promptTokens)],
                ['输出 token', formatNumber(summary?.totals.completionTokens)],
                ['Token 总量', formatNumber(summary?.totals.totalTokens)],
                ['消费金额', formatBillingUsd(summary?.totals.spendCents)]
              ]}
            />
          </section>

          <section className="admin-panel">
            <div className="panel-title">
              <ApiOutlined />
              <h2>模型管理</h2>
            </div>
            <DashboardRows
              rows={[
                ['公开模型', formatNumber(summary?.models.total)],
                ['启用模型', formatNumber(summary?.models.active)],
                ['停用模型', formatNumber(summary?.models.disabled)],
                ['启用线路', formatNumber(summary?.models.upstreamMappings.active)]
              ]}
            />
            <div className="panel-actions">
              <Link className="ghost-button compact-button" href="/merchant/model-config">
                管理模型
              </Link>
            </div>
          </section>

          <section className="admin-panel">
            <div className="panel-title">
              <GiftOutlined />
              <h2>兑换码</h2>
            </div>
            <DashboardRows
              rows={[
                ['兑换码总数', formatNumber(summary?.rechargeCodes.total)],
                ['未使用', formatNumber(summary?.rechargeCodes.unused)],
                ['已使用', formatNumber(summary?.rechargeCodes.used)],
                ['兑换充值', formatBillingUsd(summary?.totals.rechargeCents)]
              ]}
            />
            <div className="panel-actions">
              <Link className="ghost-button compact-button" href="/merchant/recharge-codes">
                管理充值码
              </Link>
            </div>
          </section>
        </section>

        <section className="admin-panel">
          <div className="panel-title panel-title-with-action">
            <span>
              <TeamOutlined />
              <h2>用户消费排行</h2>
            </span>
            <Link className="ghost-button compact-button" href="/merchant/users">
              查看全部用户
            </Link>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table merchant-dashboard-user-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>兑换充值</th>
                  <th>消费金额</th>
                  <th>Token 消耗</th>
                  <th>请求数 / 最近调用</th>
                  <th>当前余额</th>
                </tr>
              </thead>
              <tbody>
                {summary?.topUsers.map((user) => (
                  <UserStatsRow key={user.id} user={user} />
                ))}
                {summary && !summary.topUsers.length ? (
                  <tr>
                    <td colSpan={6}>暂无真实用户用量记录</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </MerchantShell>
  );
}

function MetricPanel({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: 'green' | 'red' }) {
  return (
    <section className="metric-panel">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : undefined}>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}

function DashboardRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="dashboard-rows">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function UserStatsRow({ user }: { user: DashboardUserStats }) {
  return (
    <tr>
      <td>
        <strong>{user.username}</strong>
        <small className="table-note">{user.status}</small>
      </td>
      <td>
        {formatBillingUsd(user.recharge.totalCents)}
        <small className="table-note">{formatNumber(user.recharge.count)} 次兑换</small>
      </td>
      <td>{formatBillingUsd(user.usage.spendCents)}</td>
      <td>
        {formatNumber(user.usage.totalTokens)}
        <small className="table-note">
          输入 {formatNumber(user.usage.promptTokens)} / 输出 {formatNumber(user.usage.completionTokens)}
        </small>
      </td>
      <td>
        {formatNumber(user.usage.requestCount)}
        <small className="table-note">{formatOptionalDate(user.usage.lastUsedAt)}</small>
      </td>
      <td>{formatBillingUsd(user.wallet.balanceCents)}</td>
    </tr>
  );
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-';
  }

  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false
  }).format(new Date(value));
}

function formatOptionalDate(value: string | null) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false
  }).format(new Date(value));
}
