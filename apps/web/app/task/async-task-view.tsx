'use client';

import {
  ClockCircleOutlined,
  FileSearchOutlined,
  FilterOutlined,
  HomeOutlined,
  PictureOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  listAsyncTasks,
  type AsyncTaskEntry,
  type AsyncTaskFilters,
  type AsyncTaskKind,
  type AsyncTasksResponse,
  type AsyncTaskStatus
} from '../lib/async-tasks-api';

type FilterState = {
  kind: AsyncTaskKind | '';
  status: AsyncTaskStatus | '';
  platform: string;
  model: string;
  limit: string;
};

const DEFAULT_FILTERS: FilterState = {
  kind: '',
  status: '',
  platform: '',
  model: '',
  limit: '50'
};

export function AsyncTaskView({
  defaultKind,
  title,
  subtitle
}: {
  defaultKind?: AsyncTaskKind;
  title: string;
  subtitle: string;
}) {
  const router = useRouter();
  const initialFilters = useMemo<FilterState>(() => ({ ...DEFAULT_FILTERS, kind: defaultKind ?? '' }), [defaultKind]);
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [data, setData] = useState<AsyncTasksResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadTasks(initialFilters);
  }, [initialFilters]);

  const rows = data?.items ?? [];
  const summary = data?.summary;
  const activeFilters = [filters.kind, filters.status, filters.platform, filters.model].filter(Boolean).length;

  async function loadTasks(nextFilters: FilterState) {
    setIsLoading(true);
    setError('');

    try {
      const requestFilters: AsyncTaskFilters = {
        kind: nextFilters.kind || undefined,
        status: nextFilters.status || undefined,
        platform: nextFilters.platform || undefined,
        model: nextFilters.model || undefined,
        limit: Number(nextFilters.limit) || 50
      };
      const result = await listAsyncTasks(requestFilters);
      setData(result);
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '异步任务加载失败';
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
    void loadTasks(filters);
  }

  function resetFilters() {
    const nextFilters: FilterState = { ...DEFAULT_FILTERS, kind: defaultKind ?? '' };
    setFilters(nextFilters);
    void loadTasks(nextFilters);
  }

  return (
    <main className="account-page">
      <header className="topbar">
        <Link className="auth-brand compact" href="/">
          <span className="shell-logo-mark">R</span>
          <span>Relay Console</span>
        </Link>
        <nav className="admin-top-actions" aria-label="账户导航">
          <Link className="ghost-button" href="/">
            <HomeOutlined />
            首页
          </Link>
          <button className="ghost-button" disabled={isLoading} onClick={() => void loadTasks(filters)} type="button">
            <ReloadOutlined />
            刷新
          </button>
        </nav>
      </header>

      <section className="account-grid">
        <section className="account-panel account-summary">
          <div>
            <p className="eyebrow">{defaultKind === 'image' ? '绘图日志' : '异步任务'}</p>
            <h1>{isLoading ? '加载中' : `${summary?.total ?? 0} 条记录`}</h1>
            <p className="page-subtitle">{subtitle}</p>
          </div>
          <button
            className="icon-button"
            disabled={isLoading}
            onClick={() => void loadTasks(filters)}
            title="刷新任务"
            type="button"
          >
            <ReloadOutlined />
          </button>
        </section>

        <div className="metric-panel">
          <span>运行中</span>
          <strong>{summary?.statusCounts.running ?? 0}</strong>
          <small>排队 {summary?.statusCounts.queued ?? 0}</small>
        </div>
        <div className="metric-panel">
          <span>已完成</span>
          <strong>{summary?.statusCounts.succeeded ?? 0}</strong>
          <small>失败 {summary?.statusCounts.failed ?? 0}</small>
        </div>
        <div className="metric-panel">
          <span>{defaultKind === 'image' ? '绘图任务' : '任务类型'}</span>
          <strong>{defaultKind === 'image' ? summary?.kindCounts.image ?? 0 : summary?.kindCounts.generic ?? 0}</strong>
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
              类型
              <select
                disabled={Boolean(defaultKind)}
                onChange={(event) => setFilters((current) => ({ ...current, kind: event.target.value as AsyncTaskKind | '' }))}
                value={filters.kind}
              >
                <option value="">全部类型</option>
                <option value="generic">通用任务</option>
                <option value="image">绘图任务</option>
              </select>
            </label>
            <label>
              状态
              <select
                onChange={(event) =>
                  setFilters((current) => ({ ...current, status: event.target.value as AsyncTaskStatus | '' }))
                }
                value={filters.status}
              >
                <option value="">全部状态</option>
                {(data?.filters.statuses ?? []).map((status) => (
                  <option key={status} value={status}>
                    {formatStatus(status)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              平台
              <select
                onChange={(event) => setFilters((current) => ({ ...current, platform: event.target.value }))}
                value={filters.platform}
              >
                <option value="">全部平台</option>
                {(data?.filters.platforms ?? []).map((platform) => (
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
                {(data?.filters.models ?? []).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <label>
              条数
              <input
                max={100}
                min={1}
                onChange={(event) => setFilters((current) => ({ ...current, limit: event.target.value }))}
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
            </div>
          </form>
        </section>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            {defaultKind === 'image' ? <PictureOutlined /> : <ClockCircleOutlined />}
            <h2>{title}</h2>
          </div>
          {!data?.capabilities.taskSubmissionSupported ? (
            <p className="table-note">当前仅展示已记录的真实任务；提交入口和状态同步等待真实上游能力接入。</p>
          ) : null}
          <div className="table-scroll">
            <table className="admin-table task-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>平台</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>模型</th>
                  <th>进度</th>
                  <th>结果 / 失败原因</th>
                  <th>提交时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <strong>{task.externalTaskId}</strong>
                      <small className="table-note">{task.prompt || '-'}</small>
                    </td>
                    <td>
                      {task.platform}
                      <small className="table-note">{task.upstreamProvider?.name ?? '未绑定上游'}</small>
                    </td>
                    <td>{formatKind(task.kind)}</td>
                    <td>{formatStatus(task.status)}</td>
                    <td>{task.model ?? '-'}</td>
                    <td>{formatProgress(task.progress)}</td>
                    <td>{formatTaskOutcome(task)}</td>
                    <td>{formatDate(task.submittedAt)}</td>
                  </tr>
                ))}
                {!rows.length && !isLoading ? (
                  <tr>
                    <td colSpan={8}>暂无真实任务记录</td>
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

function formatKind(kind: AsyncTaskKind) {
  return kind === 'image' ? '绘图任务' : '通用任务';
}

function formatStatus(status: AsyncTaskStatus) {
  const labels: Record<AsyncTaskStatus, string> = {
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

function formatTaskOutcome(task: AsyncTaskEntry) {
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
