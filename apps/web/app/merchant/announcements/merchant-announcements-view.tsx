'use client';

import { BellOutlined, HomeOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { MerchantShell } from '../../components/merchant-shell';
import {
  createAnnouncement,
  getAdminSiteContentConfig,
  listAnnouncements,
  updateAdminSiteContentConfig,
  type Announcement,
  type AnnouncementCategory,
  type SiteContentConfig,
  type SiteFontFamily
} from '../../lib/admin-api';
import { logout } from '../../lib/auth-api';

type AnnouncementStatusInput = 'draft' | 'published' | 'archived';

type SiteContentFormState = {
  homeTitle: string;
  homeSubtitle: string;
  homeContent: string;
  homeFontFamily: SiteFontFamily;
  homeTextColor: string;
  homeAccentColor: string;
  popupEnabled: boolean;
  popupTitle: string;
  popupContent: string;
  popupFontFamily: SiteFontFamily;
  popupTextColor: string;
  popupAccentColor: string;
};

const DEFAULT_SITE_CONTENT_FORM: SiteContentFormState = {
  homeTitle: '蔚蓝星球中转站',
  homeSubtitle: '智能服务中转后台',
  homeContent: '',
  homeFontFamily: 'system',
  homeTextColor: '#111827',
  homeAccentColor: '#2563eb',
  popupEnabled: false,
  popupTitle: '',
  popupContent: '',
  popupFontFamily: 'system',
  popupTextColor: '#111827',
  popupAccentColor: '#2563eb'
};

const FONT_OPTIONS: Array<{ value: SiteFontFamily; label: string }> = [
  { value: 'system', label: '默认无衬线' },
  { value: 'serif', label: '衬线标题' },
  { value: 'rounded', label: '圆润展示' },
  { value: 'mono', label: '等宽科技' }
];

const COLOR_OPTIONS = ['#2563eb', '#16a34a', '#e11d48', '#f59e0b', '#7c3aed', '#111827'];

export function MerchantAnnouncementsView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [siteContent, setSiteContent] = useState<SiteContentConfig | null>(null);
  const [siteContentForm, setSiteContentForm] = useState<SiteContentFormState>(DEFAULT_SITE_CONTENT_FORM);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<AnnouncementCategory>('announcement');
  const [status, setStatus] = useState<AnnouncementStatusInput>('published');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingSiteContent, setIsSavingSiteContent] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadData();
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

  async function loadData() {
    setIsLoading(true);
    setError('');

    try {
      const [announcementResult, siteContentResult] = await Promise.all([
        listAnnouncements(),
        getAdminSiteContentConfig()
      ]);
      setAnnouncements(announcementResult.items);
      setSiteContent(siteContentResult);
      setSiteContentForm(toSiteContentForm(siteContentResult));
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '公告与首页数据加载失败';
      setError(nextMessage);
      if (nextMessage.includes('401') || nextMessage.includes('认证') || nextMessage.includes('会话')) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSiteContentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsSavingSiteContent(true);

    try {
      const config = await updateAdminSiteContentConfig({
        homeTitle: siteContentForm.homeTitle || null,
        homeSubtitle: siteContentForm.homeSubtitle || null,
        homeContent: siteContentForm.homeContent || null,
        homeFontFamily: siteContentForm.homeFontFamily,
        homeTextColor: siteContentForm.homeTextColor,
        homeAccentColor: siteContentForm.homeAccentColor,
        popupEnabled: siteContentForm.popupEnabled,
        popupTitle: siteContentForm.popupTitle || null,
        popupContent: siteContentForm.popupContent || null,
        popupFontFamily: siteContentForm.popupFontFamily,
        popupTextColor: siteContentForm.popupTextColor,
        popupAccentColor: siteContentForm.popupAccentColor
      });
      setSiteContent(config);
      setSiteContentForm(toSiteContentForm(config));
      setMessage('首页与弹窗公告配置已保存');
      router.refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '首页与弹窗公告保存失败');
    } finally {
      setIsSavingSiteContent(false);
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
      await loadData();
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
      onRefresh={() => void loadData()}
      role={role}
      username={username}
    >
      <section className="admin-content merchant-announcements-page" data-page="merchant-announcements">
        <div className="admin-heading merchant-dashboard-heading">
          <div>
            <p className="eyebrow">商家工作台</p>
            <h1>公告与首页</h1>
            <small>编辑首页展示、打开网站时的弹窗公告，以及首页公告列表内容。</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadData()} title="刷新公告与首页配置" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}

        <section className="admin-panel site-content-admin-panel">
          <div className="panel-title">
            <HomeOutlined />
            <h2>首页与弹窗公告</h2>
          </div>
          <form className="auth-form site-content-form" onSubmit={handleSiteContentSubmit}>
            <label>
              首页标题
              <input
                maxLength={80}
                onChange={(event) => setSiteContentForm((current) => ({ ...current, homeTitle: event.target.value }))}
                value={siteContentForm.homeTitle}
              />
            </label>
            <label>
              首页副标题
              <input
                maxLength={160}
                onChange={(event) => setSiteContentForm((current) => ({ ...current, homeSubtitle: event.target.value }))}
                value={siteContentForm.homeSubtitle}
              />
            </label>
            <label className="wide-label">
              首页说明
              <textarea
                maxLength={1200}
                onChange={(event) => setSiteContentForm((current) => ({ ...current, homeContent: event.target.value }))}
                rows={4}
                value={siteContentForm.homeContent}
              />
            </label>

            <StyleControls
              accentColor={siteContentForm.homeAccentColor}
              fontFamily={siteContentForm.homeFontFamily}
              onAccentColorChange={(value) => setSiteContentForm((current) => ({ ...current, homeAccentColor: value }))}
              onFontFamilyChange={(value) => setSiteContentForm((current) => ({ ...current, homeFontFamily: value }))}
              onTextColorChange={(value) => setSiteContentForm((current) => ({ ...current, homeTextColor: value }))}
              textColor={siteContentForm.homeTextColor}
              title="首页样式"
            />

            <label className="checkbox-label wide-label">
              <input
                checked={siteContentForm.popupEnabled}
                onChange={(event) => setSiteContentForm((current) => ({ ...current, popupEnabled: event.target.checked }))}
                type="checkbox"
              />
              打开网站时弹出公告
            </label>
            <label>
              弹窗标题
              <input
                maxLength={120}
                onChange={(event) => setSiteContentForm((current) => ({ ...current, popupTitle: event.target.value }))}
                required={siteContentForm.popupEnabled}
                value={siteContentForm.popupTitle}
              />
            </label>
            <label className="wide-label">
              弹窗内容
              <textarea
                maxLength={2000}
                onChange={(event) => setSiteContentForm((current) => ({ ...current, popupContent: event.target.value }))}
                required={siteContentForm.popupEnabled}
                rows={5}
                value={siteContentForm.popupContent}
              />
            </label>

            <StyleControls
              accentColor={siteContentForm.popupAccentColor}
              fontFamily={siteContentForm.popupFontFamily}
              onAccentColorChange={(value) => setSiteContentForm((current) => ({ ...current, popupAccentColor: value }))}
              onFontFamilyChange={(value) => setSiteContentForm((current) => ({ ...current, popupFontFamily: value }))}
              onTextColorChange={(value) => setSiteContentForm((current) => ({ ...current, popupTextColor: value }))}
              textColor={siteContentForm.popupTextColor}
              title="弹窗样式"
            />

            <div className="form-actions-row wide-label">
              <button className="primary-button" disabled={isSavingSiteContent} type="submit">
                <HomeOutlined />
                {isSavingSiteContent ? '保存中' : '保存首页与弹窗'}
              </button>
              <small className="table-note">上次保存：{siteContent?.updatedAt ? formatOptionalDate(siteContent.updatedAt) : '暂无'}</small>
            </div>
          </form>
        </section>

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

function StyleControls({
  title,
  fontFamily,
  textColor,
  accentColor,
  onFontFamilyChange,
  onTextColorChange,
  onAccentColorChange
}: {
  title: string;
  fontFamily: SiteFontFamily;
  textColor: string;
  accentColor: string;
  onFontFamilyChange: (value: SiteFontFamily) => void;
  onTextColorChange: (value: string) => void;
  onAccentColorChange: (value: string) => void;
}) {
  return (
    <section className="style-control-group wide-label">
      <strong>{title}</strong>
      <div className="style-control-grid">
        <label>
          字体
          <select onChange={(event) => onFontFamilyChange(event.target.value as SiteFontFamily)} value={fontFamily}>
            {FONT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <ColorPicker label="正文颜色" onChange={onTextColorChange} value={textColor} />
        <ColorPicker label="强调颜色" onChange={onAccentColorChange} value={accentColor} />
      </div>
    </section>
  );
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <span className="color-picker-row">
        <input onChange={(event) => onChange(event.target.value)} type="color" value={value} />
        <input maxLength={7} onChange={(event) => onChange(event.target.value)} value={value} />
      </span>
      <span className="color-swatch-row">
        {COLOR_OPTIONS.map((color) => (
          <button
            aria-label={`选择颜色 ${color}`}
            className={color.toLowerCase() === value.toLowerCase() ? 'active' : ''}
            key={color}
            onClick={() => onChange(color)}
            style={{ backgroundColor: color }}
            type="button"
          />
        ))}
      </span>
    </label>
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

function toSiteContentForm(config: SiteContentConfig | null): SiteContentFormState {
  if (!config) {
    return DEFAULT_SITE_CONTENT_FORM;
  }

  return {
    homeTitle: config.home.title,
    homeSubtitle: config.home.subtitle,
    homeContent: config.home.content ?? '',
    homeFontFamily: config.home.fontFamily,
    homeTextColor: config.home.textColor,
    homeAccentColor: config.home.accentColor,
    popupEnabled: config.popup.enabled,
    popupTitle: config.popup.title ?? '',
    popupContent: config.popup.content ?? '',
    popupFontFamily: config.popup.fontFamily,
    popupTextColor: config.popup.textColor,
    popupAccentColor: config.popup.accentColor
  };
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
