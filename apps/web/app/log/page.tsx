'use client';

import {
  DownloadOutlined,
  FileTextOutlined,
  FilterOutlined,
  ReloadOutlined,
  WalletOutlined
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  listUsageLogs,
  type UsageLogEntry,
  type UsageLogsResponse,
  type UsageLogStatus
} from '../lib/usage-log-api';

type FilterState = {
  from: string;
  to: string;
  model: string;
  tokenId: string;
  status: UsageLogStatus | '';
  limit: string;
};

const DEFAULT_FILTERS: FilterState = {
  from: '',
  to: '',
  model: '',
  tokenId: '',
  status: '',
  limit: '50'
};

export default function UsageLogPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [data, setData] = useState<UsageLogsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadLogs(DEFAULT_FILTERS);
  }, []);

  const rows = data?.items ?? [];
  const summary = data?.summary;
  const failedCount = summary?.statusCounts.failed ?? 0;
  const billableCount = summary?.statusCounts.billable ?? 0;

  const activeFilters = useMemo(
    () =>
      [
        filters.from ? '起始时间' : '',
        filters.to ? '结束时间' : '',
        filters.model ? '模型' : '',
        filters.tokenId ? '令牌' : '',
        filters.status ? '状态' : ''
      ].filter(Boolean).length,
    [filters]
  );

  async function loadLogs(nextFilters: FilterState) {
    setIsLoading(true);
    setError('');

    try {
      const result = await listUsageLogs({
        from: toIsoDateTime(nextFilters.from),
        to: toIsoDateTime(nextFilters.to),
        model: nextFilters.model || undefined,
        tokenId: nextFilters.tokenId || undefined,
        status: nextFilters.status || undefined,
        limit: Number(nextFilters.limit) || 50
      });
      setData(result);
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '调用日志加载失败';
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
    void loadLogs(filters);
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    void loadLogs(DEFAULT_FILTERS);
  }

  function exportCurrentRows() {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `usage-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="account-page">
      <header className="topbar">
        <Link className="auth-brand compact" href="/">
          <span className="shell-logo-mark">R</span>
          <span>Relay Console</span>
        </Link>
        <nav className="admin-top-actions" aria-label="账户导航">
          <Link className="ghost-button" href="/account">
            <WalletOutlined />
            账户
          </Link>
          <button className="ghost-button" disabled={isLoading} onClick={() => void loadLogs(filters)} type="button">
            <ReloadOutlined />
            刷新
          </button>
        </nav>
      </header>

      <section className="account-grid">
        <section className="account-panel account-summary">
          <div>
            <p className="eyebrow">调用日志</p>
            <h1>{isLoading ? '加载中' : `${summary?.total ?? 0} 条记录`}</h1>
          </div>
          <button
            className="icon-button"
            disabled={isLoading}
            onClick={() => void loadLogs(filters)}
            title="刷新日志"
            type="button"
          >
            <ReloadOutlined />
          </button>
        </section>

        <div className="metric-panel">
          <span>筛选范围消费</span>
          <strong>{formatCents(summary?.totalCostCents ?? 0)}</strong>
          <small>成功扣费 {billableCount} 次</small>
        </div>
        <div className="metric-panel">
          <span>Token 用量</span>
          <strong>{summary?.totalTokens ?? 0}</strong>
          <small>
            输入 {summary?.promptTokens ?? 0} / 输出 {summary?.completionTokens ?? 0}
          </small>
        </div>
        <div className="metric-panel">
          <span>失败调用</span>
          <strong>{failedCount}</strong>
          <small>当前筛选 {activeFilters} 个条件</small>
        </div>

        {error ? <p className="form-error wide-panel">{error}</p> : null}

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <FilterOutlined />
            <h2>筛选</h2>
          </div>
          <form className="log-filter-form" onSubmit={handleSubmit}>
            <label>
              起始时间
              <input
                onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
                type="datetime-local"
                value={filters.from}
              />
            </label>
            <label>
              结束时间
              <input
                onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
                type="datetime-local"
                value={filters.to}
              />
            </label>
            <label>
              模型
              <select onChange={(event) => setFilters((current) => ({ ...current, model: event.target.value }))} value={filters.model}>
                <option value="">全部模型</option>
                {(data?.filters.models ?? []).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <label>
              令牌
              <select
                onChange={(event) => setFilters((current) => ({ ...current, tokenId: event.target.value }))}
                value={filters.tokenId}
              >
                <option value="">全部令牌</option>
                {(data?.filters.tokens ?? []).map((token) => (
                  <option key={token.id} value={token.id}>
                    {token.name} ({token.keyPreview})
                  </option>
                ))}
              </select>
            </label>
            <label>
              状态
              <select
                onChange={(event) =>
                  setFilters((current) => ({ ...current, status: event.target.value as UsageLogStatus | '' }))
                }
                value={filters.status}
              >
                <option value="">全部状态</option>
                <option value="billable">成功扣费</option>
                <option value="free">免费调用</option>
                <option value="failed">失败调用</option>
                <option value="metering_unknown">计量未知</option>
              </select>
            </label>
            <label>
              条数
              <input
                max={100}
                min={1}
                onChange={(event) => setFilters((current) => ({ ...current, limit: event.target.value }))}
                step={1}
                type="number"
                value={filters.limit}
              />
            </label>
            <div className="filter-actions">
              <button className="primary-button" disabled={isLoading} type="submit">
                <FilterOutlined />
                应用
              </button>
              <button className="ghost-button" disabled={isLoading} onClick={resetFilters} type="button">
                重置
              </button>
              <button className="ghost-button" disabled={!rows.length} onClick={exportCurrentRows} type="button">
                <DownloadOutlined />
                导出当前结果
              </button>
            </div>
          </form>
        </section>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <FileTextOutlined />
            <h2>调用明细</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table log-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>状态</th>
                  <th>模型</th>
                  <th>令牌</th>
                  <th>Token</th>
                  <th>消费</th>
                  <th>request_id</th>
                  <th>usage_event</th>
                  <th>wallet_transaction</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.createdAt).toLocaleString()}</td>
                    <td>{renderStatus(entry)}</td>
                    <td>{entry.model}</td>
                    <td>
                      <strong>{entry.token.name}</strong>
                      <span className="table-note">{entry.token.keyPreview}</span>
                    </td>
                    <td>{entry.totalTokens}</td>
                    <td>{formatCents(entry.costCents)}</td>
                    <td className="request-id-cell">{entry.requestId}</td>
                    <td className="request-id-cell">{entry.id}</td>
                    <td className="request-id-cell">{entry.walletTransaction?.id ?? '-'}</td>
                  </tr>
                ))}
                {!rows.length && !isLoading ? (
                  <tr>
                    <td colSpan={9}>暂无调用日志</td>
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

function renderStatus(entry: UsageLogEntry) {
  if (entry.status === 'billable') {
    return <span className="status-pill status-pill-success">成功扣费</span>;
  }

  if (entry.status === 'failed') {
    return <span className="status-pill status-pill-danger">{entry.errorCode ?? '失败'}</span>;
  }

  if (entry.status === 'metering_unknown') {
    return <span className="status-pill status-pill-warning">计量未知</span>;
  }

  return <span className="status-pill status-pill-muted">免费</span>;
}

function toIsoDateTime(value: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toCsv(rows: UsageLogEntry[]) {
  const header = ['createdAt', 'status', 'model', 'token', 'totalTokens', 'costCents', 'requestId', 'usageEventId', 'walletTransactionId'];
  const body = rows.map((row) => [
    row.createdAt,
    row.status,
    row.model,
    row.token.name,
    String(row.totalTokens),
    String(row.costCents),
    row.requestId,
    row.id,
    row.walletTransaction?.id ?? ''
  ]);

  return [header, ...body].map((row) => row.map(csvCell).join(',')).join('\n');
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function formatCents(value: number) {
  return `${(value / 100).toFixed(2)} 元`;
}
