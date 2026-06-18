'use client';

import {
  CheckCircleOutlined,
  CloudServerOutlined,
  EditOutlined,
  ExperimentOutlined,
  ReloadOutlined,
  SaveOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { MerchantShell } from '../../components/merchant-shell';
import {
  checkUpstreamHealth,
  createUpstreamProvider,
  listUpstreamProviders,
  updateUpstreamProvider,
  type UpstreamProvider
} from '../../lib/admin-api';

type UpstreamKind = 'deepseek' | 'relay';
type ProviderStatus = 'active' | 'disabled';

export function MerchantUpstreamWorkbench({
  activePath,
  kind,
  username,
  role
}: {
  activePath: string;
  kind: UpstreamKind;
  username: string;
  role: string;
}) {
  const router = useRouter();
  const copy = getWorkbenchCopy(kind);
  const [providers, setProviders] = useState<UpstreamProvider[]>([]);
  const [providerName, setProviderName] = useState('');
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>('active');
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [checkingProviderId, setCheckingProviderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadData();
  }, []);

  const visibleProviders = useMemo(
    () => providers.filter((provider) => isProviderInKind(provider, kind)),
    [kind, providers]
  );
  const selectedProvider = useMemo(
    () => visibleProviders.find((provider) => provider.id === selectedProviderId) ?? visibleProviders[0] ?? null,
    [selectedProviderId, visibleProviders]
  );
  const activeProviderCount = visibleProviders.filter((provider) => provider.status === 'active').length;
  const checkedProviderCount = visibleProviders.filter((provider) => provider.healthStatus !== 'unknown').length;
  const unhealthyProviderCount = visibleProviders.filter((provider) => provider.healthStatus === 'unhealthy').length;

  async function loadData() {
    setIsLoading(true);
    setError('');

    try {
      const providerResult = await listUpstreamProviders();
      const nextProviders = providerResult.items;
      setProviders(nextProviders);

      const nextVisibleProviders = nextProviders.filter((provider) => isProviderInKind(provider, kind));
      setSelectedProviderId((current) =>
        current && nextVisibleProviders.some((provider) => provider.id === current)
          ? current
          : nextVisibleProviders[0]?.id ?? null
      );
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '上游配置加载失败';
      setError(nextMessage);
      if (nextMessage.includes('401') || nextMessage.toLowerCase().includes('auth')) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsSaving(true);

    try {
      const basePayload = {
        name: providerName.trim(),
        kind,
        baseUrl: providerBaseUrl.trim(),
        status: providerStatus
      };
      const saved = editingProviderId
        ? await updateUpstreamProvider(editingProviderId, {
            ...basePayload,
            ...(providerApiKey.trim() ? { apiKey: providerApiKey.trim() } : {})
          })
        : await createUpstreamProvider({
            ...basePayload,
            apiKey: providerApiKey.trim()
          });

      setMessage(`${copy.providerName}已保存。下一步请到“模型映射”里把客户模型绑定到这条上游线路。`);
      setSelectedProviderId(saved.id);
      resetForm();
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `${copy.providerName}保存失败`);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCheckProvider(providerId: string) {
    setCheckingProviderId(providerId);
    setError('');
    setMessage('');

    try {
      const result = await checkUpstreamHealth(providerId);
      setMessage(`检查完成：${formatHealth(result.provider.healthStatus)}，${result.provider.lastHealthLatencyMs ?? '-'} 毫秒`);
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '上游检查失败');
    } finally {
      setCheckingProviderId(null);
    }
  }

  function startEditProvider(provider: UpstreamProvider) {
    setEditingProviderId(provider.id);
    setSelectedProviderId(provider.id);
    setProviderName(provider.name);
    setProviderBaseUrl(provider.baseUrl);
    setProviderApiKey('');
    setProviderStatus(provider.status === 'disabled' ? 'disabled' : 'active');
    setMessage('正在修改上游。密钥不填写表示继续使用原来的密钥。');
  }

  function resetForm() {
    setEditingProviderId(null);
    setProviderName('');
    setProviderBaseUrl('');
    setProviderApiKey('');
    setProviderStatus('active');
  }

  return (
    <MerchantShell activePath={activePath} isRefreshing={isLoading} onRefresh={() => void loadData()} role={role} username={username}>
      <section className="admin-content merchant-upstream-page" data-page={`merchant-${kind}-upstream`}>
        <div className="admin-heading merchant-dashboard-heading">
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>{copy.title}</h1>
            <small>{copy.description}</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadData()} title="刷新上游" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="已接入上游" value={formatNumber(visibleProviders.length)} detail={copy.providerName} />
          <MetricPanel label="启用上游" value={formatNumber(activeProviderCount)} detail="可作为模型线路" />
          <MetricPanel label="已检查上游" value={formatNumber(checkedProviderCount)} detail="健康检查记录" />
          <MetricPanel label="异常上游" value={formatNumber(unhealthyProviderCount)} detail="需要检查" />
        </section>

        <section className="admin-grid">
          <section className="admin-panel" id="merchant-upstream-provider-form">
            <div className="panel-title">
              <CloudServerOutlined />
              <h2>{editingProviderId ? `修改${copy.providerName}` : `新增${copy.providerName}`}</h2>
            </div>
            <form className="auth-form" onSubmit={handleSaveProvider}>
              <label>
                上游名称
                <input maxLength={120} onChange={(event) => setProviderName(event.target.value)} placeholder={copy.providerPlaceholder} required value={providerName} />
              </label>
              <label>
                上游地址
                <input onChange={(event) => setProviderBaseUrl(event.target.value)} placeholder={copy.baseUrlPlaceholder} required value={providerBaseUrl} />
              </label>
              <label>
                上游密钥
                <input
                  onChange={(event) => setProviderApiKey(event.target.value)}
                  placeholder={editingProviderId ? '不填写表示继续使用原密钥' : '请输入真实上游密钥'}
                  required={!editingProviderId}
                  type="password"
                  value={providerApiKey}
                />
              </label>
              <label>
                状态
                <select onChange={(event) => setProviderStatus(event.target.value as ProviderStatus)} value={providerStatus}>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </label>
              <div className="form-actions">
                <button className="primary-button" disabled={isSaving} type="submit">
                  <SaveOutlined />
                  {isSaving ? '保存中' : editingProviderId ? '保存修改' : '保存上游'}
                </button>
                {editingProviderId ? (
                  <button className="ghost-button" disabled={isSaving} onClick={resetForm} type="button">
                    取消修改
                  </button>
                ) : null}
              </div>
            </form>
          </section>

          <section className="admin-panel" id="merchant-upstream-provider-list">
            <div className="panel-title">
              <ExperimentOutlined />
              <h2>当前{copy.providerName}</h2>
            </div>
            <div className="admin-table-wrap compact-table">
              <table className="admin-table upstream-workbench-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>地址</th>
                    <th>密钥</th>
                    <th>状态</th>
                    <th>检查</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProviders.map((provider) => (
                    <tr className={selectedProvider?.id === provider.id ? 'active-row' : undefined} key={provider.id}>
                      <td>
                        <strong>{provider.name}</strong>
                        <small className="table-note">{formatKind(provider.kind)}</small>
                      </td>
                      <td>{provider.baseUrl}</td>
                      <td>{provider.apiKeyPreview}</td>
                      <td>{formatStatus(provider.status)}</td>
                      <td>
                        {formatHealth(provider.healthStatus)}
                        <small className="table-note">
                          {provider.lastHealthLatencyMs !== null ? `${provider.lastHealthLatencyMs} 毫秒` : '未检查'}
                        </small>
                      </td>
                      <td>
                        <div className="table-actions">
                          <button className="ghost-button compact-button" onClick={() => setSelectedProviderId(provider.id)} type="button">
                            查看
                          </button>
                          <button className="ghost-button compact-button" onClick={() => startEditProvider(provider)} type="button">
                            <EditOutlined />
                            修改
                          </button>
                          <button
                            className="ghost-button compact-button"
                            disabled={checkingProviderId === provider.id}
                            onClick={() => void handleCheckProvider(provider.id)}
                            type="button"
                          >
                            <ReloadOutlined />
                            检查
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!visibleProviders.length && !isLoading ? (
                    <tr>
                      <td colSpan={6}>暂无{copy.providerName}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <section className="admin-panel" id="merchant-upstream-provider-detail">
          <div className="panel-title">
            <CheckCircleOutlined />
            <h2>上游使用情况</h2>
          </div>
          {selectedProvider ? (
            <div className="config-detail-grid">
              <dl className="config-detail-list">
                <div>
                  <dt>上游名称</dt>
                  <dd>{selectedProvider.name}</dd>
                </div>
                <div>
                  <dt>上游地址</dt>
                  <dd>{selectedProvider.baseUrl}</dd>
                </div>
                <div>
                  <dt>密钥预览</dt>
                  <dd>{selectedProvider.apiKeyPreview}</dd>
                </div>
                <div>
                  <dt>健康状态</dt>
                  <dd>{formatHealth(selectedProvider.healthStatus)}</dd>
                </div>
              </dl>
              <p className="table-note">这里只检查供应商本身。要把它分配给某个模型，请进入“模型映射”。</p>
            </div>
          ) : (
            <p className="table-note">先保存一个真实上游，然后到“模型映射”绑定客户模型。</p>
          )}
        </section>
      </section>
    </MerchantShell>
  );
}

function MetricPanel({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="metric-panel">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}

function isProviderInKind(provider: UpstreamProvider, kind: UpstreamKind) {
  return provider.kind === kind;
}

function getWorkbenchCopy(kind: UpstreamKind) {
  if (kind === 'deepseek') {
    return {
      eyebrow: 'DeepSeek 上游',
      title: 'DeepSeek 上游接入',
      description: '这里只维护 DeepSeek 的上游地址、密钥和健康检查；客户模型先在“模型发布”准备，再到“模型映射”绑定。',
      providerName: 'DeepSeek 上游',
      providerPlaceholder: '例如：DeepSeek 官方线路 1',
      baseUrlPlaceholder: '例如：https://api.deepseek.com'
    };
  }

  return {
    eyebrow: '中转站上游',
    title: '中转站上游接入',
    description: '这里只维护其它中转站的上游地址、密钥和健康检查；客户模型先在“模型发布”准备，再到“模型映射”绑定。',
    providerName: '中转站上游',
    providerPlaceholder: '例如：中转站 1',
    baseUrlPlaceholder: '例如：https://new.aicode.us.com'
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatKind(kind: string) {
  if (kind === 'deepseek') {
    return 'DeepSeek';
  }
  if (kind === 'relay') {
    return '中转站';
  }

  return '未分类';
}

function formatStatus(status: string) {
  if (status === 'active') {
    return '启用';
  }
  if (status === 'disabled') {
    return '停用';
  }

  return status;
}

function formatHealth(status: string) {
  if (status === 'healthy') {
    return '正常';
  }
  if (status === 'unhealthy') {
    return '异常';
  }

  return '未检查';
}
