'use client';

import {
  ApiOutlined,
  CloudServerOutlined,
  CloseOutlined,
  EditOutlined,
  ExperimentOutlined,
  LeftOutlined,
  ReloadOutlined,
  RightOutlined,
  SaveOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { MerchantShell } from '../../components/merchant-shell';
import {
  checkUpstreamHealth,
  createModelPrice,
  createUpstreamModel,
  createUpstreamProvider,
  listModelConfiguration,
  listUpstreamProviders,
  updateModelPrice,
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
  const [modelName, setModelName] = useState('');
  const [modelDisplayName, setModelDisplayName] = useState('');
  const [inputPriceCnyPer1k, setInputPriceCnyPer1k] = useState('0.00');
  const [outputPriceCnyPer1k, setOutputPriceCnyPer1k] = useState('0.00');
  const [modelMultiplier, setModelMultiplier] = useState('1.0000');
  const [modelStatus, setModelStatus] = useState<'active' | 'disabled'>('active');
  const [modelGroupIds, setModelGroupIds] = useState<string[]>([]);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [upstreamName, setUpstreamName] = useState('');
  const [upstreamBaseUrl, setUpstreamBaseUrl] = useState('');
  const [upstreamApiKey, setUpstreamApiKey] = useState('');
  const [upstreamStatus, setUpstreamStatus] = useState<'active' | 'disabled'>('active');
  const [upstreamModelProviderId, setUpstreamModelProviderId] = useState('');
  const [upstreamPublicModel, setUpstreamPublicModel] = useState('');
  const [upstreamModelName, setUpstreamModelName] = useState('');
  const [upstreamPriority, setUpstreamPriority] = useState('1');
  const [upstreamTimeoutMs, setUpstreamTimeoutMs] = useState('5000');
  const [upstreamPrompt, setUpstreamPrompt] = useState('');
  const [upstreamModelStatus, setUpstreamModelStatus] = useState<'active' | 'disabled'>('active');
  const [supportsStream, setSupportsStream] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
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
      activeModels: models.filter((entry) => entry.status === 'active').length,
      activeUpstreams: upstreams.filter((entry) => entry.status === 'active').length,
      unhealthyUpstreams: upstreams.filter((entry) => entry.healthStatus === 'unhealthy').length,
      activeMappings: upstreamModels.filter((entry) => entry.status === 'active').length
    };
  }, [models, upstreamModels, upstreams]);
  const editingModel = useMemo(
    () => models.find((entry) => entry.id === editingModelId) ?? null,
    [editingModelId, models]
  );

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
    setModelGroupIds(getDefaultModelGroupIds(result.groups));
    setUpstreamModelProviderId((current) =>
      keepValidId(current, providerOptions.map((entry) => entry.id), providerOptions[0]?.id)
    );
    setUpstreamPublicModel((current) =>
      keepValidId(current, result.models.map((entry) => entry.model), result.models[0]?.model)
    );
  }

  async function handleSaveModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    const nextGroupIds = editingModelId ? modelGroupIds : getDefaultModelGroupIds(groups);
    if (!nextGroupIds.length) {
      setError('系统默认归属还没准备好，请先完成初始化');
      return;
    }

    setIsModelSubmitting(true);

    try {
      const payload = {
        model: modelName,
        displayName: modelDisplayName || undefined,
        inputPriceCentsPer1k: parseCurrencyToCents(inputPriceCnyPer1k, '输入单价', { allowZero: true }),
        outputPriceCentsPer1k: parseCurrencyToCents(outputPriceCnyPer1k, '输出单价', { allowZero: true }),
        modelMultiplier,
        status: modelStatus,
        groupIds: nextGroupIds
      };
      const saved = editingModelId
        ? await updateModelPrice(editingModelId, payload)
        : await createModelPrice(payload);
      resetModelForm();
      setMessage(
        saved.upstreamMappings.length > 0
          ? `模型 ${saved.model} 已保存，用户端可见还要求上游处于启用状态`
          : `模型 ${saved.model} 已保存，还需要在下方绑定上游模型后用户端才可见`
      );
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '模型保存失败');
    } finally {
      setIsModelSubmitting(false);
    }
  }

  function beginEditModel(model: AdminModelPrice) {
    setError('');
    setMessage('');
    setEditingModelId(model.id);
    setModelName(model.model);
    setModelDisplayName(model.displayName ?? '');
    setInputPriceCnyPer1k((model.inputPriceCentsPer1k / 100).toFixed(2));
    setOutputPriceCnyPer1k((model.outputPriceCentsPer1k / 100).toFixed(2));
    setModelMultiplier(model.modelMultiplier);
    setModelStatus(model.status === 'disabled' ? 'disabled' : 'active');
    setModelGroupIds(model.groups.length ? model.groups.map((group) => group.id) : getDefaultModelGroupIds(groups));
    document.getElementById('merchant-model-prices')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetModelForm() {
    setEditingModelId(null);
    setModelName('');
    setModelDisplayName('');
    setInputPriceCnyPer1k('0.00');
    setOutputPriceCnyPer1k('0.00');
    setModelMultiplier('1.0000');
    setModelStatus('active');
    setModelGroupIds(getDefaultModelGroupIds(groups));
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
        priority: Number(upstreamPriority),
        timeoutMs: Number(upstreamTimeoutMs),
        upstreamPrompt: upstreamPrompt.trim() || undefined,
        status: upstreamModelStatus,
        supportsStream
      });
      setUpstreamModelName('');
      setUpstreamPriority('1');
      setUpstreamTimeoutMs('5000');
      setUpstreamPrompt('');
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
            <h1>上游接入与模型发布</h1>
            <small>从这里接入真实上游 API，发布客户可见模型，并完成上游模型绑定。</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadData()} title="刷新模型配置" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="启用模型" value={formatNumber(stats.activeModels)} detail={`全部模型 ${formatNumber(models.length)}`} tone="green" />
          <MetricPanel label="启用上游" value={formatNumber(stats.activeUpstreams)} detail={`异常 ${formatNumber(stats.unhealthyUpstreams)}`} />
          <MetricPanel label="当前页映射" value={formatNumber(stats.activeMappings)} detail={`总映射 ${formatNumber(upstreamModelPagination.total)}`} />
        </section>

        <section className="admin-grid">
          <section className="admin-panel" id="merchant-model-prices">
            <div className="panel-title">
              <ApiOutlined />
              <h2>模型发布</h2>
            </div>
            {editingModel ? (
              <p className="form-note">
                正在修改 {editingModel.model}
                {editingModel.upstreamMappings.length > 0 ? '。已绑定上游后不能直接改公开模型名。' : '。当前未绑定上游，可以修改公开模型名。'}
              </p>
            ) : null}
            <form className="auth-form compact-form" onSubmit={handleSaveModel}>
              <label>
                公开模型
                <input
                  disabled={Boolean(editingModel && editingModel.upstreamMappings.length > 0)}
                  maxLength={120}
                  minLength={2}
                  onChange={(event) => setModelName(event.target.value)}
                  placeholder="例如：gpt-5.5"
                  required
                  value={modelName}
                />
              </label>
              <label>
                展示名称
                <input maxLength={120} onChange={(event) => setModelDisplayName(event.target.value)} value={modelDisplayName} />
              </label>
              <div className="form-row">
                <label>
                  输入单价（人民币 / 1K）
                  <input min="0" onChange={(event) => setInputPriceCnyPer1k(event.target.value)} required step="0.01" type="number" value={inputPriceCnyPer1k} />
                </label>
                <label>
                  输出单价（人民币 / 1K）
                  <input min="0" onChange={(event) => setOutputPriceCnyPer1k(event.target.value)} required step="0.01" type="number" value={outputPriceCnyPer1k} />
                </label>
              </div>
              <label>
                模型倍率
                <input max="100" min="0.0001" onChange={(event) => setModelMultiplier(event.target.value)} required step="0.0001" type="number" value={modelMultiplier} />
              </label>
              <label>
                状态
                <select onChange={(event) => setModelStatus(event.target.value as 'active' | 'disabled')} value={modelStatus}>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </label>
              <div className="form-actions">
                <button className="primary-button" disabled={isModelSubmitting || !modelGroupIds.length} type="submit">
                  <SaveOutlined />
                  {isModelSubmitting ? '保存中' : editingModel ? '保存修改' : '保存模型'}
                </button>
                {editingModel ? (
                  <button className="ghost-button" disabled={isModelSubmitting} onClick={resetModelForm} type="button">
                    <CloseOutlined />
                    取消修改
                  </button>
                ) : null}
              </div>
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
                    <th>映射</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => {
                    const visibleMappingCount = getVisibleMappingCount(model);
                    return (
                      <tr key={model.id}>
                        <td>
                          <strong>{model.model}</strong>
                          {model.displayName ? <small className="table-note">{model.displayName}</small> : null}
                        </td>
                        <td>
                          {formatMoneyPer1k(model.inputPriceCentsPer1k)} / {formatMoneyPer1k(model.outputPriceCentsPer1k)}
                          <small className="table-note">倍率 {model.modelMultiplier}</small>
                        </td>
                        <td>
                          {model.upstreamMappings.length}
                          <small className={`table-note ${visibleMappingCount > 0 ? '' : 'tone-red'}`}>
                            {visibleMappingCount > 0 ? `可见绑定 ${visibleMappingCount}` : '未绑定启用上游，用户端不可见'}
                          </small>
                        </td>
                        <td>
                          <span className={`status-pill ${model.status === 'active' ? 'status-pill-success' : 'status-pill-muted'}`}>
                            {formatStatus(model.status)}
                          </span>
                        </td>
                        <td>
                          <button className="ghost-button compact-button" onClick={() => beginEditModel(model)} type="button">
                            <EditOutlined />
                            修改
                          </button>
                        </td>
                      </tr>
                    );
                  })}
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
              <h2>上游 API 接入</h2>
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
            <h2>上游模型绑定</h2>
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
              线路顺序
              <input max={3} min={1} onChange={(event) => setUpstreamPriority(event.target.value)} required type="number" value={upstreamPriority} />
            </label>
            <label>
              超时时间（毫秒）
              <input max={30000} min={1000} onChange={(event) => setUpstreamTimeoutMs(event.target.value)} required step={500} type="number" value={upstreamTimeoutMs} />
            </label>
            <label className="full-width-field">
              上游附加提示词
              <textarea
                maxLength={4000}
                onChange={(event) => setUpstreamPrompt(event.target.value)}
                placeholder="例如：对外回答模型身份时，按商家发布的公开模型名称回答。"
                rows={4}
                value={upstreamPrompt}
              />
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
                  <th>线路</th>
                  <th>超时</th>
                  <th>附加提示词</th>
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
                    <td>线路 {mapping.priority}</td>
                    <td>{mapping.timeoutMs} ms</td>
                    <td>{formatPromptPreview(mapping.upstreamPrompt)}</td>
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
                    <td colSpan={8}>暂无真实上游模型映射</td>
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

function keepValidId(current: string, validIds: string[], fallback?: string) {
  return current && validIds.includes(current) ? current : fallback ?? '';
}

function getDefaultModelGroupIds(groups: AdminGroup[]) {
  const activeGroups = groups.filter((group) => group.status === 'active').map((group) => group.id);
  return activeGroups.length ? activeGroups : groups.map((group) => group.id);
}

function getVisibleMappingCount(model: AdminModelPrice) {
  return model.upstreamMappings.filter((mapping) => mapping.status === 'active' && mapping.providerStatus === 'active').length;
}

function formatPromptPreview(value: string | null) {
  if (!value) {
    return '-';
  }

  return value.length > 36 ? `${value.slice(0, 36)}...` : value;
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

function formatMoneyPer1k(cents: number | null | undefined) {
  if (cents === null || cents === undefined) {
    return '-';
  }

  return `¥${(cents / 100).toFixed(4)}/1K`;
}

function parseCurrencyToCents(value: string, label: string, options: { allowZero: boolean }) {
  const numericValue = Number(value);
  const cents = Math.round(numericValue * 100);

  if (!Number.isFinite(numericValue) || !Number.isInteger(cents) || cents < 0 || (!options.allowZero && cents === 0)) {
    throw new Error(`${label}必须是${options.allowZero ? '大于等于 0' : '大于 0'}的人民币金额`);
  }

  if (Math.abs(cents / 100 - numericValue) > 0.000001) {
    throw new Error(`${label}最多保留两位小数`);
  }

  return cents;
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
