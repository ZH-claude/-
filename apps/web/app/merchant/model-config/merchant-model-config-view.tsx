'use client';

import {
  ApiOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  LinkOutlined,
  ReloadOutlined,
  SaveOutlined,
  StopOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { MerchantShell } from '../../components/merchant-shell';
import {
  createUpstreamProvider,
  deleteModelPrice,
  createModelPrice,
  createUpstreamModel,
  listModelConfiguration,
  listUpstreamProviders,
  updateUpstreamProvider,
  updateModelPrice,
  updateModelPriceStatus,
  updateUpstreamModel,
  type AdminGroup,
  type AdminModelPrice,
  type TranslationMap,
  type UpstreamModelMapping,
  type UpstreamProvider
} from '../../lib/admin-api';
import { logout } from '../../lib/auth-api';
import {
  formatUsdPerMillionFromUnits,
  formatUsdPerMillionInputFromUnits,
  parseUsdPerMillionToUnits
} from '../../lib/billing-format';

const UPSTREAM_MAPPING_PAGE_LIMIT = 100;
const DEFAULT_MODEL_MULTIPLIER = '1.0000';
const DEFAULT_EXCHANGE_RATE = '7.200000';
const DEFAULT_MARGIN_PERCENT = '10';
const BASE_TOKEN_CNY_PER_MILLION = 8;
const USD_UNITS_PER_USD = 1_000_000;
const TOKENS_PER_MILLION = 1_000_000;
const TOKENS_PER_1K = 1_000;
const DEFAULT_UPSTREAM_NAME_PREFIX = 'model-route';
const DEEPSEEK_USD_UNITS_PER_1K_AT_ONE_X = Math.ceil(
  (BASE_TOKEN_CNY_PER_MILLION / Number(DEFAULT_EXCHANGE_RATE)) *
    (USD_UNITS_PER_USD / TOKENS_PER_MILLION) *
    TOKENS_PER_1K
);

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
  const [displayNameTranslations, setDisplayNameTranslations] = useState('');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('active');
  const [modelGroupIds, setModelGroupIds] = useState<string[]>([]);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [mappingProviderId, setMappingProviderId] = useState('');
  const [mappingProviderName, setMappingProviderName] = useState('');
  const [mappingProviderKind, setMappingProviderKind] = useState<UpstreamProvider['kind']>('generic');
  const [mappingProviderBaseUrl, setMappingProviderBaseUrl] = useState('');
  const [mappingProviderApiKey, setMappingProviderApiKey] = useState('');
  const [mappingPublicModel, setMappingPublicModel] = useState('');
  const [mappingUpstreamModel, setMappingUpstreamModel] = useState('');
  const [mappingTimeoutMs, setMappingTimeoutMs] = useState('5000');
  const [mappingPrompt, setMappingPrompt] = useState('');
  const [mappingModelMultiplier, setMappingModelMultiplier] = useState(DEFAULT_MODEL_MULTIPLIER);
  const [mappingInputTokensPer1k, setMappingInputTokensPer1k] = useState(formatUsdPerMillionInputFromUnits(DEEPSEEK_USD_UNITS_PER_1K_AT_ONE_X));
  const [mappingOutputTokensPer1k, setMappingOutputTokensPer1k] = useState(formatUsdPerMillionInputFromUnits(DEEPSEEK_USD_UNITS_PER_1K_AT_ONE_X));
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
  const [modelActionId, setModelActionId] = useState<string | null>(null);
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
  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId]
  );
  const selectedMapping = useMemo(
    () => mappings.find((mapping) => mapping.id === selectedMappingId) ?? null,
    [mappings, selectedMappingId]
  );
  const effectiveMappingProviderKind = mappingProviderKind;
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
        kind: effectiveMappingProviderKind,
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
      effectiveMappingProviderKind
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
      const searchParams = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
      const requestedModel = searchParams.get('model') ?? '';
      const selectedModelFromUrl = searchParams.get('selectedModel');
      const selectedMappingFromUrl = searchParams.get('mapping') ?? searchParams.get('selected');
      const savedState = searchParams.get('saved') ?? '';
      const nextActiveGroupIds = configResult.groups
        .filter((group) => group.status === 'active')
        .map((group) => group.id);
      setModelGroupIds((current) => keepValidIds(current, configResult.groups, nextActiveGroupIds));
      const nextProviderId = keepValidId(mappingProviderId, providerResult.items.map((provider) => provider.id));
      setMappingProviderId(nextProviderId);
      const nextProvider = providerResult.items.find((provider) => provider.id === nextProviderId);
      if (!editingMappingId && nextProvider) {
        setMappingProviderName(nextProvider.name);
        setMappingProviderKind(nextProvider.kind);
        setMappingProviderBaseUrl(nextProvider.baseUrl);
      }
      if (!editingMappingId && nextProviderId !== mappingProviderId) {
        setMappingInputTokensPer1k(defaultDirectPriceInput(nextProvider));
        setMappingOutputTokensPer1k(defaultDirectPriceInput(nextProvider));
      }
      const nextPublicModel = keepValidId(
        requestedModel || mappingPublicModel,
        configResult.models.map((model) => model.model),
        configResult.models[0]?.model
      );
      setMappingPublicModel(nextPublicModel);
      if (!editingMappingId && !nextProvider && nextPublicModel) {
        setMappingProviderName((current) => current || defaultProviderName(nextPublicModel));
      }
      if (selectedModelFromUrl) {
        const matchingModel = configResult.models.find((model) => model.id === selectedModelFromUrl);
        setSelectedModelId(matchingModel ? matchingModel.id : null);
      } else if (requestedModel) {
        const requestedModelEntity = configResult.models.find((model) => model.model === requestedModel);
        if (requestedModelEntity) {
          setSelectedModelId(requestedModelEntity.id);
        }
      }

      if (selectedMappingFromUrl) {
        const matchingMapping = configResult.upstreamModels.find((mapping) => mapping.id === selectedMappingFromUrl);
        setSelectedMappingId(matchingMapping ? matchingMapping.id : null);
      }

      const selectedModelName = selectedModelFromUrl
        ? configResult.models.find((model) => model.id === selectedModelFromUrl)?.model
        : requestedModel;
      if (savedState === 'model' && selectedModelName) {
        setMessage(`客户模型 ${selectedModelName} 已发布，请继续给它绑定上游线路。`);
      } else if (savedState === 'route' && selectedModelName) {
        setMessage(`模型 ${selectedModelName} 的线路已保存，列表已刷新。`);
      }
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
      const wasEditing = Boolean(editingModelId);
      const saved = editingModelId
        ? await updateModelPrice(editingModelId, payload)
        : await createModelPrice(payload);

      setSelectedModelId(saved.id);
      setMessage(`客户模型 ${saved.model} 已保存，列表已刷新。`);
      resetModelForm();
      if (!wasEditing) {
        router.push(
          `/merchant/model-routes?model=${encodeURIComponent(saved.model)}&selectedModel=${encodeURIComponent(saved.id)}&saved=model`
        );
        return;
      }

      replaceArchiveUrl(`/merchant/model-config?selectedModel=${encodeURIComponent(saved.id)}&saved=model`);
      await loadData();
      document.getElementById('merchant-model-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      translations: parseModelDisplayNameTranslations(displayNameTranslations),
      status: modelStatus,
      groupIds
    };
  }

  function buildMappingPricingPayload() {
    if (effectiveMappingProviderKind === 'deepseek') {
      return {
        pricingMode: 'manual' as const,
        inputPriceCentsPer1k: parseUsdPriceInput(mappingInputTokensPer1k, '输入价格'),
        outputPriceCentsPer1k: parseUsdPriceInput(mappingOutputTokensPer1k, '输出价格'),
        modelMultiplier: DEFAULT_MODEL_MULTIPLIER
      };
    }

    if (effectiveMappingProviderKind === 'relay') {
      return {
        pricingMode: 'relay_price' as const,
        upstreamInputPricePerMillion: mappingUpstreamInputPricePerMillion.trim(),
        upstreamOutputPricePerMillion: mappingUpstreamOutputPricePerMillion.trim(),
        upstreamCurrency: mappingUpstreamCurrency,
        upstreamExchangeRate: mappingUpstreamExchangeRate.trim() || DEFAULT_EXCHANGE_RATE,
        marginPercent: mappingMarginPercent.trim() || DEFAULT_MARGIN_PERCENT
      };
    }

    return {
      pricingMode: 'manual' as const,
      inputPriceCentsPer1k: parseUsdPriceInput(mappingInputTokensPer1k, '输入价格'),
      outputPriceCentsPer1k: parseUsdPriceInput(mappingOutputTokensPer1k, '输出价格'),
      modelMultiplier: DEFAULT_MODEL_MULTIPLIER
    };
  }

  async function ensureRouteProvider() {
    const name = mappingProviderName.trim();
    const kind = mappingProviderKind;
    const baseUrl = mappingProviderBaseUrl.trim();
    const apiKey = mappingProviderApiKey.trim();
    const selectedProvider = upstreams.find((upstream) => upstream.id === mappingProviderId);
    const sameNameProvider = upstreams.find((upstream) => upstream.name === name);
    const providerToUpdate = selectedProvider ?? sameNameProvider;

    if (providerToUpdate) {
      const shouldUpdateProvider =
        providerToUpdate.name !== name ||
        providerToUpdate.kind !== kind ||
        providerToUpdate.baseUrl !== baseUrl ||
        Boolean(apiKey) ||
        providerToUpdate.status !== 'active';

      if (!shouldUpdateProvider) {
        return providerToUpdate.id;
      }

      const updatedProvider = await updateUpstreamProvider(providerToUpdate.id, {
        name,
        kind,
        baseUrl,
        ...(apiKey ? { apiKey } : {}),
        status: 'active'
      });
      setUpstreams((current) => upsertProvider(current, updatedProvider));
      setMappingProviderId(updatedProvider.id);
      setMappingProviderApiKey('');
      return updatedProvider.id;
    }

    const createdProvider = await createUpstreamProvider({
      name,
      kind,
      baseUrl,
      apiKey,
      status: 'active'
    });
    setUpstreams((current) => upsertProvider(current, createdProvider));
    setMappingProviderId(createdProvider.id);
    setMappingProviderApiKey('');
    return createdProvider.id;
  }

  async function handleSaveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!mappingPublicModel) {
      setError('请先选择客户模型和上游');
      return;
    }

    if (!mappingProviderName.trim()) {
      setError('请填写上游名称');
      return;
    }
    if (!mappingProviderBaseUrl.trim()) {
      setError('请填写上游 Base URL');
      return;
    }
    if (!mappingProviderId && !mappingProviderApiKey.trim()) {
      setError('新上游必须填写密钥；编辑已有上游时可留空沿用原密钥');
      return;
    }

    setIsMappingSaving(true);
    try {
      const providerId = await ensureRouteProvider();
      const payload = {
        providerId,
        publicModel: mappingPublicModel,
        upstreamModel: mappingUpstreamModel.trim(),
        priority: 1,
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
      const savedModel = models.find((model) => model.model === saved.publicModel);

      setSelectedMappingId(saved.id);
      if (savedModel) {
        setSelectedModelId(savedModel.id);
      }
      setMessage(`线路已保存：${saved.publicModel} 只会走 ${saved.providerName} / ${saved.upstreamModel}。同名客户模型的其它启用线路已自动停用。`);
      resetMappingForm(true);
      const routeParams = new URLSearchParams({
        model: saved.publicModel,
        mapping: saved.id,
        selected: saved.id,
        saved: 'route'
      });
      if (savedModel?.id) {
        routeParams.set('selectedModel', savedModel.id);
      }
      replaceArchiveUrl(`/merchant/model-routes?${routeParams.toString()}`);
      await loadData();
      window.setTimeout(() => {
        document.getElementById('merchant-model-route-saved')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '线路保存失败');
    } finally {
      setIsMappingSaving(false);
    }
  }

  function beginEditModel(model: AdminModelPrice) {
    setError('');
    setMessage('');
    setSelectedModelId(model.id);
    setEditingModelId(model.id);
    setModelName(model.model);
    setDisplayName(model.displayName ?? '');
    setDisplayNameTranslations(stringifyModelTranslations(model.translations));
    setModelStatus(model.status === 'disabled' ? 'disabled' : 'active');
    setModelGroupIds(model.groups.length ? model.groups.map((group) => group.id) : activeGroupIds);
    document.getElementById('merchant-model-publish')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function selectModel(model: AdminModelPrice) {
    setError('');
    setMessage('');
    setSelectedModelId(model.id);
    replaceArchiveUrl(`/merchant/model-config?selectedModel=${encodeURIComponent(model.id)}`);
    window.setTimeout(() => {
      document.getElementById('merchant-model-saved')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  function beginCreateMapping(model: AdminModelPrice) {
    if (!isRoutesPage) {
      router.push(`/merchant/model-routes?model=${encodeURIComponent(model.model)}`);
      return;
    }

    setSelectedMappingId(null);
    resetMappingForm();
    setMappingPublicModel(model.model);
    setMappingProviderId('');
    setMappingProviderName(defaultProviderName(model.model));
    setMappingProviderKind('generic');
    setMappingProviderBaseUrl('');
    setMappingProviderApiKey('');
    setMappingUpstreamModel(model.model);
    setMappingModelMultiplier(DEFAULT_MODEL_MULTIPLIER);
    document.getElementById('merchant-model-routes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleToggleModelStatus(model: AdminModelPrice) {
    const nextStatus: ModelStatus = model.status === 'active' ? 'disabled' : 'active';
    const actionText = nextStatus === 'disabled' ? '下架' : '上架';

    if (
      nextStatus === 'disabled' &&
      !window.confirm(`确定下架模型 ${model.model} 吗？下架后用户端将不能继续选择和调用这个模型，历史日志和线路配置会保留。`)
    ) {
      return;
    }

    setError('');
    setMessage('');
    setModelActionId(model.id);
    try {
      const saved = await updateModelPriceStatus(model.id, { status: nextStatus });
      if (editingModelId === model.id) {
        resetModelForm();
      }
      await loadData();
      replaceArchiveUrl(`/merchant/model-config?updated=status&model=${encodeURIComponent(saved.model)}`);
      setMessage(`模型 ${saved.model} 已${actionText}，列表已刷新。`);
      window.setTimeout(() => {
        document.getElementById('merchant-model-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `模型${actionText}失败`);
    } finally {
      setModelActionId(null);
    }
  }

  async function handleDeleteModel(model: AdminModelPrice) {
    const mappingCount = model.upstreamMappings.length;
    const confirmed = window.confirm(
      `确定删除模型 ${model.model} 吗？这会删除这个客户模型和 ${mappingCount} 条绑定线路；不会删除上游账号、用户余额、历史请求日志和消费记录。如果模型仍被 API 令牌授权规则使用，系统会拒绝硬删，请先下架。`
    );

    if (!confirmed) {
      return;
    }

    setError('');
    setMessage('');
    setModelActionId(model.id);
    try {
      const deleted = await deleteModelPrice(model.id);
      if (editingModelId === model.id) {
        resetModelForm();
      }
      await loadData();
      replaceArchiveUrl(`/merchant/model-config?deleted=1&model=${encodeURIComponent(deleted.model)}`);
      setMessage(`模型 ${deleted.model} 已删除，列表已刷新。`);
      window.setTimeout(() => {
        document.getElementById('merchant-model-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '模型删除失败');
    } finally {
      setModelActionId(null);
    }
  }

  function beginEditMapping(mapping: UpstreamModelMapping) {
    setError('');
    setMessage('');
    setEditingMappingId(mapping.id);
    setSelectedMappingId(mapping.id);
    setMappingProviderId(mapping.providerId);
    setMappingProviderName(mapping.providerName);
    setMappingProviderKind(mapping.providerKind);
    setMappingProviderBaseUrl(upstreams.find((upstream) => upstream.id === mapping.providerId)?.baseUrl ?? '');
    setMappingProviderApiKey('');
    setMappingPublicModel(mapping.publicModel);
    setMappingUpstreamModel(mapping.upstreamModel);
    setMappingTimeoutMs(String(mapping.timeoutMs));
    setMappingPrompt(mapping.upstreamPrompt ?? '');
    setMappingModelMultiplier(DEFAULT_MODEL_MULTIPLIER);
    setMappingInputTokensPer1k(formatDirectPriceInput(mapping.routePricing?.inputPriceCentsPer1k));
    setMappingOutputTokensPer1k(formatDirectPriceInput(mapping.routePricing?.outputPriceCentsPer1k));
    setMappingUpstreamInputPricePerMillion(mapping.routePricing?.upstreamInputPricePerMillion ?? '');
    setMappingUpstreamOutputPricePerMillion(mapping.routePricing?.upstreamOutputPricePerMillion ?? '');
    setMappingUpstreamCurrency(mapping.routePricing?.upstreamCurrency ?? 'CNY');
    setMappingUpstreamExchangeRate(mapping.routePricing?.upstreamExchangeRate ?? DEFAULT_EXCHANGE_RATE);
    setMappingMarginPercent(mapping.routePricing?.marginPercent ?? DEFAULT_MARGIN_PERCENT);
    setMappingStatus(mapping.status === 'disabled' ? 'disabled' : 'active');
    setMappingSupportsStream(mapping.supportsStream);
    document.getElementById('merchant-model-routes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function selectMapping(mapping: UpstreamModelMapping) {
    setError('');
    setMessage('');
    setSelectedMappingId(mapping.id);
    const params = new URLSearchParams({
      model: mapping.publicModel,
      mapping: mapping.id,
      selected: mapping.id
    });
    const matchingModel = models.find((model) => model.model === mapping.publicModel);
    if (matchingModel?.id) {
      params.set('selectedModel', matchingModel.id);
      setSelectedModelId(matchingModel.id);
    }
    replaceArchiveUrl(`/merchant/model-routes?${params.toString()}`);
    window.setTimeout(() => {
      document.getElementById('merchant-model-route-saved')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  function resetModelForm() {
    setEditingModelId(null);
    setModelName('');
    setDisplayName('');
    setDisplayNameTranslations('');
    setModelStatus('active');
    setModelGroupIds(activeGroupIds);
  }

  function resetMappingForm(preserveSelected = false) {
    setEditingMappingId(null);
    if (!preserveSelected) {
      setSelectedMappingId(null);
    }
    setMappingPublicModel(models[0]?.model ?? '');
    setMappingProviderId('');
    setMappingProviderName(defaultProviderName(models[0]?.model));
    setMappingProviderKind('generic');
    setMappingProviderBaseUrl('');
    setMappingProviderApiKey('');
    setMappingUpstreamModel('');
    setMappingTimeoutMs('5000');
    setMappingPrompt('');
    setMappingModelMultiplier(DEFAULT_MODEL_MULTIPLIER);
    setMappingInputTokensPer1k(defaultDirectPriceInput());
    setMappingOutputTokensPer1k(defaultDirectPriceInput());
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

  function replaceArchiveUrl(url: string) {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', url);
    }
  }

  function handleMappingProviderChange(providerId: string) {
    setMappingProviderId(providerId);
    const provider = upstreams.find((upstream) => upstream.id === providerId);
    if (!provider) {
      setMappingProviderName(defaultProviderName(mappingPublicModel));
      setMappingProviderKind('generic');
      setMappingProviderBaseUrl('');
      setMappingProviderApiKey('');
      setMappingInputTokensPer1k(defaultDirectPriceInput());
      setMappingOutputTokensPer1k(defaultDirectPriceInput());
      setMappingModelMultiplier(DEFAULT_MODEL_MULTIPLIER);
      return;
    }

    setMappingProviderName(provider.name);
    setMappingProviderKind(provider.kind);
    setMappingProviderBaseUrl(provider.baseUrl);
    setMappingProviderApiKey('');
    if (editingMappingId) {
      return;
    }

    setMappingInputTokensPer1k(defaultDirectPriceInput(provider));
    setMappingOutputTokensPer1k(defaultDirectPriceInput(provider));
    setMappingModelMultiplier(DEFAULT_MODEL_MULTIPLIER);
  }

  function handleMappingProviderKindChange(kind: UpstreamProvider['kind']) {
    setMappingProviderKind(kind);
    if (kind === 'relay') {
      return;
    }

    const nextDirectPrice = defaultDirectPriceInput({ kind } as UpstreamProvider);
    setMappingInputTokensPer1k(nextDirectPrice);
    setMappingOutputTokensPer1k(nextDirectPrice);
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
            <h1>{isRoutesPage ? '模型线路管理' : '模型管理'}</h1>
            <small>
              {isRoutesPage
                ? '给客户模型配置上游 URL、真实模型名、超时、提示词和扣费价格。'
                : '先发布用户看到的模型名；发布成功后会自动进入线路绑定，不再停留在空表单。'}
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
          <MetricPanel label="可选上游" value={formatNumber(stats.upstreams)} detail="绑定线路时选择" />
          <MetricPanel label="启用线路" value={formatNumber(stats.activeMappings)} detail="当前真正生效的模型线路" />
        </section>

        {!isRoutesPage ? (
        <>
        <section className="admin-panel" id="merchant-model-publish">
          <span className="anchor-compat" id="merchant-model-prices" aria-hidden="true" />
          <div className="panel-title">
            <ApiOutlined />
            <h2>发布客户模型</h2>
          </div>
          <p className="form-note">
            这里填写用户实际调用时看到的模型名，例如“gpt5.5”或“claude opus4.8”。发布成功后会自动进入线路管理，继续填写上游 URL 和真实模型。
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

            <label className="full-width-field">
              Display name translations JSON
              <textarea
                data-qa="merchant-model-display-name-translations"
                onChange={(event) => setDisplayNameTranslations(event.target.value)}
                placeholder='{"es-ES":{"displayName":"Nombre del modelo","_locked":true,"_status":"human_reviewed"}}'
                rows={5}
                value={displayNameTranslations}
              />
            </label>
            <p className="form-note full-width-field">
              Saved translations drive the user-side model marketplace and pricing API when a user selects another language.
            </p>

            <div className="form-actions full-width-field">
              <button className="primary-button" disabled={isModelSaving || !activeGroupIds.length} type="submit">
                <SaveOutlined />
                {isModelSaving ? '保存中' : editingModelId ? '保存模型修改' : '发布模型'}
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

        <section className="admin-panel" id="merchant-model-list">
          <div className="panel-title">
            <EyeOutlined />
            <h2>模型管理</h2>
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
                {models.map((model) => {
                  const isActionBusy = modelActionId === model.id;
                  const isSelected = selectedModelId === model.id;
                  const isActive = model.status === 'active';

                  return (
                    <tr
                      className={isSelected ? 'active-row' : undefined}
                      data-model-id={model.id}
                      data-qa="merchant-model-row"
                      key={model.id}
                    >
                      <td>
                        <strong>{model.model}</strong>
                        <small className="table-note">{model.displayName || '-'}</small>
                        {countModelDisplayNameTranslations(model.translations) ? (
                          <small className="table-note">Translations {countModelDisplayNameTranslations(model.translations)}</small>
                        ) : null}
                      </td>
                      <td>{formatNumber(model.upstreamMappings.length)}</td>
                      <td>{formatStatus(model.status)}</td>
                      <td>
                        <div className="table-actions">
                          <button className="ghost-button compact-button" disabled={isActionBusy} onClick={() => selectModel(model)} type="button">
                            查看
                          </button>
                          <button className="ghost-button compact-button" disabled={isActionBusy} onClick={() => beginEditModel(model)} type="button">
                            <EditOutlined />
                            修改
                          </button>
                          <button className="ghost-button compact-button" disabled={isActionBusy} onClick={() => beginCreateMapping(model)} type="button">
                            <LinkOutlined />
                            去绑定上游
                          </button>
                          <button className="ghost-button compact-button" disabled={isActionBusy} onClick={() => void handleToggleModelStatus(model)} type="button">
                            <StopOutlined />
                            {isActive ? '下架' : '上架'}
                          </button>
                          <button className="ghost-button compact-button danger-button" disabled={isActionBusy} onClick={() => void handleDeleteModel(model)} type="button">
                            <DeleteOutlined />
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!models.length && !isLoading ? (
                  <tr>
                    <td colSpan={4}>暂无客户模型</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
        {selectedModel ? (
          <section
            className="admin-panel config-detail-panel"
            data-qa="merchant-model-saved"
            data-selected-model-id={selectedModel.id}
            id="merchant-model-saved"
          >
            <div className="config-detail-header">
              <div className="panel-title">
                <EyeOutlined />
                <h2>模型保存档案</h2>
              </div>
              <button className="ghost-button compact-button" onClick={() => setSelectedModelId(null)} type="button">
                <CloseOutlined />
                关闭
              </button>
            </div>
            <dl className="config-detail-list config-detail-list-wide">
              <div>
                <dt>客户模型</dt>
                <dd>{selectedModel.model}</dd>
              </div>
              <div>
                <dt>展示名称</dt>
                <dd>{selectedModel.displayName || '-'}</dd>
              </div>
              <div className="full-width-field">
                <dt>Display name translations</dt>
                <dd data-qa="merchant-model-translation-archive">
                  <pre>{stringifyModelTranslations(selectedModel.translations) || '-'}</pre>
                </dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>{formatStatus(selectedModel.status)}</dd>
              </div>
              <div>
                <dt>可用用户组</dt>
                <dd>{selectedModel.groups.length ? selectedModel.groups.map((group) => group.name).join(', ') : '-'}</dd>
              </div>
              <div>
                <dt>绑定线路</dt>
                <dd>{formatNumber(selectedModel.upstreamMappings.length)}</dd>
              </div>
              <div>
                <dt>记录 ID</dt>
                <dd>{selectedModel.id}</dd>
              </div>
              <div>
                <dt>保存时间</dt>
                <dd>{formatOptionalDate(selectedModel.updatedAt)}</dd>
              </div>
            </dl>
          </section>
        ) : null}
        </>
        ) : null}

        {isRoutesPage ? (
        <>
        <section className="admin-panel" id="merchant-model-routes">
          <span className="anchor-compat" id="merchant-upstream-models" aria-hidden="true" />
          <div className="panel-title">
            <LinkOutlined />
            <h2>模型线路</h2>
          </div>
          <p className="form-note">
            一个客户模型只启用一条线路。这里填写上游 URL、密钥、真实上游模型名和输入/输出价格；保存后会刷新下方线路列表。
          </p>
          <form className="auth-form mapping-form" data-qa="merchant-model-route-form" onSubmit={handleSaveMapping}>
            <label>
              客户模型
              <select data-qa="merchant-model-route-public-model" onChange={(event) => setMappingPublicModel(event.target.value)} required value={mappingPublicModel}>
                <option value="">选择客户模型</option>
                {models.map((model) => (
                  <option key={model.id} value={model.model}>
                    {model.model}
                  </option>
                ))}
              </select>
            </label>
            <label>
              已保存上游（可选）
              <select data-qa="merchant-model-route-provider" onChange={(event) => handleMappingProviderChange(event.target.value)} value={mappingProviderId}>
                <option value="">新建或手动填写</option>
                {upstreams.map((upstream) => (
                  <option key={upstream.id} value={upstream.id}>
                    {upstream.name}（{formatKind(upstream)}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              上游类型
              <select data-qa="merchant-model-route-provider-kind" onChange={(event) => handleMappingProviderKindChange(event.target.value as UpstreamProvider['kind'])} value={mappingProviderKind}>
                <option value="generic">OpenAI 兼容</option>
                <option value="deepseek">DeepSeek</option>
                <option value="relay">中转站</option>
              </select>
            </label>
            <label>
              上游名称
              <input data-qa="merchant-model-route-provider-name" maxLength={80} minLength={2} onChange={(event) => setMappingProviderName(event.target.value)} required value={mappingProviderName} />
            </label>
            <label>
              上游 Base URL
              <input data-qa="merchant-model-route-provider-base-url" maxLength={2048} minLength={8} onChange={(event) => setMappingProviderBaseUrl(event.target.value)} placeholder="例如：https://api.example.com" required type="url" value={mappingProviderBaseUrl} />
            </label>
            <label>
              上游密钥
              <input data-qa="merchant-model-route-provider-api-key" maxLength={512} minLength={mappingProviderId ? undefined : 8} onChange={(event) => setMappingProviderApiKey(event.target.value)} placeholder={mappingProviderId ? '不填则沿用已保存密钥' : '新上游必填'} required={!mappingProviderId} type="password" value={mappingProviderApiKey} />
            </label>
            <label>
              真实上游模型名
              <input data-qa="merchant-model-route-upstream-model" maxLength={120} minLength={2} onChange={(event) => setMappingUpstreamModel(event.target.value)} placeholder="例如：deepseek-chat / claude-opus-4-8" required value={mappingUpstreamModel} />
            </label>
            <label>
              超时时间（毫秒）
              <input data-qa="merchant-model-route-timeout-ms" max={30000} min={1000} onChange={(event) => setMappingTimeoutMs(event.target.value)} required step={500} type="number" value={mappingTimeoutMs} />
            </label>
            {effectiveMappingProviderKind === 'deepseek' ? (
              <>
                <label>
                  输入价格（美元 / 1M tokens）
                  <input data-qa="merchant-model-route-input-price" min={0} onChange={(event) => setMappingInputTokensPer1k(event.target.value)} required step="0.001" type="number" value={mappingInputTokensPer1k} />
                </label>
                <label>
                  输出价格（美元 / 1M tokens）
                  <input data-qa="merchant-model-route-output-price" min={0} onChange={(event) => setMappingOutputTokensPer1k(event.target.value)} required step="0.001" type="number" value={mappingOutputTokensPer1k} />
                </label>
              </>
            ) : null}
            {effectiveMappingProviderKind === 'relay' ? (
              <>
                <label>
                  上游输入价格 / 100万 token
                    <input
                      data-qa="merchant-model-route-upstream-input-price"
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
                      data-qa="merchant-model-route-upstream-output-price"
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
                  <select data-qa="merchant-model-route-upstream-currency" onChange={(event) => setMappingUpstreamCurrency(event.target.value as 'CNY' | 'USD')} value={mappingUpstreamCurrency}>
                    <option value="CNY">人民币</option>
                    <option value="USD">美元</option>
                  </select>
                </label>
                <label>
                  加价比例
                    <input
                      data-qa="merchant-model-route-margin-percent"
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
                      data-qa="merchant-model-route-exchange-rate"
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
            {effectiveMappingProviderKind === 'generic' ? (
              <>
                <label>
                  输入价格（美元 / 1M tokens）
                  <input data-qa="merchant-model-route-input-price" min={0} onChange={(event) => setMappingInputTokensPer1k(event.target.value)} required step="0.001" type="number" value={mappingInputTokensPer1k} />
                </label>
                <label>
                  输出价格（美元 / 1M tokens）
                  <input data-qa="merchant-model-route-output-price" min={0} onChange={(event) => setMappingOutputTokensPer1k(event.target.value)} required step="0.001" type="number" value={mappingOutputTokensPer1k} />
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
              <select data-qa="merchant-model-route-status" onChange={(event) => setMappingStatus(event.target.value as ModelStatus)} value={mappingStatus}>
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>
            <label className="full-width-field">
              上游附加提示词
              <textarea
                data-qa="merchant-model-route-prompt"
                maxLength={4000}
                onChange={(event) => setMappingPrompt(event.target.value)}
                placeholder="例如：当用户询问模型身份时，按客户模型名称回答。"
                rows={4}
                value={mappingPrompt}
              />
            </label>
            <label className="checkbox-label">
              <input checked={mappingSupportsStream} data-qa="merchant-model-route-supports-stream" onChange={(event) => setMappingSupportsStream(event.target.checked)} type="checkbox" />
              支持流式输出
            </label>
            <div className="form-actions full-width-field">
              <button className="primary-button" data-qa="merchant-model-route-submit" disabled={isMappingSaving || !models.length} type="submit">
                <SaveOutlined />
                {isMappingSaving ? '保存中' : editingMappingId ? '保存线路修改' : '保存线路'}
              </button>
              {editingMappingId ? (
                <button className="ghost-button" disabled={isMappingSaving} onClick={() => resetMappingForm()} type="button">
                  <CloseOutlined />
                  取消修改
                </button>
              ) : null}
            </div>
          </form>

          <div className="admin-table-wrap" id="merchant-model-routes-list">
            <table className="admin-table model-table">
              <thead>
                <tr>
                  <th>客户模型</th>
                  <th>上游</th>
                  <th>真实上游模型</th>
                  <th>绑定方式</th>
                  <th>超时</th>
                  <th>扣费规则</th>
                  <th>提示词</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr
                    className={selectedMappingId === mapping.id ? 'active-row' : undefined}
                    data-qa="merchant-model-route-row"
                    data-mapping-id={mapping.id}
                    key={mapping.id}
                  >
                    <td>{mapping.publicModel}</td>
                    <td>
                      {mapping.providerName}
                      <small className="table-note">{formatStatus(mapping.providerStatus)}</small>
                    </td>
                    <td>{mapping.upstreamModel}</td>
                    <td>{mapping.status === 'active' ? '唯一启用' : '已停用'}</td>
                    <td>{mapping.timeoutMs} 毫秒</td>
                    <td>{formatRoutePricing(mapping)}</td>
                    <td>{mapping.upstreamPrompt ? shortText(mapping.upstreamPrompt, 42) : '-'}</td>
                    <td>{formatStatus(mapping.status)}</td>
                    <td>
                      <div className="table-actions">
                        <button className="ghost-button compact-button" onClick={() => selectMapping(mapping)} type="button">
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
          <section
            className="admin-panel config-detail-panel"
            data-qa="merchant-model-route-detail"
            data-selected-mapping-id={selectedMapping.id}
            data-selected-provider-id={selectedMapping.providerId}
            data-selected-public-model={selectedMapping.publicModel}
            data-selected-upstream-model={selectedMapping.upstreamModel}
            id="merchant-model-route-saved"
          >
            <div className="config-detail-header">
              <div className="panel-title">
                <EyeOutlined />
                <h2>线路保存档案</h2>
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
                <dt>绑定方式</dt>
                <dd>{selectedMapping.status === 'active' ? '唯一启用上游' : '已停用线路'}</dd>
              </div>
              <div>
                <dt>扣费规则</dt>
                <dd>{formatRoutePricing(selectedMapping)}</dd>
              </div>
              <div>
                <dt>记录 ID</dt>
                <dd>{selectedMapping.id}</dd>
              </div>
              <div>
                <dt>保存时间</dt>
                <dd>{formatOptionalDate(selectedMapping.updatedAt)}</dd>
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

function parseModelDisplayNameTranslations(value: string): TranslationMap | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('Model display name translations must be valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model display name translations must be a language-keyed object.');
  }

  const nextTranslations: TranslationMap = {};
  for (const [language, record] of Object.entries(parsed as Record<string, unknown>)) {
    if (!language.trim()) {
      throw new Error('Model display name translation language code cannot be empty.');
    }

    if (typeof record === 'string') {
      nextTranslations[language] = { displayName: record };
      continue;
    }

    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`Model display name translation for ${language} must be a string or object.`);
    }

    const nextRecord: Record<string, string | boolean> = {};
    for (const [key, entryValue] of Object.entries(record as Record<string, unknown>)) {
      if (typeof entryValue === 'string' || typeof entryValue === 'boolean') {
        nextRecord[key] = entryValue;
      }
    }

    if (typeof nextRecord.displayName !== 'string' || !nextRecord.displayName.trim()) {
      throw new Error(`Model display name translation for ${language} must include displayName.`);
    }

    nextTranslations[language] = nextRecord;
  }

  return nextTranslations;
}

function stringifyModelTranslations(translations: TranslationMap | null | undefined) {
  if (!translations || !Object.keys(translations).length) {
    return '';
  }

  return JSON.stringify(translations, null, 2);
}

function countModelDisplayNameTranslations(translations: TranslationMap | null | undefined) {
  if (!translations) {
    return 0;
  }

  return Object.values(translations).filter((record) => typeof record?.displayName === 'string' && record.displayName.trim()).length;
}

function defaultProviderName(model?: string) {
  const normalizedModel = model?.trim();
  return normalizedModel ? `${DEFAULT_UPSTREAM_NAME_PREFIX}-${normalizedModel}` : DEFAULT_UPSTREAM_NAME_PREFIX;
}

function upsertProvider(providers: UpstreamProvider[], provider: UpstreamProvider) {
  const nextProviders = providers.filter((entry) => entry.id !== provider.id);
  return [provider, ...nextProviders];
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

function formatOptionalDate(value: string | null | undefined) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatChargePer1k(value: number | null | undefined) {
  return formatUsdPerMillionFromUnits(value);
}

function defaultDirectPriceInput(provider?: UpstreamProvider) {
  return formatUsdPerMillionInputFromUnits(provider?.kind === 'deepseek' ? DEEPSEEK_USD_UNITS_PER_1K_AT_ONE_X : 1000);
}

function formatDirectPriceInput(value: number | null | undefined) {
  if (typeof value !== 'number') {
    return formatUsdPerMillionInputFromUnits(1000);
  }

  return formatUsdPerMillionInputFromUnits(value);
}

function effectiveRoutePrice(value: number | null | undefined) {
  if (typeof value !== 'number') {
    return null;
  }

  return Math.ceil(value);
}

function parseUsdPriceInput(value: string, label: string) {
  const parsed = parseUsdPerMillionToUnits(value, label);
  if (parsed instanceof Error) {
    throw parsed;
  }

  return parsed;
}

function parseUsdPreviewUnits(value: string) {
  const parsed = parseUsdPerMillionToUnits(value, '价格');
  return parsed instanceof Error ? null : parsed;
}

function buildMappingPricingPreview(input: MappingPricingPreviewInput): MappingPricingPreview | null {
  if (!input.kind) {
    return null;
  }

  if (input.kind === 'deepseek') {
    const inputUnits = parseUsdPreviewUnits(input.inputTokensPer1k);
    const outputUnits = parseUsdPreviewUnits(input.outputTokensPer1k);
    if (inputUnits === null || outputUnits === null) {
      return {
        title: 'DeepSeek 线路扣费预览',
        lines: ['填完输入价格和输出价格后会显示预览；倍率固定为 1，不再参与价格计算。']
      };
    }

    return {
      title: 'DeepSeek 线路扣费预览',
      lines: [
        `输入价格：${formatChargePer1k(inputUnits)}。`,
        `输出价格：${formatChargePer1k(outputUnits)}。`,
        `token 仍显示上游返回的真实输入和输出；实际扣余额时会按汇率折算成人民币。`
      ]
    };
  }

  if (input.kind === 'relay') {
    const inputPrice = parsePreviewNumber(input.upstreamInputPricePerMillion);
    const outputPrice = parsePreviewNumber(input.upstreamOutputPricePerMillion);
    const exchangeRate = parsePreviewNumber(input.upstreamExchangeRate);
    const marginPercent = parsePreviewNumber(input.marginPercent) ?? Number(DEFAULT_MARGIN_PERCENT);

    if (inputPrice === null || outputPrice === null || exchangeRate === null) {
      return {
        title: '中转站线路扣费预览',
        lines: [
          '填完上游输入价、输出价和汇率后，会自动换算成美元扣费。',
          `token 仍显示上游返回的真实用量；价格按上游成本加价 ${formatPreviewNumber(marginPercent)}% 计算。`
        ]
      };
    }

    const marginRate = 1 + marginPercent / 100;
    const inputUsdPerMillion = input.upstreamCurrency === 'CNY' ? inputPrice / exchangeRate : inputPrice;
    const outputUsdPerMillion = input.upstreamCurrency === 'CNY' ? outputPrice / exchangeRate : outputPrice;
    const inputChargePer1k = Math.ceil(inputUsdPerMillion * marginRate * (USD_UNITS_PER_USD / TOKENS_PER_MILLION) * TOKENS_PER_1K);
    const outputChargePer1k = Math.ceil(outputUsdPerMillion * marginRate * (USD_UNITS_PER_USD / TOKENS_PER_MILLION) * TOKENS_PER_1K);

    return {
      title: '中转站线路扣费预览',
      lines: [
        `输入价格：${formatChargePer1k(inputChargePer1k)}。`,
        `输出价格：${formatChargePer1k(outputChargePer1k)}。`,
        `token 仍显示真实用量；报价按上游价格 × 加价 ${formatPreviewNumber(marginPercent)}% 换算成美元，实际扣余额时再折算人民币。`
      ]
    };
  }

  const inputUnits = parseUsdPreviewUnits(input.inputTokensPer1k);
  const outputUnits = parseUsdPreviewUnits(input.outputTokensPer1k);
  if (inputUnits === null || outputUnits === null) {
    return {
      title: '手动线路扣费预览',
      lines: ['填完输入价格和输出价格后会显示美元报价预览；token 仍显示真实用量。']
    };
  }

  return {
    title: '手动线路扣费预览',
    lines: [
      `输入价格：${formatChargePer1k(inputUnits)}。`,
      `输出价格：${formatChargePer1k(outputUnits)}。`
    ]
  };
}

function formatRoutePricing(mapping: UpstreamModelMapping) {
  const pricing = mapping.routePricing;

  if (!pricing?.pricingMode) {
    return '跟随客户模型';
  }

  if (pricing.pricingMode === 'deepseek_base') {
    return `DeepSeek：输入 ${formatChargePer1k(effectiveRoutePrice(pricing.inputPriceCentsPer1k))} / 输出 ${formatChargePer1k(effectiveRoutePrice(pricing.outputPriceCentsPer1k))}`;
  }

  if (pricing.pricingMode === 'relay_price') {
    return `中转站：输入 ${formatChargePer1k(pricing.inputPriceCentsPer1k)} / 输出 ${formatChargePer1k(pricing.outputPriceCentsPer1k)}`;
  }

  return `手动：输入 ${formatChargePer1k(pricing.inputPriceCentsPer1k)} / 输出 ${formatChargePer1k(pricing.outputPriceCentsPer1k)}`;
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
