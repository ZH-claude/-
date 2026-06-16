'use client';

import {
  AlertOutlined,
  ApiOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DollarOutlined,
  GiftOutlined,
  ReloadOutlined,
  TeamOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { MerchantShell } from '../components/merchant-shell';
import { getDashboardSummary, type DashboardSummary } from '../lib/admin-api';
import { logout } from '../lib/auth-api';

export function MerchantDashboardView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadSummary();
  }, []);

  const healthLabel = useMemo(() => {
    if (!summary) {
      return '-';
    }

    if (!summary.upstreams.total) {
      return '未配置';
    }

    if (summary.upstreams.health.unhealthy > 0) {
      return '异常';
    }

    if (summary.upstreams.health.unknown > 0) {
      return '待检查';
    }

    return '正常';
  }, [summary]);

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
            <h1>运营概览</h1>
            <small>
              数据来自真实数据库，统计窗口从 {summary ? formatDateTime(summary.window.todayStart) : '-'} 开始
            </small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadSummary()} title="刷新商家端概览" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="账户余额" value={formatMoney(summary?.wallets.totalBalanceCents)} detail="所有未删除用户钱包余额" tone="green" />
          <MetricPanel label="今日消费" value={formatMoney(summary?.today.spendCents)} detail={`${summary?.today.callCount ?? 0} 次调用`} tone="red" />
          <MetricPanel label="活跃用户" value={formatNumber(summary?.users.active)} detail={`总用户 ${summary?.users.total ?? 0}`} />
          <MetricPanel label="上游状态" value={healthLabel} detail={`${summary?.upstreams.active ?? 0} 个启用上游`} />
        </section>

        <section className="admin-grid">
          <section className="admin-panel">
            <div className="panel-title">
              <TeamOutlined />
              <h2>用户与资金</h2>
            </div>
            <DashboardRows
              rows={[
                ['普通用户', formatNumber(summary?.users.ordinary)],
                ['后台账号', formatNumber(summary?.users.admins)],
                ['今日新增', formatNumber(summary?.users.newToday)],
                ['禁用/风控', `${summary?.users.disabled ?? 0} / ${summary?.users.riskLocked ?? 0}`],
                ['累计消费', formatMoney(summary?.wallets.totalSpendCents)]
              ]}
            />
          </section>

          <section className="admin-panel">
            <div className="panel-title">
              <DatabaseOutlined />
              <h2>今日调用</h2>
            </div>
            <DashboardRows
              rows={[
                ['调用次数', formatNumber(summary?.today.callCount)],
                ['Token 总量', formatNumber(summary?.today.totalTokens)],
                ['成功扣费', formatNumber(summary?.today.statusCounts.billable)],
                ['失败记录', formatNumber(summary?.today.statusCounts.failed)],
                ['计量未知', formatNumber(summary?.today.statusCounts.metering_unknown)]
              ]}
            />
          </section>

          <section className="admin-panel">
            <div className="panel-title">
              <CloudServerOutlined />
              <h2>上游健康</h2>
            </div>
            <DashboardRows
              rows={[
                ['上游总数', formatNumber(summary?.upstreams.total)],
                ['启用/禁用', `${summary?.upstreams.active ?? 0} / ${summary?.upstreams.disabled ?? 0}`],
                ['健康', formatNumber(summary?.upstreams.health.healthy)],
                ['异常', formatNumber(summary?.upstreams.health.unhealthy)],
                ['未知', formatNumber(summary?.upstreams.health.unknown)]
              ]}
            />
          </section>

          <section className="admin-panel">
            <div className="panel-title">
              <ApiOutlined />
              <h2>模型容量</h2>
            </div>
            <DashboardRows
              rows={[
                ['公开模型', formatNumber(summary?.models.total)],
                ['启用模型', formatNumber(summary?.models.active)],
                ['停用模型', formatNumber(summary?.models.disabled)],
                ['上游映射', formatNumber(summary?.models.upstreamMappings.total)],
                ['启用映射', formatNumber(summary?.models.upstreamMappings.active)]
              ]}
            />
          </section>

          <section className="admin-panel">
            <div className="panel-title">
              <GiftOutlined />
              <h2>充值码</h2>
            </div>
            <DashboardRows
              rows={[
                ['总数', formatNumber(summary?.rechargeCodes.total)],
                ['未使用', formatNumber(summary?.rechargeCodes.unused)],
                ['已使用', formatNumber(summary?.rechargeCodes.used)],
                ['已禁用', formatNumber(summary?.rechargeCodes.disabled)]
              ]}
            />
          </section>

          <section className="admin-panel">
            <div className="panel-title">
              <AlertOutlined />
              <h2>最近告警</h2>
            </div>
            {summary?.recentAlerts.length ? (
              <div className="merchant-alert-list">
                {summary.recentAlerts.map((alert) => (
                  <article className="merchant-alert-item" key={alert.id}>
                    <div>
                      <span className={alert.severity === 'high' ? 'status-pill status-pill-danger' : 'status-pill status-pill-warning'}>
                        {alert.type === 'upstream_unhealthy' ? '上游' : '请求'}
                      </span>
                      <strong>{alert.title}</strong>
                    </div>
                    <p>{alert.detail}</p>
                    <small>{formatDateTime(alert.createdAt)}</small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">最近 24 小时暂无真实告警</p>
            )}
          </section>
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

function formatMoney(cents: number | null | undefined) {
  if (cents === null || cents === undefined) {
    return '-';
  }

  return `${(cents / 100).toFixed(2)} 元`;
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
    hour12: false,
    timeZone: 'UTC'
  }).format(new Date(value));
}
