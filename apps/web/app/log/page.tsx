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
import { useI18n } from '../components/language-provider';
import { isAuthenticationApiError } from '../lib/api-error-copy';
import { formatBillingUsd, formatBillingUsdNumber } from '../lib/billing-format';
import { applyCopyOverrides, type CopyOverrides } from '../lib/copy-overrides';
import type { LanguageCode } from '../lib/i18n';
import { pageTerm } from '../lib/page-copy-terms';
import {
  listTokenLeaderboard,
  listUsageLogs,
  type TokenLeaderboardResponse,
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

type LogCopy = {
  activeFilterNames: {
    from: string;
    model: string;
    status: string;
    to: string;
    token: string;
  };
  allModels: string;
  allStatuses: string;
  allTokens: string;
  apply: string;
  billable: string;
  billableCount: (count: number) => string;
  calls: string;
  chargedRange: string;
  cost: string;
  costByPrice: string;
  currentUser: string;
  currentFilters: (count: number) => string;
  details: string;
  empty: string;
  exportCurrent: string;
  failed: string;
  failedCalls: string;
  filter: string;
  free: string;
  inputOutput: (input: string, output: string) => string;
  loadFailed: string;
  loading: string;
  leaderboard: string;
  mergedBilling: string;
  mergedRows: (count: number) => string;
  model: string;
  noLeaderboardData: string;
  noCharge: string;
  note: string;
  refresh: string;
  reset: string;
  rowCount: (groups: number, total: number) => string;
  status: string;
  table: {
    cost: string;
    model: string;
    status: string;
    time: string;
    token: string;
    upstreamTokens: string;
  };
  timeFrom: string;
  timeTo: string;
  title: string;
  token: string;
  totalTokens: string;
  rank: string;
  unknownMetering: string;
  user: string;
  visibleRows: string;
};

const LOG_COPY = {
  'zh-CN': {
    activeFilterNames: { from: '起始时间', model: '模型', status: '状态', to: '结束时间', token: '令牌' },
    allModels: '全部模型',
    allStatuses: '全部状态',
    allTokens: '全部令牌',
    apply: '应用',
    billable: '成功扣费',
    billableCount: (count) => `成功扣费 ${count} 次`,
    chargedRange: '筛选范围扣除',
    costByPrice: '按价格扣费',
    currentFilters: (count) => `当前筛选 ${count} 个条件`,
    details: '调用明细',
    empty: '暂无调用日志',
    exportCurrent: '导出当前结果',
    failed: '失败',
    failedCalls: '失败调用',
    filter: '筛选',
    free: '免费',
    inputOutput: (input, output) => `输入 ${input} / 输出 ${output}`,
    loadFailed: '调用日志加载失败',
    loading: '加载中',
    mergedBilling: '合并扣费合计',
    mergedRows: (count) => `10 秒内合并 ${count} 次`,
    model: '模型',
    noCharge: '免费调用',
    note:
      '这里按上游真实返回记录：总量=输入+输出，模型价格按美元展示，实际扣余额会按汇率折算成人民币。Claude Code 会把会话历史和工具说明一起发给上游，所以屏幕上只看到一句话，也可能产生较高输入 token。',
    refresh: '刷新日志',
    reset: '重置',
    rowCount: (groups, total) => `${groups} 组 / ${total} 条记录`,
    status: '状态',
    table: { cost: '扣费', model: '模型', status: '状态', time: '时间', token: '令牌', upstreamTokens: '上游 token' },
    timeFrom: '起始时间',
    timeTo: '结束时间',
    title: '调用日志',
    token: '令牌',
    totalTokens: '上游 token',
    unknownMetering: '计量未知',
    visibleRows: '条数'
  },
  'zh-TW': {
    activeFilterNames: { from: '起始時間', model: '模型', status: '狀態', to: '結束時間', token: '權杖' },
    allModels: '全部模型',
    allStatuses: '全部狀態',
    allTokens: '全部權杖',
    apply: '套用',
    billable: '成功扣費',
    billableCount: (count) => `成功扣費 ${count} 次`,
    chargedRange: '篩選範圍扣除',
    costByPrice: '按價格扣費',
    currentFilters: (count) => `目前篩選 ${count} 個條件`,
    details: '呼叫明細',
    empty: '暫無呼叫日誌',
    exportCurrent: '匯出目前結果',
    failed: '失敗',
    failedCalls: '失敗呼叫',
    filter: '篩選',
    free: '免費',
    inputOutput: (input, output) => `輸入 ${input} / 輸出 ${output}`,
    loadFailed: '呼叫日誌載入失敗',
    loading: '載入中',
    mergedBilling: '合併扣費合計',
    mergedRows: (count) => `10 秒內合併 ${count} 次`,
    model: '模型',
    noCharge: '免費呼叫',
    note:
      '這裡按上游真實返回記錄：總量=輸入+輸出，模型價格按美元顯示，實際扣餘額會按匯率折算成人民幣。Claude Code 會把會話歷史和工具說明一起發給上游，所以畫面上只看到一句話，也可能產生較高輸入 token。',
    refresh: '重新整理日誌',
    reset: '重設',
    rowCount: (groups, total) => `${groups} 組 / ${total} 筆記錄`,
    status: '狀態',
    table: { cost: '扣費', model: '模型', status: '狀態', time: '時間', token: '權杖', upstreamTokens: '上游 token' },
    timeFrom: '起始時間',
    timeTo: '結束時間',
    title: '呼叫日誌',
    token: '權杖',
    totalTokens: '上游 token',
    unknownMetering: '計量未知',
    visibleRows: '筆數'
  },
  'en-US': {
    activeFilterNames: { from: 'Start time', model: 'Model', status: 'Status', to: 'End time', token: 'Token' },
    allModels: 'All models',
    allStatuses: 'All statuses',
    allTokens: 'All tokens',
    apply: 'Apply',
    billable: 'Charged',
    billableCount: (count) => `${count} charged calls`,
    chargedRange: 'Filtered charges',
    costByPrice: 'Charged by price',
    currentFilters: (count) => `${count} active filters`,
    details: 'Usage details',
    empty: 'No usage logs',
    exportCurrent: 'Export current results',
    failed: 'Failed',
    failedCalls: 'Failed calls',
    filter: 'Filters',
    free: 'Free',
    inputOutput: (input, output) => `Input ${input} / Output ${output}`,
    loadFailed: 'Failed to load usage logs',
    loading: 'Loading',
    mergedBilling: 'Merged charge total',
    mergedRows: (count) => `${count} calls merged within 10 seconds`,
    model: 'Model',
    noCharge: 'Free call',
    note:
      'This table uses the upstream record: total tokens = input + output. Model prices are shown in USD, while actual balance deductions are converted to CNY by the current exchange rate. Claude Code can send chat history and tool instructions upstream, so a short visible message can still create many input tokens.',
    refresh: 'Refresh logs',
    reset: 'Reset',
    rowCount: (groups, total) => `${groups} groups / ${total} records`,
    status: 'Status',
    table: { cost: 'Charge', model: 'Model', status: 'Status', time: 'Time', token: 'Token', upstreamTokens: 'Upstream tokens' },
    timeFrom: 'Start time',
    timeTo: 'End time',
    title: 'Usage logs',
    token: 'Token',
    totalTokens: 'Upstream tokens',
    unknownMetering: 'Metering unknown',
    visibleRows: 'Rows'
  }
} satisfies Record<'zh-CN' | 'zh-TW' | 'en-US', LogBaseCopy>;

type LogBaseCopy = Omit<
  LogCopy,
  'calls' | 'cost' | 'currentUser' | 'leaderboard' | 'noLeaderboardData' | 'rank' | 'user'
>;

function getLogCopy(language: LanguageCode) {
  const base = language === 'zh-CN' || language === 'zh-TW' || language === 'en-US' ? LOG_COPY[language] : LOG_COPY['en-US'];

  return applyCopyOverrides(base, getLogCopyOverrides(language), getLeaderboardCopyOverrides(language)) as LogCopy;
}

function getLeaderboardCopyOverrides(language: LanguageCode): CopyOverrides<LogCopy> {
  return {
    calls: pageTerm(language, 'calls'),
    cost: pageTerm(language, 'cost'),
    currentUser: pageTerm(language, 'currentUser'),
    leaderboard: pageTerm(language, 'leaderboard'),
    noLeaderboardData: pageTerm(language, 'emptyRecords'),
    rank: pageTerm(language, 'rank'),
    user: pageTerm(language, 'user')
  };
}

function getLogCopyOverrides(language: LanguageCode): CopyOverrides<LogCopy> {
  return {
    activeFilterNames: {
      from: pageTerm(language, 'timeRange'),
      model: pageTerm(language, 'model'),
      status: pageTerm(language, 'status'),
      to: pageTerm(language, 'time'),
      token: pageTerm(language, 'token')
    },
    allModels: pageTerm(language, 'allModels'),
    allStatuses: pageTerm(language, 'allStatuses'),
    allTokens: pageTerm(language, 'allTokens'),
    apply: pageTerm(language, 'apply'),
    billable: pageTerm(language, 'charged'),
    billableCount: (count) => `${count} ${pageTerm(language, 'charged')}`,
    chargedRange: pageTerm(language, 'filteredCharges'),
    costByPrice: pageTerm(language, 'billing'),
    currentFilters: (count) => `${count} ${pageTerm(language, 'filters')}`,
    details: pageTerm(language, 'usageDetails'),
    empty: pageTerm(language, 'emptyLogs'),
    exportCurrent: `${pageTerm(language, 'export')} ${pageTerm(language, 'records')}`,
    failed: pageTerm(language, 'failed'),
    failedCalls: pageTerm(language, 'failedCalls'),
    filter: pageTerm(language, 'filters'),
    free: pageTerm(language, 'free'),
    inputOutput: (input, output) => `${pageTerm(language, 'input')} ${input} / ${pageTerm(language, 'output')} ${output}`,
    loadFailed: `${pageTerm(language, 'loading')} ${pageTerm(language, 'failed')}`,
    loading: pageTerm(language, 'loading'),
    mergedBilling: pageTerm(language, 'mergedChargeTotal'),
    mergedRows: (count) => `${count} ${pageTerm(language, 'records')}`,
    model: pageTerm(language, 'model'),
    noCharge: pageTerm(language, 'free'),
    refresh: pageTerm(language, 'refresh'),
    reset: pageTerm(language, 'reset'),
    rowCount: (groups, total) => `${groups} / ${total} ${pageTerm(language, 'records')}`,
    status: pageTerm(language, 'status'),
    table: {
      cost: pageTerm(language, 'charged'),
      model: pageTerm(language, 'model'),
      status: pageTerm(language, 'status'),
      time: pageTerm(language, 'time'),
      token: pageTerm(language, 'token'),
      upstreamTokens: pageTerm(language, 'upstreamTokens')
    },
    timeFrom: pageTerm(language, 'timeRange'),
    timeTo: pageTerm(language, 'time'),
    title: pageTerm(language, 'usageLogs'),
    token: pageTerm(language, 'token'),
    totalTokens: pageTerm(language, 'totalTokens'),
    unknownMetering: pageTerm(language, 'unknownMetering'),
    visibleRows: pageTerm(language, 'visibleRows')
  };
}

export default function UsageLogPage() {
  const router = useRouter();
  const { language } = useI18n();
  const copy = getLogCopy(language);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [data, setData] = useState<UsageLogsResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<TokenLeaderboardResponse | null>(null);
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
        filters.from ? copy.activeFilterNames.from : '',
        filters.to ? copy.activeFilterNames.to : '',
        filters.model ? copy.activeFilterNames.model : '',
        filters.tokenId ? copy.activeFilterNames.token : '',
        filters.status ? copy.activeFilterNames.status : ''
      ].filter(Boolean).length,
    [copy, filters]
  );

  async function loadLogs(nextFilters: FilterState) {
    setIsLoading(true);
    setError('');

    try {
      const [result, leaderboardResult] = await Promise.all([
        listUsageLogs({
          from: toIsoDateTime(nextFilters.from),
          to: toIsoDateTime(nextFilters.to),
          model: nextFilters.model || undefined,
          tokenId: nextFilters.tokenId || undefined,
          status: nextFilters.status || undefined,
          limit: Number(nextFilters.limit) || 50
        }, language),
        listTokenLeaderboard({ period: '7d', limit: 10 }, language).catch(() => null)
      ]);
      setData(result);
      setLeaderboard(leaderboardResult);
    } catch (nextError) {
      setError(copy.loadFailed);
      if (isAuthenticationApiError(nextError)) {
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
    const csv = toCsv(displayRows, language, copy);
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
            <p className="eyebrow">{copy.title}</p>
            <h1>{isLoading ? copy.loading : copy.rowCount(displayRows.length, summary?.total ?? 0)}</h1>
          </div>
          <button
            className="icon-button"
            disabled={isLoading}
            onClick={() => void loadLogs(filters)}
            title={copy.refresh}
            type="button"
          >
            <ReloadOutlined />
          </button>
        </section>

        <div className="metric-panel">
          <span>{copy.chargedRange}</span>
          <strong>{formatBillingUsd(summary?.totalCostCents ?? 0)}</strong>
          <small>{copy.billableCount(billableCount)}</small>
        </div>
        <div className="metric-panel">
          <span>{copy.totalTokens}</span>
          <strong>{formatTokenCount(summary?.totalTokens ?? 0, language)}</strong>
          <small>
            {copy.inputOutput(formatTokenCount(summary?.promptTokens ?? 0, language), formatTokenCount(summary?.completionTokens ?? 0, language))}
          </small>
        </div>
        <div className="metric-panel">
          <span>{copy.failedCalls}</span>
          <strong>{failedCount}</strong>
          <small>{copy.currentFilters(activeFilters)}</small>
        </div>

        {error ? <p className="form-error wide-panel">{error}</p> : null}

        <section className="account-panel wide-panel" data-qa="user-token-leaderboard">
          <div className="panel-title">
            <FileTextOutlined />
            <h2>{copy.leaderboard}</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{copy.rank}</th>
                  <th>{copy.user}</th>
                  <th>{copy.totalTokens}</th>
                  <th>{copy.calls}</th>
                  <th>{copy.cost}</th>
                </tr>
              </thead>
              <tbody>
                {(leaderboard?.items ?? []).map((entry) => (
                  <tr
                    data-current-user={entry.isCurrentUser ? 'true' : 'false'}
                    data-qa="user-token-leaderboard-row"
                    data-total-tokens={entry.totalTokens}
                    data-username={entry.username}
                    key={`${entry.rank}-${entry.username}`}
                  >
                    <td>#{entry.rank}</td>
                    <td>
                      <strong>{entry.username}</strong>
                      {entry.isCurrentUser ? <small className="table-note">{copy.currentUser}</small> : null}
                    </td>
                    <td>{formatTokenCount(entry.totalTokens, language)}</td>
                    <td>{entry.requestCount}</td>
                    <td>{formatBillingUsd(entry.totalCostCents)}</td>
                  </tr>
                ))}
                {!leaderboard?.items.length ? (
                  <tr>
                    <td colSpan={5}>{copy.noLeaderboardData}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <FilterOutlined />
            <h2>{copy.filter}</h2>
          </div>
          <form className="log-filter-form" onSubmit={handleSubmit}>
            <label>
              {copy.timeFrom}
              <input
                onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
                type="datetime-local"
                value={filters.from}
              />
            </label>
            <label>
              {copy.timeTo}
              <input
                onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
                type="datetime-local"
                value={filters.to}
              />
            </label>
            <label>
              {copy.model}
              <select onChange={(event) => setFilters((current) => ({ ...current, model: event.target.value }))} value={filters.model}>
                <option value="">{copy.allModels}</option>
                {(data?.filters.models ?? []).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.token}
              <select
                onChange={(event) => setFilters((current) => ({ ...current, tokenId: event.target.value }))}
                value={filters.tokenId}
              >
                <option value="">{copy.allTokens}</option>
                {(data?.filters.tokens ?? []).map((token) => (
                  <option key={token.id} value={token.id}>
                    {token.name} ({token.keyPreview})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.status}
              <select
                onChange={(event) =>
                  setFilters((current) => ({ ...current, status: event.target.value as UsageLogStatus | '' }))
                }
                value={filters.status}
              >
                <option value="">{copy.allStatuses}</option>
                <option value="billable">{copy.billable}</option>
                <option value="free">{copy.noCharge}</option>
                <option value="failed">{copy.failedCalls}</option>
                <option value="metering_unknown">{copy.unknownMetering}</option>
              </select>
            </label>
            <label>
              {copy.visibleRows}
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
                {copy.apply}
              </button>
              <button className="ghost-button" disabled={isLoading} onClick={resetFilters} type="button">
                {copy.reset}
              </button>
              <button className="ghost-button" disabled={!displayRows.length} onClick={exportCurrentRows} type="button">
                <DownloadOutlined />
                {copy.exportCurrent}
              </button>
            </div>
          </form>
        </section>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <FileTextOutlined />
            <h2>{copy.details}</h2>
          </div>
          <p className="table-note">
            {copy.note}
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table log-table">
              <thead>
                <tr>
                  <th>{copy.table.time}</th>
                  <th>{copy.table.status}</th>
                  <th>{copy.table.model}</th>
                  <th>{copy.table.token}</th>
                  <th>{copy.table.upstreamTokens}</th>
                  <th>{copy.table.cost}</th>
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
                        {formatDisplayRowTime(row, language)}
                        {row.entries.length > 1 ? <span className="table-note">{copy.mergedRows(row.entries.length)}</span> : null}
                      </td>
                      <td>{renderStatus(entry, copy)}</td>
                      <td>{entry.model}</td>
                      <td>
                        <strong>{entry.token.name}</strong>
                        <span className="table-note">{entry.token.keyPreview}</span>
                      </td>
                      <td>
                        <strong>{formatTokenCount(row.totalTokens, language)}</strong>
                        <span className="table-note">
                          {copy.inputOutput(formatTokenCount(row.promptTokens, language), formatTokenCount(row.completionTokens, language))}
                        </span>
                      </td>
                      <td>
                        <strong>{formatBillingUsd(row.costCents)}</strong>
                        <span className="table-note">{row.entries.length > 1 ? copy.mergedBilling : copy.costByPrice}</span>
                      </td>
                      <td className="request-id-cell">{renderMergedIds(row.entries.map((item) => item.requestId), copy)}</td>
                      <td className="request-id-cell">{renderMergedIds(row.entries.map((item) => item.id), copy)}</td>
                      <td className="request-id-cell">{renderMergedIds(row.entries.map((item) => item.walletTransaction?.id ?? '-'), copy)}</td>
                    </tr>
                  );
                })}
                {!displayRows.length && !isLoading ? (
                  <tr>
                    <td colSpan={9}>{copy.empty}</td>
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

function renderStatus(entry: UsageLogEntry, copy: LogCopy) {
  if (entry.status === 'billable') {
    return <span className="status-pill status-pill-success">{copy.billable}</span>;
  }

  if (entry.status === 'failed') {
    return <span className="status-pill status-pill-danger">{entry.errorCode ?? copy.failed}</span>;
  }

  if (entry.status === 'metering_unknown') {
    return <span className="status-pill status-pill-warning">{copy.unknownMetering}</span>;
  }

  return <span className="status-pill status-pill-muted">{copy.free}</span>;
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

function formatDisplayRowTime(row: UsageLogDisplayRow, language: LanguageCode) {
  if (row.entries.length === 1) {
    return new Date(row.primary.createdAt).toLocaleString(language);
  }

  const sorted = [...row.entries].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  return `${new Date(first.createdAt).toLocaleString(language)} - ${new Date(last.createdAt).toLocaleTimeString(language)}`;
}

function renderMergedIds(ids: string[], copy: LogCopy) {
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
      <span className="table-note">{copy.mergedRows(rest.length + 1)}</span>
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

function toCsv(rows: UsageLogDisplayRow[], language: LanguageCode, copy: LogCopy) {
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
    formatDisplayRowTime(row, language),
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

function formatTokenCount(value: number, language: LanguageCode) {
  return new Intl.NumberFormat(language).format(value);
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
