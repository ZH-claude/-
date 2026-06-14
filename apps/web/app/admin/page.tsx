'use client';

import {
  BellOutlined,
  DashboardOutlined,
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
  createAnnouncement,
  listAdminUsers,
  listAnnouncements
} from '../lib/admin-api';
import type { AdminUser, Announcement } from '../lib/admin-api';
import { logout } from '../lib/auth-api';

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<'draft' | 'published'>('published');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void loadAdminData();
  }, []);

  async function loadAdminData() {
    setIsLoading(true);
    setError('');

    try {
      const [userResult, announcementResult] = await Promise.all([
        listAdminUsers(),
        listAnnouncements()
      ]);
      setUsers(userResult.items);
      setTotalUsers(userResult.total);
      setAnnouncements(announcementResult.items);
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
          </div>

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

function formatCents(value: number) {
  return `${(value / 100).toFixed(2)} 元`;
}
