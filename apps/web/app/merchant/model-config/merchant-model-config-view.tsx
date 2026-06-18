'use client';

import {
  ApiOutlined,
  CloseOutlined,
  EditOutlined,
  EyeOutlined,
  LinkOutlined,
  ReloadOutlined,
  SaveOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { MerchantShell } from '../../components/merchant-shell';
import {
  createModelPrice,
  createUpstreamModel,
  listModelConfiguration,
  listUpstreamProviders,
  updateModelPrice,
  updateUpstreamModel,
  type AdminGroup,
  type AdminModelPrice,
  type UpstreamModelMapping,
  type UpstreamProvider
} from '../../lib/admin-api';
import { logout } from '../../lib/auth-api';

const UPSTREAM_MAPPING_PAGE_LIMIT = 100;
const DEFAULT_MODEL_MULTIPLIER = '1.0000';
const DEFAULT_EXCHANGE_RATE = '7.200000';
const DEFAULT_MARGIN_PERCENT = '10';

type ModelStatus = 'active' | 'disabled';
type PricingMode = 'manual' | 'deepseek_base' | 'relay_price';
type ModelConfigMode = 'publish' | 'routes';

export function MerchantModelConfigView({
  username,
  role,
  mode = 'publish'
}: {
  username: string;
  role: string;
  mode?: ModelConfigMode;
}) {
  const router = useRouter();
  const isRoutesPage = mode === 'routes';
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [models, setModels] = useState<AdminModelPrice[]>([]);
  const [upstreams, setUpstreams] = useState<UpstreamProvider[]>([]);
  const [mappings, setMappings] = useState<UpstreamModelMapping[]>([]);
  const [modelName, setModelName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pricingMode, setPricingMode] = useState<PricingMode>('deepseek_base');
  const [modelMultiplier, setModelMultiplier] = useState(DEFAULT_MODEL_MULTIPLIER);
  const [inputTokensPer1k, setInputTokensPer1k] = useState('1000');
  const [outputTokensPer1k, setOutputTokensPer1k] = useState('1000');
  const [upstreamInputPricePerMillion, setUpstreamInputPricePerMillion] = useState('');
  const [upstreamOutputPricePerMillion, setUpstreamOutputPricePerMillion] = useState('');
  const [upstreamCurrency, setUpstreamCurrency] = useState<'CNY' | 'USD'>('CNY');
  const [upstreamExchangeRate, setUpstreamExchangeRate] = useState(DEFAULT_EXCHANGE_RATE);
  const [marginPercent, setMarginPercent] = useState(DEFAULT_MARGIN_PERCENT);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('active');
  const [modelGroupIds, setModelGroupIds] = useState<string[]>([]);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [mappingProviderId, setMappingProviderId] = useState('');
  const [mappingPublicModel, setMappingPublicModel] = useState('');
  const [mappingUpstreamModel, setMappingUpstreamModel] = useState('');
  const [mappingPriority, setMappingPriority] = useState('1');
  const [mappingTimeoutMs, setMappingTimeoutMs] = useState('5000');
  const [mappingPrompt, setMappingPrompt] = useState('');
  const [mappingStatus, setMappingStatus] = useState<ModelStatus>('active');
  const [mappingSupportsStream, setMappingSupportsStream] = useState(true);
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [selectedMappingId, setSelectedMappingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isModelSaving, setIsModelSaving] = useState(false);
  const [isMappingSaving, setIsMappingSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadData();
  }, []);

  const activeGroupIds = useMemo(
    () => groups.filter((group) => group.status === 'active').map((group) => group.id),
    [groups]
  );
  const editingModel = useMemo(
    () => models.find((model) => model.id === editingModelId) ?? null,
    [editingModelId, models]
  );
  const selectedMapping = useMemo(
    () => mappings.find((mapping) => mapping.id === selectedMappingId) ?? null,
    [mappings, selectedMappingId]
  );
  const stats = useMemo(
    () => ({
      models: models.length,
      activeModels: models.filter((model) => model.status === 'active').length,
      upstreams: upstreams.length,
      activeMappings: mappings.filter((mapping) => mapping.status === 'active' && mapping.providerStatus === 'active').length
    }),
    [mappings, models, upstreams]
  );

  async function loadData() {
    setIsLoading(true);
    setError('');

    try {
      const [providerResult, configResult] = await Promise.all([
        listUpstreamProviders(),
        listModelConfiguration({
          upstreamModelsPage: 1,
          upstreamModelsLimit: UPSTREAM_MAPPING_PAGE_LIMIT
        })
      ]);
      setUpstreams(providerResult.items);
      setGroups(configResult.groups);
      setModels(configResult.models);
      setMappings(configResult.upstreamModels);
      const requestedModel =
        typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('model') ?? '';
      const nextActiveGroupIds = configResult.groups
        .filter((group) => group.status === 'active')
        .map((group) => group.id);
      setModelGroupIds((current) => keepValidIds(current, configResult.groups, nextActiveGroupIds));
      setMappingProviderId((current) => keepValidId(current, providerResult.items.map((provider) => provider.id), providerResult.items[0]?.id));
      setMappingPublicModel((current) =>
        keepValidId(requestedModel || current, configResult.models.map((model) => model.model), configResult.models[0]?.model)
      );
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '模型配置加载失败';
      setError(nextMessage);
      if (nextMessage.includes('401') || nextMessage.toLowerCase().includes('auth')) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    const groupIds = modelGroupIds.length ? modelGroupIds : activeGroupIds;
    if (!groupIds.length) {
      setError('没有可用用户范围，不能发布模型');
      return;
    }

    setIsModelSaving(true);
    try {
      const payload = buildModelPayload(groupIds);
      const saved = editingModelId
        ? await updateModelPrice(editingModelId, payload)
        : await createModelPrice(payload);

      setMessage(`客户模型 ${saved.model} 已保存。下一步在下方给它绑定 DeepSeek 或中转站上游线路。`);
      resetModelForm();
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '模型保存失败');
    } finally {
      setIsModelSaving(false);
    }
  }

  function buildModelPayload(groupIds: string[]) {
    const basePayload = {
      model: modelName.trim(),
      displayName: displayName.trim() || undefined,
      pricingMode,
      status: modelStatus,
      groupIds
    };

    if (pricingMode === 'deepseek_base') {
      return {
        ...basePayload,
        modelMultiplier: modelMultiplier.trim() || DEFAULT_MODEL_MULTIPLIER
      };
    }

    if (pricingMode === 'relay_price') {
      return {
        ...basePayload,
        upstreamInputPricePerMillion: upstreamInputPricePerMillion.trim(),
        upstreamOutputPricePerMillion: upstreamOutputPricePerMillion.trim(),
        upstreamCurrency,
        upstreamExchangeRate: upstreamCurrency === 'USD' ? upstreamExchangeRate.trim() : '1',
        marginPercent: marginPercent.trim() || DEFAULT_MARGIN_PERCENT
      };
    }

    return {
      ...basePayload,
      inputPriceCentsPer1k: parseWholeNumber(inputTokensPer1k, '输入 token'),
      outputPriceCentsPer1k: parseWholeNumber(outputTokensPer1k, '输出 token'),
      modelMultiplier: modelMultiplier.trim() || DEFAULT_MODEL_MULTIPLIER
    };
  }

  async function handleSaveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!mappingProviderId || !mappingPublicModel) {
      setError('请先选择客户模型和上游');
      return;
    }

    setIsMappingSaving(true);
    try {
      const payload = {
        providerId: mappingProviderId,
        publicModel: mappingPublicModel,
        upstreamModel: mappingUpstreamModel.trim(),
        priority: parseWholeNumber(mappingPriority, '线路顺序'),
        timeoutMs: parseWholeNumber(mappingTimeoutMs, '超时时间'),
        upstreamPrompt: mappingPrompt.trim() || undefined,
        status: mappingStatus,
        supportsStream: mappingSupportsStream
      };
      const duplicateMapping = mappings.find(
        (mapping) =>
          mapping.providerId === payload.providerId &&
          mapping.publicModel === payload.publicModel &&
          mapping.upstreamModel === payload.upstreamModel
      );
      const targetId = editingMappingId ?? duplicateMapping?.id ?? null;
      const saved = targetId ? await updateUpstreamModel(targetId, payload) : await createUpstreamModel(payload);

      setMessage(`线路已保存：${saved.publicModel} -> ${saved.providerName} / ${saved.upstreamModel}`);
      resetMappingForm();
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '线路保存失败');
    } finally {
      setIsMappingSaving(false);
    }
  }

  function beginEditModel(model: AdminModelPrice) {
    setError('');
    setMessage('');
    setEditingModelId(model.id);
    setModelName(model.model);
    setDisplayName(model.displayName ?? '');
    setPricingMode(model.pricingMode);
    setModelMultiplier(model.modelMultiplier);
    setInputTokensPer1k(String(model.inputPriceCentsPer1k));
    setOutputTokensPer1k(String(model.outputPriceCentsPer1k));
    setUpstreamInputPricePerMillion(model.upstreamInputPricePerMillion ?? '');
    setUpstreamOutputPricePerMillion(model.upstreamOutputPricePerMillion ?? '');
    setUpstreamCurrency(model.upstreamCurrency ?? 'CNY');
    setUpstreamExchangeRate(model.upstreamExchangeRate ?? DEFAULT_EXCHANGE_RATE);
    setMarginPercent(model.marginPercent ?? DEFAULT_MARGIN_PERCENT);
    setModelStatus(model.status === 'disabled' ? 'disabled' : 'active');
    setModelGroupIds(model.groups.length ? model.groups.map((group) => group.id) : activeGroupIds);
    document.getElementById('merchant-model-publish')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function beginCreateMapping(model: AdminModelPrice) {
    if (!isRoutesPage) {
      router.push(`/merchant/model-routes?model=${encodeURIComponent(model.model)}`);
      return;
    }

    resetMappingForm();
    setMappingPublicModel(model.model);
    setMappingUpstreamModel(model.model);
    document.getElementById('merchant-model-routes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function beginEditMapping(mapping: UpstreamModelMapping) {
    setError('');
    setMessage('');
    setEditingMappingId(mapping.id);
    setSelectedMappingId(mapping.id);
    setMappingProviderId(mapping.providerId);
    setMappingPublicModel(mapping.publicModel);
    setMappingUpstreamModel(mapping.upstreamModel);
    setMappingPriority(String(mapping.priority));
    setMappingTimeoutMs(String(mapping.timeoutMs));
    setMappingPrompt(mapping.upstreamPrompt ?? '');
    setMappingStatus(mapping.status === 'disabled' ? 'disabled' : 'active');
    setMappingSupportsStream(mapping.supportsStream);
    document.getElementById('merchant-model-routes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetModelForm() {
    setEditingModelId(null);
    setModelName('');
    setDisplayName('');
    setPricingMode('deepseek_base');
    setModelMultiplier(DEFAULT_MODEL_MULTIPLIER);
    setInputTokensPer1k('1000');
    setOutputTokensPer1k('1000');
    setUpstreamInputPricePerMillion('');
    setUpstreamOutputPricePerMillion('');
    setUpstreamCurrency('CNY');
    setUpstreamExchangeRate(DEFAULT_EXCHANGE_RATE);
    setMarginPercent(DEFAULT_MARGIN_PERCENT);
    setModelStatus('active');
    setModelGroupIds(activeGroupIds);
  }

  function resetMappingForm() {
    setEditingMappingId(null);
    setSelectedMappingId(null);
    setMappingPublicModel(models[0]?.model ?? '');
    setMappingProviderId(upstreams[0]?.id ?? '');
    setMappingUpstreamModel('');
    setMappingPriority('1');
    setMappingTimeoutMs('5000');
    setMappingPrompt('');
    setMappingStatus('active');
    setMappingSupportsStream(true);
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <MerchantShell
      activePath={isRoutesPage ? '/merchant/model-routes' : '/merchant/model-config'}
      isRefreshing={isLoading}
      onLogout={handleLogout}
      onRefresh={() => void loadData()}
      role={role}
      username={username}
    >
      <section
        className="admin-content merchant-model-config-page"
        data-page={isRoutesPage ? 'merchant-model-routes' : 'merchant-model-config'}
      >
        <div className="admin-heading merchant-dashboard-heading">
          <div>
            <p className="eyebrow">商家工作台</p>
            <h1>{isRoutesPage ? '模型线路绑定' : '模型发布'}</h1>
            <small>
              {isRoutesPage
                ? '把已经发布的客户模型绑定到 DeepSeek 或中转站上游。'
                : '先准备用户看到的模型名和扣费规则，上游线路在“模型映射”里绑定。'}
            </small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadData()} title="刷新模型配置" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="客户模型" value={formatNumber(stats.models)} detail={`启用 ${formatNumber(stats.activeModels)}`} />
          <MetricPanel label="可选上游" value={formatNumber(stats.upstreams)} detail="先去上游页接入" />
          <MetricPanel label="启用线路" value={formatNumber(stats.activeMappings)} detail="用户请求会走这些线路" />
        </section>

        {!isRoutesPage ? (
        <>
        <section className="admin-panel" id="merchant-model-publish">
          <span className="anchor-compat" id="merchant-model-prices" aria-hidden="true" />
          <div className="panel-title">
            <ApiOutlined />
            <h2>第一步：发布客户模型</h2>
          </div>
          <p className="form-note">
            这里先准备用户看到的模型，例如 gpt5.5。DeepSeek 上游和中转站上游只在上游页面维护，不在上游页面发布客户模型。
          </p>
          {editingModel ? (
            <p className="form-note">
              正在修改 {editingModel.model}
              {editingModel.upstreamMappings.length > 0 ? '。已有线路后不能改客户模型名。' : '。当前还没有绑定线路，可以改客户模型名。'}
            </p>
          ) : null}
          <form className="auth-form mapping-form" onSubmit={handleSaveModel}>
            <label>
              客户看到的模型名
              <input
                disabled={Boolean(editingModel && editingModel.upstreamMappings.length > 0)}
                maxLength={120}
                minLength={2}
                onChange={(event) => setModelName(event.target.value)}
                placeholder="例如：gpt5.5"
                required
                value={modelName}
              />
            </label>
            <label>
              展示名称
              <input maxLength={120} onChange={(event) => setDisplayName(event.target.value)} placeholder="可不填" value={displayName} />
            </label>
            <label>
              计费方式
              <select onChange={(event) => setPricingMode(event.target.value as PricingMode)} value={pricingMode}>
                <option value="deepseek_base">DeepSeek 倍率</option>
                <option value="relay_price">按中转站价格换算</option>
                <option value="manual">手动 token 扣费</option>
              </select>
            </label>
            <label>
              状态
              <select onChange={(event) => setModelStatus(event.target.value as ModelStatus)} value={modelStatus}>
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>

            {pricingMode === 'deepseek_base' ? (
              <label>
                模型倍率
                <input min="0.0001" onChange={(event) => setModelMultiplier(event.target.value)} required step="0.0001" type="number" value={modelMultiplier} />
              </label>
            ) : null}

            {pricingMode === 'relay_price' ? (
              <>
                <label>
                  价格币种
                  <select onChange={(event) => setUpstreamCurrency(event.target.value as 'CNY' | 'USD')} value={upstreamCurrency}>
                    <option value="CNY">人民币</option>
                    <option value="USD">美元</option>
                  </select>
                </label>
                <label>
                  上游输入价格 / 100万 token
                  <input min="0" onChange={(event) => setUpstreamInputPricePerMillion(event.target.value)} required step="0.0001" type="number" value={upstreamInputPricePerMillion} />
                </label>
                <label>
                  上游输出价格 / 100万 token
                  <input min="0" onChange={(event) => setUpstreamOutputPricePerMillion(event.target.value)} required step="0.0001" type="number" value={upstreamOutputPricePerMillion} />
                </label>
                <label>
                  美元汇率
                  <input disabled={upstreamCurrency === 'CNY'} min="0.000001" onChange={(event) => setUpstreamExchangeRate(event.target.value)} required step="0.000001" type="number" value={upstreamExchangeRate} />
                </label>
                <label>
                  加价百分比
                  <input min="0" onChange={(event) => setMarginPercent(event.target.value)} required step="0.0001" type="number" value={marginPercent} />
                </label>
              </>
            ) : null}

            {pricingMode === 'manual' ? (
              <>
                <label>
                  输入扣费 token / 1K
                  <input min="0" onChange={(event) => setInputTokensPer1k(event.target.value)} required step="1" type="number" value={inputTokensPer1k} />
                </label>
                <label>
                  输出扣费 token / 1K
                  <input min="0" onChange={(event) => setOutputTokensPer1k(event.target.value)} required step="1" type="number" value={outputTokensPer1k} />
                </label>
                <label>
                  模型倍率
                  <input min="0.0001" onChange={(event) => setModelMultiplier(event.target.value)} required step="0.0001" type="number" value={modelMultiplier} />
                </label>
              </>
            ) : null}

            <div className="form-actions full-width-field">
              <button className="primary-button" disabled={isModelSaving || !activeGroupIds.length} type="submit">
                <SaveOutlined />
                {isModelSaving ? '保存中' : editingModelId ? '保存模型修改' : '保存客户模型'}
              </button>
              {editingModelId ? (
                <button className="ghost-button" disabled={isModelSaving} onClick={resetModelForm} type="button">
                  <CloseOutlined />
                  取消修改
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="admin-panel">
          <div className="panel-title">
            <EyeOutlined />
            <h2>已发布客户模型</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table model-table">
              <thead>
                <tr>
                  <th>客户模型</th>
                  <th>计费方式</th>
                  <th>扣费</th>
                  <th>线路</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <tr key={model.id}>
                    <td>
                      <strong>{model.model}</strong>
                      <small className="table-note">{model.displayName || '-'}</small>
                    </td>
                    <td>{formatPricingMode(model.pricingMode)}</td>
                    <td>{formatPricingCost(model)}</td>
                    <td>{formatNumber(model.upstreamMappings.length)}</td>
                    <td>{formatStatus(model.status)}</td>
                    <td>
                      <div className="table-actions">
                        <button className="ghost-button compact-button" onClick={() => beginEditModel(model)} type="button">
                          <EditOutlined />
                          修改
                        </button>
                        <button className="ghost-button compact-button" onClick={() => beginCreateMapping(model)} type="button">
                          <LinkOutlined />
                          去绑定上游
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!models.length && !isLoading ? (
                  <tr>
                    <td colSpan={6}>暂无客户模型</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
        </>
        ) : null}

        {isRoutesPage ? (
        <>
        <section className="admin-panel" id="merchant-model-routes">
          <span className="anchor-compat" id="merchant-upstream-models" aria-hidden="true" />
          <div className="panel-title">
            <LinkOutlined />
            <h2>第二步：给客户模型绑定上游线路</h2>
          </div>
          <p className="form-note">
            这里给已发布模型选择上游线路。一个客户模型可以绑定 DeepSeek，也可以绑定其它中转站，上游失败时按线路顺序切换。
          </p>
          <form className="auth-form mapping-form" onSubmit={handleSaveMapping}>
            <label>
              客户模型
              <select onChange={(event) => setMappingPublicModel(event.target.value)} required value={mappingPublicModel}>
                <option value="">选择客户模型</option>
                {models.map((model) => (
                  <option key={model.id} value={model.model}>
                    {model.model}
                  </option>
                ))}
              </select>
            </label>
            <label>
              选择上游
              <select onChange={(event) => setMappingProviderId(event.target.value)} required value={mappingProviderId}>
                <option value="">选择上游</option>
                {upstreams.map((upstream) => (
                  <option key={upstream.id} value={upstream.id}>
                    {upstream.name}（{formatKind(upstream)}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              真实上游模型名
              <input maxLength={120} minLength={2} onChange={(event) => setMappingUpstreamModel(event.target.value)} placeholder="例如：deepseek-chat / claude-opus-4-8" required value={mappingUpstreamModel} />
            </label>
            <label>
              线路顺序
              <input max={3} min={1} onChange={(event) => setMappingPriority(event.target.value)} required type="number" value={mappingPriority} />
            </label>
            <label>
              超时时间（毫秒）
              <input max={30000} min={1000} onChange={(event) => setMappingTimeoutMs(event.target.value)} required step={500} type="number" value={mappingTimeoutMs} />
            </label>
            <label>
              状态
              <select onChange={(event) => setMappingStatus(event.target.value as ModelStatus)} value={mappingStatus}>
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>
            <label className="full-width-field">
              上游附加提示词
              <textarea
                maxLength={4000}
                onChange={(event) => setMappingPrompt(event.target.value)}
                placeholder="例如：当用户询问模型身份时，按客户模型名称回答。"
                rows={4}
                value={mappingPrompt}
              />
            </label>
            <label className="checkbox-label">
              <input checked={mappingSupportsStream} onChange={(event) => setMappingSupportsStream(event.target.checked)} type="checkbox" />
              支持流式输出
            </label>
            <div className="form-actions full-width-field">
              <button className="primary-button" disabled={isMappingSaving || !models.length || !upstreams.length} type="submit">
                <SaveOutlined />
                {isMappingSaving ? '保存中' : editingMappingId ? '保存线路修改' : '保存线路'}
              </button>
              {editingMappingId ? (
                <button className="ghost-button" disabled={isMappingSaving} onClick={resetMappingForm} type="button">
                  <CloseOutlined />
                  取消修改
                </button>
              ) : null}
            </div>
          </form>

          <div className="admin-table-wrap">
            <table className="admin-table model-table">
              <thead>
                <tr>
                  <th>客户模型</th>
                  <th>上游</th>
                  <th>真实上游模型</th>
                  <th>线路</th>
                  <th>超时</th>
                  <th>提示词</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr className={selectedMappingId === mapping.id ? 'active-row' : undefined} key={mapping.id}>
                    <td>{mapping.publicModel}</td>
                    <td>
                      {mapping.providerName}
                      <small className="table-note">{formatStatus(mapping.providerStatus)}</small>
                    </td>
                    <td>{mapping.upstreamModel}</td>
                    <td>线路 {mapping.priority}</td>
                    <td>{mapping.timeoutMs} 毫秒</td>
                    <td>{mapping.upstreamPrompt ? shortText(mapping.upstreamPrompt, 42) : '-'}</td>
                    <td>{formatStatus(mapping.status)}</td>
                    <td>
                      <div className="table-actions">
                        <button className="ghost-button compact-button" onClick={() => setSelectedMappingId(mapping.id)} type="button">
                          查看
                        </button>
                        <button className="ghost-button compact-button" onClick={() => beginEditMapping(mapping)} type="button">
                          <EditOutlined />
                          修改
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!mappings.length && !isLoading ? (
                  <tr>
                    <td colSpan={8}>暂无上游线路</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {selectedMapping ? (
          <section className="admin-panel config-detail-panel">
            <div className="config-detail-header">
              <div className="panel-title">
                <EyeOutlined />
                <h2>线路详情</h2>
              </div>
              <button className="ghost-button compact-button" onClick={() => setSelectedMappingId(null)} type="button">
                <CloseOutlined />
                关闭
              </button>
            </div>
            <dl className="config-detail-list config-detail-list-wide">
              <div>
                <dt>客户模型</dt>
                <dd>{selectedMapping.publicModel}</dd>
              </div>
              <div>
                <dt>上游</dt>
                <dd>{selectedMapping.providerName}</dd>
              </div>
              <div>
                <dt>真实上游模型</dt>
                <dd>{selectedMapping.upstreamModel}</dd>
              </div>
              <div>
                <dt>线路顺序</dt>
                <dd>线路 {selectedMapping.priority}</dd>
              </div>
              <div className="full-width-field">
                <dt>上游附加提示词</dt>
                <dd className="config-detail-prompt">{selectedMapping.upstreamPrompt || '-'}</dd>
              </div>
            </dl>
          </section>
        ) : null}
        </>
        ) : null}
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

function keepValidId(current: string, validIds: string[], fallback?: string) {
  return current && validIds.includes(current) ? current : fallback ?? '';
}

function keepValidIds(current: string[], groups: AdminGroup[], fallback: string[]) {
  const validIds = new Set(groups.map((group) => group.id));
  const nextIds = current.filter((id) => validIds.has(id));
  return nextIds.length ? nextIds : fallback;
}

function parseWholeNumber(value: string, label: string) {
  const nextValue = Number(value);
  if (!Number.isInteger(nextValue) || nextValue < 0) {
    throw new Error(`${label}必须是大于等于 0 的整数`);
  }

  return nextValue;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatPricingMode(mode: string) {
  if (mode === 'deepseek_base') {
    return 'DeepSeek 倍率';
  }
  if (mode === 'relay_price') {
    return '中转站价格换算';
  }

  return '手动 token';
}

function formatPricingCost(model: AdminModelPrice) {
  if (model.pricingMode === 'deepseek_base') {
    return `${trimNumber(model.modelMultiplier)} 倍率`;
  }

  if (model.pricingMode === 'relay_price') {
    return `输入 ${formatNumber(model.inputPriceCentsPer1k)} / 输出 ${formatNumber(model.outputPriceCentsPer1k)} token`;
  }

  return `输入 ${formatNumber(model.inputPriceCentsPer1k)} / 输出 ${formatNumber(model.outputPriceCentsPer1k)} token`;
}

function formatKind(upstream: UpstreamProvider) {
  if (upstream.kind === 'deepseek') {
    return 'DeepSeek';
  }
  if (upstream.kind === 'relay') {
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

function trimNumber(value: string) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return value;
  }

  return numberValue.toString();
}

function shortText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
