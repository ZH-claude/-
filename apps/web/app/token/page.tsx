'use client';

import {
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  SyncOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { ConsoleShell } from '../components/console-shell';
import { useI18n } from '../components/language-provider';
import { getProfile, type AvailableModel } from '../lib/auth-api';
import { formatBillingUsd, formatBillingUsdForInput, parseBillingUsdInput } from '../lib/billing-format';
import { applyCopyOverrides, type CopyOverrides } from '../lib/copy-overrides';
import type { LanguageCode } from '../lib/i18n';
import { pageRows, pageTerm } from '../lib/page-copy-terms';
import {
  createToken,
  deleteToken,
  listTokens,
  revealTokenKey,
  resetToken,
  updateToken,
  type ApiToken
} from '../lib/token-api';

type OneTimeKey = {
  tokenId: string;
  tokenName: string;
  apiKey: string;
};

type TokenFilters = {
  name: string;
  model: string;
  status: string;
};

type TokenFormState = {
  name: string;
  quotaBaseTokens: string;
  expiresAt: string;
  modelNames: string[];
  note: string;
};

const defaultFilters: TokenFilters = {
  name: '',
  model: '',
  status: 'all'
};

const emptyTokenForm: TokenFormState = {
  name: '',
  quotaBaseTokens: '',
  expiresAt: '',
  modelNames: [],
  note: ''
};

const pageSizeOptions = [10, 20, 50];
const publicAnthropicBaseUrl = 'https://newaicode.com';
const publicNoProxyHosts = 'newaicode.com,api.newaicode.com,localhost,127.0.0.1,::1';

type TokenCopy = {
  allModels: string;
  allStatuses: string;
  allUsableModels: string;
  batchDeleteConfirm: (count: number) => string;
  batchDeleteFailed: string;
  batchDeleted: string;
  billingMode: string;
  cancel: string;
  close: string;
  copyClaudeConfig: string;
  copyClaudeConfigSuccess: string;
  copyFailed: string;
  copyFullKey: string;
  copyFullKeyFailed: string;
  copiedFullKey: string;
  createToken: string;
  delete: string;
  deleteConfirm: string;
  deleteFailed: string;
  deleted: string;
  deleteSelected: string;
  edit: string;
  editToken: string;
  empty: string;
  export: string;
  filters: {
    model: string;
    name: string;
    namePlaceholder: string;
    status: string;
  };
  form: {
    expiresAt: string;
    models: string;
    name: string;
    namePlaceholder: string;
    note: string;
    notePlaceholder: string;
    quota: string;
    quotaPlaceholder: string;
  };
  loadFailed: string;
  neverExpires: string;
  noLimit: string;
  pageRows: (size: number) => string;
  pagination: (start: number, end: number, total: number) => string;
  quotaLabel: string;
  refresh: string;
  reset: string;
  resetFailed: string;
  resetKey: string;
  resetToken: string;
  resetTokenSuccess: string;
  save: string;
  saveFailed: string;
  saving: string;
  search: string;
  select: string;
  selectToken: (name: string) => string;
  selectTokenFirst: string;
  statusLabels: Record<string, string>;
  table: {
    actions: string;
    availableModels: string;
    billing: string;
    createdAt: string;
    expiresAt: string;
    lastUsedAt: string;
    name: string;
    remainingQuota: string;
    status: string;
    used: string;
  };
  title: string;
  tokenCreated: string;
  tokenUpdated: (name: string) => string;
  multiSelect: string;
  nextPage: string;
  previousPage: string;
  pageSizeAria: string;
};

const TOKEN_COPY = {
  'en-US': {
    allModels: 'All models',
    allStatuses: 'All statuses',
    allUsableModels: 'All available models',
    batchDeleteConfirm: (count) => `Delete the selected ${count} tokens?`,
    batchDeleteFailed: 'Batch delete failed',
    batchDeleted: 'Selected tokens deleted',
    billingMode: 'Usage first',
    cancel: 'Cancel',
    close: 'Close',
    copyClaudeConfig: 'Copy Claude Code config',
    copyClaudeConfigSuccess: 'Claude Code config copied',
    copyFailed: 'Copy failed',
    copyFullKey: 'Copy full key',
    copyFullKeyFailed: 'Copy failed. Reset the token and try again.',
    copiedFullKey: 'Full key copied',
    createToken: 'Create token',
    delete: 'Delete',
    deleteConfirm: 'Delete this token? It can no longer be used for API authentication.',
    deleteFailed: 'Failed to delete token',
    deleted: 'Token deleted',
    deleteSelected: 'Delete selected',
    edit: 'Edit',
    editToken: 'Edit token',
    empty: 'No tokens',
    export: 'Export',
    filters: { model: 'Available model:', name: 'Token name:', namePlaceholder: 'Enter name', status: 'Status:' },
    form: {
      expiresAt: 'Expiration time',
      models: 'Available models',
      name: 'Token name',
      namePlaceholder: 'Enter token name',
      note: 'Note',
      notePlaceholder: 'Optional',
      quota: 'Quota (CNY, optional)',
      quotaPlaceholder: 'Leave blank for unlimited'
    },
    loadFailed: 'Failed to load tokens',
    multiSelect: 'Select',
    neverExpires: 'Never expires',
    nextPage: 'Next page',
    noLimit: 'Unlimited',
    pageRows: (size) => `${size} rows/page`,
    pageSizeAria: 'Rows per page',
    pagination: (start, end, total) => `${start}-${end} of ${total} rows`,
    previousPage: 'Previous page',
    quotaLabel: 'Quota',
    refresh: 'Refresh',
    reset: 'Reset',
    resetFailed: 'Failed to reset token',
    resetKey: 'Reset key',
    resetToken: 'Reset',
    resetTokenSuccess: 'Token reset. The full key is shown only this once.',
    save: 'Save',
    saveFailed: 'Failed to save token',
    saving: 'Saving',
    search: 'Search',
    select: 'Select',
    selectToken: (name) => `Select ${name}`,
    selectTokenFirst: 'Select a token first',
    statusLabels: { active: 'Active', deleted: 'Deleted', disabled: 'Disabled', expired: 'Expired', quota_exhausted: 'Quota exhausted' },
    table: {
      actions: 'Actions',
      availableModels: 'Available models',
      billing: 'Billing',
      createdAt: 'Created',
      expiresAt: 'Expires',
      lastUsedAt: 'Last used',
      name: 'Token name',
      remainingQuota: 'Remaining quota',
      status: 'Status',
      used: 'Used'
    },
    title: 'Token management',
    tokenCreated: 'Token created. The full key is shown only this once.',
    tokenUpdated: (name) => `Token ${name} updated`
  }
} satisfies Record<'en-US', TokenCopy>;

function getTokenCopy(language: LanguageCode) {
  const base = TOKEN_COPY['en-US'];
  if (language === 'en-US') {
    return base;
  }

  return applyCopyOverrides(base, getTokenCopyOverrides(language));
}

function getTokenCopyOverrides(language: LanguageCode): CopyOverrides<TokenCopy> {
  return {
    allModels: pageTerm(language, 'allModels'),
    allStatuses: pageTerm(language, 'allStatuses'),
    allUsableModels: pageTerm(language, 'allUsableModels'),
    batchDeleteConfirm: (count) => `${pageTerm(language, 'deleteSelected')} ${count} ${pageTerm(language, 'token')}?`,
    batchDeleteFailed: `${pageTerm(language, 'delete')} ${pageTerm(language, 'failed')}`,
    batchDeleted: `${pageTerm(language, 'deleteSelected')} ${pageTerm(language, 'deleted')}`,
    cancel: pageTerm(language, 'cancel'),
    close: pageTerm(language, 'close'),
    copyFailed: `${pageTerm(language, 'copy')} ${pageTerm(language, 'failed')}`,
    copyFullKey: `${pageTerm(language, 'copy')} ${pageTerm(language, 'token')}`,
    copyFullKeyFailed: `${pageTerm(language, 'copy')} ${pageTerm(language, 'failed')}`,
    copiedFullKey: `${pageTerm(language, 'token')} ${pageTerm(language, 'copy')}`,
    createToken: pageTerm(language, 'createToken'),
    delete: pageTerm(language, 'delete'),
    deleteConfirm: `${pageTerm(language, 'delete')} ${pageTerm(language, 'token')}?`,
    deleteFailed: `${pageTerm(language, 'delete')} ${pageTerm(language, 'failed')}`,
    deleted: `${pageTerm(language, 'token')} ${pageTerm(language, 'deleted')}`,
    deleteSelected: pageTerm(language, 'deleteSelected'),
    edit: pageTerm(language, 'edit'),
    editToken: pageTerm(language, 'editToken'),
    empty: pageTerm(language, 'emptyTokens'),
    export: pageTerm(language, 'export'),
    filters: {
      model: `${pageTerm(language, 'availableModels')}:`,
      name: `${pageTerm(language, 'name')}:`,
      namePlaceholder: pageTerm(language, 'name'),
      status: `${pageTerm(language, 'status')}:`
    },
    form: {
      expiresAt: pageTerm(language, 'expiresAt'),
      models: pageTerm(language, 'availableModels'),
      name: pageTerm(language, 'name'),
      namePlaceholder: pageTerm(language, 'name'),
      note: pageTerm(language, 'note'),
      notePlaceholder: pageTerm(language, 'noData'),
      quota: pageTerm(language, 'quota'),
      quotaPlaceholder: pageTerm(language, 'noLimit')
    },
    loadFailed: `${pageTerm(language, 'loading')} ${pageTerm(language, 'failed')}`,
    multiSelect: pageTerm(language, 'select'),
    neverExpires: pageTerm(language, 'neverExpires'),
    nextPage: pageTerm(language, 'nextPage'),
    noLimit: pageTerm(language, 'noLimit'),
    pageRows: (size) => pageRows(language, size),
    pageSizeAria: pageTerm(language, 'visibleRows'),
    pagination: (start, end, total) => `${start}-${end} / ${total} ${pageTerm(language, 'visibleRows')}`,
    previousPage: pageTerm(language, 'previousPage'),
    quotaLabel: pageTerm(language, 'quota'),
    refresh: pageTerm(language, 'refresh'),
    reset: pageTerm(language, 'reset'),
    resetFailed: `${pageTerm(language, 'reset')} ${pageTerm(language, 'failed')}`,
    resetKey: pageTerm(language, 'resetKey'),
    resetToken: pageTerm(language, 'reset'),
    resetTokenSuccess: `${pageTerm(language, 'resetKey')} ${pageTerm(language, 'active')}`,
    save: pageTerm(language, 'save'),
    saveFailed: `${pageTerm(language, 'save')} ${pageTerm(language, 'failed')}`,
    saving: pageTerm(language, 'saving'),
    search: pageTerm(language, 'search'),
    select: pageTerm(language, 'select'),
    selectToken: (name) => `${pageTerm(language, 'select')} ${name}`,
    selectTokenFirst: `${pageTerm(language, 'select')} ${pageTerm(language, 'token')}`,
    statusLabels: {
      active: pageTerm(language, 'active'),
      deleted: pageTerm(language, 'deleted'),
      disabled: pageTerm(language, 'disabled'),
      expired: pageTerm(language, 'expired'),
      quota_exhausted: pageTerm(language, 'quota')
    },
    table: {
      actions: pageTerm(language, 'actions'),
      availableModels: pageTerm(language, 'availableModels'),
      billing: pageTerm(language, 'billing'),
      createdAt: pageTerm(language, 'createdAt'),
      expiresAt: pageTerm(language, 'expiresAt'),
      lastUsedAt: pageTerm(language, 'lastUsed'),
      name: pageTerm(language, 'name'),
      remainingQuota: pageTerm(language, 'remainingQuota'),
      status: pageTerm(language, 'status'),
      used: pageTerm(language, 'charged')
    },
    title: pageTerm(language, 'tokenManagement'),
    tokenCreated: `${pageTerm(language, 'token')} ${pageTerm(language, 'active')}`,
    tokenUpdated: (name) => `${pageTerm(language, 'token')} ${name} ${pageTerm(language, 'edit')}`
  };
}

export default function TokenPage() {
  const router = useRouter();
  const { language } = useI18n();
  const copy = getTokenCopy(language);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [oneTimeKey, setOneTimeKey] = useState<OneTimeKey | null>(null);
  const [draftFilters, setDraftFilters] = useState<TokenFilters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<TokenFilters>(defaultFilters);
  const [form, setForm] = useState<TokenFormState>(emptyTokenForm);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | null>(null);
  const [editingTokenId, setEditingTokenId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyTokenId, setBusyTokenId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadTokenPage();
  }, [language]);

  const modelFilterOptions = useMemo(() => {
    const names = [
      ...availableModels.map((model) => model.model),
      ...tokens.flatMap((token) => token.modelNames)
    ];
    return [...new Set(names)].sort((left, right) => left.localeCompare(right));
  }, [availableModels, tokens]);

  const filteredTokens = useMemo(() => {
    return tokens.filter((token) => {
      const state = getTokenEffectiveState(token, copy).state;
      const nameMatched = appliedFilters.name
        ? token.name.toLowerCase().includes(appliedFilters.name.trim().toLowerCase())
        : true;
      const statusMatched = appliedFilters.status === 'all' ? true : state === appliedFilters.status;
      const modelMatched = appliedFilters.model
        ? token.modelNames.length === 0 || token.modelNames.includes(appliedFilters.model)
        : true;
      return nameMatched && statusMatched && modelMatched;
    });
  }, [appliedFilters, copy, tokens]);

  const totalPages = Math.max(1, Math.ceil(filteredTokens.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageTokens = filteredTokens.slice(pageStart, pageStart + pageSize);
  const selectedCount = selectedIds.length;

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  async function loadTokenPage() {
    setIsLoading(true);
    setError('');

    try {
      const [tokenResult, profileResult] = await Promise.all([listTokens(language), getProfile(language)]);
      setTokens(tokenResult.items);
      setAvailableModels(profileResult.user.availableModels);
    } catch {
      setError(copy.loadFailed);
      router.replace('/login');
    } finally {
      setIsLoading(false);
    }
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters(draftFilters);
    setPage(1);
    setSelectedIds([]);
  }

  function resetFilters() {
    setDraftFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    setPage(1);
    setSelectedIds([]);
  }

  function openCreateDialog() {
    setError('');
    setMessage('');
    setDialogMode('create');
    setEditingTokenId('');
    setForm(emptyTokenForm);
  }

  function openEditDialog(token: ApiToken) {
    setError('');
    setMessage('');
    setDialogMode('edit');
    setEditingTokenId(token.id);
    setForm({
      name: token.name,
      quotaBaseTokens: formatBillingUsdForInput(token.quotaCents),
      expiresAt: token.expiresAt && new Date(token.expiresAt) > new Date() ? toDateTimeLocal(token.expiresAt) : '',
      modelNames: token.modelNames,
      note: token.note ?? ''
    });
  }

  function closeDialog() {
    setDialogMode(null);
    setEditingTokenId('');
    setForm(emptyTokenForm);
  }

  async function handleSaveToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    const quotaValue = normalizeQuotaUsd(form.quotaBaseTokens, copy);
    if (quotaValue instanceof Error) {
      setError(quotaValue.message);
      return;
    }

    setIsSaving(true);

    try {
      const payload = {
        name: form.name.trim(),
        quotaCents: quotaValue,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        modelNames: form.modelNames,
        note: form.note.trim()
      };

      if (dialogMode === 'edit') {
        const result = await updateToken(editingTokenId, payload, language);
        setMessage(copy.tokenUpdated(result.token.name));
      } else {
        const result = await createToken(payload, language);
        setOneTimeKey({
          tokenId: result.token.id,
          tokenName: result.token.name,
          apiKey: result.apiKey
        });
        setMessage(copy.tokenCreated);
      }

      closeDialog();
      await loadTokenPage();
    } catch {
      setError(copy.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReset(token: ApiToken) {
    setError('');
    setMessage('');
    setBusyTokenId(token.id);

    try {
      const result = await resetToken(token.id, language);
      setOneTimeKey({
        tokenId: result.token.id,
        tokenName: result.token.name,
        apiKey: result.apiKey
      });
      setMessage(copy.resetTokenSuccess);
      await loadTokenPage();
    } catch {
      setError(copy.resetFailed);
    } finally {
      setBusyTokenId('');
    }
  }

  async function handleDelete(tokenId: string) {
    setError('');
    setMessage('');

    if (!window.confirm(copy.deleteConfirm)) {
      return;
    }

    setBusyTokenId(tokenId);

    try {
      await deleteToken(tokenId, language);
      if (oneTimeKey?.tokenId === tokenId) {
        setOneTimeKey(null);
      }
      setSelectedIds((current) => current.filter((id) => id !== tokenId));
      setMessage(copy.deleted);
      await loadTokenPage();
    } catch {
      setError(copy.deleteFailed);
    } finally {
      setBusyTokenId('');
    }
  }

  async function handleBatchDelete() {
    setError('');
    setMessage('');

    if (selectedIds.length === 0) {
      setError(copy.selectTokenFirst);
      return;
    }

    if (!window.confirm(copy.batchDeleteConfirm(selectedIds.length))) {
      return;
    }

    setBusyTokenId('batch');

    try {
      for (const tokenId of selectedIds) {
        await deleteToken(tokenId, language);
      }
      setOneTimeKey((current) => (current && selectedIds.includes(current.tokenId) ? null : current));
      setSelectedIds([]);
      setMessage(copy.batchDeleted);
      await loadTokenPage();
    } catch {
      setError(copy.batchDeleteFailed);
    } finally {
      setBusyTokenId('');
    }
  }

  async function copyOneTimeKey() {
    if (!oneTimeKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(oneTimeKey.apiKey);
      setMessage(copy.copiedFullKey);
    } catch {
      setError(copy.copyFailed);
    }
  }

  async function copyOneTimeClaudeConfig() {
    if (!oneTimeKey) {
      return;
    }

    const token = tokens.find((entry) => entry.id === oneTimeKey.tokenId);
    await copyClaudeConfig(oneTimeKey.apiKey, token);
  }

  async function copyTokenInfo(token: ApiToken) {
    const fullKey = oneTimeKey?.tokenId === token.id ? oneTimeKey.apiKey : null;
    const text = fullKey ?? (await revealTokenKey(token.id, language)).apiKey;

    try {
      await navigator.clipboard.writeText(text);
      setMessage(copy.copiedFullKey);
    } catch {
      setError(copy.copyFullKeyFailed);
    }
  }

  async function copyClaudeConfigForToken(token: ApiToken) {
    const fullKey = oneTimeKey?.tokenId === token.id ? oneTimeKey.apiKey : null;
    const apiKey = fullKey ?? (await revealTokenKey(token.id, language)).apiKey;
    await copyClaudeConfig(apiKey, token);
  }

  async function copyClaudeConfig(apiKey: string, token?: ApiToken) {
    const model = getClaudeConfigModel(token, availableModels);
    const config = buildClaudeCodePowerShellConfig(apiKey, model);

    try {
      await navigator.clipboard.writeText(config);
      setMessage(copy.copyClaudeConfigSuccess);
    } catch {
      setError(copy.copyFailed);
    }
  }

  function exportTokens() {
    const header = [
      copy.table.name,
      copy.table.billing,
      copy.table.status,
      copy.table.availableModels,
      copy.table.used,
      copy.table.remainingQuota,
      copy.table.createdAt,
      copy.table.lastUsedAt,
      copy.table.expiresAt
    ];
    const rows = filteredTokens.map((token) => [
      token.name,
      copy.billingMode,
      getTokenEffectiveState(token, copy).label,
      formatModelScope(token, copy),
      formatBillingUsd(token.usedCents),
      formatRemainingQuota(token, copy),
      formatDate(token.createdAt, language) ?? '-',
      formatDate(token.lastUsedAt, language) ?? '-',
      formatDate(token.expiresAt, language) ?? copy.neverExpires
    ]);
    const csv = [header, ...rows].map((row) => row.map(quoteCsvCell).join(',')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tokens-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function toggleMultiSelect() {
    setIsMultiSelect((current) => !current);
    setSelectedIds([]);
  }

  function toggleSelected(tokenId: string) {
    setSelectedIds((current) =>
      current.includes(tokenId) ? current.filter((id) => id !== tokenId) : [...current, tokenId]
    );
  }

  return (
    <ConsoleShell activePath="/token" isRefreshing={isLoading} onRefresh={() => void loadTokenPage()}>
      <section className="token-management-page">
        <form className="token-filter-panel" onSubmit={applyFilters}>
          <label>
            {copy.filters.name}
            <input
              onChange={(event) => setDraftFilters((current) => ({ ...current, name: event.target.value }))}
              placeholder={copy.filters.namePlaceholder}
              type="search"
              value={draftFilters.name}
            />
          </label>
          <label>
            {copy.filters.model}
            <select onChange={(event) => setDraftFilters((current) => ({ ...current, model: event.target.value }))} value={draftFilters.model}>
              <option value="">{copy.allModels}</option>
              {modelFilterOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.filters.status}
            <select onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value }))} value={draftFilters.status}>
              <option value="all">{copy.allStatuses}</option>
              <option value="active">{copy.statusLabels.active}</option>
              <option value="disabled">{copy.statusLabels.disabled}</option>
              <option value="expired">{copy.statusLabels.expired}</option>
              <option value="quota_exhausted">{copy.statusLabels.quota_exhausted}</option>
            </select>
          </label>
          <div className="token-filter-actions">
            <button className="ghost-button" onClick={resetFilters} type="button">
              {copy.reset}
            </button>
            <button className="primary-button" type="submit">
              <SearchOutlined />
              {copy.search}
            </button>
          </div>
        </form>

        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}

        {oneTimeKey ? (
          <section className="token-key-banner">
            <div>
              <strong>{oneTimeKey.tokenName}</strong>
              <code>{oneTimeKey.apiKey}</code>
            </div>
            <button className="ghost-button compact-button" onClick={() => void copyOneTimeKey()} type="button">
              <CopyOutlined />
              {copy.copyFullKey}
            </button>
            <button className="ghost-button compact-button" onClick={() => void copyOneTimeClaudeConfig()} type="button">
              <CopyOutlined />
              Claude
            </button>
            <button className="icon-button" onClick={() => setOneTimeKey(null)} title={copy.close} type="button">
              <CloseOutlined />
            </button>
          </section>
        ) : null}

        <section className="token-table-panel">
          <div className="token-table-header">
            <h1>{copy.title}</h1>
            <div className="token-table-toolbar">
              <button className={`ghost-button compact-button ${isMultiSelect ? 'active' : ''}`} onClick={toggleMultiSelect} type="button">
                {copy.multiSelect}
              </button>
              {isMultiSelect ? (
                <button className="ghost-button compact-button" disabled={busyTokenId === 'batch' || selectedCount === 0} onClick={() => void handleBatchDelete()} type="button">
                  <DeleteOutlined />
                  {copy.deleteSelected}
                </button>
              ) : null}
              <button className="ghost-button compact-button" onClick={exportTokens} type="button">
                <DownloadOutlined />
                {copy.export}
              </button>
              <button className="primary-button compact-button" onClick={openCreateDialog} type="button">
                <PlusOutlined />
                {copy.createToken}
              </button>
              <button className="icon-button" disabled={isLoading} onClick={() => void loadTokenPage()} title={copy.refresh} type="button">
                <ReloadOutlined />
              </button>
            </div>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table token-table simple-token-table">
              <thead>
                <tr>
                  {isMultiSelect ? <th>{copy.select}</th> : null}
                  <th>{copy.table.name}</th>
                  <th>{copy.table.billing}</th>
                  <th>{copy.table.status}</th>
                  <th>{copy.table.availableModels}</th>
                  <th>{copy.table.used}</th>
                  <th>{copy.table.remainingQuota}</th>
                  <th>{copy.table.createdAt}</th>
                  <th>{copy.table.lastUsedAt}</th>
                  <th>{copy.table.expiresAt}</th>
                  <th>{copy.table.actions}</th>
                </tr>
              </thead>
              <tbody>
                {pageTokens.map((token) => (
                  <tr key={token.id}>
                    {isMultiSelect ? (
                      <td>
                        <input
                          aria-label={copy.selectToken(token.name)}
                          checked={selectedIds.includes(token.id)}
                          onChange={() => toggleSelected(token.id)}
                          type="checkbox"
                        />
                      </td>
                    ) : null}
                    <td>
                      <strong>{token.name}</strong>
                      <small className="table-note">{token.keyPreview}</small>
                    </td>
                    <td>
                      <span className="status-pill status-pill-warning">{copy.billingMode}</span>
                    </td>
                    <td>{renderTokenState(token, copy)}</td>
                    <td>{renderModelScope(token, copy)}</td>
                    <td>{formatBillingUsd(token.usedCents)}</td>
                    <td>{formatRemainingQuota(token, copy)}</td>
                    <td>{formatDate(token.createdAt, language)}</td>
                    <td>{formatDate(token.lastUsedAt, language) ?? '-'}</td>
                    <td>{formatDate(token.expiresAt, language) ?? copy.neverExpires}</td>
                    <td>
                      <div className="token-icon-actions">
                        <button className="icon-button compact-icon-button" onClick={() => void copyTokenInfo(token)} title={copy.copyFullKey} type="button">
                          <CopyOutlined />
                        </button>
                        <button
                          className="ghost-button compact-button"
                          onClick={() => void copyClaudeConfigForToken(token)}
                          title={copy.copyClaudeConfig}
                          type="button"
                        >
                          Claude
                        </button>
                        <button
                          className="icon-button compact-icon-button"
                          disabled={busyTokenId === token.id}
                          onClick={() => void handleDelete(token.id)}
                          title={copy.delete}
                          type="button"
                        >
                          <DeleteOutlined />
                        </button>
                        <button
                          className="icon-button compact-icon-button"
                          disabled={busyTokenId === token.id || getTokenEffectiveState(token, copy).state !== 'active'}
                          onClick={() => void handleReset(token)}
                          title={copy.resetKey}
                          type="button"
                        >
                          <SyncOutlined />
                        </button>
                        <button className="icon-button compact-icon-button" onClick={() => openEditDialog(token)} title={copy.edit} type="button">
                          <EditOutlined />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!isLoading && pageTokens.length === 0 ? (
                  <tr>
                    <td colSpan={isMultiSelect ? 11 : 10}>{copy.empty}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="token-pagination">
            <span>
              {copy.pagination(filteredTokens.length === 0 ? 0 : pageStart + 1, Math.min(pageStart + pageSize, filteredTokens.length), filteredTokens.length)}
            </span>
            <button className="ghost-button compact-button" disabled={currentPage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">
              {copy.previousPage}
            </button>
            <span className="token-page-number">{currentPage}</span>
            <button className="ghost-button compact-button" disabled={currentPage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} type="button">
              {copy.nextPage}
            </button>
            <select
              aria-label={copy.pageSizeAria}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              value={pageSize}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {copy.pageRows(option)}
                </option>
              ))}
            </select>
          </div>
        </section>

        {dialogMode ? (
          <div className="token-dialog-backdrop" role="presentation">
            <form className="token-dialog" onSubmit={handleSaveToken}>
              <div className="token-dialog-header">
                <h2>{dialogMode === 'edit' ? copy.editToken : copy.createToken}</h2>
                <button className="icon-button" onClick={closeDialog} title={copy.close} type="button">
                  <CloseOutlined />
                </button>
              </div>
              <label>
                {copy.form.name}
                <input
                  maxLength={80}
                  minLength={2}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder={copy.form.namePlaceholder}
                  required
                  value={form.name}
                />
              </label>
              <div className="form-row">
                <label>
                  {copy.form.quota}
                  <input
                    min={0}
                    onChange={(event) => setForm((current) => ({ ...current, quotaBaseTokens: event.target.value }))}
                    placeholder={copy.form.quotaPlaceholder}
                    step={0.000001}
                    type="number"
                    value={form.quotaBaseTokens}
                  />
                </label>
                <label>
                  {copy.form.expiresAt}
                  <input
                    onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))}
                    type="datetime-local"
                    value={form.expiresAt}
                  />
                </label>
              </div>
              <fieldset className="token-model-checkboxes">
                <legend>{copy.form.models}</legend>
                <label>
                  <input
                    checked={form.modelNames.length === 0}
                    onChange={() => setForm((current) => ({ ...current, modelNames: [] }))}
                    type="checkbox"
                  />
                  {copy.allUsableModels}
                </label>
                {availableModels.map((model) => (
                  <label key={model.model}>
                    <input
                      checked={form.modelNames.includes(model.model)}
                      onChange={() => toggleFormModel(model.model)}
                      type="checkbox"
                    />
                    {model.displayName ? `${model.model} - ${model.displayName}` : model.model}
                  </label>
                ))}
              </fieldset>
              <label>
                {copy.form.note}
                <textarea
                  maxLength={240}
                  onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                  placeholder={copy.form.notePlaceholder}
                  rows={3}
                  value={form.note}
                />
              </label>
              <div className="token-dialog-actions">
                <button className="ghost-button" disabled={isSaving} onClick={closeDialog} type="button">
                  {copy.cancel}
                </button>
                <button className="primary-button" disabled={isSaving} type="submit">
                  <SaveOutlined />
                  {isSaving ? copy.saving : copy.save}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </section>
    </ConsoleShell>
  );

  function toggleFormModel(model: string) {
    setForm((current) => ({
      ...current,
      modelNames: current.modelNames.includes(model)
        ? current.modelNames.filter((entry) => entry !== model)
        : [...current.modelNames, model]
    }));
  }
}

function normalizeQuotaUsd(value: string, copy: TokenCopy) {
  return parseBillingUsdInput(value, copy.quotaLabel);
}

function renderTokenState(token: ApiToken, copy: TokenCopy) {
  const effectiveState = getTokenEffectiveState(token, copy);

  if (effectiveState.state === 'active') {
    return <span className="status-pill status-pill-success">{effectiveState.label}</span>;
  }

  if (effectiveState.state === 'disabled' || effectiveState.state === 'expired' || effectiveState.state === 'quota_exhausted') {
    return <span className="status-pill status-pill-danger">{effectiveState.label}</span>;
  }

  return <span className="status-pill status-pill-muted">{effectiveState.label}</span>;
}

function getTokenEffectiveState(token: ApiToken, copy: TokenCopy) {
  if (token.status === 'disabled') {
    return { state: 'disabled', label: copy.statusLabels.disabled };
  }

  if (token.status === 'deleted') {
    return { state: 'deleted', label: copy.statusLabels.deleted };
  }

  if (token.expiresAt && new Date(token.expiresAt) <= new Date()) {
    return { state: 'expired', label: copy.statusLabels.expired };
  }

  if (typeof token.quotaCents === 'number' && token.usedCents >= token.quotaCents) {
    return { state: 'quota_exhausted', label: copy.statusLabels.quota_exhausted };
  }

  if (token.status === 'active') {
    return { state: 'active', label: copy.statusLabels.active };
  }

  return { state: token.status, label: token.status };
}

function renderModelScope(token: ApiToken, copy: TokenCopy) {
  if (token.modelNames.length === 0) {
    return <span className="status-pill status-pill-warning">{copy.noLimit}</span>;
  }

  return (
    <span className="token-model-scope" title={token.modelNames.join(', ')}>
      {token.modelNames.join(', ')}
    </span>
  );
}

function formatModelScope(token: ApiToken, copy: TokenCopy) {
  return token.modelNames.length === 0 ? copy.noLimit : token.modelNames.join(', ');
}

function formatRemainingQuota(token: ApiToken, copy: TokenCopy) {
  if (token.quotaCents === null || token.quotaCents === undefined) {
    return copy.noLimit;
  }

  return formatBillingUsd(Math.max(0, token.quotaCents - token.usedCents));
}

function formatDate(value: string | null | undefined, language: LanguageCode) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function getClaudeConfigModel(token: ApiToken | undefined, availableModels: AvailableModel[]) {
  return token?.modelNames[0] ?? availableModels[0]?.model ?? 'glm5.2';
}

function buildClaudeCodePowerShellConfig(apiKey: string, model: string) {
  const quotedApiKey = quotePowerShellString(apiKey);
  const quotedModel = quotePowerShellString(model);

  return [
    `$env:ANTHROPIC_AUTH_TOKEN=${quotedApiKey}`,
    `$env:ANTHROPIC_BASE_URL=${quotePowerShellString(publicAnthropicBaseUrl)}`,
    `claude --model ${quotedModel}`
  ].join('\n');
}

function quotePowerShellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteCsvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
