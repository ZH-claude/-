'use client';

import { FileTextOutlined, FilterOutlined, LeftOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { MerchantShell } from '../../components/merchant-shell';
import {
  listAdminRequestLogs,
  type AdminRequestLog,
  type AdminRequestLogStatusFilter
} from '../../lib/admin-api';
import { logout } from '../../lib/auth-api';

const REQUEST_LOG_LIMIT = 20;

type PaginationState = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type FilterState = {
  status: AdminRequestLogStatusFilter;
  model: string;
};

const DEFAULT_FILTERS: FilterState = {
  status: 'all',
  model: ''
};

export function MerchantRequestLogsView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<AdminRequestLog[]>([]);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [summary, setSummary] = useState({ total: 0, successCount: 0, errorCount: 0 });
  const [pagination, setPagination] = useState<PaginationState>(createPagination());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadLogs(1, DEFAULT_FILTERS);
  }, []);

  async function loadLogs(page = pagination.page, nextFilters = filters) {
    setIsLoading(true);
    setError('');

    try {
      const result = await listAdminRequestLogs({
        page,
        limit: REQUEST_LOG_LIMIT,
        status: nextFilters.status,
        model: nextFilters.model || undefined
      });
      setRows(result.items);
      setSummary(result.summary);
      setPagination({
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / result.limit))
      });
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '请求记录加载失败';
      setError(nextMessage);
      if (nextMessage.includes('401') || nextMessage.includes('认证') || nextMessage.includes('会话')) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadLogs(1, filters);
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    void loadLogs(1, DEFAULT_FILTERS);
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <MerchantShell
      activePath="/merchant/request-logs"
      isRefreshing={isLoading}
      onLogout={handleLogout}
      onRefresh={() => void loadLogs(pagination.page, filters)}
      role={role}
      username={username}
    >
      <section className="admin-content merchant-request-logs-page" data-page="merchant-request-logs">
        <div className="admin-heading merchant-dashboard-heading">
          <div>
            <p className="eyebrow">商家工作台</p>
            <h1>请求日志</h1>
            <small>展示平台真实请求记录、客户账号、令牌预览、上游状态和耗时。</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadLogs(pagination.page, filters)} title="刷新请求日志" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="请求总数" value={formatNumber(summary.total)} detail="当前筛选范围" />
          <MetricPanel label="成功请求" value={formatNumber(summary.successCount)} detail="状态码小于 400 且无错误码" tone="green" />
          <MetricPanel label="异常请求" value={formatNumber(summary.errorCount)} detail="包含错误码或 4xx/5xx" tone="red" />
          <MetricPanel label="本页记录" value={formatNumber(rows.length)} detail={`第 ${pagination.page} / ${pagination.totalPages} 页`} />
        </section>

        <section className="admin-panel">
          <div className="panel-title">
            <FilterOutlined />
            <h2>筛选</h2>
          </div>
          <form className="log-filter-form" onSubmit={handleSubmit}>
            <label>
              状态
              <select onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as AdminRequestLogStatusFilter }))} value={filters.status}>
                <option value="all">全部状态</option>
                <option value="success">成功</option>
                <option value="error">异常</option>
              </select>
            </label>
            <label>
              模型
              <input maxLength={120} onChange={(event) => setFilters((current) => ({ ...current, model: event.target.value }))} placeholder="输入模型名精确筛选" value={filters.model} />
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

        <section className="admin-panel">
          <div className="panel-title">
            <FileTextOutlined />
            <h2>请求明细</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table merchant-request-log-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>客户</th>
                  <th>状态</th>
                  <th>模型</th>
                  <th>上游</th>
                  <th>耗时</th>
                  <th>请求编号</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.createdAt)}</td>
                    <td>
                      <strong>{entry.user?.username ?? '未知客户'}</strong>
                      <span className="table-note">{entry.token ? `${entry.token.name} (${entry.token.keyPreview})` : '无令牌记录'}</span>
                    </td>
                    <td>{renderRequestStatus(entry)}</td>
                    <td>{entry.model ?? '-'}</td>
                    <td>
                      {entry.upstreamProvider?.name ?? '-'}
                      <span className="table-note">{entry.upstreamStatus ?? '-'}</span>
                    </td>
                    <td>
                      {formatLatency(entry.latencyMs)}
                      <span className="table-note">上游 {formatLatency(entry.upstreamLatencyMs)}</span>
                    </td>
                    <td className="request-id-cell">{entry.requestId}</td>
                  </tr>
                ))}
                {!rows.length && !isLoading ? (
                  <tr>
                    <td colSpan={7}>暂无真实请求记录</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <PaginationControls isLoading={isLoading} onChange={(page) => void loadLogs(page, filters)} pagination={pagination} />
        </section>
      </section>
    </MerchantShell>
  );
}

function MetricPanel({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'green' | 'red';
}) {
  return (
    <section className="metric-panel">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : undefined}>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}

function PaginationControls({
  pagination,
  isLoading,
  onChange
}: {
  pagination: PaginationState;
  isLoading: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <div className="table-pagination">
      <span>
        第 {pagination.page} / {pagination.totalPages} 页，共 {pagination.total} 条记录
      </span>
      <div className="pagination-actions">
        <button className="ghost-button compact-button" disabled={isLoading || pagination.page <= 1} onClick={() => onChange(pagination.page - 1)} type="button">
          <LeftOutlined />
          上一页
        </button>
        <button
          className="ghost-button compact-button"
          disabled={isLoading || pagination.page >= pagination.totalPages || pagination.total === 0}
          onClick={() => onChange(pagination.page + 1)}
          type="button"
        >
          下一页
          <RightOutlined />
        </button>
      </div>
    </div>
  );
}

function createPagination(): PaginationState {
  return {
    page: 1,
    limit: REQUEST_LOG_LIMIT,
    total: 0,
    totalPages: 1
  };
}

function renderRequestStatus(entry: AdminRequestLog) {
  if (entry.errorCode || (entry.statusCode ?? 0) >= 400) {
    return <span className="status-pill status-pill-danger">{entry.errorCode ?? entry.statusCode ?? '异常'}</span>;
  }

  return <span className="status-pill status-pill-success">{entry.statusCode ?? '成功'}</span>;
}

function formatLatency(value: number | null) {
  return value === null ? '-' : `${value} ms`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-';
  }

  return new Intl.NumberFormat('zh-CN').format(value);
}
