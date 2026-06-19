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
const BASE_TOKEN_CNY_PER_MILLION = 8;

type ModelStatus = 'active' | 'disabled';
type ModelConfigMode = 'publish' | 'routes';
type MappingPricingPreview = {
  title: string;
  lines: string[];
};
type MappingPricingPreviewInput = {
  kind?: UpstreamProvider['kind'];
  modelMultiplier: string;
  upstreamInputPricePerMillion: string;
  upstreamOutputPricePerMillion: string;
  upstreamCurrency: 'CNY' | 'USD';
  upstreamExchangeRate: string;
  marginPercent: string;
  inputTokensPer1k: string;
  outputTokensPer1k: string;
};

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
  const [modelStatus, setModelStatus] = useState<ModelStatus>('active');
  const [modelGroupIds, setModelGroupIds] = useState<string[]>([]);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [mappingProviderId, setMappingProviderId] = useState('');
  const [mappingPublicModel, setMappingPublicModel] = useState('');
  const [mappingUpstreamModel, setMappingUpstreamModel] = useState('');
  const [mappingPriority, setMappingPriority] = useState('1');
  const [mappingTimeoutMs, setMappingTimeoutMs] = useState('5000');
  const [mappingPrompt, setMappingPrompt] = useState('');
  const [mappingModelMultiplier, setMappingModelMultiplier] = useState(DEFAULT_MODEL_MULTIPLIER);
  const [mappingInputTokensPer1k, setMappingInputTokensPer1k] = useState('1000');
  const [mappingOutputTokensPer1k, setMappingOutputTokensPer1k] = useState('1000');
  const [mappingUpstreamInputPricePerMillion, setMappingUpstreamInputPricePerMillion] = useState('');
  const [mappingUpstreamOutputPricePerMillion, setMappingUpstreamOutputPricePerMillion] = useState('');
  const [mappingUpstreamCurrency, setMappingUpstreamCurrency] = useState<'CNY' | 'USD'>('CNY');
  const [mappingUpstreamExchangeRate, setMappingUpstreamExchangeRate] = useState(DEFAULT_EXCHANGE_RATE);
  const [mappingMarginPercent, setMappingMarginPercent] = useState(DEFAULT_MARGIN_PERCENT);
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
  const selectedMappingProvider = useMemo(
    () => upstreams.find((upstream) => upstream.id === mappingProviderId) ?? null,
    [mappingProviderId, upstreams]
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
  const mappingPricingPreview = useMemo(
    () =>
      buildMappingPricingPreview({
        kind: selectedMappingProvider?.kind,
        modelMultiplier: mappingModelMultiplier,
        upstreamInputPricePerMillion: mappingUpstreamInputPricePerMillion,
        upstreamOutputPricePerMillion: mappingUpstreamOutputPricePerMillion,
        upstreamCurrency: mappingUpstreamCurrency,
        upstreamExchangeRate: mappingUpstreamExchangeRate,
        marginPercent: mappingMarginPercent,
        inputTokensPer1k: mappingInputTokensPer1k,
        outputTokensPer1k: mappingOutputTokensPer1k
      }),
    [
      mappingInputTokensPer1k,
      mappingMarginPercent,
      mappingModelMultiplier,
      mappingOutputTokensPer1k,
      mappingUpstreamCurrency,
      mappingUpstreamExchangeRate,
      mappingUpstreamInputPricePerMillion,
      mappingUpstreamOutputPricePerMillion,
      selectedMappingProvider?.kind
    ]
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

      setMessage(`客户模型 ${saved.model} 已保存。下一步到“模型映射”给它绑定 DeepSeek 或中转站上游线路。`);
      resetModelForm();
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '模型保存失败');
    } finally {
      setIsModelSaving(false);
    }
  }

  function buildModelPayload(groupIds: string[]) {
    return {
      model: modelName.trim(),
      displayName: displayName.trim() || undefined,
      status: modelStatus,
      groupIds
    };
  }

  function buildMappingPricingPayload() {
    if (!selectedMappingProvider) {
      throw new Error('请先选择上游');
    }

    if (selectedMappingProvider.kind === 'deepseek') {
      return {
        pricingMode: 'deepseek_base' as const,
        modelMultiplier: mappingModelMultiplier.trim() || DEFAULT_MODEL_MULTIPLIER
      };
    }

    if (selectedMappingProvider.kind === 'relay') {
      return {
        pricingMode: 'relay_price' as const,
        upstreamInputPricePerMillion: mappingUpstreamInputPricePerMillion.trim(),
        upstreamOutputPricePerMillion: mappingUpstreamOutputPricePerMillion.trim(),
        upstreamCurrency: mappingUpstreamCurrency,
        upstreamExchangeRate: mappingUpstreamCurrency === 'USD' ? mappingUpstreamExchangeRate.trim() : '1',
        marginPercent: mappingMarginPercent.trim() || DEFAULT_MARGIN_PERCENT
      };
    }

    return {
      pricingMode: 'manual' as const,
      inputPriceCentsPer1k: parseWholeNumber(mappingInputTokensPer1k, '输入 token'),
      outputPriceCentsPer1k: parseWholeNumber(mappingOutputTokensPer1k, '输出 token'),
      modelMultiplier: mappingModelMultiplier.trim() || DEFAULT_MODEL_MULTIPLIER
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
        ...buildMappingPricingPayload(),
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
    setMappingModelMultiplier(DEFAULT_MODEL_MULTIPLIER);
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
    setMappingModelMultiplier(mapping.routePricing?.modelMultiplier ?? DEFAULT_MODEL_MULTIPLIER);
    setMappingInputTokensPer1k(String(mapping.routePricing?.inputPriceCentsPer1k ?? 1000));
    setMappingOutputTokensPer1k(String(mapping.routePricing?.outputPriceCentsPer1k ?? 1000));
    setMappingUpstreamInputPricePerMillion(mapping.routePricing?.upstreamInputPricePerMillion ?? '');
    setMappingUpstreamOutputPricePerMillion(mapping.routePricing?.upstreamOutputPricePerMillion ?? '');
    setMappingUpstreamCurrency(mapping.routePricing?.upstreamCurrency ?? 'CNY');
    setMappingUpstreamExchangeRate(mapping.routePricing?.upstreamExchangeRate ?? DEFAULT_EXCHANGE_RATE);
    setMappingMarginPercent(mapping.routePricing?.marginPercent ?? DEFAULT_MARGIN_PERCENT);
    setMappingStatus(mapping.status === 'disabled' ? 'disabled' : 'active');
    setMappingSupportsStream(mapping.supportsStream);
    document.getElementById('merchant-model-routes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetModelForm() {
    setEditingModelId(null);
    setModelName('');
    setDisplayName('');
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
    setMappingModelMultiplier(DEFAULT_MODEL_MULTIPLIER);
    setMappingInputTokensPer1k('1000');
    setMappingOutputTokensPer1k('1000');
    setMappingUpstreamInputPricePerMillion('');
    setMappingUpstreamOutputPricePerMillion('');
    setMappingUpstreamCurrency('CNY');
    setMappingUpstreamExchangeRate(DEFAULT_EXCHANGE_RATE);
    setMappingMarginPercent(DEFAULT_MARGIN_PERCENT);
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
            <h1>{isRoutesPage ? '模型映射（上游线路）' : '模型发布'}</h1>
            <small>
              {isRoutesPage
                ? '第三步：把已经发布的客户模型绑定到 DeepSeek 或中转站上游，并在这条线路上设置扣费。'
                : '先准备用户看到的模型名；上游、真实模型和扣费规则都在后面单独配置。'}
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
            这里只准备用户看到的模型，例如 gpt5.5。上游地址在上游页面维护，真实模型、线路顺序、超时、提示词和扣费规则在“模型映射”里配置。
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
              状态
              <select onChange={(event) => setModelStatus(event.target.value as ModelStatus)} value={modelStatus}>
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>

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
                    <td colSpan={4}>暂无客户模型</td>
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
            <h2>第三步：模型映射（上游线路）</h2>
          </div>
          <p className="form-note">
            这里给已发布客户模型选择上游线路。一个客户模型可以绑定 DeepSeek，也可以绑定其它中转站；扣费规则也在这条线路里设置，上游失败时按线路顺序切换。
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
            {selectedMappingProvider?.kind === 'deepseek' ? (
              <label>
                这条线路倍率
                <input
                  min="0"
                  onChange={(event) => setMappingModelMultiplier(event.target.value)}
                  placeholder="例如：gpt5.5 填 5，普通 DeepSeek 填 1"
                  required
                  step="0.0001"
                  type="number"
                  value={mappingModelMultiplier}
                />
              </label>
            ) : null}
            {selectedMappingProvider?.kind === 'relay' ? (
              <>
                <label>
                  上游输入价格 / 100万 token
                  <input
                    min="0"
                    onChange={(event) => setMappingUpstreamInputPricePerMillion(event.target.value)}
                    placeholder="例如：5"
                    required
                    step="0.0001"
                    type="number"
                    value={mappingUpstreamInputPricePerMillion}
                  />
                </label>
                <label>
                  上游输出价格 / 100万 token
                  <input
                    min="0"
                    onChange={(event) => setMappingUpstreamOutputPricePerMillion(event.target.value)}
                    placeholder="例如：30"
                    required
                    step="0.0001"
                    type="number"
                    value={mappingUpstreamOutputPricePerMillion}
                  />
                </label>
                <label>
                  上游币种
                  <select onChange={(event) => setMappingUpstreamCurrency(event.target.value as 'CNY' | 'USD')} value={mappingUpstreamCurrency}>
                    <option value="CNY">人民币</option>
                    <option value="USD">美元</option>
                  </select>
                </label>
                <label>
                  加价比例
                  <input
                    min="0"
                    onChange={(event) => setMappingMarginPercent(event.target.value)}
                    placeholder="默认 10"
                    step="0.0001"
                    type="number"
                    value={mappingMarginPercent}
                  />
                </label>
                {mappingUpstreamCurrency === 'USD' ? (
                  <label>
                    美元转人民币汇率
                    <input
                      min="0.000001"
                      onChange={(event) => setMappingUpstreamExchangeRate(event.target.value)}
                      step="0.000001"
                      type="number"
                      value={mappingUpstreamExchangeRate}
                    />
                  </label>
                ) : null}
              </>
            ) : null}
            {selectedMappingProvider && selectedMappingProvider.kind === 'generic' ? (
              <>
                <label>
                  输入 token / 1000
                  <input min={0} onChange={(event) => setMappingInputTokensPer1k(event.target.value)} required type="number" value={mappingInputTokensPer1k} />
                </label>
                <label>
                  输出 token / 1000
                  <input min={0} onChange={(event) => setMappingOutputTokensPer1k(event.target.value)} required type="number" value={mappingOutputTokensPer1k} />
                </label>
              </>
            ) : null}
            {mappingPricingPreview ? (
              <div className="form-note full-width-field pricing-preview">
                <strong>{mappingPricingPreview.title}</strong>
                {mappingPricingPreview.lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            ) : null}
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
                  <th>扣费规则</th>
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
                    <td>{formatRoutePricing(mapping)}</td>
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
                    <td colSpan={9}>暂无上游线路</td>
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
              <div>
                <dt>扣费规则</dt>
                <dd>{formatRoutePricing(selectedMapping)}</dd>
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

function formatOptionalNumber(value: number | null | undefined) {
  return typeof value === 'number' ? formatNumber(value) : '-';
}

function buildMappingPricingPreview(input: MappingPricingPreviewInput): MappingPricingPreview | null {
  if (!input.kind) {
    return null;
  }

  if (input.kind === 'deepseek') {
    const multiplier = parsePreviewNumber(input.modelMultiplier);
    if (multiplier === null) {
      return {
        title: 'DeepSeek 线路扣费预览',
        lines: ['填写倍率后会显示扣费预览。普通 DeepSeek 填 1，gpt5.5 如果按 5 倍卖就填 5。']
      };
    }

    return {
      title: 'DeepSeek 线路扣费预览',
      lines: [
        `线路倍率：${formatPreviewNumber(multiplier)} 倍。`,
        `客户每产生 1,000 个真实 token，约扣 ${formatNumber(Math.ceil(multiplier * 1000))} token。`,
        '普通 DeepSeek 填 1；其它模型按你要卖给客户的倍率填写。'
      ]
    };
  }

  if (input.kind === 'relay') {
    const inputPrice = parsePreviewNumber(input.upstreamInputPricePerMillion);
    const outputPrice = parsePreviewNumber(input.upstreamOutputPricePerMillion);
    const exchangeRate = input.upstreamCurrency === 'USD' ? parsePreviewNumber(input.upstreamExchangeRate) : 1;
    const marginPercent = parsePreviewNumber(input.marginPercent) ?? Number(DEFAULT_MARGIN_PERCENT);

    if (inputPrice === null || outputPrice === null || exchangeRate === null) {
      return {
        title: '中转站线路扣费预览',
        lines: [
          '填完上游输入价、输出价和汇率后，会自动换算成 token 扣费。',
          `换算口径：上游价格加价 ${formatPreviewNumber(marginPercent)}%，再按 ${BASE_TOKEN_CNY_PER_MILLION} 元 / 100 万 token 折算。`
        ]
      };
    }

    const marginRate = 1 + marginPercent / 100;
    const inputMultiplier = (inputPrice * exchangeRate * marginRate) / BASE_TOKEN_CNY_PER_MILLION;
    const outputMultiplier = (outputPrice * exchangeRate * marginRate) / BASE_TOKEN_CNY_PER_MILLION;

    return {
      title: '中转站线路扣费预览',
      lines: [
        `输入扣费：${formatPreviewNumber(inputMultiplier)} 倍，1000 输入约扣 ${formatNumber(Math.ceil(inputMultiplier * 1000))} token。`,
        `输出扣费：${formatPreviewNumber(outputMultiplier)} 倍，1000 输出约扣 ${formatNumber(Math.ceil(outputMultiplier * 1000))} token。`,
        `换算口径：上游价格 × 汇率 × 加价 ${formatPreviewNumber(marginPercent)}%，再除以 ${BASE_TOKEN_CNY_PER_MILLION} 元 / 100 万 token。`
      ]
    };
  }

  const inputTokens = parsePreviewNumber(input.inputTokensPer1k);
  const outputTokens = parsePreviewNumber(input.outputTokensPer1k);
  if (inputTokens === null || outputTokens === null) {
    return {
      title: '手动线路扣费预览',
      lines: ['填完输入 token 和输出 token 后会显示扣费预览。']
    };
  }

  return {
    title: '手动线路扣费预览',
    lines: [
      `1000 输入扣 ${formatNumber(Math.ceil(inputTokens))} token。`,
      `1000 输出扣 ${formatNumber(Math.ceil(outputTokens))} token。`
    ]
  };
}

function formatRoutePricing(mapping: UpstreamModelMapping) {
  const pricing = mapping.routePricing;

  if (!pricing?.pricingMode) {
    return '跟随客户模型';
  }

  if (pricing.pricingMode === 'deepseek_base') {
    return `DeepSeek ${trimNumber(pricing.modelMultiplier ?? '1')} 倍`;
  }

  if (pricing.pricingMode === 'relay_price') {
    return `中转站：输入 ${formatOptionalNumber(pricing.inputPriceCentsPer1k)} / 输出 ${formatOptionalNumber(pricing.outputPriceCentsPer1k)} token`;
  }

  return `手动：输入 ${formatOptionalNumber(pricing.inputPriceCentsPer1k)} / 输出 ${formatOptionalNumber(pricing.outputPriceCentsPer1k)} token`;
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

function parsePreviewNumber(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  const numberValue = Number(trimmedValue);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function formatPreviewNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 4
  }).format(value);
}

function shortText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
