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
import { getProfile, type AvailableModel } from '../lib/auth-api';
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

export default function TokenPage() {
  const router = useRouter();
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
  }, []);

  const modelFilterOptions = useMemo(() => {
    const names = [
      ...availableModels.map((model) => model.model),
      ...tokens.flatMap((token) => token.modelNames)
    ];
    return [...new Set(names)].sort((left, right) => left.localeCompare(right));
  }, [availableModels, tokens]);

  const filteredTokens = useMemo(() => {
    return tokens.filter((token) => {
      const state = getTokenEffectiveState(token).state;
      const nameMatched = appliedFilters.name
        ? token.name.toLowerCase().includes(appliedFilters.name.trim().toLowerCase())
        : true;
      const statusMatched = appliedFilters.status === 'all' ? true : state === appliedFilters.status;
      const modelMatched = appliedFilters.model
        ? token.modelNames.length === 0 || token.modelNames.includes(appliedFilters.model)
        : true;
      return nameMatched && statusMatched && modelMatched;
    });
  }, [appliedFilters, tokens]);

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
      const [tokenResult, profileResult] = await Promise.all([listTokens(), getProfile()]);
      setTokens(tokenResult.items);
      setAvailableModels(profileResult.user.availableModels);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '加载令牌失败');
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
      quotaBaseTokens: token.quotaCents === null || token.quotaCents === undefined ? '' : String(token.quotaCents),
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

    const quotaValue = normalizeQuotaBaseTokens(form.quotaBaseTokens);
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
        const result = await updateToken(editingTokenId, payload);
        setMessage(`令牌 ${result.token.name} 已修改`);
      } else {
        const result = await createToken(payload);
        setOneTimeKey({
          tokenId: result.token.id,
          tokenName: result.token.name,
          apiKey: result.apiKey
        });
        setMessage('令牌已新增，完整密钥只显示这一次');
      }

      closeDialog();
      await loadTokenPage();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '令牌保存失败');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReset(token: ApiToken) {
    setError('');
    setMessage('');
    setBusyTokenId(token.id);

    try {
      const result = await resetToken(token.id);
      setOneTimeKey({
        tokenId: result.token.id,
        tokenName: result.token.name,
        apiKey: result.apiKey
      });
      setMessage('令牌已重置，完整密钥只显示这一次');
      await loadTokenPage();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '重置令牌失败');
    } finally {
      setBusyTokenId('');
    }
  }

  async function handleDelete(tokenId: string) {
    setError('');
    setMessage('');

    if (!window.confirm('确认删除这个令牌？删除后不能再用于 API 鉴权。')) {
      return;
    }

    setBusyTokenId(tokenId);

    try {
      await deleteToken(tokenId);
      if (oneTimeKey?.tokenId === tokenId) {
        setOneTimeKey(null);
      }
      setSelectedIds((current) => current.filter((id) => id !== tokenId));
      setMessage('令牌已删除');
      await loadTokenPage();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '删除令牌失败');
    } finally {
      setBusyTokenId('');
    }
  }

  async function handleBatchDelete() {
    setError('');
    setMessage('');

    if (selectedIds.length === 0) {
      setError('请先选择令牌');
      return;
    }

    if (!window.confirm(`确认删除选中的 ${selectedIds.length} 个令牌？`)) {
      return;
    }

    setBusyTokenId('batch');

    try {
      for (const tokenId of selectedIds) {
        await deleteToken(tokenId);
      }
      setOneTimeKey((current) => (current && selectedIds.includes(current.tokenId) ? null : current));
      setSelectedIds([]);
      setMessage('选中令牌已删除');
      await loadTokenPage();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '批量删除失败');
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
      setMessage('完整密钥已复制');
    } catch {
      setError('复制失败，请手动选中');
    }
  }

  async function copyTokenInfo(token: ApiToken) {
    const fullKey = oneTimeKey?.tokenId === token.id ? oneTimeKey.apiKey : null;
    const text = fullKey ?? (await revealTokenKey(token.id)).apiKey;

    try {
      await navigator.clipboard.writeText(text);
      setMessage('完整密钥已复制');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '复制失败，请重置令牌后再复制');
    }
  }

  function exportTokens() {
    const header = ['令牌名称', '计费方式', '状态', '可用模型', '消耗额度', '剩余额度', '创建时间', '最后使用时间', '过期时间'];
    const rows = filteredTokens.map((token) => [
      token.name,
      '按量优先',
      getTokenEffectiveState(token).label,
      formatModelScope(token),
      formatBaseTokens(token.usedCents),
      formatRemainingQuota(token),
      formatDate(token.createdAt) ?? '-',
      formatDate(token.lastUsedAt) ?? '-',
      formatDate(token.expiresAt) ?? '永不过期'
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
            令牌名称：
            <input
              onChange={(event) => setDraftFilters((current) => ({ ...current, name: event.target.value }))}
              placeholder="请输入"
              type="search"
              value={draftFilters.name}
            />
          </label>
          <label>
            可用模型：
            <select onChange={(event) => setDraftFilters((current) => ({ ...current, model: event.target.value }))} value={draftFilters.model}>
              <option value="">全部模型</option>
              {modelFilterOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <label>
            状态：
            <select onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value }))} value={draftFilters.status}>
              <option value="all">全部状态</option>
              <option value="active">正常</option>
              <option value="disabled">已禁用</option>
              <option value="expired">已过期</option>
              <option value="quota_exhausted">额度用尽</option>
            </select>
          </label>
          <div className="token-filter-actions">
            <button className="ghost-button" onClick={resetFilters} type="button">
              重置
            </button>
            <button className="primary-button" type="submit">
              <SearchOutlined />
              查询
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
              复制完整密钥
            </button>
            <button className="icon-button" onClick={() => setOneTimeKey(null)} title="关闭" type="button">
              <CloseOutlined />
            </button>
          </section>
        ) : null}

        <section className="token-table-panel">
          <div className="token-table-header">
            <h1>令牌管理</h1>
            <div className="token-table-toolbar">
              <button className={`ghost-button compact-button ${isMultiSelect ? 'active' : ''}`} onClick={toggleMultiSelect} type="button">
                多选
              </button>
              {isMultiSelect ? (
                <button className="ghost-button compact-button" disabled={busyTokenId === 'batch' || selectedCount === 0} onClick={() => void handleBatchDelete()} type="button">
                  <DeleteOutlined />
                  删除选中
                </button>
              ) : null}
              <button className="ghost-button compact-button" onClick={exportTokens} type="button">
                <DownloadOutlined />
                导出
              </button>
              <button className="primary-button compact-button" onClick={openCreateDialog} type="button">
                <PlusOutlined />
                新增
              </button>
              <button className="icon-button" disabled={isLoading} onClick={() => void loadTokenPage()} title="刷新" type="button">
                <ReloadOutlined />
              </button>
            </div>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table token-table simple-token-table">
              <thead>
                <tr>
                  {isMultiSelect ? <th>选择</th> : null}
                  <th>令牌名称</th>
                  <th>计费方式</th>
                  <th>状态</th>
                  <th>可用模型</th>
                  <th>消耗 token</th>
                  <th>剩余 token</th>
                  <th>创建时间</th>
                  <th>最后使用时间</th>
                  <th>过期时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {pageTokens.map((token) => (
                  <tr key={token.id}>
                    {isMultiSelect ? (
                      <td>
                        <input
                          aria-label={`选择 ${token.name}`}
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
                      <span className="status-pill status-pill-warning">按量优先</span>
                    </td>
                    <td>{renderTokenState(token)}</td>
                    <td>{renderModelScope(token)}</td>
                    <td>{formatBaseTokens(token.usedCents)}</td>
                    <td>{formatRemainingQuota(token)}</td>
                    <td>{formatDate(token.createdAt)}</td>
                    <td>{formatDate(token.lastUsedAt) ?? '-'}</td>
                    <td>{formatDate(token.expiresAt) ?? '永不过期'}</td>
                    <td>
                      <div className="token-icon-actions">
                        <button className="icon-button compact-icon-button" onClick={() => void copyTokenInfo(token)} title="复制完整密钥" type="button">
                          <CopyOutlined />
                        </button>
                        <button
                          className="icon-button compact-icon-button"
                          disabled={busyTokenId === token.id}
                          onClick={() => void handleDelete(token.id)}
                          title="删除"
                          type="button"
                        >
                          <DeleteOutlined />
                        </button>
                        <button
                          className="icon-button compact-icon-button"
                          disabled={busyTokenId === token.id || getTokenEffectiveState(token).state !== 'active'}
                          onClick={() => void handleReset(token)}
                          title="重置密钥"
                          type="button"
                        >
                          <SyncOutlined />
                        </button>
                        <button className="icon-button compact-icon-button" onClick={() => openEditDialog(token)} title="修改" type="button">
                          <EditOutlined />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!isLoading && pageTokens.length === 0 ? (
                  <tr>
                    <td colSpan={isMultiSelect ? 11 : 10}>暂无令牌</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="token-pagination">
            <span>
              第 {filteredTokens.length === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + pageSize, filteredTokens.length)} 条/总共 {filteredTokens.length} 条
            </span>
            <button className="ghost-button compact-button" disabled={currentPage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">
              上一页
            </button>
            <span className="token-page-number">{currentPage}</span>
            <button className="ghost-button compact-button" disabled={currentPage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} type="button">
              下一页
            </button>
            <select
              aria-label="每页条数"
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              value={pageSize}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option} 条/页
                </option>
              ))}
            </select>
          </div>
        </section>

        {dialogMode ? (
          <div className="token-dialog-backdrop" role="presentation">
            <form className="token-dialog" onSubmit={handleSaveToken}>
              <div className="token-dialog-header">
                <h2>{dialogMode === 'edit' ? '修改令牌' : '新增令牌'}</h2>
                <button className="icon-button" onClick={closeDialog} title="关闭" type="button">
                  <CloseOutlined />
                </button>
              </div>
              <label>
                令牌名称
                <input
                  maxLength={80}
                  minLength={2}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="请输入令牌名称"
                  required
                  value={form.name}
                />
              </label>
              <div className="form-row">
                <label>
                  额度（token，可空）
                  <input
                    min={0}
                    onChange={(event) => setForm((current) => ({ ...current, quotaBaseTokens: event.target.value }))}
                    placeholder="留空表示不限制"
                    step={1}
                    type="number"
                    value={form.quotaBaseTokens}
                  />
                </label>
                <label>
                  过期时间
                  <input
                    onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))}
                    type="datetime-local"
                    value={form.expiresAt}
                  />
                </label>
              </div>
              <fieldset className="token-model-checkboxes">
                <legend>可用模型</legend>
                <label>
                  <input
                    checked={form.modelNames.length === 0}
                    onChange={() => setForm((current) => ({ ...current, modelNames: [] }))}
                    type="checkbox"
                  />
                  全部可用模型
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
                备注
                <textarea
                  maxLength={240}
                  onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                  placeholder="可空"
                  rows={3}
                  value={form.note}
                />
              </label>
              <div className="token-dialog-actions">
                <button className="ghost-button" disabled={isSaving} onClick={closeDialog} type="button">
                  取消
                </button>
                <button className="primary-button" disabled={isSaving} type="submit">
                  <SaveOutlined />
                  {isSaving ? '保存中' : '保存'}
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

function normalizeQuotaBaseTokens(value: string) {
  if (!value.trim()) {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 0) {
    return new Error('额度必须是大于等于 0 的 token 整数');
  }

  return numericValue;
}

function renderTokenState(token: ApiToken) {
  const effectiveState = getTokenEffectiveState(token);

  if (effectiveState.state === 'active') {
    return <span className="status-pill status-pill-success">{effectiveState.label}</span>;
  }

  if (effectiveState.state === 'disabled' || effectiveState.state === 'expired' || effectiveState.state === 'quota_exhausted') {
    return <span className="status-pill status-pill-danger">{effectiveState.label}</span>;
  }

  return <span className="status-pill status-pill-muted">{effectiveState.label}</span>;
}

function getTokenEffectiveState(token: ApiToken) {
  if (token.status === 'disabled') {
    return { state: 'disabled', label: '已禁用' };
  }

  if (token.status === 'deleted') {
    return { state: 'deleted', label: '已删除' };
  }

  if (token.expiresAt && new Date(token.expiresAt) <= new Date()) {
    return { state: 'expired', label: '已过期' };
  }

  if (typeof token.quotaCents === 'number' && token.usedCents >= token.quotaCents) {
    return { state: 'quota_exhausted', label: '额度用尽' };
  }

  if (token.status === 'active') {
    return { state: 'active', label: '正常' };
  }

  return { state: token.status, label: token.status };
}

function renderModelScope(token: ApiToken) {
  if (token.modelNames.length === 0) {
    return <span className="status-pill status-pill-warning">无限制</span>;
  }

  return (
    <span className="token-model-scope" title={token.modelNames.join(', ')}>
      {token.modelNames.join(', ')}
    </span>
  );
}

function formatModelScope(token: ApiToken) {
  return token.modelNames.length === 0 ? '无限制' : token.modelNames.join(', ');
}

function formatRemainingQuota(token: ApiToken) {
  if (token.quotaCents === null || token.quotaCents === undefined) {
    return '无限制';
  }

  return formatBaseTokens(Math.max(0, token.quotaCents - token.usedCents));
}

function formatDate(value?: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat('zh-CN', {
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

function formatBaseTokens(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function quoteCsvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
