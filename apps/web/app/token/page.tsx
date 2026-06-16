'use client';

import {
  CopyOutlined,
  DeleteOutlined,
  KeyOutlined,
  ReloadOutlined,
  StopOutlined,
  SyncOutlined
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { getProfile, type AvailableModel } from '../lib/auth-api';
import {
  createToken,
  deleteToken,
  disableToken,
  listTokens,
  resetToken,
  type ApiToken
} from '../lib/token-api';

type OneTimeKey = {
  tokenId: string;
  tokenName: string;
  apiKey: string;
};

export default function TokenPage() {
  const router = useRouter();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [oneTimeKey, setOneTimeKey] = useState<OneTimeKey | null>(null);
  const [name, setName] = useState('');
  const [quotaCents, setQuotaCents] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');
  const [modelNames, setModelNames] = useState<string[]>([]);
  const [rateLimitRequestsPerMinute, setRateLimitRequestsPerMinute] = useState('');
  const [modelRateLimitRequestsPerMinute, setModelRateLimitRequestsPerMinute] = useState('');
  const [ipRateLimitRequestsPerMinute, setIpRateLimitRequestsPerMinute] = useState('');
  const [ipWhitelist, setIpWhitelist] = useState('');
  const [activationTtlMinutes, setActivationTtlMinutes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [busyTokenId, setBusyTokenId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadTokenPage();
  }, []);

  const tokenStats = useMemo(() => {
    const activeCount = tokens.filter((token) => getTokenEffectiveState(token).state === 'active').length;
    const disabledCount = tokens.filter((token) => token.status === 'disabled').length;
    return { activeCount, disabledCount };
  }, [tokens]);

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

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    const quotaValue = normalizeQuotaCents(quotaCents);
    if (quotaValue instanceof Error) {
      setError(quotaValue.message);
      return;
    }

    const tokenLimitValue = normalizePositiveInteger(rateLimitRequestsPerMinute, '令牌每分钟请求数');
    if (tokenLimitValue instanceof Error) {
      setError(tokenLimitValue.message);
      return;
    }

    const modelLimitValue = normalizePositiveInteger(modelRateLimitRequestsPerMinute, '单模型每分钟请求数');
    if (modelLimitValue instanceof Error) {
      setError(modelLimitValue.message);
      return;
    }

    const ipLimitValue = normalizePositiveInteger(ipRateLimitRequestsPerMinute, '单 IP 每分钟请求数');
    if (ipLimitValue instanceof Error) {
      setError(ipLimitValue.message);
      return;
    }

    const activationTtlValue = normalizePositiveInteger(activationTtlMinutes, '首次激活有效分钟数');
    if (activationTtlValue instanceof Error) {
      setError(activationTtlValue.message);
      return;
    }

    setIsCreating(true);

    try {
      const result = await createToken({
        name: name.trim(),
        quotaCents: quotaValue,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        note: note.trim() || undefined,
        modelNames,
        rateLimitRequestsPerMinute: tokenLimitValue,
        modelRateLimitRequestsPerMinute: modelLimitValue,
        ipRateLimitRequestsPerMinute: ipLimitValue,
        ipWhitelist: normalizeIpWhitelistInput(ipWhitelist),
        activationTtlSeconds: activationTtlValue === undefined ? undefined : activationTtlValue * 60
      });

      setOneTimeKey({
        tokenId: result.token.id,
        tokenName: result.token.name,
        apiKey: result.apiKey
      });
      setName('');
      setQuotaCents('');
      setExpiresAt('');
      setNote('');
      setModelNames([]);
      setRateLimitRequestsPerMinute('');
      setModelRateLimitRequestsPerMinute('');
      setIpRateLimitRequestsPerMinute('');
      setIpWhitelist('');
      setActivationTtlMinutes('');
      setMessage('令牌已创建，请立即保存明文 API Key');
      await loadTokenPage();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '创建令牌失败');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDisable(tokenId: string) {
    setError('');
    setMessage('');
    setBusyTokenId(tokenId);

    try {
      await disableToken(tokenId);
      setMessage('令牌已禁用');
      await loadTokenPage();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '禁用令牌失败');
    } finally {
      setBusyTokenId('');
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
      setMessage('令牌已重置，请立即保存新的明文 API Key');
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
      setMessage('令牌已删除');
      await loadTokenPage();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '删除令牌失败');
    } finally {
      setBusyTokenId('');
    }
  }

  async function copyApiKey() {
    if (!oneTimeKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(oneTimeKey.apiKey);
      setMessage('API Key 已复制');
    } catch {
      setError('复制失败，请手动选中 API Key');
    }
  }

  return (
    <main className="account-page">
      <header className="topbar">
        <Link className="auth-brand compact" href="/">
          <span className="shell-logo-mark">R</span>
          <span>Relay Console</span>
        </Link>
        <div className="admin-top-actions">
          <Link className="ghost-button" href="/account/profile">
            个人中心
          </Link>
          <button className="ghost-button" disabled={isLoading} onClick={() => void loadTokenPage()} type="button">
            <ReloadOutlined />
            刷新
          </button>
        </div>
      </header>

      <section className="account-grid">
        <section className="account-panel account-summary">
          <div>
            <p className="eyebrow">API 令牌</p>
            <h1>令牌管理</h1>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadTokenPage()} title="刷新令牌" type="button">
            <ReloadOutlined />
          </button>
        </section>

        <div className="metric-panel">
          <span>令牌总数</span>
          <strong>{tokens.length}</strong>
          <small>不含已删除令牌</small>
        </div>
        <div className="metric-panel">
          <span>可用令牌</span>
          <strong>{tokenStats.activeCount}</strong>
          <small>可用于 API 鉴权</small>
        </div>
        <div className="metric-panel">
          <span>已禁用</span>
          <strong>{tokenStats.disabledCount}</strong>
          <small>不会通过鉴权</small>
        </div>

        {error ? <p className="form-error wide-panel">{error}</p> : null}
        {message ? <p className="form-success wide-panel">{message}</p> : null}

        {oneTimeKey ? (
          <section className="account-panel wide-panel">
            <div className="panel-title">
              <KeyOutlined />
              <h2>一次性 API Key</h2>
            </div>
            <div className="one-time-key-box">
              <div>
                <strong>{oneTimeKey.tokenName}</strong>
                <code>{oneTimeKey.apiKey}</code>
              </div>
              <button className="ghost-button" onClick={() => void copyApiKey()} type="button">
                <CopyOutlined />
                复制
              </button>
            </div>
          </section>
        ) : null}

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <KeyOutlined />
            <h2>创建令牌</h2>
          </div>
          <form className="auth-form token-form" onSubmit={handleCreate}>
            <div className="form-row">
              <label>
                名称
                <input
                  maxLength={80}
                  minLength={2}
                  onChange={(event) => setName(event.target.value)}
                  required
                  type="text"
                  value={name}
                />
              </label>
              <label>
                额度（分，可空）
                <input
                  min={0}
                  onChange={(event) => setQuotaCents(event.target.value)}
                  placeholder="留空表示不设置令牌额度"
                  step={1}
                  type="number"
                  value={quotaCents}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                过期时间
                <input onChange={(event) => setExpiresAt(event.target.value)} type="datetime-local" value={expiresAt} />
              </label>
              <label>
                可用模型
                <select
                  className="multi-select"
                  multiple
                  onChange={(event) =>
                    setModelNames(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))
                  }
                  value={modelNames}
                >
                  {availableModels.map((model) => (
                    <option key={model.model} value={model.model}>
                      {model.displayName ? `${model.model} - ${model.displayName}` : model.model}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                令牌 RPM
                <input
                  min={1}
                  onChange={(event) => setRateLimitRequestsPerMinute(event.target.value)}
                  placeholder="留空表示不限制"
                  step={1}
                  type="number"
                  value={rateLimitRequestsPerMinute}
                />
              </label>
              <label>
                单模型 RPM
                <input
                  min={1}
                  onChange={(event) => setModelRateLimitRequestsPerMinute(event.target.value)}
                  placeholder="留空表示不限制"
                  step={1}
                  type="number"
                  value={modelRateLimitRequestsPerMinute}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                单 IP RPM
                <input
                  min={1}
                  onChange={(event) => setIpRateLimitRequestsPerMinute(event.target.value)}
                  placeholder="留空表示不限制"
                  step={1}
                  type="number"
                  value={ipRateLimitRequestsPerMinute}
                />
              </label>
              <label>
                首次激活有效分钟
                <input
                  min={1}
                  onChange={(event) => setActivationTtlMinutes(event.target.value)}
                  placeholder="留空表示永久"
                  step={1}
                  type="number"
                  value={activationTtlMinutes}
                />
              </label>
            </div>
            <label>
              IP 白名单
              <textarea
                onChange={(event) => setIpWhitelist(event.target.value)}
                placeholder="每行或逗号分隔一个 IP，留空表示不限制"
                rows={3}
                value={ipWhitelist}
              />
            </label>
            <label>
              备注
              <textarea maxLength={240} onChange={(event) => setNote(event.target.value)} rows={3} value={note} />
            </label>
            <button className="primary-button" disabled={isCreating} type="submit">
              <KeyOutlined />
              {isCreating ? '创建中' : '创建令牌'}
            </button>
          </form>
        </section>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <KeyOutlined />
            <h2>令牌列表</h2>
          </div>
          <div className="admin-table-wrap">
            {isLoading ? (
              <p className="empty-state">加载中...</p>
            ) : tokens.length === 0 ? (
              <p className="empty-state">暂无令牌</p>
            ) : (
              <table className="admin-table token-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>Key 预览</th>
                    <th>状态</th>
                    <th>额度</th>
                    <th>模型范围</th>
                    <th>过期时间</th>
                    <th>最近使用</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => (
                    <tr key={token.id}>
                      <td>
                        <strong>{token.name}</strong>
                        {token.note ? <span className="table-note">{token.note}</span> : null}
                        {renderPolicySummary(token)}
                      </td>
                      <td>{token.keyPreview}</td>
                      <td>{renderTokenState(token)}</td>
                      <td>
                        {token.quotaCents === null || token.quotaCents === undefined
                          ? '不限制'
                          : `${formatCents(token.usedCents)} / ${formatCents(token.quotaCents)}`}
                      </td>
                      <td>{token.modelNames.length > 0 ? token.modelNames.join(', ') : '继承分组可用模型'}</td>
                      <td>{formatDateTime(token.expiresAt) ?? '永不过期'}</td>
                      <td>{formatDateTime(token.lastUsedAt) ?? '未使用'}</td>
                      <td>
                        <div className="table-action-row">
                          <button
                            className="ghost-button compact-button"
                            disabled={busyTokenId === token.id || token.status === 'disabled'}
                            onClick={() => void handleDisable(token.id)}
                            type="button"
                          >
                            <StopOutlined />
                            禁用
                          </button>
                          <button
                            className="ghost-button compact-button"
                            disabled={busyTokenId === token.id || getTokenEffectiveState(token).state !== 'active'}
                            title={
                              getTokenEffectiveState(token).state === 'active'
                                ? '重置 API Key'
                                : '当前令牌不可用，请创建新令牌'
                            }
                            onClick={() => void handleReset(token)}
                            type="button"
                          >
                            <SyncOutlined />
                            重置
                          </button>
                          <button
                            className="ghost-button compact-button"
                            disabled={busyTokenId === token.id}
                            onClick={() => void handleDelete(token.id)}
                            type="button"
                          >
                            <DeleteOutlined />
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function normalizeQuotaCents(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 0) {
    return new Error('额度必须是大于等于 0 的整数分');
  }

  return numericValue;
}

function normalizePositiveInteger(value: string, label: string) {
  if (!value.trim()) {
    return undefined;
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1) {
    return new Error(`${label}必须是大于 0 的整数`);
  }

  return numericValue;
}

function normalizeIpWhitelistInput(value: string) {
  return [...new Set(value.split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean))];
}

function renderPolicySummary(token: ApiToken) {
  const parts = [
    token.rateLimitRequestsPerMinute ? `token ${token.rateLimitRequestsPerMinute} RPM` : null,
    token.modelRateLimitRequestsPerMinute ? `model ${token.modelRateLimitRequestsPerMinute} RPM` : null,
    token.ipRateLimitRequestsPerMinute ? `IP ${token.ipRateLimitRequestsPerMinute} RPM` : null,
    (token.ipWhitelist ?? []).length > 0 ? `IP whitelist ${(token.ipWhitelist ?? []).length}` : null,
    token.activationTtlSeconds ? `activation ${formatDuration(token.activationTtlSeconds)}` : null,
    token.activatedAt ? `activated ${formatDateTime(token.activatedAt)}` : null,
    token.activationExpiresAt ? `activation expires ${formatDateTime(token.activationExpiresAt)}` : null
  ].filter((part): part is string => Boolean(part));

  return <span className="table-note">Policy: {parts.length > 0 ? parts.join(' · ') : 'unlimited'}</span>;
}

function formatDuration(seconds: number) {
  if (seconds % 60 === 0) {
    return `${seconds / 60} min`;
  }

  return `${seconds}s`;
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
    return { state: 'active', label: '可用' };
  }

  return { state: token.status, label: token.status };
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : null;
}

function formatCents(value: number) {
  return `${(value / 100).toFixed(2)} 元`;
}
