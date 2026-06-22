'use client';

import {
  AppstoreOutlined,
  CalculatorOutlined,
  CopyOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ConsoleShell } from '../components/console-shell';
import { ModelBrandMark, type ModelBrandId } from '../components/model-brand-mark';
import { formatUsdPerMillionFromUnits } from '../lib/billing-format';
import { getModelPricing, type PricingModel, type PricingResponse } from '../lib/pricing-api';

type ProviderId = 'all' | 'anthropic' | 'openai' | 'google' | 'deepseek' | 'glm' | 'other';

type ProviderFilter = {
  id: ProviderId;
  label: string;
  mark: string;
  className: string;
};

const PROVIDER_FILTERS: ProviderFilter[] = [
  { id: 'all', label: '全部模型', mark: 'All', className: 'all' },
  { id: 'anthropic', label: 'Claude', mark: 'AI', className: 'claude' },
  { id: 'openai', label: 'GPT', mark: 'GPT', className: 'gpt' },
  { id: 'google', label: 'Gemini', mark: 'G', className: 'google' },
  { id: 'deepseek', label: 'DeepSeek', mark: 'DS', className: 'deepseek' },
  { id: 'glm', label: 'GLM', mark: 'GLM', className: 'glm' },
  { id: 'other', label: '其他', mark: 'AI', className: 'other' }
];

export default function PricingPage() {
  const router = useRouter();
  const [pricing, setPricing] = useState<PricingResponse | null>(null);
  const [query, setQuery] = useState('');
  const [activeProvider, setActiveProvider] = useState<ProviderId>('all');
  const [copiedModel, setCopiedModel] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadPricing();
  }, []);

  const filteredModels = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const models = pricing?.models ?? [];

    return models.filter((model) => {
      const matchesKeyword =
        !keyword || [model.model, model.displayName ?? ''].some((value) => value.toLowerCase().includes(keyword));
      const matchesProvider = activeProvider === 'all' || getModelProvider(model) === activeProvider;
      return matchesKeyword && matchesProvider;
    });
  }, [activeProvider, pricing, query]);

  const providerStats = useMemo(() => {
    const models = pricing?.models ?? [];
    return PROVIDER_FILTERS.map((filter) => ({
      ...filter,
      count: models.filter((model) => filter.id === 'all' || getModelProvider(model) === filter.id).length
    }));
  }, [pricing]);

  const paidModelCount = useMemo(
    () => filteredModels.filter((model) => model.inputPriceCentsPer1k > 0 || model.outputPriceCentsPer1k > 0).length,
    [filteredModels]
  );

  async function loadPricing() {
    setIsLoading(true);
    setError('');

    try {
      const result = await getModelPricing();
      setPricing(result);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '费用说明加载失败';
      setError(message);
      if (message.startsWith('401:') || message.includes('认证') || message.includes('会话')) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function copyModelName(model: string) {
    setError('');
    setCopiedModel('');

    try {
      await navigator.clipboard.writeText(model);
      setCopiedModel(model);
    } catch {
      setError('复制失败，请手动选中模型名');
    }
  }

  return (
    <ConsoleShell activePath="/pricing" isRefreshing={isLoading} onRefresh={() => void loadPricing()}>
      <section className="console-content-grid">
        <section className="account-panel account-summary pricing-market-header">
          <div>
            <p className="eyebrow">费用说明</p>
            <h1>模型广场</h1>
            <small>{isLoading ? '加载中' : `${pricing?.models.length ?? 0} 个可用模型`}</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadPricing()} title="刷新价格" type="button">
            <ReloadOutlined />
          </button>
        </section>

        <div className="metric-panel">
          <span>可用模型</span>
          <strong>{pricing?.models.length ?? 0}</strong>
          <small>当前账号可调用</small>
        </div>
        <div className="metric-panel">
          <span>计费模型</span>
          <strong>{paidModelCount}</strong>
          <small>输入或输出有单价</small>
        </div>
        <div className="metric-panel">
          <span>搜索结果</span>
          <strong>{filteredModels.length}</strong>
          <small>其中计费模型 {paidModelCount} 个</small>
        </div>

        {error ? <p className="form-error wide-panel">{error}</p> : null}
        {copiedModel ? <p className="form-success wide-panel">已复制模型名：{copiedModel}</p> : null}

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <CalculatorOutlined />
            <h2>扣费口径</h2>
          </div>
          <div className="formula-box">
            <strong>token 只记录真实用量；模型价格按美元 / 1M tokens 展示。</strong>
            <small>实际扣余额时，会按当前汇率自动折算成人民币金额。</small>
          </div>
        </section>

        <section className="account-panel wide-panel pricing-market-panel">
          <div className="pricing-market-topbar">
            <div className="panel-title">
              <AppstoreOutlined />
              <h2>模型广场</h2>
            </div>
            <label className="pricing-search">
              <SearchOutlined />
              <input
                aria-label="搜索模型"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索模型名或展示名"
                type="search"
                value={query}
              />
            </label>
          </div>

          <div className="pricing-market-shell">
            <aside className="pricing-category-pane" aria-label="模型分类">
              <PricingProviderGroup activeId={activeProvider} items={providerStats} onChange={setActiveProvider} />
            </aside>

            <div className="pricing-model-grid">
              {filteredModels.map((model) => (
                <PricingModelCard key={model.model} model={model} onCopy={copyModelName} />
              ))}
              {!isLoading && filteredModels.length === 0 ? (
                <div className="pricing-empty-state">
                  <SearchOutlined />
                  <strong>暂无匹配模型</strong>
                  <span>换一个分类或搜索关键词。</span>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </section>
    </ConsoleShell>
  );
}

function PricingProviderGroup({
  activeId,
  items,
  onChange
}: {
  activeId: ProviderId;
  items: Array<ProviderFilter & { count: number }>;
  onChange: (id: ProviderId) => void;
}) {
  return (
    <section className="pricing-category-group">
      <h3>模型分类</h3>
      {items.map((item) => (
        <button
          className={`pricing-provider-button ${activeId === item.id ? 'active' : ''}`}
          disabled={item.count === 0}
          key={item.id}
          onClick={() => onChange(item.id)}
          type="button"
        >
          <ModelBrandMark brand={getProviderBrand(item.id)} className="compact" label={item.label} mark={item.mark} />
          <strong>{item.label}</strong>
          <em>{item.count}</em>
        </button>
      ))}
    </section>
  );
}

function PricingModelCard({ model, onCopy }: { model: PricingModel; onCopy: (model: string) => Promise<void> }) {
  const groupMultiplier = Number(model.groupMultiplier);
  const effectiveInputPrice = model.inputPriceCentsPer1k * groupMultiplier;
  const effectiveOutputPrice = model.outputPriceCentsPer1k * groupMultiplier;
  const provider = getProviderMeta(getModelProvider(model));

  return (
    <article className="pricing-model-card">
      <header>
        <ModelBrandMark brand={getProviderBrand(provider.id)} label={provider.label} mark={provider.mark} />
        <div>
          <div className="pricing-card-tags">
            <span>{provider.label}</span>
            <span>官方资源</span>
          </div>
          <h3>{model.model}</h3>
          {model.displayName ? <small>{model.displayName}</small> : null}
        </div>
      </header>

      <div className="pricing-card-prices">
        <div>
          <strong>{formatUsdPer1m(effectiveInputPrice)}</strong>
          <span>输入</span>
        </div>
        <div>
          <strong>{formatUsdPer1m(effectiveOutputPrice)}</strong>
          <span>输出</span>
        </div>
      </div>

      <footer>
        {model.supportsStream ? (
          <span className="status-pill status-pill-success">支持流式</span>
        ) : (
          <span className="status-pill status-pill-muted">普通输出</span>
        )}
        <button className="ghost-button compact-button" onClick={() => void onCopy(model.model)} type="button">
          <CopyOutlined />
          复制
        </button>
      </footer>
    </article>
  );
}

function formatUsdPer1m(value: number) {
  return formatUsdPerMillionFromUnits(value);
}

function getProviderMeta(id: ProviderId) {
  return PROVIDER_FILTERS.find((item) => item.id === id) ?? PROVIDER_FILTERS[6];
}

function getProviderBrand(id: ProviderId): ModelBrandId {
  const brands: Record<ProviderId, ModelBrandId> = {
    all: 'all',
    anthropic: 'claude',
    deepseek: 'deepseek',
    glm: 'glm',
    google: 'google',
    openai: 'gpt',
    other: 'other'
  };

  return brands[id];
}

function getModelProvider(model: PricingModel): ProviderId {
  const text = normalizeModelText(model);

  if (text.includes('claude') || text.includes('anthropic')) {
    return 'anthropic';
  }

  if (text.includes('gpt') || text.includes('openai') || /\bo[134]\b/.test(text)) {
    return 'openai';
  }

  if (text.includes('google') || text.includes('gemini') || text.includes('palm')) {
    return 'google';
  }

  if (text.includes('deepseek')) {
    return 'deepseek';
  }

  if (text.includes('glm') || text.includes('chatglm') || text.includes('zhipu')) {
    return 'glm';
  }

  return 'other';
}

function normalizeModelText(model: PricingModel) {
  return `${model.model} ${model.displayName ?? ''}`.toLowerCase();
}
