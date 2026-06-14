'use client';

import {
  DashboardOutlined,
  FilterOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  WalletOutlined
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import {
  getGroupAvailability,
  type GroupAvailabilityResponse,
  type GroupAvailabilityStatus
} from '../lib/group-availability-api';

type FilterState = {
  hours: string;
  status: GroupAvailabilityStatus | '';
};

const DEFAULT_FILTERS: FilterState = {
  hours: '24',
  status: ''
};

export default function GroupAvailabilityPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [data, setData] = useState<GroupAvailabilityResponse | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadAvailability(DEFAULT_FILTERS);
  }, []);

  async function loadAvailability(nextFilters: FilterState) {
    setIsLoading(true);
    setError('');

    try {
      const result = await getGroupAvailability({
        hours: Number(nextFilters.hours) || 24,
        status: nextFilters.status || undefined
      });
      setData(result);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '分组状态加载失败';
      setError(message);
      if (message.startsWith('401:') || message.includes('认证') || message.includes('会话')) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadAvailability(filters);
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    void loadAvailability(DEFAULT_FILTERS);
  }

  const summary = data?.summary;

  return (
    <main className="account-page">
      <header className="topbar">
        <Link className="auth-brand compact" href="/">
          <span className="shell-logo-mark">R</span>
          <span>Relay Console</span>
        </Link>
        <nav className="admin-top-actions" aria-label="分组状态导航">
          <Link className="ghost-button" href="/account">
            <WalletOutlined />
            账户
          </Link>
          <button className="ghost-button" disabled={isLoading} onClick={() => void loadAvailability(filters)} type="button">
            <ReloadOutlined />
            刷新
          </button>
        </nav>
      </header>

      <section className="account-grid">
        <section className="account-panel account-summary">
          <div>
            <p className="eyebrow">分组状态</p>
            <h1>{isLoading ? '加载中' : `${summary?.totalModels ?? 0} 个分组模型`}</h1>
          </div>
          <button
            className="icon-button"
            disabled={isLoading}
            onClick={() => void loadAvailability(filters)}
            title="刷新分组状态"
            type="button"
          >
            <ReloadOutlined />
          </button>
        </section>

        <div className="metric-panel">
          <span>当前分组</span>
          <strong>{data?.group.name ?? '-'}</strong>
          <small>
            {data?.group.code ?? '-'} · {data?.group.status ?? '-'} · {data?.group.userCount ?? 0} 用户
          </small>
        </div>
        <div className="metric-panel">
          <span>模型状态</span>
          <strong>{summary?.statusCounts.normal ?? 0} 正常</strong>
          <small>
            部分 {summary?.statusCounts.partial ?? 0} · 不可用 {summary?.statusCounts.unavailable ?? 0} · 暂无数据{' '}
            {summary?.statusCounts.no_data ?? 0}
          </small>
        </div>
        <div className="metric-panel">
          <span>窗口成功率</span>
          <strong>{formatPercent(summary?.successRate ?? null)}</strong>
          <small>
            成功 {summary?.successfulCalls ?? 0} / 失败 {summary?.failedCalls ?? 0} / 总计 {summary?.totalCalls ?? 0}
          </small>
        </div>

        {error ? <p className="form-error wide-panel">{error}</p> : null}

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <FilterOutlined />
            <h2>筛选</h2>
          </div>
          <form className="availability-filter-form" onSubmit={handleSubmit}>
            <label>
              时间范围
              <select
                onChange={(event) => setFilters((current) => ({ ...current, hours: event.target.value }))}
                value={filters.hours}
              >
                <option value="1">近 1 小时</option>
                <option value="24">近 24 小时</option>
                <option value="168">近 7 天</option>
              </select>
            </label>
            <label>
              状态
              <select
                onChange={(event) =>
                  setFilters((current) => ({ ...current, status: event.target.value as GroupAvailabilityStatus | '' }))
                }
                value={filters.status}
              >
                <option value="">全部状态</option>
                <option value="normal">正常</option>
                <option value="partial">部分可用</option>
                <option value="unavailable">不可用</option>
                <option value="no_data">暂无数据</option>
              </select>
            </label>
            <div className="filter-actions">
              <button className="primary-button" disabled={isLoading} type="submit">
                <FilterOutlined />
                应用
              </button>
              <button className="ghost-button" disabled={isLoading} onClick={resetFilters} type="button">
                重置
              </button>
            </div>
          </form>
        </section>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <SafetyCertificateOutlined />
            <h2>模型可用性</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table availability-table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th>状态</th>
                  <th>成功率</th>
                  <th>调用</th>
                  <th>上游汇总</th>
                  <th>能力</th>
                  <th>最近调用</th>
                  <th>最近健康检查</th>
                </tr>
              </thead>
              <tbody>
                {(data?.models ?? []).map((model) => (
                  <tr key={model.model}>
                    <td>
                      <strong>{model.model}</strong>
                      {model.displayName ? <span className="table-note">{model.displayName}</span> : null}
                    </td>
                    <td>
                      {renderStatus(model.status)}
                      <span className="table-note">{formatReason(model.reason)}</span>
                    </td>
                    <td>{formatPercent(model.usage.successRate)}</td>
                    <td>
                      {model.usage.successfulCalls}/{model.usage.failedCalls}/{model.usage.totalCalls}
                      <span className="table-note">成功 / 失败 / 总计</span>
                    </td>
                    <td>
                      {model.upstreams.healthy}/{model.upstreams.unhealthy}/{model.upstreams.unknown}/{model.upstreams.active}
                      <span className="table-note">健康 / 不健康 / 未知 / 启用</span>
                    </td>
                    <td>{model.supportsStream ? 'stream' : 'no stream'}</td>
                    <td>{formatDateTime(model.lastCallAt) ?? '暂无调用'}</td>
                    <td>{formatDateTime(model.lastHealthCheckAt) ?? '暂无检查'}</td>
                  </tr>
                ))}
                {!isLoading && !(data?.models ?? []).length ? (
                  <tr>
                    <td colSpan={8}>暂无符合条件的真实状态数据</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function renderStatus(status: GroupAvailabilityStatus) {
  if (status === 'normal') {
    return <span className="status-pill status-pill-success">正常</span>;
  }

  if (status === 'partial') {
    return <span className="status-pill status-pill-warning">部分可用</span>;
  }

  if (status === 'unavailable') {
    return <span className="status-pill status-pill-danger">不可用</span>;
  }

  return <span className="status-pill status-pill-muted">暂无数据</span>;
}

function formatReason(reason: string) {
  const labels: Record<string, string> = {
    group_disabled: '分组已禁用',
    model_disabled: '模型已禁用',
    no_active_upstream: '无启用上游',
    no_recent_usage_or_health_check: '无近期调用或健康检查',
    upstream_unhealthy: '存在不健康上游',
    low_success_rate: '近期成功率偏低',
    recent_calls_successful: '近期调用可用',
    upstream_healthy: '上游健康'
  };

  return labels[reason] ?? reason;
}

function formatPercent(value: number | null) {
  return value === null ? '暂无数据' : `${(value * 100).toFixed(1)}%`;
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : null;
}
