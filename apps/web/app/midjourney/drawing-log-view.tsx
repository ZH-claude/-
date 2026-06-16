'use client';

import { CheckCircleOutlined, FilterOutlined, PictureOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { ConsoleShell } from '../components/console-shell';
import { getProfile, logout } from '../lib/auth-api';
import {
  listAsyncTasks,
  type AsyncTaskEntry,
  type AsyncTaskFilters,
  type AsyncTasksResponse,
  type AsyncTaskStatus
} from '../lib/async-tasks-api';

type FilterState = {
  status: AsyncTaskStatus | '';
  platform: string;
  model: string;
  limit: string;
};

const DEFAULT_FILTERS: FilterState = {
  status: '',
  platform: '',
  model: '',
  limit: '50'
};

export function DrawingLogView() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [data, setData] = useState<AsyncTasksResponse | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadProfile();
    void loadTasks(DEFAULT_FILTERS);
  }, []);

  const rows = data?.items ?? [];
  const summary = data?.summary;
  const activeFilters = [filters.status, filters.platform, filters.model].filter(Boolean).length;
  const isRefreshing = isLoadingProfile || isLoadingTasks;

  async function loadProfile() {
    setIsLoadingProfile(true);

    try {
      const result = await getProfile();
      setUsername(result.user.username);
    } catch {
      router.replace('/login');
    } finally {
      setIsLoadingProfile(false);
    }
  }

  async function loadTasks(nextFilters: FilterState) {
    setIsLoadingTasks(true);
    setError('');

    try {
      const requestFilters: AsyncTaskFilters = {
        kind: 'image',
        status: nextFilters.status || undefined,
        platform: nextFilters.platform || undefined,
        model: nextFilters.model || undefined,
        limit: Number(nextFilters.limit) || 50
      };
      const result = await listAsyncTasks(requestFilters);
      setData(result);
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '绘图记录加载失败';
      setError(nextMessage);
      if (nextMessage.includes('401') || nextMessage.includes('认证') || nextMessage.includes('会话')) {
        router.replace('/login');
      }
    } finally {
      setIsLoadingTasks(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadTasks(filters);
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    void loadTasks(DEFAULT_FILTERS);
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <ConsoleShell
      activePath="/midjourney"
      isRefreshing={isRefreshing}
      onLogout={() => void handleLogout()}
      onRefresh={() => void loadTasks(filters)}
      username={username}
    >
      <section className="profile-card account-summary">
        <div>
          <p className="eyebrow">绘图</p>
          <h1>{isLoadingTasks ? '加载中' : `${summary?.total ?? 0} 条记录`}</h1>
        </div>
        <button className="icon-button" disabled={isLoadingTasks} onClick={() => void loadTasks(filters)} title="刷新绘图记录" type="button">
          <PictureOutlined />
        </button>
      </section>

      <section className="drawing-metrics">
        <MetricPanel label="运行中" value={summary?.statusCounts.running ?? 0} detail={`排队 ${summary?.statusCounts.queued ?? 0}`} />
        <MetricPanel label="已完成" value={summary?.statusCounts.succeeded ?? 0} detail={`失败 ${summary?.statusCounts.failed ?? 0}`} />
        <MetricPanel label="绘图记录" value={summary?.kindCounts.image ?? 0} detail={`当前筛选 ${activeFilters} 个条件`} />
      </section>

      {error ? <p className="form-error">{error}</p> : null}

      <section className="profile-card">
        <div className="panel-title">
          <FilterOutlined />
          <h2>筛选</h2>
        </div>
        <form className="log-filter-form drawing-filter-form" onSubmit={handleSubmit}>
          <label>
            状态
            <select
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as AsyncTaskStatus | '' }))}
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
            <select onChange={(event) => setFilters((current) => ({ ...current, platform: event.target.value }))} value={filters.platform}>
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
            <button className="primary-button" disabled={isLoadingTasks} type="submit">
              <FilterOutlined />
              应用
            </button>
            <button className="ghost-button" disabled={isLoadingTasks} onClick={resetFilters} type="button">
              重置
            </button>
          </div>
        </form>
      </section>

      <section className="profile-card">
        <div className="panel-title">
          <PictureOutlined />
          <h2>绘图记录</h2>
        </div>
        {!data?.capabilities.imageSubmissionSupported ? <p className="table-note">提交入口未接入真实绘图上游。</p> : null}
        <div className="table-scroll">
          <table className="admin-table drawing-table">
            <thead>
              <tr>
                <th>任务</th>
                <th>平台</th>
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
                  <td>{formatStatus(task.status)}</td>
                  <td>{task.model ?? '-'}</td>
                  <td>{formatProgress(task.progress)}</td>
                  <td>{formatTaskOutcome(task)}</td>
                  <td>{formatDate(task.submittedAt)}</td>
                </tr>
              ))}
              {!rows.length && !isLoadingTasks ? (
                <tr>
                  <td colSpan={7}>暂无真实绘图记录</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </ConsoleShell>
  );
}

function MetricPanel({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="metric-panel">
      <span>{label}</span>
      <strong>
        <CheckCircleOutlined />
        {value}
      </strong>
      <small>{detail}</small>
    </div>
  );
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
