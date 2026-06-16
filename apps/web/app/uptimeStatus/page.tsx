'use client';

import {
  ApiOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  LineChartOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { ConsoleShell } from '../components/console-shell';
import {
  getServiceStatus,
  type ServiceComponentStatus,
  type ServiceStatusResponse,
  type UpstreamStatus
} from '../lib/service-status-api';

export default function UptimeStatusPage() {
  const [data, setData] = useState<ServiceStatusResponse | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    setIsLoading(true);
    setError('');

    try {
      setData(await getServiceStatus());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '服务状态加载失败');
    } finally {
      setIsLoading(false);
    }
  }

  const summary = data?.summary;

  return (
    <ConsoleShell activePath="/uptimeStatus" isRefreshing={isLoading} onRefresh={() => void loadStatus()}>
      <section className="console-content-grid">
        <section className="account-panel account-summary">
          <div>
            <p className="eyebrow">服务状态</p>
            <h1>{isLoading ? '加载中' : formatOverallStatus(summary?.overallStatus)}</h1>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadStatus()} title="刷新服务状态" type="button">
            <ReloadOutlined />
          </button>
        </section>

        <div className="metric-panel">
          <span>平台组件</span>
          <strong>{summary?.componentStatusCounts.healthy ?? 0} 健康</strong>
          <small>
            必需 {summary?.requiredComponents ?? 0} / 总计 {summary?.totalComponents ?? 0}
          </small>
        </div>
        <div className="metric-panel">
          <span>上游状态</span>
          <strong>{summary?.activeUpstreams ?? 0} 启用</strong>
          <small>
            健康 {summary?.upstreamStatusCounts.healthy ?? 0} · 异常 {summary?.upstreamStatusCounts.unhealthy ?? 0} · 未知{' '}
            {summary?.upstreamStatusCounts.unknown ?? 0}
          </small>
        </div>
        <div className="metric-panel">
          <span>状态来源</span>
          <strong>{data?.mode === 'external_monitor_configured' ? '外部监控' : '内置探针'}</strong>
          <small>生成时间 {formatDateTime(data?.generatedAt ?? null) ?? '暂无'}</small>
        </div>

        {error ? <p className="form-error wide-panel">{error}</p> : null}

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <LineChartOutlined />
            <h2>平台组件</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table service-status-table">
              <thead>
                <tr>
                  <th>组件</th>
                  <th>状态</th>
                  <th>类型</th>
                  <th>探针来源</th>
                  <th>延迟</th>
                  <th>最近检查</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {(data?.components ?? []).map((component) => (
                  <tr key={component.key}>
                    <td>
                      <strong>{component.label}</strong>
                      <span className="table-note">{component.key}</span>
                    </td>
                    <td>{renderComponentStatus(component.status)}</td>
                    <td>{component.required ? '必需' : '可选'}</td>
                    <td>{formatSource(component.source)}</td>
                    <td>{formatLatency(component.latencyMs)}</td>
                    <td>{formatDateTime(component.checkedAt) ?? '暂无'}</td>
                    <td>{formatMessage(component.message)}</td>
                  </tr>
                ))}
                {!isLoading && !(data?.components ?? []).length ? (
                  <tr>
                    <td colSpan={7}>暂无真实平台组件探针数据</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <CloudServerOutlined />
            <h2>上游状态</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table service-upstream-table">
              <thead>
                <tr>
                  <th>上游</th>
                  <th>状态</th>
                  <th>启用状态</th>
                  <th>健康字段</th>
                  <th>最近延迟</th>
                  <th>最近检查</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                {(data?.upstreams ?? []).map((upstream) => (
                  <tr key={upstream.name}>
                    <td>
                      <DatabaseOutlined />
                      <strong className="upstream-name"> {upstream.name}</strong>
                    </td>
                    <td>{renderUpstreamStatus(upstream.status)}</td>
                    <td>{upstream.providerStatus === 'active' ? '启用' : '停用'}</td>
                    <td>{formatHealthStatus(upstream.healthStatus)}</td>
                    <td>{formatLatency(upstream.lastHealthLatencyMs)}</td>
                    <td>{formatDateTime(upstream.lastHealthCheckAt) ?? '暂无检查'}</td>
                    <td>{formatMessage(upstream.lastHealthError)}</td>
                  </tr>
                ))}
                {!isLoading && !(data?.upstreams ?? []).length ? (
                  <tr>
                    <td colSpan={7}>暂无已配置上游真实状态数据</td>
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

function renderComponentStatus(status: ServiceComponentStatus) {
  if (status === 'healthy') {
    return <span className="status-pill status-pill-success">健康</span>;
  }
  if (status === 'degraded') {
    return <span className="status-pill status-pill-warning">降级</span>;
  }
  if (status === 'unhealthy') {
    return <span className="status-pill status-pill-danger">异常</span>;
  }
  if (status === 'not_configured') {
    return <span className="status-pill status-pill-muted">未配置</span>;
  }
  if (status === 'disabled') {
    return <span className="status-pill status-pill-muted">停用</span>;
  }

  return <span className="status-pill status-pill-muted">未知</span>;
}

function renderUpstreamStatus(status: UpstreamStatus) {
  if (status === 'healthy') {
    return <span className="status-pill status-pill-success">健康</span>;
  }
  if (status === 'unhealthy') {
    return <span className="status-pill status-pill-danger">异常</span>;
  }
  if (status === 'disabled') {
    return <span className="status-pill status-pill-muted">停用</span>;
  }

  return <span className="status-pill status-pill-muted">未知</span>;
}

function formatOverallStatus(status: ServiceStatusResponse['summary']['overallStatus'] | undefined) {
  if (status === 'healthy') {
    return '平台运行正常';
  }
  if (status === 'unhealthy') {
    return '平台存在异常';
  }
  return '平台状态需关注';
}

function formatSource(source: string) {
  const labels: Record<string, string> = {
    builtin: '内置',
    database: '数据库',
    redis: 'Redis',
    web: 'Web',
    uptime_kuma: 'Uptime Kuma'
  };

  return labels[source] ?? source;
}

function formatHealthStatus(status: string) {
  const labels: Record<string, string> = {
    healthy: '健康',
    unhealthy: '异常',
    unknown: '未知'
  };

  return labels[status] ?? status;
}

function formatMessage(message: string | null) {
  if (!message) {
    return '-';
  }

  const labels: Record<string, string> = {
    api_process_responding: 'API 进程正在响应',
    database_query_ok: '数据库查询成功',
    tcp_connect_ok: 'TCP 连接成功',
    web_process_reachable: 'Web 进程可访问',
    uptime_kuma_status_page_reachable: '外部状态页可访问',
    uptime_kuma_not_configured: '未配置外部监控',
    web_health_url_not_configured: '未配置 Web 探针',
    redis_url_not_configured: '未配置 Redis 探针',
    timeout: '探针超时',
    invalid_url: '配置地址无效',
    unsupported_protocol: '协议不支持',
    invalid_host_or_port: '主机或端口无效',
    probe_failed: '探针失败',
    health_check_timed_out: '上游检查超时',
    private_or_local_upstream_blocked: '上游地址被安全策略拦截',
    upstream_host_unresolved: '上游域名无法解析',
    health_check_failed: '上游检查失败'
  };

  return labels[message] ?? message;
}

function formatLatency(value: number | null) {
  return value === null ? '-' : `${value} ms`;
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : null;
}
