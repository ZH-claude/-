'use client';

import {
  ApiOutlined,
  CloudServerOutlined,
  ExperimentOutlined,
  LeftOutlined,
  ReloadOutlined,
  RightOutlined,
  SaveOutlined,
  TeamOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { MerchantShell } from '../../components/merchant-shell';
import {
  checkUpstreamHealth,
  createModelPrice,
  createUpstreamModel,
  createUpstreamProvider,
  createUserGroup,
  listModelConfiguration,
  listUpstreamProviders,
  type AdminGroup,
  type AdminModelPrice,
  type UpstreamModelMapping,
  type UpstreamProvider
} from '../../lib/admin-api';
import { logout } from '../../lib/auth-api';

const UPSTREAM_MAPPING_PAGE_LIMIT = 50;
const DEFAULT_UPSTREAM_MODEL_PAGINATION = {
  page: 1,
  limit: UPSTREAM_MAPPING_PAGE_LIMIT,
  total: 0,
  totalPages: 1
};

type PaginationState = typeof DEFAULT_UPSTREAM_MODEL_PAGINATION;

export function MerchantModelConfigView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [models, setModels] = useState<AdminModelPrice[]>([]);
  const [upstreams, setUpstreams] = useState<UpstreamProvider[]>([]);
  const [upstreamModels, setUpstreamModels] = useState<UpstreamModelMapping[]>([]);
  const [upstreamModelPagination, setUpstreamModelPagination] = useState<PaginationState>(
    DEFAULT_UPSTREAM_MODEL_PAGINATION
  );
  const [groupCode, setGroupCode] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupMultiplier, setGroupMultiplier] = useState('1.0000');
  const [groupStatus, setGroupStatus] = useState<'active' | 'disabled'>('active');
  const [modelName, setModelName] = useState('');
  const [modelDisplayName, setModelDisplayName] = useState('');
  const [inputPriceCentsPer1k, setInputPriceCentsPer1k] = useState('0');
  const [outputPriceCentsPer1k, setOutputPriceCentsPer1k] = useState('0');
  const [modelMultiplier, setModelMultiplier] = useState('1.0000');
  const [modelStatus, setModelStatus] = useState<'active' | 'disabled'>('active');
  const [modelGroupIds, setModelGroupIds] = useState<string[]>([]);
  const [upstreamName, setUpstreamName] = useState('');
  const [upstreamBaseUrl, setUpstreamBaseUrl] = useState('');
  const [upstreamApiKey, setUpstreamApiKey] = useState('');
  const [upstreamStatus, setUpstreamStatus] = useState<'active' | 'disabled'>('active');
  const [upstreamModelProviderId, setUpstreamModelProviderId] = useState('');
  const [upstreamPublicModel, setUpstreamPublicModel] = useState('');
  const [upstreamModelName, setUpstreamModelName] = useState('');
  const [upstreamModelStatus, setUpstreamModelStatus] = useState<'active' | 'disabled'>('active');
  const [supportsStream, setSupportsStream] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isGroupSubmitting, setIsGroupSubmitting] = useState(false);
  const [isModelSubmitting, setIsModelSubmitting] = useState(false);
  const [isUpstreamSubmitting, setIsUpstreamSubmitting] = useState(false);
  const [isMappingSubmitting, setIsMappingSubmitting] = useState(false);
  const [isMappingPageLoading, setIsMappingPageLoading] = useState(false);
  const [checkingUpstreamId, setCheckingUpstreamId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadData(1);
  }, []);

  const stats = useMemo(() => {
    return {
      groups: groups.length,
      activeModels: models.filter((entry) => entry.status === 'active').length,
      activeUpstreams: upstreams.filter((entry) => entry.status === 'active').length,
      unhealthyUpstreams: upstreams.filter((entry) => entry.healthStatus === 'unhealthy').length,
      activeMappings: upstreamModels.filter((entry) => entry.status === 'active').length
    };
  }, [groups, models, upstreamModels, upstreams]);

  async function loadData(page = upstreamModelPagination.page) {
    setIsLoading(true);
    setError('');

    try {
      const [upstreamResult, modelConfigResult] = await Promise.all([
        listUpstreamProviders(),
        listModelConfiguration({
          upstreamModelsPage: page,
          upstreamModelsLimit: UPSTREAM_MAPPING_PAGE_LIMIT
        })
      ]);
      setUpstreams(upstreamResult.items);
      applyModelConfiguration(modelConfigResult, upstreamResult.items);
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '模型与上游配置加载失败';
      setError(nextMessage);
      if (nextMessage.includes('401') || nextMessage.toLowerCase().includes('auth')) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  function applyModelConfiguration(
    result: Awaited<ReturnType<typeof listModelConfiguration>>,
    providerOptions = upstreams
  ) {
    setGroups(result.groups);
    setModels(result.models);
    setUpstreamModels(result.upstreamModels);
    setUpstreamModelPagination(result.upstreamModelsPagination);
    setModelGroupIds((current) => keepValidIds(current, result.groups.map((entry) => entry.id), result.groups[0]?.id));
    setUpstreamModelProviderId((current) =>
      keepValidId(current, providerOptions.map((entry) => entry.id), providerOptions[0]?.id)
    );
    setUpstreamPublicModel((current) =>
      keepValidId(current, result.models.map((entry) => entry.model), result.models[0]?.model)
    );
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsGroupSubmitting(true);

    try {
      const created = await createUserGroup({
        code: groupCode,
        name: groupName,
        multiplier: groupMultiplier,
        status: groupStatus
      });
      setGroupCode('');
      setGroupName('');
      setGroupMultiplier('1.0000');
      setGroupStatus('active');
      setMessage(`分组 ${created.code} 已保存`);
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '分组保存失败');
    } finally {
      setIsGroupSubmitting(false);
    }
  }

  async function handleCreateModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!modelGroupIds.length) {
      setError('至少选择一个可见分组');
      return;
    }

    setIsModelSubmitting(true);

    try {
      const created = await createModelPrice({
        model: modelName,
        displayName: modelDisplayName || undefined,
        inputPriceCentsPer1k: Number(inputPriceCentsPer1k),
        outputPriceCentsPer1k: Number(outputPriceCentsPer1k),
        modelMultiplier,
        status: modelStatus,
        groupIds: modelGroupIds
      });
      setModelName('');
      setModelDisplayName('');
      setInputPriceCentsPer1k('0');
      setOutputPriceCentsPer1k('0');
      setModelMultiplier('1.0000');
      setModelStatus('active');
      setMessage(`模型 ${created.model} 已保存，完成上游映射后用户端可见`);
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '模型保存失败');
    } finally {
      setIsModelSubmitting(false);
    }
  }

  async function handleCreateUpstream(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsUpstreamSubmitting(true);

    try {
      const created = await createUpstreamProvider({
        name: upstreamName,
        baseUrl: upstreamBaseUrl,
        apiKey: upstreamApiKey,
        status: upstreamStatus
      });
      setUpstreamName('');
      setUpstreamBaseUrl('');
      setUpstreamApiKey('');
      setUpstreamStatus('active');
      setMessage(`上游 ${created.name} 已保存，页面只显示脱敏密钥`);
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '上游保存失败');
    } finally {
      setIsUpstreamSubmitting(false);
    }
  }

  async function handleCreateUpstreamModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!upstreamModelProviderId || !upstreamPublicModel) {
      setError('请选择上游和公开模型');
      return;
    }

    setIsMappingSubmitting(true);

    try {
      const created = await createUpstreamModel({
        providerId: upstreamModelProviderId,
        publicModel: upstreamPublicModel,
        upstreamModel: upstreamModelName,
        status: upstreamModelStatus,
        supportsStream
      });
      setUpstreamModelName('');
      setUpstreamModelStatus('active');
      setSupportsStream(true);
      setMessage(`映射已保存：${created.publicModel} -> ${created.upstreamModel}`);
      await loadData(1);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '映射保存失败');
    } finally {
      setIsMappingSubmitting(false);
    }
  }

  async function handleCheckUpstream(providerId: string) {
    setError('');
    setMessage('');
    setCheckingUpstreamId(providerId);

    try {
      const result = await checkUpstreamHealth(providerId);
      setUpstreams((current) => current.map((entry) => (entry.id === providerId ? result.provider : entry)));
      setMessage(result.reachable ? '健康检查通过' : `健康检查未通过：${result.provider.lastHealthError ?? '无法连接'}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '健康检查失败');
    } finally {
      setCheckingUpstreamId(null);
    }
  }

  async function handleUpstreamModelPageChange(page: number) {
    setError('');
    setMessage('');
    setIsMappingPageLoading(true);

    try {
      await loadData(page);
    } finally {
      setIsMappingPageLoading(false);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <MerchantShell
      activePath="/merchant/model-config"
      isRefreshing={isLoading}
      onLogout={handleLogout}
      onRefresh={() => void loadData()}
      role={role}
      username={username}
    >
      <section className="admin-content merchant-model-config-page" data-page="merchant-model-config">
        <div className="admin-heading merchant-dashboard-heading">
          <div>
            <p className="eyebrow">商家工作台</p>
            <h1>模型与上游配置</h1>
            <small>分组、价格、上游、映射和健康检查均来自真实数据。</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadData()} title="刷新模型配置" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="分组" value={formatNumber(stats.groups)} detail="真实用户分组" />
          <MetricPanel label="启用模型" value={formatNumber(stats.activeModels)} detail={`全部模型 ${formatNumber(models.length)}`} tone="green" />
          <MetricPanel label="启用上游" value={formatNumber(stats.activeUpstreams)} detail={`异常 ${formatNumber(stats.unhealthyUpstreams)}`} />
          <MetricPanel label="当前页映射" value={formatNumber(stats.activeMappings)} detail={`总映射 ${formatNumber(upstreamModelPagination.total)}`} />
        </section>

        <section className="admin-grid">
          <section className="admin-panel" id="merchant-groups">
            <div className="panel-title">
              <TeamOutlined />
              <h2>分组配置</h2>
            </div>
            <form className="auth-form compact-form" onSubmit={handleCreateGroup}>
              <label>
                分组代码
                <input maxLength={40} minLength={2} onChange={(event) => setGroupCode(event.target.value)} placeholder="例如：贵宾分组" required value={groupCode} />
              </label>
              <label>
                分组名称
                <input maxLength={80} minLength={2} onChange={(event) => setGroupName(event.target.value)} required value={groupName} />
              </label>
              <label>
                分组倍率
                <input max="100" min="0.0001" onChange={(event) => setGroupMultiplier(event.target.value)} required step="0.0001" type="number" value={groupMultiplier} />
              </label>
              <label>
                状态
                <select onChange={(event) => setGroupStatus(event.target.value as 'active' | 'disabled')} value={groupStatus}>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </label>
              <button className="primary-button" disabled={isGroupSubmitting} type="submit">
                <SaveOutlined />
                {isGroupSubmitting ? '保存中' : '保存分组'}
              </button>
            </form>
          </section>

          <section className="admin-panel">
            <div className="panel-title">
              <TeamOutlined />
              <h2>分组状态</h2>
            </div>
            <div className="admin-table-wrap compact-table">
              <table className="admin-table group-status-table">
                <thead>
                  <tr>
                    <th>代码</th>
                    <th>名称</th>
                    <th>倍率</th>
                    <th>状态</th>
                    <th>用户/模型</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr key={group.id}>
                      <td>{group.code}</td>
                      <td>{group.name}</td>
                      <td>{group.multiplier}</td>
                      <td>
                        <span className={`status-pill ${group.status === 'active' ? 'status-pill-success' : 'status-pill-muted'}`}>
                          {formatStatus(group.status)}
                        </span>
                      </td>
                      <td>
                        {group.userCount} / {group.modelAccessCount}
                      </td>
                    </tr>
                  ))}
                  {!groups.length && !isLoading ? (
                    <tr>
                      <td colSpan={5}>暂无真实分组</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <section className="admin-grid">
          <section className="admin-panel" id="merchant-model-prices">
            <div className="panel-title">
              <ApiOutlined />
              <h2>模型价格与授权</h2>
            </div>
            <form className="auth-form compact-form" onSubmit={handleCreateModel}>
              <label>
                公开模型
                <input maxLength={120} minLength={2} onChange={(event) => setModelName(event.target.value)} placeholder="例如：通用模型" required value={modelName} />
              </label>
              <label>
                展示名称
                <input maxLength={120} onChange={(event) => setModelDisplayName(event.target.value)} value={modelDisplayName} />
              </label>
              <div className="form-row">
                <label>
                  输入单价
                  <input min="0" onChange={(event) => setInputPriceCentsPer1k(event.target.value)} required step="1" type="number" value={inputPriceCentsPer1k} />
                </label>
                <label>
                  输出单价
                  <input min="0" onChange={(event) => setOutputPriceCentsPer1k(event.target.value)} required step="1" type="number" value={outputPriceCentsPer1k} />
                </label>
              </div>
              <label>
                模型倍率
                <input max="100" min="0.0001" onChange={(event) => setModelMultiplier(event.target.value)} required step="0.0001" type="number" value={modelMultiplier} />
              </label>
              <label>
                可见分组
                <select className="multi-select" multiple onChange={(event) => setModelGroupIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))} required value={modelGroupIds}>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} ({group.code})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                状态
                <select onChange={(event) => setModelStatus(event.target.value as 'active' | 'disabled')} value={modelStatus}>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </label>
              <button className="primary-button" disabled={isModelSubmitting || !groups.length} type="submit">
                <SaveOutlined />
                {isModelSubmitting ? '保存中' : '保存模型'}
              </button>
            </form>
          </section>

          <section className="admin-panel">
            <div className="panel-title">
              <ApiOutlined />
              <h2>模型列表</h2>
            </div>
            <div className="admin-table-wrap compact-table">
              <table className="admin-table model-table">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>价格</th>
                    <th>分组</th>
                    <th>映射</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => (
                    <tr key={model.id}>
                      <td>
                        <strong>{model.model}</strong>
                        {model.displayName ? <small className="table-note">{model.displayName}</small> : null}
                      </td>
                      <td>
                        {model.inputPriceCentsPer1k}/{model.outputPriceCentsPer1k}
                        <small className="table-note">倍率 {model.modelMultiplier}</small>
                      </td>
                      <td>{model.groups.map((group) => group.code).join(', ') || '-'}</td>
                      <td>{model.upstreamMappings.length}</td>
                      <td>
                        <span className={`status-pill ${model.status === 'active' ? 'status-pill-success' : 'status-pill-muted'}`}>
                          {formatStatus(model.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!models.length && !isLoading ? (
                    <tr>
                      <td colSpan={5}>暂无真实模型</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <section className="admin-grid" id="merchant-upstreams">
          <section className="admin-panel">
            <div className="panel-title">
              <CloudServerOutlined />
              <h2>上游配置</h2>
            </div>
            <form className="auth-form compact-form" onSubmit={handleCreateUpstream}>
              <label>
                名称
                <input maxLength={80} minLength={2} onChange={(event) => setUpstreamName(event.target.value)} required value={upstreamName} />
              </label>
              <label>
                上游地址
                <input maxLength={2048} minLength={8} onChange={(event) => setUpstreamBaseUrl(event.target.value)} placeholder="请输入真实上游地址" required type="url" value={upstreamBaseUrl} />
              </label>
              <label>
                上游密钥
                <input autoComplete="off" maxLength={512} minLength={8} onChange={(event) => setUpstreamApiKey(event.target.value)} required type="password" value={upstreamApiKey} />
              </label>
              <label>
                状态
                <select onChange={(event) => setUpstreamStatus(event.target.value as 'active' | 'disabled')} value={upstreamStatus}>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </label>
              <button className="primary-button" disabled={isUpstreamSubmitting} type="submit">
                <SaveOutlined />
                {isUpstreamSubmitting ? '保存中' : '保存上游'}
              </button>
            </form>
          </section>

          <section className="admin-panel" id="merchant-service-status">
            <div className="panel-title">
              <ExperimentOutlined />
              <h2>健康检查</h2>
            </div>
            <div className="admin-table-wrap compact-table">
              <table className="admin-table upstream-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>上游地址</th>
                    <th>密钥</th>
                    <th>健康状态</th>
                    <th>上次检查</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {upstreams.map((upstream) => (
                    <tr key={upstream.id}>
                      <td>{upstream.name}</td>
                      <td>{upstream.baseUrl}</td>
                      <td>{upstream.apiKeyPreview}</td>
                      <td>
                        <span className={`status-pill ${getHealthClass(upstream.healthStatus)}`}>{formatHealthStatus(upstream.healthStatus)}</span>
                        {upstream.lastHealthError ? <small className="table-note">{upstream.lastHealthError}</small> : null}
                      </td>
                      <td>
                        {formatOptionalDate(upstream.lastHealthCheckAt)}
                        {upstream.lastHealthLatencyMs !== null ? <small className="table-note">{upstream.lastHealthLatencyMs} 毫秒</small> : null}
                      </td>
                      <td>
                        <button className="ghost-button compact-button" disabled={checkingUpstreamId === upstream.id} onClick={() => void handleCheckUpstream(upstream.id)} type="button">
                          <ExperimentOutlined />
                          {checkingUpstreamId === upstream.id ? '检查中' : '检查'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!upstreams.length && !isLoading ? (
                    <tr>
                      <td colSpan={6}>暂无真实上游</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <section className="admin-panel" id="merchant-upstream-models">
          <div className="panel-title">
            <ExperimentOutlined />
            <h2>上游模型映射</h2>
          </div>
          <form className="auth-form mapping-form" onSubmit={handleCreateUpstreamModel}>
            <label>
              上游
              <select onChange={(event) => setUpstreamModelProviderId(event.target.value)} required value={upstreamModelProviderId}>
                <option value="">选择上游</option>
                {upstreams.map((upstream) => (
                  <option key={upstream.id} value={upstream.id}>
                    {upstream.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              公开模型
              <select onChange={(event) => setUpstreamPublicModel(event.target.value)} required value={upstreamPublicModel}>
                <option value="">选择模型</option>
                {models.map((model) => (
                  <option key={model.id} value={model.model}>
                    {model.model}
                  </option>
                ))}
              </select>
            </label>
            <label>
              上游模型
              <input maxLength={120} minLength={2} onChange={(event) => setUpstreamModelName(event.target.value)} placeholder="真实上游模型名称" required value={upstreamModelName} />
            </label>
            <label>
              状态
              <select onChange={(event) => setUpstreamModelStatus(event.target.value as 'active' | 'disabled')} value={upstreamModelStatus}>
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input checked={supportsStream} onChange={(event) => setSupportsStream(event.target.checked)} type="checkbox" />
              支持流式输出
            </label>
            <button className="primary-button" disabled={isMappingSubmitting || !upstreams.length || !models.length} type="submit">
              <SaveOutlined />
              {isMappingSubmitting ? '保存中' : '保存映射'}
            </button>
          </form>

          <div className="admin-table-wrap">
            <table className="admin-table model-table">
              <thead>
                <tr>
                  <th>公开模型</th>
                  <th>上游模型</th>
                  <th>上游</th>
                  <th>状态</th>
                  <th>流式</th>
                </tr>
              </thead>
              <tbody>
                {upstreamModels.map((mapping) => (
                  <tr key={mapping.id}>
                    <td>{mapping.publicModel}</td>
                    <td>{mapping.upstreamModel}</td>
                    <td>
                      {mapping.providerName}
                      <small className="table-note">{formatStatus(mapping.providerStatus)}</small>
                    </td>
                    <td>
                      <span className={`status-pill ${mapping.status === 'active' ? 'status-pill-success' : 'status-pill-muted'}`}>
                        {formatStatus(mapping.status)}
                      </span>
                    </td>
                    <td>{mapping.supportsStream ? '是' : '否'}</td>
                  </tr>
                ))}
                {!upstreamModels.length && !isLoading ? (
                  <tr>
                    <td colSpan={5}>暂无真实上游模型映射</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="table-pagination">
            <span>
              第 {upstreamModelPagination.page} / {upstreamModelPagination.totalPages} 页，共 {upstreamModelPagination.total} 条映射
            </span>
            <div className="pagination-actions">
              <button className="ghost-button compact-button" disabled={isMappingPageLoading || upstreamModelPagination.page <= 1} onClick={() => void handleUpstreamModelPageChange(upstreamModelPagination.page - 1)} type="button">
                <LeftOutlined />
                上一页
              </button>
              <button
                className="ghost-button compact-button"
                disabled={isMappingPageLoading || upstreamModelPagination.page >= upstreamModelPagination.totalPages || upstreamModelPagination.total === 0}
                onClick={() => void handleUpstreamModelPageChange(upstreamModelPagination.page + 1)}
                type="button"
              >
                下一页
                <RightOutlined />
              </button>
            </div>
          </div>
        </section>
      </section>
    </MerchantShell>
  );
}

function MetricPanel({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: 'green' | 'red' }) {
  return (
    <section className="metric-panel">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : undefined}>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}

function keepValidIds(current: string[], validIds: string[], fallback?: string) {
  const validSet = new Set(validIds);
  const filtered = current.filter((id) => validSet.has(id));
  if (filtered.length > 0) {
    return filtered;
  }
  return fallback ? [fallback] : [];
}

function keepValidId(current: string, validIds: string[], fallback?: string) {
  return current && validIds.includes(current) ? current : fallback ?? '';
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

function formatHealthStatus(status: string) {
  if (status === 'healthy') {
    return '正常';
  }

  if (status === 'unhealthy') {
    return '异常';
  }

  return '未检查';
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
