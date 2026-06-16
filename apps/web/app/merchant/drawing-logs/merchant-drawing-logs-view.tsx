'use client';

import { FilterOutlined, LeftOutlined, PictureOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { MerchantShell } from '../../components/merchant-shell';
import {
  listAdminImageTasks,
  type AdminImageTask,
  type AdminImageTaskStatus
} from '../../lib/admin-api';
import { logout } from '../../lib/auth-api';

const DRAWING_LOG_LIMIT = 20;

type PaginationState = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type FilterState = {
  status: AdminImageTaskStatus | '';
  platform: string;
  model: string;
};

const DEFAULT_FILTERS: FilterState = {
  status: '',
  platform: '',
  model: ''
};

export function MerchantDrawingLogsView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<AdminImageTask[]>([]);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [filterOptions, setFilterOptions] = useState({ platforms: [] as string[], models: [] as string[], statuses: [] as AdminImageTaskStatus[] });
  const [summary, setSummary] = useState({
    total: 0,
    statusCounts: { queued: 0, running: 0, succeeded: 0, failed: 0, canceled: 0 } as Record<AdminImageTaskStatus, number>
  });
  const [capabilities, setCapabilities] = useState({ imageSubmissionSupported: false, statusSyncSupported: false });
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
      const result = await listAdminImageTasks({
        page,
        limit: DRAWING_LOG_LIMIT,
        status: nextFilters.status || undefined,
        platform: nextFilters.platform || undefined,
        model: nextFilters.model || undefined
      });
      setRows(result.items);
      setSummary(result.summary);
      setFilterOptions(result.filters);
      setCapabilities(result.capabilities);
      setPagination({
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / result.limit))
      });
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '绘图记录加载失败';
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
      activePath="/merchant/drawing-logs"
      isRefreshing={isLoading}
      onLogout={handleLogout}
      onRefresh={() => void loadLogs(pagination.page, filters)}
      role={role}
      username={username}
    >
      <section className="admin-content merchant-drawing-logs-page" data-page="merchant-drawing-logs">
        <div className="admin-heading merchant-dashboard-heading">
          <div>
            <p className="eyebrow">商家工作台</p>
            <h1>绘图日志</h1>
            <small>仅展示图片类真实记录；通用异步任务不会出现在这里。</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadLogs(pagination.page, filters)} title="刷新绘图日志" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {!capabilities.imageSubmissionSupported ? <p className="table-note">当前未接入真实绘图提交入口，本页只展示已记录的真实绘图结果。</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="绘图记录" value={formatNumber(summary.total)} detail="仅图片类记录" />
          <MetricPanel label="运行中" value={formatNumber(summary.statusCounts.running)} detail={`排队 ${summary.statusCounts.queued}`} />
          <MetricPanel label="已完成" value={formatNumber(summary.statusCounts.succeeded)} detail={`失败 ${summary.statusCounts.failed}`} tone="green" />
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
              <select onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as AdminImageTaskStatus | '' }))} value={filters.status}>
                <option value="">全部状态</option>
                {filterOptions.statuses.map((status) => (
                  <option key={status} value={status}>
                    {formatStatus(status)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              平台
              <select onChange={(event) => setFilters((current) => ({ ...current, platform: event.target.value }))} value={filters.platform}>
                <option value="">全部平台</option>
                {filterOptions.platforms.map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模型
              <select onChange={(event) => setFilters((current) => ({ ...current, model: event.target.value }))} value={filters.model}>
                <option value="">全部模型</option>
                {filterOptions.models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
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

        <section className="admin-panel">
          <div className="panel-title">
            <PictureOutlined />
            <h2>绘图明细</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table merchant-drawing-log-table">
              <thead>
                <tr>
                  <th>记录</th>
                  <th>客户</th>
                  <th>平台</th>
                  <th>状态</th>
                  <th>模型</th>
                  <th>进度</th>
                  <th>结果 / 失败原因</th>
                  <th>提交时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.externalTaskId}</strong>
                      <span className="table-note">{entry.prompt || '-'}</span>
                    </td>
                    <td>{entry.user.username}</td>
                    <td>
                      {entry.platform}
                      <span className="table-note">{entry.upstreamProvider?.name ?? '未绑定上游'}</span>
                    </td>
                    <td>{renderStatus(entry.status)}</td>
                    <td>{entry.model ?? '-'}</td>
                    <td>{formatProgress(entry.progress)}</td>
                    <td>{formatTaskOutcome(entry)}</td>
                    <td>{formatDate(entry.submittedAt)}</td>
                  </tr>
                ))}
                {!rows.length && !isLoading ? (
                  <tr>
                    <td colSpan={8}>暂无真实绘图记录</td>
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
    limit: DRAWING_LOG_LIMIT,
    total: 0,
    totalPages: 1
  };
}

function renderStatus(status: AdminImageTaskStatus) {
  if (status === 'succeeded') {
    return <span className="status-pill status-pill-success">成功</span>;
  }
  if (status === 'failed') {
    return <span className="status-pill status-pill-danger">失败</span>;
  }
  if (status === 'running') {
    return <span className="status-pill status-pill-warning">运行中</span>;
  }
  if (status === 'canceled') {
    return <span className="status-pill status-pill-muted">已取消</span>;
  }

  return <span className="status-pill status-pill-muted">排队中</span>;
}

function formatStatus(status: AdminImageTaskStatus) {
  const labels: Record<AdminImageTaskStatus, string> = {
    queued: '排队中',
    running: '运行中',
    succeeded: '成功',
    failed: '失败',
    canceled: '已取消'
  };

  return labels[status] ?? status;
}

function formatProgress(progress: number | null) {
  return typeof progress === 'number' ? `${progress}%` : '-';
}

function formatTaskOutcome(task: AdminImageTask) {
  if (task.errorMessage) {
    return task.errorMessage;
  }

  if (task.result === null || task.result === undefined) {
    return '-';
  }

  return JSON.stringify(task.result);
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
