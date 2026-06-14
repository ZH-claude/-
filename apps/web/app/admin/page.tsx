'use client';

import {
  ApiOutlined,
  BellOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  LogoutOutlined,
  ReloadOutlined,
  SendOutlined,
  TeamOutlined
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  checkUpstreamHealth,
  createAnnouncement,
  createUpstreamProvider,
  listAdminUsers,
  listAnnouncements,
  listUpstreamProviders
} from '../lib/admin-api';
import type { AdminUser, Announcement, UpstreamProvider } from '../lib/admin-api';
import { logout } from '../lib/auth-api';

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [upstreams, setUpstreams] = useState<UpstreamProvider[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<'draft' | 'published'>('published');
  const [upstreamName, setUpstreamName] = useState('');
  const [upstreamBaseUrl, setUpstreamBaseUrl] = useState('');
  const [upstreamApiKey, setUpstreamApiKey] = useState('');
  const [upstreamStatus, setUpstreamStatus] = useState<'active' | 'disabled'>('active');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUpstreamSubmitting, setIsUpstreamSubmitting] = useState(false);
  const [checkingUpstreamId, setCheckingUpstreamId] = useState<string | null>(null);

  useEffect(() => {
    void loadAdminData();
  }, []);

  async function loadAdminData() {
    setIsLoading(true);
    setError('');

    try {
      const [userResult, announcementResult, upstreamResult] = await Promise.all([
        listAdminUsers(),
        listAnnouncements(),
        listUpstreamProviders()
      ]);
      setUsers(userResult.items);
      setTotalUsers(userResult.total);
      setAnnouncements(announcementResult.items);
      setUpstreams(upstreamResult.items);
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '后台数据加载失败';
      setError(nextMessage);
      if (nextMessage.includes('401') || nextMessage.includes('认证') || nextMessage.includes('会话')) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsSubmitting(true);

    try {
      await createAnnouncement({ title, content, status });
      setTitle('');
      setContent('');
      setStatus('published');
      setMessage('公告已保存');
      const announcementResult = await listAnnouncements();
      setAnnouncements(announcementResult.items);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '公告保存失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateUpstream(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsUpstreamSubmitting(true);

    try {
      await createUpstreamProvider({
        name: upstreamName,
        baseUrl: upstreamBaseUrl,
        apiKey: upstreamApiKey,
        status: upstreamStatus
      });
      setUpstreamName('');
      setUpstreamBaseUrl('');
      setUpstreamApiKey('');
      setUpstreamStatus('active');
      setMessage('上游配置已保存');
      const upstreamResult = await listUpstreamProviders();
      setUpstreams(upstreamResult.items);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '上游配置保存失败');
    } finally {
      setIsUpstreamSubmitting(false);
    }
  }

  async function handleCheckUpstream(providerId: string) {
    setError('');
    setMessage('');
    setCheckingUpstreamId(providerId);

    try {
      const result = await checkUpstreamHealth(providerId);
      setUpstreams((currentUpstreams) =>
        currentUpstreams.map((upstream) => (upstream.id === providerId ? result.provider : upstream))
      );
      setMessage(result.reachable ? '上游连通性验证通过' : '上游连通性验证失败');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '上游连通性验证失败');
    } finally {
      setCheckingUpstreamId(null);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <main className="admin-page">
      <header className="topbar">
        <Link className="auth-brand compact" href="/">
          <span className="shell-logo-mark">R</span>
          <span>Relay Console</span>
        </Link>
        <nav className="admin-top-actions" aria-label="后台操作">
          <Link className="ghost-button" href="/account">
            <DashboardOutlined />
            账户
          </Link>
          <button className="ghost-button" onClick={handleLogout} type="button">
            <LogoutOutlined />
            退出
          </button>
        </nav>
      </header>

      <section className="admin-layout">
        <aside className="admin-nav" aria-label="后台导航">
          <Link className="admin-nav-item active" href="/admin">
            <TeamOutlined />
            用户与公告
          </Link>
        </aside>

        <section className="admin-content">
          <div className="admin-heading">
            <div>
              <p className="eyebrow">管理后台</p>
              <h1>用户与公告</h1>
            </div>
            <button className="icon-button" onClick={() => void loadAdminData()} title="刷新后台数据" type="button">
              <ReloadOutlined />
            </button>
          </div>

          {error ? <p className="form-error">{error}</p> : null}
          {message ? <p className="form-success">{message}</p> : null}

          <div className="admin-metrics">
            <section className="metric-panel">
              <span>用户总数</span>
              <strong>{isLoading ? '-' : totalUsers}</strong>
              <small>最多显示最近 100 个用户</small>
            </section>
            <section className="metric-panel">
              <span>公告数量</span>
              <strong>{isLoading ? '-' : announcements.length}</strong>
              <small>包含草稿和已发布</small>
            </section>
            <section className="metric-panel">
              <span>Upstreams</span>
              <strong>{isLoading ? '-' : upstreams.length}</strong>
              <small>configured provider connections</small>
            </section>
          </div>

          <section className="admin-grid">
            <section className="admin-panel">
              <div className="panel-title">
                <CloudServerOutlined />
                <h2>Upstream config</h2>
              </div>
              <form className="auth-form compact-form" onSubmit={handleCreateUpstream}>
                <label>
                  Name
                  <input
                    maxLength={80}
                    minLength={2}
                    onChange={(event) => setUpstreamName(event.target.value)}
                    required
                    value={upstreamName}
                  />
                </label>
                <label>
                  Base URL
                  <input
                    maxLength={2048}
                    minLength={8}
                    onChange={(event) => setUpstreamBaseUrl(event.target.value)}
                    placeholder="https://api.example.com"
                    required
                    type="url"
                    value={upstreamBaseUrl}
                  />
                </label>
                <label>
                  API Key
                  <input
                    autoComplete="off"
                    maxLength={512}
                    minLength={8}
                    onChange={(event) => setUpstreamApiKey(event.target.value)}
                    required
                    type="password"
                    value={upstreamApiKey}
                  />
                </label>
                <label>
                  Status
                  <select
                    onChange={(event) => setUpstreamStatus(event.target.value as 'active' | 'disabled')}
                    value={upstreamStatus}
                  >
                    <option value="active">active</option>
                    <option value="disabled">disabled</option>
                  </select>
                </label>
                <button className="primary-button" disabled={isUpstreamSubmitting} type="submit">
                  <ApiOutlined />
                  {isUpstreamSubmitting ? 'Saving' : 'Save upstream'}
                </button>
              </form>
            </section>

            <section className="admin-panel">
              <div className="panel-title">
                <ExperimentOutlined />
                <h2>Health check</h2>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table upstream-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Base URL</th>
                      <th>Key</th>
                      <th>Health</th>
                      <th>Last check</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upstreams.map((upstream) => (
                      <tr key={upstream.id}>
                        <td>{upstream.name}</td>
                        <td>{upstream.baseUrl}</td>
                        <td>{upstream.apiKeyPreview}</td>
                        <td>
                          <span className={`status-pill ${getHealthClass(upstream.healthStatus)}`}>
                            {formatHealthStatus(upstream.healthStatus)}
                          </span>
                          {upstream.lastHealthError ? <small className="table-note">{upstream.lastHealthError}</small> : null}
                        </td>
                        <td>
                          {formatOptionalDate(upstream.lastHealthCheckAt)}
                          {upstream.lastHealthLatencyMs !== null ? (
                            <small className="table-note">{upstream.lastHealthLatencyMs}ms</small>
                          ) : null}
                        </td>
                        <td>
                          <button
                            className="ghost-button compact-button"
                            disabled={checkingUpstreamId === upstream.id}
                            onClick={() => void handleCheckUpstream(upstream.id)}
                            type="button"
                          >
                            <ExperimentOutlined />
                            {checkingUpstreamId === upstream.id ? 'Checking' : 'Check'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!upstreams.length && !isLoading ? (
                      <tr>
                        <td colSpan={6}>No upstream configured</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </section>

          <section className="admin-panel">
            <div className="panel-title">
              <TeamOutlined />
              <h2>用户列表</h2>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>角色</th>
                    <th>状态</th>
                    <th>分组</th>
                    <th>余额</th>
                    <th>上次登录</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.username}</td>
                      <td>{user.role}</td>
                      <td>{user.status}</td>
                      <td>{user.group.name}</td>
                      <td>{formatCents(user.wallet.balanceCents)}</td>
                      <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                  {!users.length && !isLoading ? (
                    <tr>
                      <td colSpan={6}>暂无用户</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="admin-grid">
            <section className="admin-panel">
              <div className="panel-title">
                <SendOutlined />
                <h2>发布公告</h2>
              </div>
              <form className="auth-form compact-form" onSubmit={handleCreateAnnouncement}>
                <label>
                  标题
                  <input
                    maxLength={120}
                    minLength={3}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    value={title}
                  />
                </label>
                <label>
                  内容
                  <textarea
                    maxLength={5000}
                    onChange={(event) => setContent(event.target.value)}
                    required
                    rows={6}
                    value={content}
                  />
                </label>
                <label>
                  状态
                  <select onChange={(event) => setStatus(event.target.value as 'draft' | 'published')} value={status}>
                    <option value="published">发布</option>
                    <option value="draft">草稿</option>
                  </select>
                </label>
                <button className="primary-button" disabled={isSubmitting} type="submit">
                  <SendOutlined />
                  {isSubmitting ? '保存中' : '保存公告'}
                </button>
              </form>
            </section>

            <section className="admin-panel">
              <div className="panel-title">
                <BellOutlined />
                <h2>公告记录</h2>
              </div>
              <div className="announcement-list">
                {announcements.map((announcement) => (
                  <article className="announcement-item" key={announcement.id}>
                    <div>
                      <strong>{announcement.title}</strong>
                      <span>{announcement.status}</span>
                    </div>
                    <p>{announcement.content}</p>
                    <small>
                      {announcement.publishedAt
                        ? `发布时间 ${new Date(announcement.publishedAt).toLocaleString()}`
                        : '未发布'}
                    </small>
                  </article>
                ))}
                {!announcements.length && !isLoading ? <p className="empty-state">暂无公告</p> : null}
              </div>
            </section>
          </section>
        </section>
      </section>
    </main>
  );
}

function formatOptionalDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
}

function formatHealthStatus(status: string) {
  if (status === 'healthy') {
    return 'healthy';
  }

  if (status === 'unhealthy') {
    return 'unhealthy';
  }

  return 'unknown';
}

function getHealthClass(status: string) {
  if (status === 'healthy') {
    return 'status-pill-success';
  }

  if (status === 'unhealthy') {
    return 'status-pill-danger';
  }

  return 'status-pill-muted';
}

function formatCents(value: number) {
  return `${(value / 100).toFixed(2)} 元`;
}
