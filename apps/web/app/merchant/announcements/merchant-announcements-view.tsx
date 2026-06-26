'use client';

import { BellOutlined, EyeOutlined, HomeOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { MerchantShell } from '../../components/merchant-shell';
import {
  createAnnouncement,
  createTranslationGlossaryTerm,
  getAdminSiteContentConfig,
  listAnnouncements,
  listTranslationGlossaryTerms,
  prepareAnnouncementTranslations,
  previewAnnouncement,
  updateAnnouncement,
  updateAdminSiteContentConfig,
  updateTranslationGlossaryTerm,
  type Announcement,
  type AnnouncementPreview,
  type AnnouncementCategory,
  type AnnouncementTranslationWorkflowEntry,
  type SiteContentConfig,
  type SiteFontFamily,
  type TranslationGlossaryTerm,
  type TranslationMap
} from '../../lib/admin-api';
import { logout } from '../../lib/auth-api';
import { supportedLanguages } from '../../lib/i18n';

type AnnouncementStatusInput = 'draft' | 'published' | 'archived';
type AnnouncementWorkflowStatusFilter =
  | 'all'
  | 'published'
  | 'draft'
  | 'archived'
  | 'scheduled'
  | 'pinned'
  | 'machine_draft'
  | 'human_reviewed'
  | 'locked'
  | 'untranslated';
type AnnouncementWorkflowCategoryFilter = 'all' | AnnouncementCategory;
type AnnouncementTranslationRecord = Record<string, string | boolean>;
type TranslationLanguageState = Record<string, string>;
type AnnouncementPreviewCache = Record<string, {
  error: string;
  isLoading: boolean;
  language: string;
  preview: AnnouncementPreview | null;
}>;

type AnnouncementDraftState = {
  announcementTranslationsJson: string;
  category: AnnouncementCategory;
  content: string;
  isPinned: boolean;
  scheduledAtInput: string;
  status: AnnouncementStatusInput;
  title: string;
  updatedAt: string;
};

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
  translationsJson: string;
};

type TranslationGlossaryFormState = {
  sourceTerm: string;
  replacementTerm: string;
  note: string;
  isActive: boolean;
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
  popupAccentColor: '#2563eb',
  translationsJson: ''
};

const EMPTY_GLOSSARY_FORM: TranslationGlossaryFormState = {
  sourceTerm: '',
  replacementTerm: '',
  note: '',
  isActive: true
};

const FONT_OPTIONS: Array<{ value: SiteFontFamily; label: string }> = [
  { value: 'system', label: '默认无衬线' },
  { value: 'serif', label: '衬线标题' },
  { value: 'rounded', label: '圆润展示' },
  { value: 'mono', label: '等宽科技' }
];

const COLOR_OPTIONS = ['#2563eb', '#16a34a', '#e11d48', '#f59e0b', '#7c3aed', '#111827'];
const ANNOUNCEMENT_DRAFT_STORAGE_PREFIX = 'merchant-announcement-draft:v1';
const ANNOUNCEMENT_WORKFLOW_STATUS_OPTIONS: Array<{ value: AnnouncementWorkflowStatusFilter; label: string }> = [
  { value: 'all', label: '全部内容' },
  { value: 'published', label: '已发布' },
  { value: 'draft', label: '草稿' },
  { value: 'archived', label: '归档' },
  { value: 'scheduled', label: '定时发布' },
  { value: 'pinned', label: '置顶内容' },
  { value: 'machine_draft', label: '机器翻译待确认' },
  { value: 'human_reviewed', label: '人工已确认' },
  { value: 'locked', label: '已锁定翻译' },
  { value: 'untranslated', label: '缺失翻译' }
];
const ANNOUNCEMENT_WORKFLOW_CATEGORY_OPTIONS: Array<{ value: AnnouncementWorkflowCategoryFilter; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'announcement', label: '平台公告' },
  { value: 'update_log', label: '更新日志' },
  { value: 'usage_guide', label: '使用建议' }
];

export function MerchantAnnouncementsView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [translationGlossaryTerms, setTranslationGlossaryTerms] = useState<TranslationGlossaryTerm[]>([]);
  const [siteContent, setSiteContent] = useState<SiteContentConfig | null>(null);
  const [siteContentForm, setSiteContentForm] = useState<SiteContentFormState>(DEFAULT_SITE_CONTENT_FORM);
  const [glossaryForm, setGlossaryForm] = useState<TranslationGlossaryFormState>(EMPTY_GLOSSARY_FORM);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [announcementTranslationsJson, setAnnouncementTranslationsJson] = useState('');
  const [category, setCategory] = useState<AnnouncementCategory>('announcement');
  const [status, setStatus] = useState<AnnouncementStatusInput>('published');
  const [isPinned, setIsPinned] = useState(false);
  const [scheduledAtInput, setScheduledAtInput] = useState('');
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null);
  const [editingTranslationsJson, setEditingTranslationsJson] = useState('');
  const [editingGlossaryTermId, setEditingGlossaryTermId] = useState<string | null>(null);
  const [savingAnnouncementId, setSavingAnnouncementId] = useState<string | null>(null);
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<string | null>(null);
  const [selectedGlossaryTermId, setSelectedGlossaryTermId] = useState<string | null>(null);
  const [announcementPreviewLanguage, setAnnouncementPreviewLanguage] = useState<TranslationLanguageState>({});
  const [announcementPreviewCache, setAnnouncementPreviewCache] = useState<AnnouncementPreviewCache>({});
  const [editingLanguageByAnnouncementId, setEditingLanguageByAnnouncementId] = useState<TranslationLanguageState>({});
  const [preparingAnnouncementId, setPreparingAnnouncementId] = useState<string | null>(null);
  const [workflowStatusFilter, setWorkflowStatusFilter] = useState<AnnouncementWorkflowStatusFilter>('all');
  const [workflowCategoryFilter, setWorkflowCategoryFilter] = useState<AnnouncementWorkflowCategoryFilter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingSiteContent, setIsSavingSiteContent] = useState(false);
  const [isSavingGlossaryTerm, setIsSavingGlossaryTerm] = useState(false);
  const [hasHydratedAnnouncementDraft, setHasHydratedAnnouncementDraft] = useState(false);
  const [announcementDraftSavedAt, setAnnouncementDraftSavedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const savedDraft = readAnnouncementDraft(username);
    if (savedDraft) {
      setTitle(savedDraft.title);
      setContent(savedDraft.content);
      setAnnouncementTranslationsJson(savedDraft.announcementTranslationsJson);
      setCategory(savedDraft.category);
      setStatus(savedDraft.status);
      setIsPinned(savedDraft.isPinned);
      setScheduledAtInput(savedDraft.scheduledAtInput);
      setAnnouncementDraftSavedAt(savedDraft.updatedAt);
      setMessage('已恢复上次未提交的公告草稿');
    }
    setHasHydratedAnnouncementDraft(true);
  }, [username]);

  useEffect(() => {
    if (!hasHydratedAnnouncementDraft || isSubmitting) {
      return;
    }

    const draft: AnnouncementDraftState = {
      announcementTranslationsJson,
      category,
      content,
      isPinned,
      scheduledAtInput,
      status,
      title,
      updatedAt: new Date().toISOString()
    };

    if (!hasAnnouncementDraftContent(draft)) {
      clearAnnouncementDraft(username);
      setAnnouncementDraftSavedAt(null);
      return;
    }

    saveAnnouncementDraft(username, draft);
    setAnnouncementDraftSavedAt(draft.updatedAt);
  }, [
    announcementTranslationsJson,
    category,
    content,
    hasHydratedAnnouncementDraft,
    isPinned,
    isSubmitting,
    scheduledAtInput,
    status,
    title,
    username
  ]);

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

  const workflowStats = useMemo(() => summarizeAnnouncementWorkflow(announcements), [announcements]);

  const filteredAnnouncements = useMemo(
    () =>
      announcements.filter(
        (announcement) =>
          matchesAnnouncementWorkflowStatus(announcement, workflowStatusFilter) &&
          (workflowCategoryFilter === 'all' || announcement.category === workflowCategoryFilter)
      ),
    [announcements, workflowCategoryFilter, workflowStatusFilter]
  );

  const selectedAnnouncement = useMemo(
    () => announcements.find((announcement) => announcement.id === selectedAnnouncementId) ?? null,
    [announcements, selectedAnnouncementId]
  );
  const selectedGlossaryTerm = useMemo(
    () => translationGlossaryTerms.find((term) => term.id === selectedGlossaryTermId) ?? null,
    [selectedGlossaryTermId, translationGlossaryTerms]
  );

  async function loadData() {
    setIsLoading(true);
    setError('');

    try {
      const [announcementResult, siteContentResult, glossaryResult] = await Promise.all([
        listAnnouncements(),
        getAdminSiteContentConfig(),
        listTranslationGlossaryTerms()
      ]);
      setAnnouncements(announcementResult.items);
      setTranslationGlossaryTerms(glossaryResult.items);
      setSiteContent(siteContentResult);
      setSiteContentForm(toSiteContentForm(siteContentResult));
      syncSelectedAnnouncementFromUrl(announcementResult.items);
      syncSelectedGlossaryTermFromUrl(glossaryResult.items);
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
          popupAccentColor: siteContentForm.popupAccentColor,
          translations: parseTranslationsJson(siteContentForm.translationsJson, '首页与弹窗多语言翻译')
        });
      setSiteContent(config);
      setSiteContentForm(toSiteContentForm(config));
      setMessage('首页与弹窗公告配置已保存');
      replaceArchiveUrl('/merchant/announcements?section=site-content&saved=site-content');
      window.setTimeout(() => {
        document.getElementById('merchant-site-content-saved')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '首页与弹窗公告保存失败');
    } finally {
      setIsSavingSiteContent(false);
    }
  }

  async function handleSaveTranslationGlossaryTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsSavingGlossaryTerm(true);

    try {
      const payload = {
        sourceTerm: glossaryForm.sourceTerm.trim(),
        replacementTerm: glossaryForm.replacementTerm.trim(),
        note: glossaryForm.note.trim() || null,
        isActive: glossaryForm.isActive
      };
      const savedTerm = editingGlossaryTermId
        ? await updateTranslationGlossaryTerm(editingGlossaryTermId, payload)
        : await createTranslationGlossaryTerm(payload);

      setTranslationGlossaryTerms((current) => upsertTranslationGlossaryTerm(current, savedTerm));
      setSelectedGlossaryTermId(savedTerm.id);
      setEditingGlossaryTermId(null);
      setGlossaryForm(EMPTY_GLOSSARY_FORM);
      setMessage(`术语 ${savedTerm.sourceTerm} 已保存`);
      replaceArchiveUrl(`/merchant/announcements?section=glossary&term=${encodeURIComponent(savedTerm.id)}&saved=glossary`);
      window.setTimeout(() => {
        document.getElementById('merchant-translation-glossary-saved')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '翻译术语保存失败');
    } finally {
      setIsSavingGlossaryTerm(false);
    }
  }

  async function handleCreateAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsSubmitting(true);

    try {
      const created = await createAnnouncement({
        title,
        content,
        category,
        status,
        isPinned,
        scheduledAt: toIsoDateTimeOrNull(scheduledAtInput),
        translations: parseTranslationsJson(announcementTranslationsJson, '公告多语言翻译')
      });
      setSelectedAnnouncementId(created.id);
      setMessage(`公告 ${created.title} 已保存`);
      resetAnnouncementDraftForm();
      clearAnnouncementDraft(username);
      setAnnouncementDraftSavedAt(null);
      replaceArchiveUrl(`/merchant/announcements?selected=${encodeURIComponent(created.id)}&saved=announcement`);
      await loadData();
      window.setTimeout(() => {
        document.getElementById('merchant-announcement-saved')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '公告保存失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetAnnouncementDraftForm() {
    setTitle('');
    setContent('');
    setAnnouncementTranslationsJson('');
    setCategory('announcement');
    setStatus('published');
    setIsPinned(false);
    setScheduledAtInput('');
  }

  function clearLocalAnnouncementDraft() {
    resetAnnouncementDraftForm();
    clearAnnouncementDraft(username);
    setAnnouncementDraftSavedAt(null);
    setMessage('本地公告草稿已清空');
    setError('');
  }

  function syncSelectedAnnouncementFromUrl(items: Announcement[]) {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('saved') === 'site-content') {
      setMessage(formatSavedQueryMessage('site-content', ''));
    }

    const selectedId = params.get('selected');
    if (!selectedId) {
      return;
    }

    const selected = items.find((announcement) => announcement.id === selectedId);
    if (!selected) {
      return;
    }

    setSelectedAnnouncementId(selected.id);
    const saved = params.get('saved');
    if (saved) {
      setMessage(formatSavedQueryMessage(saved, selected.title));
    }
  }

  function syncSelectedGlossaryTermFromUrl(items: TranslationGlossaryTerm[]) {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const termId = params.get('term');
    if (!termId) {
      return;
    }

    const selected = items.find((term) => term.id === termId);
    if (!selected) {
      return;
    }

    setSelectedGlossaryTermId(selected.id);
    if (params.get('saved') === 'glossary') {
      setMessage(formatSavedQueryMessage('glossary', selected.sourceTerm));
    }
  }

  function startEditingGlossaryTerm(term: TranslationGlossaryTerm) {
    setEditingGlossaryTermId(term.id);
    setSelectedGlossaryTermId(term.id);
    setGlossaryForm(toGlossaryForm(term));
    setError('');
    setMessage('');
    window.setTimeout(() => {
      document.getElementById('merchant-translation-glossary-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  function startEditingAnnouncementTranslations(announcement: Announcement) {
    const availableLanguages = getTranslationLanguages(announcement.translations);

    setEditingAnnouncementId(announcement.id);
    setEditingTranslationsJson(stringifyTranslations(announcement.translations));
    setEditingLanguageByAnnouncementId((current) => ({
      ...current,
      [announcement.id]: availableLanguages[0] ?? ''
    }));
    setError('');
    setMessage('');
  }

  function updatePreviewLanguage(announcementId: string, language: string) {
    setAnnouncementPreviewLanguage((current) => ({
      ...current,
      [announcementId]: language
    }));
  }

  async function handleAnnouncementPreviewLanguageChange(announcement: Announcement, language: string) {
    updatePreviewLanguage(announcement.id, language);
    await loadAnnouncementPreview(announcement.id, language);
  }

  async function loadAnnouncementPreview(announcementId: string, language: string) {
    if (!language) {
      return;
    }

    setAnnouncementPreviewCache((current) => ({
      ...current,
      [announcementId]: {
        error: '',
        isLoading: true,
        language,
        preview: current[announcementId]?.language === language ? current[announcementId].preview : null
      }
    }));

    try {
      const preview = await previewAnnouncement(announcementId, language);
      setAnnouncementPreviewCache((current) => {
        const currentEntry = current[announcementId];
        if (currentEntry?.language !== language) {
          return current;
        }

        return {
          ...current,
          [announcementId]: {
            error: '',
            isLoading: false,
            language,
            preview
          }
        };
      });
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '公告预览加载失败';
      setAnnouncementPreviewCache((current) => {
        const currentEntry = current[announcementId];
        if (currentEntry?.language !== language) {
          return current;
        }

        return {
          ...current,
          [announcementId]: {
            error: nextMessage,
            isLoading: false,
            language,
            preview: null
          }
        };
      });
    }
  }

  function markEditingLanguageAsReviewedAndLocked(announcement: Announcement, fallbackLanguage?: string) {
    const language = editingLanguageByAnnouncementId[announcement.id] || fallbackLanguage || '';
    if (!language) {
      setError('请选择要确认的语言');
      return;
    }

    try {
      const parsed = parseTranslationsJsonOrDefault(editingTranslationsJson);
      const currentEntry = parsed[language];
      const nextEntry: AnnouncementTranslationRecord = currentEntry && typeof currentEntry === 'object' && !Array.isArray(currentEntry)
        ? { ...(currentEntry as Record<string, string | boolean>) }
        : {};

      nextEntry._status = 'human_reviewed';
      nextEntry._locked = true;
      parsed[language] = nextEntry;

      setEditingTranslationsJson(stringifyTranslations(parsed));
      setMessage(`语言 ${language} 已标记为人工确认并锁定`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '无法更新翻译状态 JSON');
    }
  }

  function updateEditingTranslationRecord(language: string, updates: Partial<Record<'title' | 'content' | '_status' | '_locked', string | boolean>>) {
    if (!language) {
      setError('请选择要编辑的语言');
      return;
    }

    try {
      const parsed = parseTranslationsJsonOrDefault(editingTranslationsJson);
      const currentEntry = parsed[language];
      const nextEntry: AnnouncementTranslationRecord = currentEntry && typeof currentEntry === 'object' && !Array.isArray(currentEntry)
        ? { ...(currentEntry as Record<string, string | boolean>) }
        : {};

      for (const [field, value] of Object.entries(updates)) {
        if (typeof value === 'string' || typeof value === 'boolean') {
          nextEntry[field] = value;
        }
      }
      nextEntry._updatedAt = new Date().toISOString();
      parsed[language] = nextEntry;
      setEditingTranslationsJson(stringifyTranslations(parsed));
      setError('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '无法更新翻译表单');
    }
  }

  async function handlePrepareAnnouncementTranslations(announcement: Announcement) {
    setError('');
    setMessage('');
    setPreparingAnnouncementId(announcement.id);

    try {
      const prepared = await prepareAnnouncementTranslations(announcement.id);
      setAnnouncements((current) => current.map((entry) => (entry.id === prepared.id ? prepared : entry)));
      setSelectedAnnouncementId(prepared.id);
      setEditingAnnouncementId(null);
      setEditingTranslationsJson('');
      const preparedCount = prepared.preparedTranslationLanguages.length;
      const errorCount = prepared.translationErrors.length;
      setMessage(
        `Translation drafts prepared: ${preparedCount} languages${errorCount ? `, ${errorCount} warnings` : ''}`
      );
      replaceArchiveUrl(`/merchant/announcements?selected=${encodeURIComponent(prepared.id)}&saved=translation`);
      window.setTimeout(() => {
        document.getElementById('merchant-announcement-saved')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to prepare translation drafts');
    } finally {
      setPreparingAnnouncementId(null);
    }
  }

  async function handleUpdateAnnouncementTranslations(announcement: Announcement) {
    setError('');
    setMessage('');
    setSavingAnnouncementId(announcement.id);

    try {
      const updated = await updateAnnouncement(announcement.id, {
        translations: parseTranslationsJson(editingTranslationsJson, '公告多语言翻译')
      });
      setAnnouncements((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setSelectedAnnouncementId(updated.id);
      setEditingAnnouncementId(null);
      setEditingTranslationsJson('');
      setMessage(`公告翻译已保存：${updated.title}`);
      replaceArchiveUrl(`/merchant/announcements?selected=${encodeURIComponent(updated.id)}&saved=translation`);
      window.setTimeout(() => {
        document.getElementById('merchant-announcement-saved')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '公告翻译保存失败');
    } finally {
      setSavingAnnouncementId(null);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  function replaceArchiveUrl(url: string) {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', url);
    }
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
            <label className="wide-label">
              多语言翻译 JSON
              <textarea
                onChange={(event) => setSiteContentForm((current) => ({ ...current, translationsJson: event.target.value }))}
                placeholder={`示例：\n{\n  "en-US": {"homeTitle": "Home title", "homeSubtitle": "Subtitle", "homeContent": "Body", "popupTitle": "Popup", "popupContent": "Popup body"},\n  "ja-JP": {"homeTitle": "Temporary Japanese home title"}\n}`}
                rows={8}
                value={siteContentForm.translationsJson}
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
          {siteContent ? (
            <div className="one-time-key-box recharge-code-box" id="merchant-site-content-saved">
              <div>
                <strong>首页与弹窗已保存档案</strong>
                <small>首页标题：{siteContent.home.title || '-'}</small>
                <small>弹窗状态：{siteContent.popup.enabled ? '已开启' : '未开启'}</small>
                <small>弹窗标题：{siteContent.popup.title || '-'}</small>
                <small>翻译语言：{getTranslationLanguages(siteContent.translations).length || 0}</small>
                <small>保存时间：{siteContent.updatedAt ? formatOptionalDate(siteContent.updatedAt) : '暂无'}</small>
              </div>
            </div>
          ) : null}
        </section>

        <section className="admin-panel" id="merchant-translation-glossary">
          <div className="panel-title">
            <BellOutlined />
            <h2>翻译术语表</h2>
          </div>
          <p className="table-note">
            固定品牌词、模型名和产品名。公告发布生成机器草稿时会优先套用这些术语，避免 Azure Planet Relay、VibeCoding 等名称被乱翻。
          </p>
          <form
            className="auth-form compact-form"
            data-qa="merchant-translation-glossary-form"
            id="merchant-translation-glossary-form"
            onSubmit={handleSaveTranslationGlossaryTerm}
          >
            <label>
              原文术语
              <input
                data-qa="merchant-translation-glossary-source"
                maxLength={160}
                onChange={(event) => setGlossaryForm((current) => ({ ...current, sourceTerm: event.target.value }))}
                placeholder="Azure Planet Relay"
                required
                value={glossaryForm.sourceTerm}
              />
            </label>
            <label>
              固定译法/保留词
              <input
                data-qa="merchant-translation-glossary-replacement"
                maxLength={160}
                onChange={(event) => setGlossaryForm((current) => ({ ...current, replacementTerm: event.target.value }))}
                placeholder="Azure Planet Relay"
                required
                value={glossaryForm.replacementTerm}
              />
            </label>
            <label className="wide-label">
              备注
              <textarea
                data-qa="merchant-translation-glossary-note"
                maxLength={500}
                onChange={(event) => setGlossaryForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="例如：品牌名不翻译，所有语言保持英文"
                rows={3}
                value={glossaryForm.note}
              />
            </label>
            <label className="checkbox-label">
              <input
                checked={glossaryForm.isActive}
                data-qa="merchant-translation-glossary-active"
                onChange={(event) => setGlossaryForm((current) => ({ ...current, isActive: event.target.checked }))}
                type="checkbox"
              />
              启用术语
            </label>
            <div className="form-actions-row wide-label">
              <button className="primary-button" data-qa="merchant-translation-glossary-submit" disabled={isSavingGlossaryTerm} type="submit">
                <SendOutlined />
                {isSavingGlossaryTerm ? '保存中...' : editingGlossaryTermId ? '保存术语修改' : '新增术语'}
              </button>
              {editingGlossaryTermId ? (
                <button
                  className="ghost-button"
                  onClick={() => {
                    setEditingGlossaryTermId(null);
                    setGlossaryForm(EMPTY_GLOSSARY_FORM);
                  }}
                  type="button"
                >
                  取消编辑
                </button>
              ) : null}
            </div>
          </form>

          {selectedGlossaryTerm ? (
            <div
              className="one-time-key-box recharge-code-box"
              data-glossary-term-id={selectedGlossaryTerm.id}
              data-qa="merchant-translation-glossary-saved"
              id="merchant-translation-glossary-saved"
            >
              <div>
                <strong>术语已保存档案</strong>
                <small>原文：{selectedGlossaryTerm.sourceTerm}</small>
                <small>固定译法：{selectedGlossaryTerm.replacementTerm}</small>
                <small>状态：{selectedGlossaryTerm.isActive ? '启用' : '停用'}</small>
                <small>备注：{selectedGlossaryTerm.note || '-'}</small>
                <small>更新时间：{formatOptionalDate(selectedGlossaryTerm.updatedAt)}</small>
              </div>
              <button className="ghost-button compact-button" onClick={() => startEditingGlossaryTerm(selectedGlossaryTerm)} type="button">
                继续修改
              </button>
            </div>
          ) : null}

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>原文术语</th>
                  <th>固定译法</th>
                  <th>状态</th>
                  <th>备注</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {translationGlossaryTerms.map((term) => (
                  <tr
                    className={selectedGlossaryTermId === term.id ? 'active-row' : undefined}
                    data-glossary-term-id={term.id}
                    data-qa="merchant-translation-glossary-row"
                    key={term.id}
                  >
                    <td><strong>{term.sourceTerm}</strong></td>
                    <td>{term.replacementTerm}</td>
                    <td>
                      <span className={`status-pill ${term.isActive ? 'status-pill-success' : 'status-pill-muted'}`}>
                        {term.isActive ? '启用' : '停用'}
                      </span>
                    </td>
                    <td>{term.note || '-'}</td>
                    <td>{formatOptionalDate(term.updatedAt)}</td>
                    <td>
                      <button className="ghost-button compact-button" onClick={() => startEditingGlossaryTerm(term)} type="button">
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
                {!translationGlossaryTerms.length && !isLoading ? (
                  <tr>
                    <td colSpan={6}>暂无翻译术语</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="admin-metrics">
          <MetricPanel label="公告总数" value={formatNumber(stats.total)} detail="最近 100 条真实记录" />
          <MetricPanel label="已发布" value={formatNumber(stats.published)} detail="用户首页可见" tone="green" />
          <MetricPanel label="草稿" value={formatNumber(stats.draft)} detail="仅商家端可见" />
          <MetricPanel label="归档" value={formatNumber(stats.archived)} detail="不进入公开首页" tone="red" />
        </section>

        <section className="admin-panel" id="merchant-announcement-saved">
          <div className="panel-title">
            <BellOutlined />
            <h2>公告已保存档案</h2>
          </div>
          {selectedAnnouncement ? (
            <div className="announcement-saved-archive">
              <strong>{selectedAnnouncement.title}</strong>
              <p>{selectedAnnouncement.content}</p>
              <div className="admin-metrics compact-metrics">
                <MetricPanel label="状态" value={formatStatus(selectedAnnouncement.status)} detail={formatAnnouncementCategory(selectedAnnouncement.category)} />
                <MetricPanel
                  label="定时"
                  value={selectedAnnouncement.scheduledAt ? '已设置' : '立即/无'}
                  detail={selectedAnnouncement.scheduledAt ? formatOptionalDate(selectedAnnouncement.scheduledAt) : '未设置定时'}
                />
                <MetricPanel label="置顶" value={selectedAnnouncement.isPinned ? '是' : '否'} detail="公开列表排序" />
                <MetricPanel
                  label="翻译"
                  value={formatNumber(selectedAnnouncement.translationWorkflow?.counts.total ?? 0)}
                  detail={formatTranslationWorkflowCounts(selectedAnnouncement)}
                />
              </div>
              <small className="table-note">
                ID：{selectedAnnouncement.id} · 创建人：{selectedAnnouncement.createdBy ?? selectedAnnouncement.createdByAdminId ?? '-'} · 保存时间：
                {formatOptionalDate(selectedAnnouncement.updatedAt ?? selectedAnnouncement.createdAt)}
              </small>
            </div>
          ) : (
            <p className="empty-state">保存或选择一条公告后，这里会显示状态、定时、置顶和翻译确认档案。</p>
          )}
        </section>

        <section className="admin-grid">
          <section className="admin-panel">
            <div className="panel-title">
              <SendOutlined />
              <h2>发布公告</h2>
            </div>
            <form className="auth-form compact-form" onSubmit={handleCreateAnnouncement}>
              <div className="local-draft-status wide-label" data-announcement-draft-status>
                <strong>本地草稿</strong>
                <span>
                  {announcementDraftSavedAt
                    ? `已自动保存到本机：${formatOptionalDate(announcementDraftSavedAt)}`
                    : '暂无未提交草稿'}
                </span>
                <button
                  className="ghost-button compact-button"
                  data-clear-announcement-draft
                  disabled={!announcementDraftSavedAt}
                  onClick={clearLocalAnnouncementDraft}
                  type="button"
                >
                  清空草稿
                </button>
              </div>
              <label>
                标题
                <input
                  data-announcement-title-input
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
                  data-announcement-content-input
                  maxLength={5000}
                  onChange={(event) => setContent(event.target.value)}
                  required
                  rows={6}
                  value={content}
                />
              </label>
              <label className="wide-label">
                多语言翻译 JSON
                <textarea
                  data-announcement-translations-input
                  onChange={(event) => setAnnouncementTranslationsJson(event.target.value)}
                  placeholder={`示例：\n{\n  "en-US": {"title": "Announcement title", "content": "Announcement body"},\n  "ja-JP": {"title": "Temporary Japanese announcement", "content": "Temporary Japanese body"}\n}`}
                  rows={6}
                  value={announcementTranslationsJson}
                />
              </label>
              <label>
                分类
                <select data-announcement-category-select onChange={(event) => setCategory(event.target.value as AnnouncementCategory)} value={category}>
                  <option value="announcement">平台公告</option>
                  <option value="update_log">更新日志</option>
                  <option value="usage_guide">使用建议</option>
                </select>
              </label>
              <label>
                状态
                <select data-announcement-status-select onChange={(event) => setStatus(event.target.value as AnnouncementStatusInput)} value={status}>
                  <option value="published">发布</option>
                  <option value="draft">草稿</option>
                  <option value="archived">归档</option>
                </select>
              </label>
              <label className="checkbox-label">
                <input data-announcement-pinned-checkbox checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} type="checkbox" />
                置顶公告
              </label>
              <label>
                定时发布时间
                <input data-announcement-scheduled-input onChange={(event) => setScheduledAtInput(event.target.value)} type="datetime-local" value={scheduledAtInput} />
              </label>
              <button className="primary-button" data-announcement-submit-button disabled={isSubmitting} type="submit">
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
            <div className="announcement-workflow-panel" data-announcement-workflow-panel>
              <div className="announcement-workflow-head">
                <div>
                  <strong>内容发布工作流</strong>
                  <small>按草稿、定时、置顶、机器翻译和人工确认状态处理公告。</small>
                </div>
                <span className="announcement-workflow-count" data-announcement-workflow-count>
                  {formatNumber(filteredAnnouncements.length)} / {formatNumber(announcements.length)}
                </span>
              </div>
              <div className="announcement-workflow-filters">
                <label>
                  处理队列
                  <select
                    data-announcement-workflow-status-filter
                    onChange={(event) => setWorkflowStatusFilter(event.target.value as AnnouncementWorkflowStatusFilter)}
                    value={workflowStatusFilter}
                  >
                    {ANNOUNCEMENT_WORKFLOW_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  内容类型
                  <select
                    data-announcement-workflow-category-filter
                    onChange={(event) => setWorkflowCategoryFilter(event.target.value as AnnouncementWorkflowCategoryFilter)}
                    value={workflowCategoryFilter}
                  >
                    {ANNOUNCEMENT_WORKFLOW_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="announcement-workflow-summary">
                <span data-announcement-workflow-machine-draft-count>机器草稿 {formatNumber(workflowStats.machineDraft)}</span>
                <span>人工确认 {formatNumber(workflowStats.humanReviewed)}</span>
                <span>锁定翻译 {formatNumber(workflowStats.locked)}</span>
                <span>定时/置顶 {formatNumber(workflowStats.scheduled)} / {formatNumber(workflowStats.pinned)}</span>
              </div>
            </div>
            <div className="announcement-list">
              {filteredAnnouncements.map((announcement) => {
                const availableLanguages = getAnnouncementTranslationLanguages(announcement);
                const previewLanguageOptions = getPreviewLanguageOptions(availableLanguages);
                const currentPreviewLanguage =
                  announcementPreviewLanguage[announcement.id] &&
                  previewLanguageOptions.some((option) => option.code === announcementPreviewLanguage[announcement.id])
                    ? announcementPreviewLanguage[announcement.id]
                    : availableLanguages[0] ?? 'en-US';
                const serverPreviewEntry =
                  announcementPreviewCache[announcement.id]?.language === currentPreviewLanguage
                    ? announcementPreviewCache[announcement.id]
                    : null;
                const serverPreview = serverPreviewEntry?.preview ?? null;
                const editingLanguages = getTranslationLanguagesFromJson(editingTranslationsJson);
                const editingLanguageOptions = getTranslationEditorLanguageOptions(editingLanguages);
                const editingLanguage = editingLanguageByAnnouncementId[announcement.id] || editingLanguages[0] || editingLanguageOptions[0]?.code || '';
                const editingRecord = getTranslationRecordFromJson(editingTranslationsJson, editingLanguage);
                const editingTranslationTitle = typeof editingRecord?.title === 'string' ? editingRecord.title : '';
                const editingTranslationContent = typeof editingRecord?.content === 'string' ? editingRecord.content : '';
                const editingTranslationStatus = typeof editingRecord?._status === 'string' ? editingRecord._status : 'machine_draft';
                const editingTranslationLocked = editingRecord?._locked === true;
                const editingTranslationSource = typeof editingRecord?._source === 'string' ? editingRecord._source : '-';
                const editingTranslationUpdatedAt = typeof editingRecord?._updatedAt === 'string' ? editingRecord._updatedAt : null;
                const translationForPreview = getTranslationForLanguage(announcement.translations, currentPreviewLanguage);
                const previewTitle =
                  serverPreview?.title ??
                  (typeof translationForPreview?.title === 'string' && translationForPreview.title.length > 0
                    ? translationForPreview.title
                    : announcement.title);
                const previewContent =
                  serverPreview?.content ??
                  (typeof translationForPreview?.content === 'string' && translationForPreview.content.length > 0
                    ? translationForPreview.content
                    : announcement.content);
                const previewStatus = serverPreview ? formatPreviewStatus(serverPreview) : '本地预览，选择语言后同步服务端结果';

                return (
                  <article className="announcement-item" data-announcement-id={announcement.id} key={announcement.id}>
                  <div>
                    <strong>{announcement.title}</strong>
                    <span>{formatAnnouncementCategory(announcement.category)} · {formatStatus(announcement.status)}</span>
                  </div>
                  <p>{announcement.content}</p>
                  <small>
                    {announcement.isPinned ? '置顶' : '未置顶'}
                    {announcement.scheduledAt ? ` · 定时 ${formatOptionalDate(announcement.scheduledAt)}` : ''}
                  </small>
                  <small>
                    {announcement.publishedAt ? `发布时间 ${formatOptionalDate(announcement.publishedAt)}` : '未发布'}
                    {announcement.createdBy ? ` · 创建人 ${announcement.createdBy}` : ''}
                  </small>
                  <div className="announcement-translation-summary">
                    <small className="table-note">
                      {availableLanguages.length === 0 ? '翻译语言：无' : `翻译语言：${availableLanguages.length}`}
                    </small>
                    {availableLanguages.length > 0 ? (
                      <ul className="announcement-translation-summary-list">
                        {availableLanguages.map((language) => {
                          const workflowEntry = getAnnouncementTranslationWorkflowEntry(announcement, language);
                          const status = summarizeTranslationStatus(
                            getTranslationForLanguage(announcement.translations, language),
                            workflowEntry
                          );
                          return (
                            <li
                              data-announcement-workflow-entry
                              data-announcement-workflow-entry-language={language}
                              data-announcement-workflow-entry-locked={status.isLocked ? 'true' : 'false'}
                              data-announcement-workflow-entry-source={status.sourceValue}
                              data-announcement-workflow-entry-status={status.rawStatus}
                              key={language}
                            >
                              <strong>{language}</strong> {status.machineStatus} / {status.humanStatus}
                              {' / '}
                              {status.lockedStatus}
                              <span className="translation-source-badge" data-announcement-workflow-entry-source-label>
                                来源 {status.sourceLabel}
                              </span>
                              <span className="translation-source-badge" data-announcement-workflow-entry-coverage>
                                {formatTranslationCoverage(workflowEntry)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                  <div className="announcement-preview-controls">
                    <label className="wide-label">
                      按语言服务端预览
                      <select
                        data-preview-language-select
                        onChange={(event) => void handleAnnouncementPreviewLanguageChange(announcement, event.target.value)}
                        value={currentPreviewLanguage}
                      >
                        {previewLanguageOptions.map((language) => (
                          <option key={language.code} value={language.code}>
                            {language.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="form-actions-row">
                      <button
                        className="ghost-button compact-button"
                        data-preview-sync-button
                        disabled={serverPreviewEntry?.isLoading === true}
                        onClick={() => void loadAnnouncementPreview(announcement.id, currentPreviewLanguage)}
                        type="button"
                      >
                        <EyeOutlined />
                        {serverPreviewEntry?.isLoading ? '预览中' : '同步预览'}
                      </button>
                      <small className="table-note" data-preview-status>{previewStatus}</small>
                    </div>
                    {serverPreviewEntry?.error ? <small className="form-error">{serverPreviewEntry.error}</small> : null}
                    <div data-preview-title>
                      <strong>标题预览：</strong> {previewTitle}
                    </div>
                    <div data-preview-content>
                      <strong>正文预览：</strong>
                      <p className="table-note" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>
                        {previewContent}
                      </p>
                    </div>
                  </div>
                  <div className="form-actions-row">
                    <button
                      className="ghost-button compact-button"
                      onClick={() => {
                        setSelectedAnnouncementId(announcement.id);
                          replaceArchiveUrl(`/merchant/announcements?selected=${encodeURIComponent(announcement.id)}`);
                        window.setTimeout(() => {
                          document.getElementById('merchant-announcement-saved')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 0);
                      }}
                      type="button"
                    >
                      查看档案
                    </button>
                    <button
                      className="secondary-button"
                      data-translation-prepare-button
                      disabled={preparingAnnouncementId === announcement.id}
                      onClick={() => void handlePrepareAnnouncementTranslations(announcement)}
                      type="button"
                    >
                      {preparingAnnouncementId === announcement.id ? 'Preparing drafts...' : 'Prepare drafts'}
                    </button>
                    <button
                      className="secondary-button"
                      data-translation-edit-button
                      onClick={() =>
                        editingAnnouncementId === announcement.id
                          ? setEditingAnnouncementId(null)
                          : startEditingAnnouncementTranslations(announcement)
                      }
                      type="button"
                    >
                      {editingAnnouncementId === announcement.id ? '取消编辑翻译' : '编辑翻译'}
                    </button>
                  </div>
                  {editingAnnouncementId === announcement.id ? (
                    <div className="announcement-translation-editor">
                      <label className="wide-label">
                        编辑语言
                        <select
                          data-translation-language-select
                          onChange={(event) =>
                            setEditingLanguageByAnnouncementId((current) => ({
                              ...current,
                              [announcement.id]: event.target.value
                            }))
                          }
                          value={editingLanguage}
                        >
                          {editingLanguageOptions.map((language) => (
                            <option key={language.code} value={language.code}>
                              {language.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="announcement-translation-fields" data-translation-form>
                        <label>
                          翻译标题
                          <input
                            data-translation-title-input
                            disabled={!editingLanguage}
                            maxLength={120}
                            onChange={(event) => updateEditingTranslationRecord(editingLanguage, { title: event.target.value })}
                            value={editingTranslationTitle}
                          />
                        </label>
                        <label>
                          确认状态
                          <select
                            data-translation-status-select
                            disabled={!editingLanguage}
                            onChange={(event) => updateEditingTranslationRecord(editingLanguage, { _status: event.target.value })}
                            value={editingTranslationStatus}
                          >
                            <option value="machine_draft">机器草稿</option>
                            <option value="human_reviewed">人工确认</option>
                            <option value="manual_locked">人工锁定</option>
                            <option value="unreviewed">未审阅</option>
                          </select>
                        </label>
                        <label className="wide-label">
                          翻译正文
                          <textarea
                            data-translation-content-input
                            disabled={!editingLanguage}
                            maxLength={5000}
                            onChange={(event) => updateEditingTranslationRecord(editingLanguage, { content: event.target.value })}
                            rows={5}
                            value={editingTranslationContent}
                          />
                        </label>
                        <label className="checkbox-label wide-label">
                          <input
                            checked={editingTranslationLocked}
                            data-translation-locked-checkbox
                            disabled={!editingLanguage}
                            onChange={(event) => updateEditingTranslationRecord(editingLanguage, { _locked: event.target.checked })}
                            type="checkbox"
                          />
                          锁定这条人工翻译，后续机器草稿不覆盖
                        </label>
                        <small className="table-note wide-label" data-translation-editor-meta>
                          来源：{formatTranslationSource(editingTranslationSource)} · 更新时间：
                          {editingTranslationUpdatedAt ? formatOptionalDate(editingTranslationUpdatedAt) : '-'}
                        </small>
                      </div>
                      <textarea
                        data-translation-json-input
                        onChange={(event) => setEditingTranslationsJson(event.target.value)}
                        placeholder={`{\n  "en-US": {"title": "Title", "content": "Content", "_locked": true, "_status": "human_reviewed"}\n}`}
                        rows={7}
                        value={editingTranslationsJson}
                      />
                      <small className="table-note">
                        设置 _locked=true 后，人工翻译不会被自动草稿覆盖。
                      </small>
                      <div className="form-actions-row">
                        <button
                          className="secondary-button"
                          data-translation-lock-button
                          disabled={!editingLanguage}
                          onClick={() => markEditingLanguageAsReviewedAndLocked(announcement, editingLanguage)}
                          type="button"
                        >
                          标记为人工确认并锁定
                        </button>
                        <button
                          className="primary-button"
                          data-translation-save-button
                          disabled={savingAnnouncementId === announcement.id}
                          onClick={() => void handleUpdateAnnouncementTranslations(announcement)}
                          type="button"
                        >
                          {savingAnnouncementId === announcement.id ? '保存中...' : '保存翻译'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
              })}
              {!announcements.length && !isLoading ? <p className="empty-state">暂无真实公告记录</p> : null}
              {announcements.length > 0 && filteredAnnouncements.length === 0 && !isLoading ? (
                <p className="empty-state">当前筛选没有公告记录</p>
              ) : null}
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
    popupAccentColor: config.popup.accentColor,
    translationsJson: stringifyTranslations(config.translations)
  };
}

function toGlossaryForm(term: TranslationGlossaryTerm): TranslationGlossaryFormState {
  return {
    sourceTerm: term.sourceTerm,
    replacementTerm: term.replacementTerm,
    note: term.note ?? '',
    isActive: term.isActive
  };
}

function upsertTranslationGlossaryTerm(items: TranslationGlossaryTerm[], term: TranslationGlossaryTerm) {
  const existingIndex = items.findIndex((item) => item.id === term.id);
  if (existingIndex === -1) {
    return [term, ...items];
  }

  return items.map((item) => (item.id === term.id ? term : item));
}

function summarizeAnnouncementWorkflow(announcements: Announcement[]) {
  return announcements.reduce(
    (current, announcement) => {
      const counts = announcement.translationWorkflow?.counts;

      return {
        total: current.total + 1,
        scheduled: current.scheduled + (announcement.scheduledAt ? 1 : 0),
        pinned: current.pinned + (announcement.isPinned ? 1 : 0),
        machineDraft: current.machineDraft + (counts?.machineDraft ?? 0),
        humanReviewed: current.humanReviewed + (counts?.humanReviewed ?? 0),
        locked: current.locked + (counts?.locked ?? 0),
        untranslated: current.untranslated + (counts?.untranslated ?? 0)
      };
    },
    {
      total: 0,
      scheduled: 0,
      pinned: 0,
      machineDraft: 0,
      humanReviewed: 0,
      locked: 0,
      untranslated: 0
    }
  );
}

function matchesAnnouncementWorkflowStatus(announcement: Announcement, filter: AnnouncementWorkflowStatusFilter) {
  const counts = announcement.translationWorkflow?.counts;

  if (filter === 'all') {
    return true;
  }
  if (filter === 'published' || filter === 'draft' || filter === 'archived') {
    return announcement.status === filter;
  }
  if (filter === 'scheduled') {
    return Boolean(announcement.scheduledAt);
  }
  if (filter === 'pinned') {
    return announcement.isPinned;
  }
  if (filter === 'machine_draft') {
    return (counts?.machineDraft ?? 0) > 0;
  }
  if (filter === 'human_reviewed') {
    return (counts?.humanReviewed ?? 0) > 0;
  }
  if (filter === 'locked') {
    return (counts?.locked ?? 0) > 0;
  }
  if (filter === 'untranslated') {
    return (counts?.untranslated ?? 0) > 0;
  }

  return false;
}

function getTranslationLanguages(translations: TranslationMap | null | undefined): string[] {
  if (!translations) {
    return [];
  }

  return Object.keys(translations);
}

function getAnnouncementTranslationLanguages(announcement: Announcement): string[] {
  if (announcement.translationWorkflow?.languages?.length) {
    return announcement.translationWorkflow.languages;
  }

  return getTranslationLanguages(announcement.translations);
}

function getPreviewLanguageOptions(availableLanguages: string[]) {
  const available = new Set(availableLanguages);
  const mergedCodes = Array.from(new Set([...supportedLanguages.map((language) => language.code), ...availableLanguages]));

  return mergedCodes.map((code) => {
    const supported = supportedLanguages.find((language) => language.code === code);
    const source = code === 'zh-CN' ? '源文' : available.has(code) ? '已有翻译' : '缺失时回源';
    return {
      code,
      label: `${supported?.label ?? code} (${code} · ${source})`
    };
  });
}

function getAnnouncementTranslationWorkflowEntry(
  announcement: Announcement,
  language: string
): AnnouncementTranslationWorkflowEntry | null {
  return announcement.translationWorkflow?.entries.find((entry) => entry.language === language) ?? null;
}

function getTranslationForLanguage(
  translations: TranslationMap | null | undefined,
  language: string | undefined
): AnnouncementTranslationRecord | null {
  if (!translations || !language) {
    return null;
  }

  const record = translations[language];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  return record as AnnouncementTranslationRecord;
}

function summarizeTranslationStatus(
  translation: AnnouncementTranslationRecord | null,
  workflowEntry: AnnouncementTranslationWorkflowEntry | null
) {
  const status = workflowEntry?.status ?? (typeof translation?.['_status'] === 'string' ? translation._status : '');
  const isLocked = workflowEntry?.locked ?? (translation?.['_locked'] === true);
  const sourceValue =
    workflowEntry?.source ?? (typeof translation?.['_source'] === 'string' && translation._source.trim().length > 0 ? translation._source : '');
  const humanStatus = status === 'human_reviewed' ? '已人工确认' : '未人工确认';
  const machineStatus = formatTranslationMachineStatus(status);

  return {
    humanStatus,
    isLocked,
    machineStatus,
    lockedStatus: isLocked ? '已锁定' : '未锁定',
    rawStatus: status || 'unreviewed',
    sourceLabel: formatTranslationSource(sourceValue),
    sourceValue: sourceValue || 'none'
  };
}

function formatTranslationCoverage(workflowEntry: AnnouncementTranslationWorkflowEntry | null) {
  if (!workflowEntry) {
    return '内容状态未知';
  }
  if (workflowEntry.hasTitle && workflowEntry.hasContent) {
    return '标题/正文完整';
  }
  if (!workflowEntry.hasTitle && !workflowEntry.hasContent) {
    return '缺少标题/正文';
  }
  return workflowEntry.hasTitle ? '缺少正文' : '缺少标题';
}

function formatTranslationSource(source: string) {
  if (!source) {
    return '无来源记录';
  }
  if (source === 'google-public') {
    return 'Google 自动草稿';
  }
  if (source === 'source_fallback_draft') {
    return '源文草稿';
  }
  if (source === 'provider_disabled') {
    return '翻译服务关闭';
  }
  if (source === 'provider_not_configured') {
    return '翻译服务未配置';
  }
  return source;
}

function formatTranslationWorkflowCounts(announcement: Announcement) {
  const counts = announcement.translationWorkflow?.counts;
  if (!counts) {
    return '机器草稿 0 / 人工确认 0 / 锁定 0';
  }

  return `机器草稿 ${counts.machineDraft} / 人工确认 ${counts.humanReviewed} / 锁定 ${counts.locked} / 未翻译 ${counts.untranslated}`;
}

function formatPreviewStatus(preview: AnnouncementPreview) {
  const status = preview.translation.status;
  const parts = [
    preview.fallback ? '服务端缺失翻译，当前回源文' : '服务端翻译命中',
    preview.translation.language ? `语言 ${preview.translation.language}` : '无匹配语言',
    formatTranslationMachineStatus(status),
    preview.translation.locked ? '已锁定' : '未锁定'
  ];

  return parts.join(' / ');
}

function formatTranslationMachineStatus(status: string) {
  if (status === 'human_reviewed') {
    return '人工';
  }
  if (status === 'manual_locked') {
    return '人工锁定';
  }
  if (status === 'machine_draft') {
    return '机器草稿';
  }
  if (status === 'unreviewed') {
    return '未审阅';
  }
  if (!status) {
    return '待生成';
  }
  return status;
}

function getTranslationLanguagesFromJson(json: string): string[] {
  try {
    const parsed = parseTranslationsJson(json, '公告多语言翻译');
    return getTranslationLanguages(parsed);
  } catch {
    return [];
  }
}

function getTranslationRecordFromJson(json: string, language: string): AnnouncementTranslationRecord | null {
  if (!language) {
    return null;
  }

  try {
    const parsed = parseTranslationsJson(json, '公告多语言翻译');
    return getTranslationForLanguage(parsed, language);
  } catch {
    return null;
  }
}

function getTranslationEditorLanguageOptions(existingLanguages: string[]) {
  const existing = new Set(existingLanguages);
  const mergedCodes = Array.from(new Set([...supportedLanguages.map((language) => language.code), ...existingLanguages]));

  return mergedCodes.map((code) => {
    const supported = supportedLanguages.find((language) => language.code === code);
    return {
      code,
      label: `${supported?.label ?? code} (${code} · ${existing.has(code) ? '已有翻译' : '可新增'})`
    };
  });
}

function parseTranslationsJsonOrDefault(value: string): TranslationMap {
  return parseTranslationsJson(value, '公告多语言翻译') ?? {};
}

function parseTranslationsJson(value: string, label: string): TranslationMap | null {
  const text = value.trim();
  if (!text) {
    return null;
  }

  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label}必须是 JSON 对象`);
  }

  return parsed as TranslationMap;
}

function announcementDraftStorageKey(username: string) {
  return `${ANNOUNCEMENT_DRAFT_STORAGE_PREFIX}:${username || 'merchant'}`;
}

function readAnnouncementDraft(username: string): AnnouncementDraftState | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawDraft = window.localStorage.getItem(announcementDraftStorageKey(username));
    if (!rawDraft) {
      return null;
    }
    return normalizeAnnouncementDraft(JSON.parse(rawDraft) as unknown);
  } catch {
    clearAnnouncementDraft(username);
    return null;
  }
}

function saveAnnouncementDraft(username: string, draft: AnnouncementDraftState) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(announcementDraftStorageKey(username), JSON.stringify(draft));
  } catch {
    // Local draft persistence is a convenience layer; backend save remains authoritative.
  }
}

function clearAnnouncementDraft(username: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(announcementDraftStorageKey(username));
  } catch {
    // Ignore browser storage failures.
  }
}

function normalizeAnnouncementDraft(value: unknown): AnnouncementDraftState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const draft = value as Record<string, unknown>;
  const category = typeof draft.category === 'string' && isAnnouncementCategory(draft.category)
    ? draft.category
    : 'announcement';
  const status = typeof draft.status === 'string' && isAnnouncementStatusInput(draft.status)
    ? draft.status
    : 'published';
  const normalized: AnnouncementDraftState = {
    announcementTranslationsJson: typeof draft.announcementTranslationsJson === 'string' ? draft.announcementTranslationsJson : '',
    category,
    content: typeof draft.content === 'string' ? draft.content : '',
    isPinned: draft.isPinned === true,
    scheduledAtInput: typeof draft.scheduledAtInput === 'string' ? draft.scheduledAtInput : '',
    status,
    title: typeof draft.title === 'string' ? draft.title : '',
    updatedAt: typeof draft.updatedAt === 'string' ? draft.updatedAt : new Date().toISOString()
  };

  return hasAnnouncementDraftContent(normalized) ? normalized : null;
}

function hasAnnouncementDraftContent(draft: AnnouncementDraftState) {
  return Boolean(
    draft.title.trim() ||
      draft.content.trim() ||
      draft.announcementTranslationsJson.trim() ||
      draft.category !== 'announcement' ||
      draft.status !== 'published' ||
      draft.isPinned ||
      draft.scheduledAtInput
  );
}

function isAnnouncementCategory(value: string): value is AnnouncementCategory {
  return value === 'announcement' || value === 'update_log' || value === 'usage_guide';
}

function isAnnouncementStatusInput(value: string): value is AnnouncementStatusInput {
  return value === 'draft' || value === 'published' || value === 'archived';
}

function stringifyTranslations(value: TranslationMap | null | undefined) {
  return value ? JSON.stringify(value, null, 2) : '';
}

function toIsoDateTimeOrNull(value: string) {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
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

function formatSavedQueryMessage(saved: string, title: string) {
  if (saved === 'translation') {
    return `公告翻译已保存：${title}`;
  }
  if (saved === 'glossary') {
    return `翻译术语已保存：${title}`;
  }
  if (saved === 'site-content') {
    return '首页与弹窗公告配置已保存';
  }
  return `公告 ${title} 已保存`;
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
