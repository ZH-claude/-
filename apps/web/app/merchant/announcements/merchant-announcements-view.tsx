'use client';

import { BellOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { MerchantShell } from '../../components/merchant-shell';
import {
  createAnnouncement,
  listAnnouncements,
  type Announcement,
  type AnnouncementCategory
} from '../../lib/admin-api';
import { logout } from '../../lib/auth-api';

type AnnouncementStatusInput = 'draft' | 'published' | 'archived';

export function MerchantAnnouncementsView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<AnnouncementCategory>('announcement');
  const [status, setStatus] = useState<AnnouncementStatusInput>('published');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadAnnouncements();
  }, []);

  const stats = useMemo(() => {
    return announcements.reduce(
      (current, entry) => ({
        total: current.total + 1,
        published: current.published + (entry.status === 'published' ? 1 : 0),
        draft: current.draft + (entry.status === 'draft' ? 1 : 0),
        archived: current.archived + (entry.status === 'archived' ? 1 : 0)
      }),
      { total: 0, published: 0, draft: 0, archived: 0 }
    );
  }, [announcements]);

  async function loadAnnouncements() {
    setIsLoading(true);
    setError('');

    try {
      const result = await listAnnouncements();
      setAnnouncements(result.items);
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '公告数据加载失败';
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
      const created = await createAnnouncement({ title, content, category, status });
      setTitle('');
      setContent('');
      setCategory('announcement');
      setStatus('published');
      setMessage(`公告 ${created.title} 已保存`);
      await loadAnnouncements();
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
    <MerchantShell
      activePath="/merchant/announcements"
      isRefreshing={isLoading}
      onLogout={handleLogout}
      onRefresh={() => void loadAnnouncements()}
      role={role}
      username={username}
    >
      <section className="admin-content merchant-announcements-page" data-page="merchant-announcements">
        <div className="admin-heading merchant-dashboard-heading">
          <div>
            <p className="eyebrow">商家工作台</p>
            <h1>公告管理</h1>
            <small>发布公告、更新日志和使用建议；用户首页只读取已发布内容。</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadAnnouncements()} title="刷新公告" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="公告总数" value={formatNumber(stats.total)} detail="最近 100 条真实记录" />
          <MetricPanel label="已发布" value={formatNumber(stats.published)} detail="用户首页可见" tone="green" />
          <MetricPanel label="草稿" value={formatNumber(stats.draft)} detail="仅商家端可见" />
          <MetricPanel label="归档" value={formatNumber(stats.archived)} detail="不进入公开首页" tone="red" />
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
                <input maxLength={120} minLength={3} onChange={(event) => setTitle(event.target.value)} required value={title} />
              </label>
              <label>
                内容
                <textarea maxLength={5000} onChange={(event) => setContent(event.target.value)} required rows={6} value={content} />
              </label>
              <label>
                分类
                <select onChange={(event) => setCategory(event.target.value as AnnouncementCategory)} value={category}>
                  <option value="announcement">平台公告</option>
                  <option value="update_log">更新日志</option>
                  <option value="usage_guide">使用建议</option>
                </select>
              </label>
              <label>
                状态
                <select onChange={(event) => setStatus(event.target.value as AnnouncementStatusInput)} value={status}>
                  <option value="published">发布</option>
                  <option value="draft">草稿</option>
                  <option value="archived">归档</option>
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
                    <span>{formatAnnouncementCategory(announcement.category)} · {formatStatus(announcement.status)}</span>
                  </div>
                  <p>{announcement.content}</p>
                  <small>
                    {announcement.publishedAt ? `发布时间 ${formatOptionalDate(announcement.publishedAt)}` : '未发布'}
                    {announcement.createdBy ? ` · 创建人 ${announcement.createdBy}` : ''}
                  </small>
                </article>
              ))}
              {!announcements.length && !isLoading ? <p className="empty-state">暂无真实公告记录</p> : null}
            </div>
          </section>
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

function formatAnnouncementCategory(category: AnnouncementCategory) {
  const labels: Record<AnnouncementCategory, string> = {
    announcement: '平台公告',
    update_log: '更新日志',
    usage_guide: '使用建议'
  };

  return labels[category] ?? category;
}

function formatStatus(status: string) {
  if (status === 'published') {
    return '已发布';
  }

  if (status === 'draft') {
    return '草稿';
  }

  if (status === 'archived') {
    return '归档';
  }

  return status;
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-';
  }

  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatOptionalDate(value: string | null) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false
  }).format(new Date(value));
}
