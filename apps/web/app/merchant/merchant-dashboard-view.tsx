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
import {
  getDailyConsumptionReport,
  getDashboardSummary,
  type DailyConsumptionDay,
  type DailyConsumptionReport,
  type DailyUserCostAlert,
  type DashboardSummary,
  type DashboardUserStats
} from '../lib/admin-api';
import { logout } from '../lib/auth-api';
import { formatBillingUsd } from '../lib/billing-format';

export function MerchantDashboardView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [dailyReport, setDailyReport] = useState<DailyConsumptionReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadSummary();
  }, []);

  async function loadSummary() {
    setIsLoading(true);
    setError('');

    try {
      const [nextSummary, nextDailyReport] = await Promise.all([
        getDashboardSummary(),
        getDailyConsumptionReport({ days: 14 })
      ]);
      setSummary(nextSummary);
      setDailyReport(nextDailyReport);
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
          <MetricPanel
            label="今日兑换金额"
            qa="merchant-dashboard-today-recharge"
            value={formatBillingUsd(summary?.today.rechargeCents)}
            detail={`${summary?.today.rechargeCount ?? 0} 次兑换码入账`}
            tone="green"
          />
          <MetricPanel
            label="今日新增用户"
            qa="merchant-dashboard-today-new-users"
            value={formatNumber(summary?.users.newToday)}
            detail={`较昨日 ${formatDelta(summary?.users.newTodayDelta)}`}
          />
          <MetricPanel
            label="今日活跃用户"
            qa="merchant-dashboard-today-active-users"
            value={formatNumber(summary?.today.activeUsers)}
            detail="按今日 token 消耗用户数计算"
          />
          <MetricPanel
            label="24h 错误率"
            value={`${summary?.performance.errorRatePercent ?? 0}%`}
            detail={`${summary?.performance.errorCount ?? 0}/${summary?.performance.requestCount ?? 0} 请求，均值 ${summary?.performance.averageLatencyMs ?? 0}ms`}
            tone={(summary?.performance.errorRatePercent ?? 0) > 1 ? 'red' : undefined}
          />
        </section>

        <section className="admin-metrics">
          <MetricPanel
            label="本月兑换金额"
            qa="merchant-dashboard-month-recharge"
            value={formatBillingUsd(summary?.month?.rechargeCents)}
            detail={`${summary?.month?.rechargeCount ?? 0} 次兑换码入账`}
            tone="green"
          />
          <MetricPanel
            label="本月新增用户"
            qa="merchant-dashboard-month-new-users"
            value={formatNumber(summary?.month?.newUsers)}
            detail={`自然月起点 ${summary?.window.monthStart ? formatDate(summary.window.monthStart) : '-'}`}
          />
          <MetricPanel
            label="本月活跃用户"
            qa="merchant-dashboard-month-active-users"
            value={formatNumber(summary?.month?.activeUsers)}
            detail="按本月 token 消耗用户数计算"
          />
          <MetricPanel
            label="本月 Token"
            value={formatNumber(summary?.month?.totalTokens)}
            detail={`${summary?.month?.callCount ?? 0} 次请求，错误率 ${summary?.month?.performance.errorRatePercent ?? 0}%`}
          />
        </section>

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
          <div className="panel-title">
            <ApiOutlined />
            <h2>服务性能</h2>
          </div>
          <DashboardRows
            rows={[
              ['24h 请求量', formatNumber(summary?.performance.requestCount)],
              ['24h 错误数', formatNumber(summary?.performance.errorCount)],
              ['24h 错误率', `${summary?.performance.errorRatePercent ?? 0}%`],
              ['平均耗时', `${summary?.performance.averageLatencyMs ?? 0} ms`],
              ['上游平均耗时', `${summary?.performance.averageUpstreamLatencyMs ?? 0} ms`]
            ]}
          />
        </section>

        <section className="admin-panel">
          <div className="panel-title">
            <DatabaseOutlined />
            <h2>每日消耗报表</h2>
          </div>
          <DashboardRows
            rows={[
              ['统计周期', dailyReport ? `${dailyReport.window.days} 天` : '-'],
              ['周期消耗', formatBillingUsd(dailyReport?.totals.spendCents)],
              ['周期 Token', formatNumber(dailyReport?.totals.totalTokens)],
              ['周期错误率', `${dailyReport?.totals.errorRatePercent ?? 0}%`]
            ]}
          />
          <div className="admin-table-wrap">
            <table className="admin-table merchant-dashboard-daily-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>消耗</th>
                  <th>Token</th>
                  <th>活跃用户</th>
                  <th>充值</th>
                  <th>请求/错误率</th>
                  <th>均耗时</th>
                </tr>
              </thead>
              <tbody>
                {dailyReport?.days.slice(0, 7).map((day) => (
                  <DailyReportRow day={day} key={day.date} />
                ))}
                {dailyReport && !dailyReport.days.length ? (
                  <tr>
                    <td colSpan={7}>暂无每日消耗数据</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="admin-panel">
          <div className="panel-title">
            <DatabaseOutlined />
            <h2>用户成本告警</h2>
          </div>
          <DashboardRows
            rows={[
              ['单用户日阈值', formatBillingUsd(dailyReport?.costAlert.userDailyThresholdCents)],
              ['当前告警数', formatNumber(dailyReport?.costAlert.alerts.length)]
            ]}
          />
          <div className="admin-table-wrap">
            <table className="admin-table merchant-dashboard-cost-alert-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>用户</th>
                  <th>日消耗</th>
                  <th>Token</th>
                  <th>请求数</th>
                  <th>最近调用</th>
                </tr>
              </thead>
              <tbody>
                {dailyReport?.costAlert.alerts.map((alert) => (
                  <CostAlertRow alert={alert} key={`${alert.date}:${alert.userId}`} />
                ))}
                {dailyReport && !dailyReport.costAlert.alerts.length ? (
                  <tr>
                    <td colSpan={6}>暂无超过阈值的用户成本告警</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
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

function DailyReportRow({ day }: { day: DailyConsumptionDay }) {
  return (
    <tr>
      <td>{day.date}</td>
      <td>{formatBillingUsd(day.spendCents)}</td>
      <td>
        {formatNumber(day.totalTokens)}
        <small className="table-note">
          输入 {formatNumber(day.promptTokens)} / 输出 {formatNumber(day.completionTokens)}
        </small>
      </td>
      <td>{formatNumber(day.activeUsers)}</td>
      <td>
        {formatBillingUsd(day.rechargeCents)}
        <small className="table-note">{formatNumber(day.rechargeCount)} 次</small>
      </td>
      <td>
        {formatNumber(day.requestLogCount)}
        <small className="table-note">{day.errorRatePercent}%</small>
      </td>
      <td>{formatNumber(day.averageLatencyMs)} ms</td>
    </tr>
  );
}

function CostAlertRow({ alert }: { alert: DailyUserCostAlert }) {
  return (
    <tr>
      <td>{alert.date}</td>
      <td>
        <strong>{alert.username}</strong>
        <small className="table-note">阈值 {formatBillingUsd(alert.thresholdCents)}</small>
      </td>
      <td>{formatBillingUsd(alert.spendCents)}</td>
      <td>{formatNumber(alert.totalTokens)}</td>
      <td>{formatNumber(alert.requestCount)}</td>
      <td>{formatOptionalDate(alert.lastUsedAt)}</td>
    </tr>
  );
}

function MetricPanel({ label, value, detail, qa, tone }: { label: string; value: string; detail: string; qa?: string; tone?: 'green' | 'red' }) {
  return (
    <section className="metric-panel" data-qa={qa}>
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

function formatDelta(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-';
  }

  if (value > 0) {
    return `+${formatNumber(value)}`;
  }

  return formatNumber(value);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short'
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
