'use client';

import {
  CalculatorOutlined,
  CopyOutlined,
  DollarOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ConsoleShell } from '../components/console-shell';
import { getModelPricing, type PricingModel, type PricingResponse } from '../lib/pricing-api';

export default function PricingPage() {
  const router = useRouter();
  const [pricing, setPricing] = useState<PricingResponse | null>(null);
  const [query, setQuery] = useState('');
  const [copiedModel, setCopiedModel] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadPricing();
  }, []);

  const filteredModels = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const models = pricing?.models ?? [];

    if (!keyword) {
      return models;
    }

    return models.filter((model) =>
      [model.model, model.displayName ?? ''].some((value) => value.toLowerCase().includes(keyword))
    );
  }, [pricing, query]);

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
        <section className="account-panel account-summary">
          <div>
            <p className="eyebrow">费用说明</p>
            <h1>{isLoading ? '加载中' : `${pricing?.models.length ?? 0} 个可用模型`}</h1>
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
            <h2>计费公式</h2>
          </div>
          <div className="formula-box">
            <code>{pricing?.billingFormula.totalCostCents ?? '加载中'}</code>
            <small>单位：美元 / 1K tokens，内部按美分向上取整。</small>
          </div>
        </section>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <SearchOutlined />
            <h2>模型搜索</h2>
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
        </section>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <DollarOutlined />
            <h2>模型价格</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table pricing-table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th>公开输入单价</th>
                  <th>公开输出单价</th>
                  <th>模型倍率</th>
                  <th>实际输入单价</th>
                  <th>实际输出单价</th>
                  <th>能力</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredModels.map((model) => (
                  <PricingRow key={model.model} model={model} onCopy={copyModelName} />
                ))}
                {!isLoading && filteredModels.length === 0 ? (
                  <tr>
                    <td colSpan={8}>暂无匹配模型</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </ConsoleShell>
  );
}

function PricingRow({ model, onCopy }: { model: PricingModel; onCopy: (model: string) => Promise<void> }) {
  const modelMultiplier = Number(model.modelMultiplier);
  const groupMultiplier = Number(model.groupMultiplier);
  const effectiveInputPrice = model.inputPriceCentsPer1k * modelMultiplier * groupMultiplier;
  const effectiveOutputPrice = model.outputPriceCentsPer1k * modelMultiplier * groupMultiplier;

  return (
    <tr>
      <td>
        <strong>{model.model}</strong>
        {model.displayName ? <span className="table-note">{model.displayName}</span> : null}
      </td>
      <td>{formatCentsPer1k(model.inputPriceCentsPer1k)}</td>
      <td>{formatCentsPer1k(model.outputPriceCentsPer1k)}</td>
      <td>x{formatMultiplier(model.modelMultiplier)}</td>
      <td>{formatCentsPer1k(effectiveInputPrice)}</td>
      <td>{formatCentsPer1k(effectiveOutputPrice)}</td>
      <td>
        {model.supportsStream ? (
          <span className="status-pill status-pill-success">stream</span>
        ) : (
          <span className="status-pill status-pill-muted">no stream</span>
        )}
      </td>
      <td>
        <button className="ghost-button compact-button" onClick={() => void onCopy(model.model)} type="button">
          <CopyOutlined />
          复制
        </button>
      </td>
    </tr>
  );
}

function formatMultiplier(value: string) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return value;
  }

  return numericValue.toLocaleString('zh-CN', {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0
  });
}

function formatCentsPer1k(value: number) {
  return `$${(value / 100).toFixed(4)} / 1K`;
}
