'use client';

import {
  DownloadOutlined,
  FileTextOutlined,
  FilterOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { ConsoleShell } from '../components/console-shell';
import { formatBillingUsd, formatBillingUsdNumber } from '../lib/billing-format';
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

type UsageLogDisplayRow = {
  id: string;
  primary: UsageLogEntry;
  entries: UsageLogEntry[];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costCents: number;
};

const DISPLAY_MERGE_WINDOW_MS = 10_000;

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
  const displayRows = useMemo(() => groupUsageLogRows(rows), [rows]);
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
    const csv = toCsv(displayRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `usage-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <ConsoleShell activePath="/log" isRefreshing={isLoading} onRefresh={() => void loadLogs(filters)}>
      <section className="console-content-grid">
        <section className="account-panel account-summary">
          <div>
            <p className="eyebrow">调用日志</p>
            <h1>{isLoading ? '加载中' : `${displayRows.length} 组 / ${summary?.total ?? 0} 条记录`}</h1>
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
          <span>筛选范围扣除</span>
          <strong>{formatBillingUsd(summary?.totalCostCents ?? 0)}</strong>
          <small>成功扣费 {billableCount} 次</small>
        </div>
        <div className="metric-panel">
          <span>上游 token</span>
          <strong>{formatTokenCount(summary?.totalTokens ?? 0)}</strong>
          <small>
            输入 {formatTokenCount(summary?.promptTokens ?? 0)} / 输出 {formatTokenCount(summary?.completionTokens ?? 0)}
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
              <button className="ghost-button" disabled={!displayRows.length} onClick={exportCurrentRows} type="button">
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
          <p className="table-note">
            这里按上游真实返回记录：总量=输入+输出，模型价格按美元展示，实际扣余额会按汇率折算成人民币。Claude Code 会把会话历史和工具说明一起发给上游，所以屏幕上只看到一句话，也可能产生较高输入 token。
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table log-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>状态</th>
                  <th>模型</th>
                  <th>令牌</th>
                  <th>上游 token</th>
                  <th>扣费</th>
                  <th>request_id</th>
                  <th>usage_event</th>
                  <th>wallet_transaction</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => {
                  const entry = row.primary;
                  return (
                    <tr key={row.id}>
                      <td>
                        {formatDisplayRowTime(row)}
                        {row.entries.length > 1 ? <span className="table-note">10 秒内合并 {row.entries.length} 次</span> : null}
                      </td>
                      <td>{renderStatus(entry)}</td>
                      <td>{entry.model}</td>
                      <td>
                        <strong>{entry.token.name}</strong>
                        <span className="table-note">{entry.token.keyPreview}</span>
                      </td>
                      <td>
                        <strong>{formatTokenCount(row.totalTokens)}</strong>
                        <span className="table-note">
                          输入 {formatTokenCount(row.promptTokens)} / 输出 {formatTokenCount(row.completionTokens)}
                        </span>
                      </td>
                      <td>
                        <strong>{formatBillingUsd(row.costCents)}</strong>
                        <span className="table-note">{row.entries.length > 1 ? '合并扣费合计' : '按价格扣费'}</span>
                      </td>
                      <td className="request-id-cell">{renderMergedIds(row.entries.map((item) => item.requestId))}</td>
                      <td className="request-id-cell">{renderMergedIds(row.entries.map((item) => item.id))}</td>
                      <td className="request-id-cell">{renderMergedIds(row.entries.map((item) => item.walletTransaction?.id ?? '-'))}</td>
                    </tr>
                  );
                })}
                {!displayRows.length && !isLoading ? (
                  <tr>
                    <td colSpan={9}>暂无调用日志</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </ConsoleShell>
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

function groupUsageLogRows(rows: UsageLogEntry[]): UsageLogDisplayRow[] {
  const ascendingRows = [...rows].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const groups: UsageLogEntry[][] = [];

  for (const row of ascendingRows) {
    const lastGroup = groups.at(-1);
    const first = lastGroup?.[0];

    if (first && shouldMergeDisplayRows(first, row)) {
      lastGroup!.push(row);
      continue;
    }

    groups.push([row]);
  }

  return groups
    .map((entries) => {
      const newest = entries.reduce((selected, entry) =>
        new Date(entry.createdAt).getTime() > new Date(selected.createdAt).getTime() ? entry : selected
      );

      return {
        id: entries.map((entry) => entry.id).join(':'),
        primary: newest,
        entries: [...entries].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
        promptTokens: sumBy(entries, (entry) => entry.promptTokens),
        completionTokens: sumBy(entries, (entry) => entry.completionTokens),
        totalTokens: sumBy(entries, (entry) => entry.totalTokens),
        costCents: sumBy(entries, (entry) => entry.costCents)
      };
    })
    .sort((left, right) => new Date(right.primary.createdAt).getTime() - new Date(left.primary.createdAt).getTime());
}

function shouldMergeDisplayRows(base: UsageLogEntry, current: UsageLogEntry) {
  const baseAt = new Date(base.createdAt).getTime();
  const currentAt = new Date(current.createdAt).getTime();

  return (
    currentAt - baseAt <= DISPLAY_MERGE_WINDOW_MS &&
    base.model === current.model &&
    base.token.id === current.token.id &&
    base.status === current.status &&
    base.errorCode === current.errorCode
  );
}

function sumBy(entries: UsageLogEntry[], selector: (entry: UsageLogEntry) => number) {
  return entries.reduce((total, entry) => total + selector(entry), 0);
}

function formatDisplayRowTime(row: UsageLogDisplayRow) {
  if (row.entries.length === 1) {
    return new Date(row.primary.createdAt).toLocaleString();
  }

  const sorted = [...row.entries].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  return `${new Date(first.createdAt).toLocaleString()} - ${new Date(last.createdAt).toLocaleTimeString()}`;
}

function renderMergedIds(ids: string[]) {
  const [first, ...rest] = ids;
  if (!first) {
    return '-';
  }

  if (rest.length === 0) {
    return first;
  }

  return (
    <>
      {first}
      <span className="table-note">另 {rest.length} 条，导出含全部</span>
    </>
  );
}

function toIsoDateTime(value: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toCsv(rows: UsageLogDisplayRow[]) {
  const header = [
    'createdAtRange',
    'mergedCount',
    'status',
    'model',
    'token',
    'promptTokens',
    'completionTokens',
    'totalTokens',
    'costUsd',
    'requestId',
    'usageEventId',
    'walletTransactionId'
  ];
  const body = rows.map((row) => [
    formatDisplayRowTime(row),
    String(row.entries.length),
    row.primary.status,
    row.primary.model,
    row.primary.token.name,
    String(row.promptTokens),
    String(row.completionTokens),
    String(row.totalTokens),
    formatBillingUsdNumber(row.costCents),
    row.entries.map((entry) => entry.requestId).join(';'),
    row.entries.map((entry) => entry.id).join(';'),
    row.entries.map((entry) => entry.walletTransaction?.id ?? '').join(';')
  ]);

  return [header, ...body].map((row) => row.map(csvCell).join(',')).join('\n');
}

function formatTokenCount(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
