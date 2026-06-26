'use client';

import {
  AppstoreOutlined,
  CalculatorOutlined,
  CloseOutlined,
  CopyOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ConsoleShell } from '../components/console-shell';
import { useI18n } from '../components/language-provider';
import { ModelBrandMark, type ModelBrandId } from '../components/model-brand-mark';
import { formatUsdPerMillionFromUnits } from '../lib/billing-format';
import { applyCopyOverrides, type CopyOverrides } from '../lib/copy-overrides';
import type { LanguageCode } from '../lib/i18n';
import { getModelPricing, type PricingModel, type PricingResponse } from '../lib/pricing-api';

type ProviderId = 'all' | 'anthropic' | 'openai' | 'google' | 'deepseek' | 'glm' | 'other';
type ProviderLabelKey = 'allModels' | 'claude' | 'gpt' | 'gemini' | 'deepseek' | 'glm' | 'other';
type IntegrationGuideId = 'python' | 'typescript' | 'java' | 'go' | 'shell' | 'claude-code';

type ProviderFilter = {
  className: string;
  id: ProviderId;
  labelKey: ProviderLabelKey;
  mark: string;
};

type IntegrationGuide = {
  code: (model: string, copy: PricingCopy) => string;
  id: IntegrationGuideId;
  label: string;
};

type PricingCopy = {
  allModels: string;
  apiBase: string;
  apiKeyPlaceholder: string;
  apiPath: string;
  billingPolicy: string;
  billingPolicyBody: string;
  billingPolicyHint: string;
  claude: string;
  close: string;
  codeAria: (label: string) => string;
  copy: string;
  copyCodeError: string;
  copyCodeSuccess: (label: string, model: string) => string;
  copyModelError: string;
  copyModelSuccess: (model: string) => string;
  currentAccountAvailable: string;
  deepseek: string;
  gemini: string;
  glm: string;
  gpt: string;
  hasInputOrOutputPrice: string;
  input: string;
  inputPrice: string;
  integrationDescription: string;
  integrationExamples: string;
  integrationHeading: string;
  loading: string;
  loadFailed: string;
  modeChat: string;
  modelCategory: string;
  modelCount: (count: number) => string;
  noModelsDescription: string;
  noModelsTitle: string;
  officialResource: string;
  other: string;
  output: string;
  outputPrice: string;
  paidModelCount: (count: number) => string;
  paidModels: string;
  pricingEyebrow: string;
  refreshPrices: string;
  searchAria: string;
  searchPlaceholder: string;
  searchResults: string;
  standardOutput: string;
  supportsStreaming: string;
  systemMessage: string;
  title: string;
  userMessage: string;
  viewIntegrationExamples: (model: string) => string;
};

const PUBLIC_API_BASE_URL = 'https://newaicode.com';
const OPENAI_COMPAT_BASE_URL = `${PUBLIC_API_BASE_URL}/v1`;

const PRICING_COPY: Record<'zh-CN' | 'zh-TW' | 'en-US', PricingCopy> = {
  'zh-CN': {
    allModels: '全部模型',
    apiBase: '接口地址',
    apiKeyPlaceholder: '你的 API 密钥',
    apiPath: '接口路径',
    billingPolicy: '扣费口径',
    billingPolicyBody: 'token 只记录真实用量；模型价格按美元 / 1M tokens 展示。',
    billingPolicyHint: '实际扣余额时，会按当前汇率自动折算成人民币金额。',
    claude: 'Claude',
    close: '关闭',
    codeAria: (label) => `${label} 接入代码`,
    copy: '复制',
    copyCodeError: '复制失败，请手动选中代码',
    copyCodeSuccess: (label, model) => `已复制 ${label} 接入示例：${model}`,
    copyModelError: '复制失败，请手动选中模型名',
    copyModelSuccess: (model) => `已复制模型名：${model}`,
    currentAccountAvailable: '当前账号可调用',
    deepseek: 'DeepSeek',
    gemini: 'Gemini',
    glm: 'GLM',
    gpt: 'GPT',
    hasInputOrOutputPrice: '输入或输出有单价',
    input: '输入',
    inputPrice: '输入价格',
    integrationDescription: '先在令牌页面创建 API 密钥，再把示例里的模型名替换为当前模型。',
    integrationExamples: '接入示例',
    integrationHeading: '使用以下代码示例来集成我们的 API：',
    loading: '加载中',
    loadFailed: '费用说明加载失败',
    modeChat: '聊天',
    modelCategory: '模型分类',
    modelCount: (count) => `${count} 个可用模型`,
    noModelsDescription: '换一个分类或搜索关键词。',
    noModelsTitle: '暂无匹配模型',
    officialResource: '官方资源',
    other: '其他',
    output: '输出',
    outputPrice: '输出价格',
    paidModelCount: (count) => `其中计费模型 ${count} 个`,
    paidModels: '计费模型',
    pricingEyebrow: '费用说明',
    refreshPrices: '刷新价格',
    searchAria: '搜索模型',
    searchPlaceholder: '搜索模型名或展示名',
    searchResults: '搜索结果',
    standardOutput: '普通输出',
    supportsStreaming: '支持流式',
    systemMessage: '你是一个有帮助的助手。',
    title: '模型广场',
    userMessage: '你好，请简单介绍一下你自己。',
    viewIntegrationExamples: (model) => `查看 ${model} 接入示例`
  },
  'zh-TW': {
    allModels: '全部模型',
    apiBase: '介面地址',
    apiKeyPlaceholder: '你的 API 金鑰',
    apiPath: '介面路徑',
    billingPolicy: '扣費口徑',
    billingPolicyBody: 'token 只記錄真實用量；模型價格按美元 / 1M tokens 顯示。',
    billingPolicyHint: '實際扣餘額時，會按目前匯率自動折算成人民幣金額。',
    claude: 'Claude',
    close: '關閉',
    codeAria: (label) => `${label} 接入程式碼`,
    copy: '複製',
    copyCodeError: '複製失敗，請手動選取程式碼',
    copyCodeSuccess: (label, model) => `已複製 ${label} 接入範例：${model}`,
    copyModelError: '複製失敗，請手動選取模型名',
    copyModelSuccess: (model) => `已複製模型名：${model}`,
    currentAccountAvailable: '目前帳號可呼叫',
    deepseek: 'DeepSeek',
    gemini: 'Gemini',
    glm: 'GLM',
    gpt: 'GPT',
    hasInputOrOutputPrice: '輸入或輸出有單價',
    input: '輸入',
    inputPrice: '輸入價格',
    integrationDescription: '先在令牌頁面建立 API 金鑰，再把範例裡的模型名替換為目前模型。',
    integrationExamples: '接入範例',
    integrationHeading: '使用以下程式碼範例來整合我們的 API：',
    loading: '載入中',
    loadFailed: '費用說明載入失敗',
    modeChat: '聊天',
    modelCategory: '模型分類',
    modelCount: (count) => `${count} 個可用模型`,
    noModelsDescription: '換一個分類或搜尋關鍵字。',
    noModelsTitle: '暫無匹配模型',
    officialResource: '官方資源',
    other: '其他',
    output: '輸出',
    outputPrice: '輸出價格',
    paidModelCount: (count) => `其中計費模型 ${count} 個`,
    paidModels: '計費模型',
    pricingEyebrow: '費用說明',
    refreshPrices: '刷新價格',
    searchAria: '搜尋模型',
    searchPlaceholder: '搜尋模型名或顯示名',
    searchResults: '搜尋結果',
    standardOutput: '普通輸出',
    supportsStreaming: '支援串流',
    systemMessage: '你是一個有幫助的助手。',
    title: '模型廣場',
    userMessage: '你好，請簡單介紹一下你自己。',
    viewIntegrationExamples: (model) => `查看 ${model} 接入範例`
  },
  'en-US': {
    allModels: 'All models',
    apiBase: 'API base URL',
    apiKeyPlaceholder: 'your API key',
    apiPath: 'API path',
    billingPolicy: 'Billing rules',
    billingPolicyBody: 'Tokens record real usage only; model prices are shown in USD / 1M tokens.',
    billingPolicyHint: 'When balance is deducted, the system converts it to CNY using the current exchange rate.',
    claude: 'Claude',
    close: 'Close',
    codeAria: (label) => `${label} integration code`,
    copy: 'Copy',
    copyCodeError: 'Copy failed. Select the code manually.',
    copyCodeSuccess: (label, model) => `Copied ${label} integration example: ${model}`,
    copyModelError: 'Copy failed. Select the model name manually.',
    copyModelSuccess: (model) => `Copied model name: ${model}`,
    currentAccountAvailable: 'Available to the current account',
    deepseek: 'DeepSeek',
    gemini: 'Gemini',
    glm: 'GLM',
    gpt: 'GPT',
    hasInputOrOutputPrice: 'Input or output has a unit price',
    input: 'Input',
    inputPrice: 'Input price',
    integrationDescription: 'Create an API key on the Tokens page first, then replace the model name in the example with this model.',
    integrationExamples: 'Integration examples',
    integrationHeading: 'Use the following code examples to integrate our API:',
    loading: 'Loading',
    loadFailed: 'Failed to load pricing details',
    modeChat: 'Chat',
    modelCategory: 'Model categories',
    modelCount: (count) => `${count} available models`,
    noModelsDescription: 'Try another category or search keyword.',
    noModelsTitle: 'No matching models',
    officialResource: 'Official resource',
    other: 'Other',
    output: 'Output',
    outputPrice: 'Output price',
    paidModelCount: (count) => `${count} paid models`,
    paidModels: 'Paid models',
    pricingEyebrow: 'Pricing',
    refreshPrices: 'Refresh prices',
    searchAria: 'Search models',
    searchPlaceholder: 'Search model name or display name',
    searchResults: 'Search results',
    standardOutput: 'Standard output',
    supportsStreaming: 'Streaming supported',
    systemMessage: 'You are a helpful assistant.',
    title: 'Model marketplace',
    userMessage: 'Hello, please briefly introduce yourself.',
    viewIntegrationExamples: (model) => `View ${model} integration examples`
  }
};

const INTEGRATION_GUIDES: IntegrationGuide[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    code: (model, copy) => `$env:ANTHROPIC_AUTH_TOKEN="${copy.apiKeyPlaceholder}"
$env:ANTHROPIC_BASE_URL="${PUBLIC_API_BASE_URL}/"
claude --model "${model}"`
  },
  {
    id: 'python',
    label: 'Python',
    code: (model, copy) => `from openai import OpenAI

client = OpenAI(
    api_key="${copy.apiKeyPlaceholder}",
    base_url="${OPENAI_COMPAT_BASE_URL}"
)

response = client.chat.completions.create(
    model="${model}",
    messages=[
        {"role": "system", "content": "${copy.systemMessage}"},
        {"role": "user", "content": "${copy.userMessage}"}
    ],
    max_tokens=1024,
    temperature=0.7
)

print(response.choices[0].message.content)`
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    code: (model, copy) => `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.NEWAICODE_API_KEY,
  baseURL: "${OPENAI_COMPAT_BASE_URL}",
});

const response = await client.chat.completions.create({
  model: "${model}",
  messages: [
    { role: "system", content: "${copy.systemMessage}" },
    { role: "user", content: "${copy.userMessage}" },
  ],
  max_tokens: 1024,
  temperature: 0.7,
});

console.log(response.choices[0]?.message?.content);`
  },
  {
    id: 'java',
    label: 'Java',
    code: (model, copy) => `import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("NEWAICODE_API_KEY");
    String body = """
    {
      "model": "${model}",
      "messages": [
        {"role": "system", "content": "${copy.systemMessage}"},
        {"role": "user", "content": "${copy.userMessage}"}
      ],
      "max_tokens": 1024,
      "temperature": 0.7
    }
    """;

    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("${OPENAI_COMPAT_BASE_URL}/chat/completions"))
        .header("Content-Type", "application/json")
        .header("Authorization", "Bearer " + apiKey)
        .POST(HttpRequest.BodyPublishers.ofString(body))
        .build();

    HttpResponse<String> response = HttpClient.newHttpClient()
        .send(request, HttpResponse.BodyHandlers.ofString());

    System.out.println(response.body());
  }
}`
  },
  {
    id: 'go',
    label: 'Go',
    code: (model, copy) => `package main

import (
  "bytes"
  "fmt"
  "io"
  "net/http"
  "os"
)

func main() {
  body := []byte(\`{
    "model": "${model}",
    "messages": [
      {"role": "system", "content": "${copy.systemMessage}"},
      {"role": "user", "content": "${copy.userMessage}"}
    ],
    "max_tokens": 1024,
    "temperature": 0.7
  }\`)

  request, _ := http.NewRequest("POST", "${OPENAI_COMPAT_BASE_URL}/chat/completions", bytes.NewBuffer(body))
  request.Header.Set("Content-Type", "application/json")
  request.Header.Set("Authorization", "Bearer "+os.Getenv("NEWAICODE_API_KEY"))

  response, err := http.DefaultClient.Do(request)
  if err != nil {
    panic(err)
  }
  defer response.Body.Close()
  responseBody, _ := io.ReadAll(response.Body)
  fmt.Println(string(responseBody))
}`
  },
  {
    id: 'shell',
    label: 'Shell',
    code: (model, copy) => `#!/usr/bin/env bash

API_KEY="${copy.apiKeyPlaceholder}"
MODEL_ID="${model}"
BASE_URL="${PUBLIC_API_BASE_URL}"

curl -X POST "$BASE_URL/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $API_KEY" \\
  -d '{
    "model": "'"$MODEL_ID"'",
    "messages": [
      {
        "role": "system",
        "content": "${copy.systemMessage}"
      },
      {
        "role": "user",
        "content": "${copy.userMessage}"
      }
    ],
    "max_tokens": 1024,
    "temperature": 0.7
  }'`
  }
];

const PROVIDER_FILTERS: ProviderFilter[] = [
  { id: 'all', labelKey: 'allModels', mark: 'All', className: 'all' },
  { id: 'anthropic', labelKey: 'claude', mark: 'AI', className: 'claude' },
  { id: 'openai', labelKey: 'gpt', mark: 'GPT', className: 'gpt' },
  { id: 'google', labelKey: 'gemini', mark: 'G', className: 'google' },
  { id: 'deepseek', labelKey: 'deepseek', mark: 'DS', className: 'deepseek' },
  { id: 'glm', labelKey: 'glm', mark: 'GLM', className: 'glm' },
  { id: 'other', labelKey: 'other', mark: 'AI', className: 'other' }
];

export default function PricingPage() {
  const router = useRouter();
  const { language } = useI18n();
  const copy = getPricingCopy(language);
  const [pricing, setPricing] = useState<PricingResponse | null>(null);
  const [query, setQuery] = useState('');
  const [activeProvider, setActiveProvider] = useState<ProviderId>('all');
  const [copiedModel, setCopiedModel] = useState('');
  const [copiedGuide, setCopiedGuide] = useState('');
  const [selectedModel, setSelectedModel] = useState<PricingModel | null>(null);
  const [activeGuide, setActiveGuide] = useState<IntegrationGuideId>('claude-code');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const pricingRequestSeq = useRef(0);

  useEffect(() => {
    void loadPricing();
  }, [language]);

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
    const requestId = pricingRequestSeq.current + 1;
    pricingRequestSeq.current = requestId;
    setIsLoading(true);
    setError('');

    try {
      const result = await getModelPricing(language);
      if (requestId !== pricingRequestSeq.current) {
        return;
      }
      setPricing(result);
    } catch (nextError) {
      if (requestId !== pricingRequestSeq.current) {
        return;
      }
      const message = nextError instanceof Error ? nextError.message : '';
      setError(copy.loadFailed);
      if (message.startsWith('401:') || message.includes('认证') || message.includes('會話') || message.includes('会话')) {
        router.replace('/login');
      }
    } finally {
      if (requestId === pricingRequestSeq.current) {
        setIsLoading(false);
      }
    }
  }

  async function copyModelName(model: string) {
    setError('');
    setCopiedModel('');

    try {
      await navigator.clipboard.writeText(model);
      setCopiedModel(model);
    } catch {
      setError(copy.copyModelError);
    }
  }

  async function copyIntegrationCode(model: PricingModel, guide: IntegrationGuide) {
    setError('');
    setCopiedModel('');
    setCopiedGuide('');

    try {
      await navigator.clipboard.writeText(guide.code(model.model, copy));
      setCopiedGuide(copy.copyCodeSuccess(guide.label, model.model));
    } catch {
      setError(copy.copyCodeError);
    }
  }

  function openIntegrationGuide(model: PricingModel) {
    setSelectedModel(model);
    setActiveGuide('claude-code');
    setCopiedModel('');
    setCopiedGuide('');
    setError('');
  }

  return (
    <ConsoleShell activePath="/models" isRefreshing={isLoading} onRefresh={() => void loadPricing()}>
      <section className="console-content-grid">
        <section className="account-panel account-summary pricing-market-header">
          <div>
            <p className="eyebrow">{copy.pricingEyebrow}</p>
            <h1>{copy.title}</h1>
            <small>{isLoading ? copy.loading : copy.modelCount(pricing?.models.length ?? 0)}</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadPricing()} title={copy.refreshPrices} type="button">
            <ReloadOutlined />
          </button>
        </section>

        <div className="metric-panel">
          <span>{copy.allModels}</span>
          <strong>{pricing?.models.length ?? 0}</strong>
          <small>{copy.currentAccountAvailable}</small>
        </div>
        <div className="metric-panel">
          <span>{copy.paidModels}</span>
          <strong>{paidModelCount}</strong>
          <small>{copy.hasInputOrOutputPrice}</small>
        </div>
        <div className="metric-panel">
          <span>{copy.searchResults}</span>
          <strong>{filteredModels.length}</strong>
          <small>{copy.paidModelCount(paidModelCount)}</small>
        </div>

        {error ? <p className="form-error wide-panel">{error}</p> : null}
        {copiedGuide ? <p className="form-success wide-panel">{copiedGuide}</p> : null}
        {copiedModel ? <p className="form-success wide-panel">{copy.copyModelSuccess(copiedModel)}</p> : null}

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <CalculatorOutlined />
            <h2>{copy.billingPolicy}</h2>
          </div>
          <div className="formula-box">
            <strong>{copy.billingPolicyBody}</strong>
            <small>{copy.billingPolicyHint}</small>
          </div>
        </section>

        <section className="account-panel wide-panel pricing-market-panel">
          <div className="pricing-market-topbar">
            <div className="panel-title">
              <AppstoreOutlined />
              <h2>{copy.title}</h2>
            </div>
            <label className="pricing-search">
              <SearchOutlined />
              <input
                aria-label={copy.searchAria}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.searchPlaceholder}
                type="search"
                value={query}
              />
            </label>
          </div>

          <div className="pricing-market-shell">
            <aside className="pricing-category-pane" aria-label={copy.modelCategory}>
              <PricingProviderGroup activeId={activeProvider} copy={copy} items={providerStats} onChange={setActiveProvider} />
            </aside>

            <div className="pricing-model-grid">
              {filteredModels.map((model) => (
                <PricingModelCard key={model.model} copy={copy} model={model} onCopy={copyModelName} onSelect={openIntegrationGuide} />
              ))}
              {!isLoading && filteredModels.length === 0 ? (
                <div className="pricing-empty-state">
                  <SearchOutlined />
                  <strong>{copy.noModelsTitle}</strong>
                  <span>{copy.noModelsDescription}</span>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {selectedModel ? (
          <PricingIntegrationDialog
            activeGuide={activeGuide}
            copy={copy}
            model={selectedModel}
            onActiveGuideChange={setActiveGuide}
            onClose={() => setSelectedModel(null)}
            onCopy={copyIntegrationCode}
          />
        ) : null}
      </section>
    </ConsoleShell>
  );
}

function PricingProviderGroup({
  activeId,
  copy,
  items,
  onChange
}: {
  activeId: ProviderId;
  copy: PricingCopy;
  items: Array<ProviderFilter & { count: number }>;
  onChange: (id: ProviderId) => void;
}) {
  return (
    <section className="pricing-category-group">
      <h3>{copy.modelCategory}</h3>
      {items.map((item) => {
        const label = getProviderLabel(item, copy);
        return (
          <button
            className={`pricing-provider-button ${activeId === item.id ? 'active' : ''}`}
            disabled={item.count === 0}
            key={item.id}
            onClick={() => onChange(item.id)}
            type="button"
          >
            <ModelBrandMark brand={getProviderBrand(item.id)} className="compact" label={label} mark={item.mark} />
            <strong>{label}</strong>
            <em>{item.count}</em>
          </button>
        );
      })}
    </section>
  );
}

function PricingModelCard({
  copy,
  model,
  onCopy,
  onSelect
}: {
  copy: PricingCopy;
  model: PricingModel;
  onCopy: (model: string) => Promise<void>;
  onSelect: (model: PricingModel) => void;
}) {
  const groupMultiplier = Number(model.groupMultiplier);
  const effectiveInputPrice = model.inputPriceCentsPer1k * groupMultiplier;
  const effectiveOutputPrice = model.outputPriceCentsPer1k * groupMultiplier;
  const provider = getProviderMeta(getModelProvider(model));
  const providerLabel = getProviderLabel(provider, copy);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    onSelect(model);
  }

  return (
    <article
      aria-label={copy.viewIntegrationExamples(model.model)}
      className="pricing-model-card"
      onClick={() => onSelect(model)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <header>
        <ModelBrandMark brand={getProviderBrand(provider.id)} label={providerLabel} mark={provider.mark} />
        <div>
          <div className="pricing-card-tags">
            <span>{providerLabel}</span>
            <span>{copy.officialResource}</span>
          </div>
          <h3>{model.model}</h3>
          {model.displayName ? <small>{model.displayName}</small> : null}
        </div>
      </header>

      <div className="pricing-card-prices">
        <div>
          <strong>{formatUsdPer1m(effectiveInputPrice)}</strong>
          <span>{copy.input}</span>
        </div>
        <div>
          <strong>{formatUsdPer1m(effectiveOutputPrice)}</strong>
          <span>{copy.output}</span>
        </div>
      </div>

      <footer>
        {model.supportsStream ? (
          <span className="status-pill status-pill-success">{copy.supportsStreaming}</span>
        ) : (
          <span className="status-pill status-pill-muted">{copy.standardOutput}</span>
        )}
        <button
          className="ghost-button compact-button"
          onClick={(event) => {
            event.stopPropagation();
            void onCopy(model.model);
          }}
          type="button"
        >
          <CopyOutlined />
          {copy.copy}
        </button>
      </footer>
    </article>
  );
}

function PricingIntegrationDialog({
  activeGuide,
  copy,
  model,
  onActiveGuideChange,
  onClose,
  onCopy
}: {
  activeGuide: IntegrationGuideId;
  copy: PricingCopy;
  model: PricingModel;
  onActiveGuideChange: (guide: IntegrationGuideId) => void;
  onClose: () => void;
  onCopy: (model: PricingModel, guide: IntegrationGuide) => Promise<void>;
}) {
  const provider = getProviderMeta(getModelProvider(model));
  const providerLabel = getProviderLabel(provider, copy);
  const guide = INTEGRATION_GUIDES.find((item) => item.id === activeGuide) ?? INTEGRATION_GUIDES[0];
  const groupMultiplier = Number(model.groupMultiplier);
  const effectiveInputPrice = model.inputPriceCentsPer1k * groupMultiplier;
  const effectiveOutputPrice = model.outputPriceCentsPer1k * groupMultiplier;
  const codeLines = guide.code(model.model, copy).split('\n');

  return (
    <div
      aria-labelledby="pricing-integration-title"
      aria-modal="true"
      className="pricing-integration-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
    >
      <section className="pricing-integration-modal">
        <header className="pricing-integration-header">
          <div className="pricing-integration-title">
            <ModelBrandMark brand={getProviderBrand(provider.id)} label={providerLabel} mark={provider.mark} />
            <div>
              <span>{providerLabel}</span>
              <h2 id="pricing-integration-title">{model.model}</h2>
              {model.displayName ? <p>{model.displayName}</p> : null}
            </div>
          </div>
          <button className="icon-button" onClick={onClose} title={copy.close} type="button">
            <CloseOutlined />
          </button>
        </header>

        <div className="pricing-integration-summary">
          <div>
            <span>{copy.apiBase}</span>
            <code>{OPENAI_COMPAT_BASE_URL}</code>
          </div>
          <div>
            <span>{copy.apiPath}</span>
            <code>/chat/completions</code>
          </div>
          <div>
            <span>{copy.inputPrice}</span>
            <strong>{formatUsdPer1m(effectiveInputPrice)}</strong>
          </div>
          <div>
            <span>{copy.outputPrice}</span>
            <strong>{formatUsdPer1m(effectiveOutputPrice)}</strong>
          </div>
        </div>

        <section className="pricing-integration-guide">
          <div className="pricing-guide-heading">
            <div>
              <h3>{copy.integrationHeading}</h3>
              <p>{copy.integrationDescription}</p>
            </div>
            <button className="ghost-button compact-button" onClick={() => void onCopy(model, guide)} type="button">
              <CopyOutlined />
              {copy.copy}
            </button>
          </div>

          <div className="pricing-guide-tabs" role="tablist" aria-label={copy.integrationExamples}>
            {INTEGRATION_GUIDES.map((item) => (
              <button
                aria-selected={guide.id === item.id}
                className={guide.id === item.id ? 'active' : ''}
                key={item.id}
                onClick={() => onActiveGuideChange(item.id)}
                role="tab"
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="pricing-guide-mode">{copy.modeChat}</div>

          <pre className="pricing-code-block" aria-label={copy.codeAria(guide.label)}>
            {codeLines.map((line, index) => (
              <code className="pricing-code-line" key={`${guide.id}-${index}`}>
                <span>{index + 1}</span>
                <em>{line || ' '}</em>
              </code>
            ))}
          </pre>
        </section>
      </section>
    </div>
  );
}

const PRICING_COPY_OVERRIDES: Partial<Record<LanguageCode, CopyOverrides<PricingCopy>>> = {
  'es-ES': {
    allModels: 'Todos los modelos',
    billingPolicy: 'Reglas de cobro',
    billingPolicyBody: 'Los tokens registran solo el uso real; los precios se muestran en USD / 1M tokens.',
    billingPolicyHint: 'Al descontar saldo, el sistema convierte el importe a CNY con el tipo de cambio actual.',
    close: 'Cerrar',
    copy: 'Copiar',
    currentAccountAvailable: 'Disponible para la cuenta actual',
    hasInputOrOutputPrice: 'La entrada o salida tiene precio unitario',
    input: 'Entrada',
    inputPrice: 'Precio de entrada',
    integrationDescription: 'Crea una clave API en la pagina de tokens y sustituye el nombre del modelo del ejemplo.',
    integrationExamples: 'Ejemplos de integracion',
    integrationHeading: 'Usa los siguientes ejemplos de codigo para integrar nuestra API:',
    loading: 'Cargando',
    loadFailed: 'No se pudo cargar la informacion de precios',
    modelCategory: 'Categoria de modelo',
    noModelsDescription: 'Cambia la categoria o la busqueda.',
    noModelsTitle: 'Sin modelos coincidentes',
    officialResource: 'Recurso oficial',
    other: 'Otros',
    output: 'Salida',
    outputPrice: 'Precio de salida',
    paidModels: 'Modelos de pago',
    pricingEyebrow: 'Precios',
    refreshPrices: 'Actualizar precios',
    searchAria: 'Buscar modelos',
    searchPlaceholder: 'Buscar por modelo o nombre visible',
    searchResults: 'Resultados',
    standardOutput: 'Salida estandar',
    supportsStreaming: 'Streaming',
    title: 'Mercado de modelos'
  },
  'fr-FR': {
    allModels: 'Tous les modeles',
    billingPolicy: 'Regles de facturation',
    billingPolicyBody: 'Les tokens ne comptent que l usage reel; les prix sont affiches en USD / 1M tokens.',
    billingPolicyHint: 'Lors du debit du solde, le montant est converti en CNY avec le taux actuel.',
    close: 'Fermer',
    copy: 'Copier',
    currentAccountAvailable: 'Disponible pour le compte actuel',
    hasInputOrOutputPrice: 'L entree ou la sortie a un prix unitaire',
    input: 'Entree',
    inputPrice: 'Prix entree',
    integrationDescription: 'Creez une cle API dans la page Tokens, puis remplacez le modele dans l exemple.',
    integrationExamples: 'Exemples d integration',
    integrationHeading: 'Utilisez ces exemples de code pour integrer notre API :',
    loading: 'Chargement',
    loadFailed: 'Echec du chargement des tarifs',
    modelCategory: 'Categorie de modele',
    noModelsDescription: 'Changez de categorie ou de recherche.',
    noModelsTitle: 'Aucun modele correspondant',
    officialResource: 'Ressource officielle',
    other: 'Autres',
    output: 'Sortie',
    outputPrice: 'Prix sortie',
    paidModels: 'Modeles payants',
    pricingEyebrow: 'Tarifs',
    refreshPrices: 'Actualiser les prix',
    searchAria: 'Rechercher des modeles',
    searchPlaceholder: 'Rechercher un modele ou un nom affiche',
    searchResults: 'Resultats',
    standardOutput: 'Sortie standard',
    supportsStreaming: 'Streaming',
    title: 'Marche des modeles'
  },
  'de-DE': {
    allModels: 'Alle Modelle',
    billingPolicy: 'Abrechnungsregeln',
    billingPolicyBody: 'Tokens erfassen nur echte Nutzung; Preise werden in USD / 1M Tokens angezeigt.',
    billingPolicyHint: 'Beim Abbuchen wird der Betrag mit dem aktuellen Kurs in CNY umgerechnet.',
    close: 'Schliessen',
    copy: 'Kopieren',
    currentAccountAvailable: 'Fuer das aktuelle Konto verfuegbar',
    hasInputOrOutputPrice: 'Eingabe oder Ausgabe hat einen Einzelpreis',
    input: 'Eingabe',
    inputPrice: 'Eingabepreis',
    integrationDescription: 'Erstellen Sie zuerst einen API-Schluessel auf der Token-Seite und ersetzen Sie dann den Modellnamen.',
    integrationExamples: 'Integrationsbeispiele',
    integrationHeading: 'Nutzen Sie diese Codebeispiele zur Integration unserer API:',
    loading: 'Wird geladen',
    loadFailed: 'Preisinformationen konnten nicht geladen werden',
    modelCategory: 'Modellkategorie',
    noModelsDescription: 'Wechseln Sie Kategorie oder Suchbegriff.',
    noModelsTitle: 'Keine passenden Modelle',
    officialResource: 'Offizielle Ressource',
    other: 'Andere',
    output: 'Ausgabe',
    outputPrice: 'Ausgabepreis',
    paidModels: 'Kostenpflichtige Modelle',
    pricingEyebrow: 'Preise',
    refreshPrices: 'Preise aktualisieren',
    searchAria: 'Modelle suchen',
    searchPlaceholder: 'Modell oder Anzeigenamen suchen',
    searchResults: 'Suchergebnisse',
    standardOutput: 'Standardausgabe',
    supportsStreaming: 'Streaming',
    title: 'Modellmarktplatz'
  },
  'pt-BR': {
    allModels: 'Todos os modelos',
    billingPolicy: 'Regras de cobranca',
    billingPolicyBody: 'Tokens registram apenas uso real; os precos aparecem em USD / 1M tokens.',
    billingPolicyHint: 'Ao debitar saldo, o sistema converte para CNY usando a taxa atual.',
    close: 'Fechar',
    copy: 'Copiar',
    currentAccountAvailable: 'Disponivel para a conta atual',
    hasInputOrOutputPrice: 'Entrada ou saida tem preco unitario',
    input: 'Entrada',
    inputPrice: 'Preco de entrada',
    integrationDescription: 'Crie uma chave API na pagina de tokens e substitua o modelo no exemplo.',
    integrationExamples: 'Exemplos de integracao',
    integrationHeading: 'Use estes exemplos de codigo para integrar nossa API:',
    loading: 'Carregando',
    loadFailed: 'Falha ao carregar precos',
    modelCategory: 'Categoria do modelo',
    noModelsDescription: 'Troque a categoria ou a busca.',
    noModelsTitle: 'Nenhum modelo encontrado',
    officialResource: 'Recurso oficial',
    other: 'Outros',
    output: 'Saida',
    outputPrice: 'Preco de saida',
    paidModels: 'Modelos pagos',
    pricingEyebrow: 'Precos',
    refreshPrices: 'Atualizar precos',
    searchAria: 'Pesquisar modelos',
    searchPlaceholder: 'Pesquisar modelo ou nome exibido',
    searchResults: 'Resultados',
    standardOutput: 'Saida padrao',
    supportsStreaming: 'Streaming',
    title: 'Mercado de modelos'
  },
  'ja-JP': {
    allModels: 'すべてのモデル',
    billingPolicy: '課金ルール',
    billingPolicyBody: 'token は実使用量だけを記録し、価格は USD / 100万 tokens で表示します。',
    billingPolicyHint: '残高を差し引くときは、現在の為替レートで人民元に換算します。',
    close: '閉じる',
    copy: 'コピー',
    currentAccountAvailable: '現在のアカウントで利用可能',
    hasInputOrOutputPrice: '入力または出力に単価あり',
    input: '入力',
    inputPrice: '入力価格',
    integrationDescription: 'トークンページで API キーを作成し、例のモデル名を現在のモデルに置き換えてください。',
    integrationExamples: '連携例',
    integrationHeading: '以下のコード例で API を連携できます:',
    loading: '読み込み中',
    loadFailed: '料金情報の読み込みに失敗しました',
    modeChat: 'チャット',
    modelCategory: 'モデル分類',
    modelCount: (count) => `${count} 個の利用可能モデル`,
    noModelsDescription: '分類または検索語を変更してください。',
    noModelsTitle: '一致するモデルはありません',
    officialResource: '公式リソース',
    other: 'その他',
    output: '出力',
    outputPrice: '出力価格',
    paidModelCount: (count) => `課金モデル ${count} 個`,
    paidModels: '課金モデル',
    pricingEyebrow: '料金',
    refreshPrices: '価格を更新',
    searchAria: 'モデルを検索',
    searchPlaceholder: 'モデル名または表示名を検索',
    searchResults: '検索結果',
    standardOutput: '通常出力',
    supportsStreaming: 'ストリーミング対応',
    systemMessage: 'あなたは役に立つアシスタントです。',
    title: 'モデルマーケット',
    userMessage: 'こんにちは。あなた自身を簡単に紹介してください。',
    viewIntegrationExamples: (model) => `${model} の連携例を見る`
  },
  'ko-KR': {
    allModels: '전체 모델',
    billingPolicy: '과금 기준',
    billingPolicyBody: 'token 은 실제 사용량만 기록하며 가격은 USD / 1M tokens 로 표시됩니다.',
    billingPolicyHint: '잔액 차감 시 현재 환율로 CNY 금액으로 환산합니다.',
    close: '닫기',
    copy: '복사',
    currentAccountAvailable: '현재 계정에서 사용 가능',
    hasInputOrOutputPrice: '입력 또는 출력 단가 있음',
    input: '입력',
    inputPrice: '입력 가격',
    integrationExamples: '연동 예시',
    loading: '불러오는 중',
    loadFailed: '가격 정보를 불러오지 못했습니다',
    modelCategory: '모델 분류',
    officialResource: '공식 리소스',
    output: '출력',
    outputPrice: '출력 가격',
    paidModels: '유료 모델',
    pricingEyebrow: '가격',
    refreshPrices: '가격 새로고침',
    searchPlaceholder: '모델명 또는 표시 이름 검색',
    searchResults: '검색 결과',
    supportsStreaming: '스트리밍 지원',
    title: '모델 마켓'
  },
  'ru-RU': {
    allModels: 'Все модели',
    billingPolicy: 'Правила списания',
    billingPolicyBody: 'Токены отражают только реальное использование; цены указаны в USD / 1M tokens.',
    billingPolicyHint: 'При списании баланса сумма конвертируется в CNY по текущему курсу.',
    close: 'Закрыть',
    copy: 'Копировать',
    currentAccountAvailable: 'Доступно текущему аккаунту',
    input: 'Ввод',
    inputPrice: 'Цена ввода',
    integrationExamples: 'Примеры интеграции',
    loading: 'Загрузка',
    loadFailed: 'Не удалось загрузить цены',
    modelCategory: 'Категория моделей',
    officialResource: 'Официальный ресурс',
    output: 'Вывод',
    outputPrice: 'Цена вывода',
    paidModels: 'Платные модели',
    pricingEyebrow: 'Цены',
    refreshPrices: 'Обновить цены',
    searchPlaceholder: 'Поиск по модели или названию',
    searchResults: 'Результаты поиска',
    supportsStreaming: 'Поддержка стриминга',
    title: 'Маркет моделей'
  },
  'ar-EG': {
    allModels: 'كل النماذج',
    billingPolicy: 'قواعد الفوترة',
    billingPolicyBody: 'تسجل الرموز الاستخدام الحقيقي فقط، وتعرض الاسعار بالدولار لكل مليون رمز.',
    billingPolicyHint: 'عند خصم الرصيد يتم التحويل الى CNY حسب سعر الصرف الحالي.',
    close: 'اغلاق',
    copy: 'نسخ',
    currentAccountAvailable: 'متاح للحساب الحالي',
    input: 'الادخال',
    inputPrice: 'سعر الادخال',
    integrationExamples: 'امثلة التكامل',
    loading: 'جار التحميل',
    loadFailed: 'فشل تحميل الاسعار',
    modelCategory: 'تصنيف النماذج',
    officialResource: 'مورد رسمي',
    output: 'الاخراج',
    outputPrice: 'سعر الاخراج',
    paidModels: 'نماذج مدفوعة',
    pricingEyebrow: 'الاسعار',
    refreshPrices: 'تحديث الاسعار',
    searchPlaceholder: 'ابحث باسم النموذج او اسم العرض',
    searchResults: 'نتائج البحث',
    supportsStreaming: 'يدعم البث',
    title: 'سوق النماذج'
  },
  'sw-KE': {
    allModels: 'Miundo yote',
    billingPolicy: 'Kanuni za malipo',
    billingPolicyBody: 'Tokeni hurekodi matumizi halisi pekee; bei huonyeshwa kwa USD / tokeni 1M.',
    billingPolicyHint: 'Salio linapokatwa, mfumo hubadilisha kiasi kuwa CNY kwa kiwango cha sasa.',
    close: 'Funga',
    copy: 'Nakili',
    currentAccountAvailable: 'Inapatikana kwa akaunti ya sasa',
    input: 'Ingizo',
    inputPrice: 'Bei ya ingizo',
    integrationExamples: 'Mifano ya kuunganisha',
    loading: 'Inapakia',
    loadFailed: 'Imeshindwa kupakia bei',
    modelCategory: 'Aina ya modeli',
    officialResource: 'Rasilimali rasmi',
    output: 'Tokeo',
    outputPrice: 'Bei ya tokeo',
    paidModels: 'Modeli za kulipia',
    pricingEyebrow: 'Bei',
    refreshPrices: 'Sasisha bei',
    searchPlaceholder: 'Tafuta jina la modeli au jina la kuonyesha',
    searchResults: 'Matokeo ya utafutaji',
    supportsStreaming: 'Inasaidia streaming',
    title: 'Soko la modeli'
  },
  'am-ET': {
    allModels: 'Hulu modeloch',
    billingPolicy: 'Ye kifiyaw sirat',
    billingPolicyBody: 'Tokenoch yemiyazut ye emet yetsiet new; kimatoch be USD / 1M tokens yitalalu.',
    billingPolicyHint: 'Balansi siqenes, sistemu wede CNY be ahun ye hig gize yilewotal.',
    close: 'Zga',
    copy: 'Kopi adrg',
    currentAccountAvailable: 'Le ahun account yiteqemal',
    input: 'Gebeta',
    inputPrice: 'Ye gebeta kimat',
    integrationExamples: 'Ye magagnent misaale',
    loading: 'Bemetchan lay',
    loadFailed: 'Kimatochun memchat alchalkem',
    modelCategory: 'Ye modeli kifl',
    officialResource: 'Rasmi mebrat',
    output: 'Wutet',
    outputPrice: 'Ye wutet kimat',
    paidModels: 'Yemikifelachew modeloch',
    pricingEyebrow: 'Kimatoch',
    refreshPrices: 'Kimatochun ades adrg',
    searchPlaceholder: 'Modeli sim weyim yemitalew sim fleg',
    searchResults: 'Ye flega witetoach',
    supportsStreaming: 'Streaming yidegafal',
    title: 'Ye modeli gebeya'
  },
  'ha-NG': {
    allModels: 'Duk modeloli',
    billingPolicy: 'Dokokin caji',
    billingPolicyBody: 'Tokens suna rubuta amfani na gaskiya kawai; ana nuna farashi a USD / 1M tokens.',
    billingPolicyHint: 'Lokacin cire kudi daga balance, tsarin yana maida adadin zuwa CNY da farashin yanzu.',
    close: 'Rufe',
    copy: 'Kwafi',
    currentAccountAvailable: 'Akwai ga asusun yanzu',
    input: 'Shigarwa',
    inputPrice: 'Farashin shigarwa',
    integrationExamples: 'Misalan hadawa',
    loading: 'Ana lodawa',
    loadFailed: 'An kasa loda farashi',
    modelCategory: 'Rukunin modeli',
    officialResource: 'Tushen hukuma',
    output: 'Fitarwa',
    outputPrice: 'Farashin fitarwa',
    paidModels: 'Modelolin biya',
    pricingEyebrow: 'Farashi',
    refreshPrices: 'Sabunta farashi',
    searchPlaceholder: 'Nemi sunan modeli ko sunan nunawa',
    searchResults: 'Sakamakon nema',
    supportsStreaming: 'Yana goyon bayan streaming',
    title: 'Kasuwar modeloli'
  },
  'yo-NG': {
    allModels: 'Gbogbo awoṣe',
    billingPolicy: 'Awon ofin isanwo',
    billingPolicyBody: 'Tokens n ka lilo gidi nikan; owo han ni USD / 1M tokens.',
    billingPolicyHint: 'Nigbati a ba yo owo kuro, eto naa yi iye pada si CNY pelu osuwon lowolowo.',
    close: 'Pa',
    copy: 'Daako',
    currentAccountAvailable: 'Wa fun akanti lowolowo',
    input: 'Iwole',
    inputPrice: 'Owo iwole',
    integrationExamples: 'Awon apeere isopo',
    loading: 'N kojopo',
    loadFailed: 'Ko le kojopo owo',
    modelCategory: 'Eka awoṣe',
    officialResource: 'Orisun osise',
    output: 'Ijade',
    outputPrice: 'Owo ijade',
    paidModels: 'Awon awoṣe isanwo',
    pricingEyebrow: 'Owo',
    refreshPrices: 'Tun owo se',
    searchPlaceholder: 'Wa oruko awoṣe tabi oruko ifihan',
    searchResults: 'Awon esi wiwa',
    supportsStreaming: 'Se atileyin streaming',
    title: 'Oja awoṣe'
  },
  'ig-NG': {
    allModels: 'Udi niile',
    billingPolicy: 'Iwu igwa ugwo',
    billingPolicyBody: 'Tokens na-edekọ naanị ojiji eziokwu; egosiri ọnụahịa na USD / 1M tokens.',
    billingPolicyHint: 'Mgbe a na-ewepu balance, usoro na-agbanwe ego gaa CNY site na ọnụego ugbu a.',
    close: 'Mechie',
    copy: 'Detuo',
    currentAccountAvailable: 'Di maka akauntu ugbu a',
    input: 'Ntinye',
    inputPrice: 'Onuahia ntinye',
    integrationExamples: 'Ihe atu njikota',
    loading: 'Na-ebudata',
    loadFailed: 'Ibudata onuahia dara',
    modelCategory: 'Ngalaba modeli',
    officialResource: 'Isi mmalite gọọmenti',
    output: 'Mweputa',
    outputPrice: 'Onuahia mweputa',
    paidModels: 'Modeli akwu ugwo',
    pricingEyebrow: 'Onuahia',
    refreshPrices: 'Melite onuahia',
    searchPlaceholder: 'Choo aha modeli ma obu aha ngosi',
    searchResults: 'Nsonaazu ochucho',
    supportsStreaming: 'Na-akwado streaming',
    title: 'Ahia modeli'
  },
  'zu-ZA': {
    allModels: 'Wonke amamodeli',
    billingPolicy: 'Imithetho yokukhokhisa',
    billingPolicyBody: 'Ama-token aqopha ukusetshenziswa kwangempela kuphela; amanani aboniswa ngo-USD / 1M tokens.',
    billingPolicyHint: 'Uma ibhalansi idonswa, uhlelo luguqulela inani ku-CNY ngesilinganiso samanje.',
    close: 'Vala',
    copy: 'Kopisha',
    currentAccountAvailable: 'Kuyatholakala ku-akhawunti yamanje',
    input: 'Okufakwayo',
    inputPrice: 'Intengo yokufaka',
    integrationExamples: 'Izibonelo zokuhlanganisa',
    loading: 'Iyalayisha',
    loadFailed: 'Yehlulekile ukulayisha amanani',
    modelCategory: 'Isigaba semodeli',
    officialResource: 'Insiza esemthethweni',
    output: 'Okuphumayo',
    outputPrice: 'Intengo yokuphumayo',
    paidModels: 'Amamodeli akhokhelwayo',
    pricingEyebrow: 'Amanani',
    refreshPrices: 'Vuselela amanani',
    searchPlaceholder: 'Sesha igama lemodeli noma igama lokubonisa',
    searchResults: 'Imiphumela yokusesha',
    supportsStreaming: 'Isekela streaming',
    title: 'Imakethe yamamodeli'
  },
  'af-ZA': {
    allModels: 'Alle modelle',
    billingPolicy: 'Faktuurreels',
    billingPolicyBody: 'Tokens teken net werklike gebruik aan; pryse word in USD / 1M tokens gewys.',
    billingPolicyHint: 'Wanneer balans afgetrek word, skakel die stelsel die bedrag na CNY teen die huidige koers om.',
    close: 'Sluit',
    copy: 'Kopieer',
    currentAccountAvailable: 'Beskikbaar vir die huidige rekening',
    input: 'Invoer',
    inputPrice: 'Invoerprys',
    integrationExamples: 'Integrasievoorbeelde',
    loading: 'Laai',
    loadFailed: 'Kon pryse nie laai nie',
    modelCategory: 'Modelkategorie',
    officialResource: 'Amptelike hulpbron',
    output: 'Uitvoer',
    outputPrice: 'Uitvoerprys',
    paidModels: 'Betaalde modelle',
    pricingEyebrow: 'Pryse',
    refreshPrices: 'Verfris pryse',
    searchPlaceholder: 'Soek modelnaam of vertoonnaam',
    searchResults: 'Soekresultate',
    supportsStreaming: 'Ondersteun streaming',
    title: 'Modelmark'
  },
  'so-SO': {
    allModels: 'Dhammaan moodellada',
    billingPolicy: 'Xeerarka lacag-bixinta',
    billingPolicyBody: 'Tokens waxay diiwaangeliyaan isticmaalka dhabta ah oo keliya; qiimaha waxaa lagu muujiyaa USD / 1M tokens.',
    billingPolicyHint: 'Marka hadhaaga la jaro, nidaamku wuxuu u beddelaa CNY iyadoo la adeegsanayo sarifka hadda.',
    close: 'Xir',
    copy: 'Nuqul',
    currentAccountAvailable: 'Waxaa heli kara koontada hadda',
    input: 'Gelinta',
    inputPrice: 'Qiimaha gelinta',
    integrationExamples: 'Tusaalooyin isku xirka',
    loading: 'Wuu rarayaa',
    loadFailed: 'Qiimaha lama rarin',
    modelCategory: 'Qaybta moodellada',
    officialResource: 'Kheyraad rasmi ah',
    output: 'Soo saarid',
    outputPrice: 'Qiimaha soo saarid',
    paidModels: 'Moodello lacag leh',
    pricingEyebrow: 'Qiimaha',
    refreshPrices: 'Cusbooneysii qiimaha',
    searchPlaceholder: 'Raadi magaca moodellada ama magaca muuqda',
    searchResults: 'Natiijooyinka raadinta',
    supportsStreaming: 'Waxay taageertaa streaming',
    title: 'Suuqa moodellada'
  },
  'rw-RW': {
    allModels: 'Modeli zose',
    billingPolicy: 'Amategeko yo kwishyuza',
    billingPolicyBody: 'Tokens zibika gusa ikoreshwa nyaryo; ibiciro bigaragazwa muri USD / 1M tokens.',
    billingPolicyHint: 'Iyo amafaranga akuwe kuri balance, sisitemu iyahindura muri CNY ikurikije igipimo kiriho.',
    close: 'Funga',
    copy: 'Koporora',
    currentAccountAvailable: 'Biraboneka kuri konti iriho',
    input: 'Ibyinjira',
    inputPrice: 'Igiciro cyibyinjira',
    integrationExamples: 'Ingero zo guhuza',
    loading: 'Birimo gupakira',
    loadFailed: 'Kunanirwa gupakira ibiciro',
    modelCategory: 'Icyiciro cya modeli',
    officialResource: 'Isoko ryemewe',
    output: 'Ibisohoka',
    outputPrice: 'Igiciro cyibisohoka',
    paidModels: 'Modeli zishyurwa',
    pricingEyebrow: 'Ibiciro',
    refreshPrices: 'Vugurura ibiciro',
    searchPlaceholder: 'Shaka izina rya modeli cyangwa izina rigaragara',
    searchResults: 'Ibisubizo byishakisha',
    supportsStreaming: 'Ishyigikira streaming',
    title: 'Isoko rya modeli'
  },
  'om-ET': {
    allModels: 'Moodeelota hunda',
    billingPolicy: 'Seerota kaffaltii',
    billingPolicyBody: 'Tokenonni itti fayyadama dhugaa qofa galmeessu; gatiin USD / 1M tokens tiin agarsiifama.',
    billingPolicyHint: 'Yeroo balance hiratu, sirni gara CNY tti jijjiira sadarkaa yeroo ammaa fayyadamuun.',
    close: 'Cufi',
    copy: 'Garagalchi',
    currentAccountAvailable: 'Herrega ammaa irratti ni argama',
    input: 'Galtee',
    inputPrice: 'Gatii galtee',
    integrationExamples: 'Fakkeenya walitti hidhuu',
    loading: 'Feamaa jira',
    loadFailed: 'Gatii feuu hin dandeenye',
    modelCategory: 'Ramaddii moodeela',
    officialResource: 'Madda rasmii',
    output: 'Buaa',
    outputPrice: 'Gatii buaa',
    paidModels: 'Moodeelota kaffaltii',
    pricingEyebrow: 'Gatii',
    refreshPrices: 'Gatii haaromsi',
    searchPlaceholder: 'Maqaa moodeela ykn maqaa agarsiisaa barbaadi',
    searchResults: 'Buaa barbaacha',
    supportsStreaming: 'Streaming ni deeggara',
    title: 'Gabaa moodeela'
  },
  'hi-IN': {
    allModels: 'सभी मॉडल',
    billingPolicy: 'बिलिंग नियम',
    billingPolicyBody: 'token केवल वास्तविक उपयोग दर्ज करता है; कीमत USD / 1M tokens में दिखती है.',
    billingPolicyHint: 'बैलेंस कटने पर राशि वर्तमान विनिमय दर से CNY में बदलेगी.',
    close: 'बंद करें',
    copy: 'कॉपी',
    currentAccountAvailable: 'मौजूदा खाते के लिए उपलब्ध',
    input: 'इनपुट',
    inputPrice: 'इनपुट कीमत',
    integrationExamples: 'इंटीग्रेशन उदाहरण',
    loading: 'लोड हो रहा है',
    loadFailed: 'कीमतें लोड नहीं हुईं',
    modelCategory: 'मॉडल श्रेणी',
    officialResource: 'आधिकारिक संसाधन',
    output: 'आउटपुट',
    outputPrice: 'आउटपुट कीमत',
    paidModels: 'सशुल्क मॉडल',
    pricingEyebrow: 'कीमतें',
    refreshPrices: 'कीमतें रीफ्रेश करें',
    searchPlaceholder: 'मॉडल या डिस्प्ले नाम खोजें',
    searchResults: 'खोज परिणाम',
    supportsStreaming: 'स्ट्रीमिंग समर्थित',
    title: 'मॉडल मार्केट'
  },
  'id-ID': {
    allModels: 'Semua model',
    billingPolicy: 'Aturan penagihan',
    billingPolicyBody: 'Token hanya mencatat pemakaian nyata; harga ditampilkan dalam USD / 1M tokens.',
    billingPolicyHint: 'Saat saldo dipotong, sistem mengonversi ke CNY memakai kurs saat ini.',
    close: 'Tutup',
    copy: 'Salin',
    currentAccountAvailable: 'Tersedia untuk akun saat ini',
    input: 'Input',
    inputPrice: 'Harga input',
    integrationExamples: 'Contoh integrasi',
    loading: 'Memuat',
    loadFailed: 'Gagal memuat harga',
    modelCategory: 'Kategori model',
    officialResource: 'Sumber resmi',
    output: 'Output',
    outputPrice: 'Harga output',
    paidModels: 'Model berbayar',
    pricingEyebrow: 'Harga',
    refreshPrices: 'Segarkan harga',
    searchPlaceholder: 'Cari nama model atau nama tampilan',
    searchResults: 'Hasil pencarian',
    supportsStreaming: 'Mendukung streaming',
    title: 'Pasar model'
  },
  'tr-TR': {
    allModels: 'Tum modeller',
    billingPolicy: 'Ucretlendirme kurallari',
    billingPolicyBody: 'Token yalnizca gercek kullanimi kaydeder; fiyatlar USD / 1M tokens olarak gosterilir.',
    billingPolicyHint: 'Bakiye dusulurken tutar guncel kurla CNY ye cevrilir.',
    close: 'Kapat',
    copy: 'Kopyala',
    currentAccountAvailable: 'Mevcut hesap icin kullanilabilir',
    input: 'Girdi',
    inputPrice: 'Girdi fiyati',
    integrationExamples: 'Entegrasyon ornekleri',
    loading: 'Yukleniyor',
    loadFailed: 'Fiyatlar yuklenemedi',
    modelCategory: 'Model kategorisi',
    officialResource: 'Resmi kaynak',
    output: 'Cikti',
    outputPrice: 'Cikti fiyati',
    paidModels: 'Ucretli modeller',
    pricingEyebrow: 'Fiyatlar',
    refreshPrices: 'Fiyatlari yenile',
    searchPlaceholder: 'Model veya gorunen ad ara',
    searchResults: 'Arama sonuclari',
    supportsStreaming: 'Akis destegi',
    title: 'Model pazari'
  },
  'vi-VN': {
    allModels: 'Tat ca mo hinh',
    billingPolicy: 'Quy tac tinh phi',
    billingPolicyBody: 'Token chi ghi nhan muc su dung thuc; gia hien thi bang USD / 1M tokens.',
    billingPolicyHint: 'Khi tru so du, he thong quy doi sang CNY theo ty gia hien tai.',
    close: 'Dong',
    copy: 'Sao chep',
    currentAccountAvailable: 'Kha dung cho tai khoan hien tai',
    input: 'Dau vao',
    inputPrice: 'Gia dau vao',
    integrationExamples: 'Vi du tich hop',
    loading: 'Dang tai',
    loadFailed: 'Tai gia that bai',
    modelCategory: 'Danh muc mo hinh',
    officialResource: 'Tai nguyen chinh thuc',
    output: 'Dau ra',
    outputPrice: 'Gia dau ra',
    paidModels: 'Mo hinh tinh phi',
    pricingEyebrow: 'Bang gia',
    refreshPrices: 'Lam moi gia',
    searchPlaceholder: 'Tim ten mo hinh hoac ten hien thi',
    searchResults: 'Ket qua tim kiem',
    supportsStreaming: 'Ho tro streaming',
    title: 'Cho mo hinh'
  },
  'th-TH': {
    allModels: 'โมเดลทั้งหมด',
    billingPolicy: 'กติกาการคิดเงิน',
    billingPolicyBody: 'token บันทึกเฉพาะการใช้งานจริง ราคาแสดงเป็น USD / 1M tokens',
    billingPolicyHint: 'เมื่อหักยอด ระบบจะแปลงเป็น CNY ด้วยอัตราแลกเปลี่ยนปัจจุบัน',
    close: 'ปิด',
    copy: 'คัดลอก',
    currentAccountAvailable: 'ใช้ได้กับบัญชีปัจจุบัน',
    input: 'อินพุต',
    inputPrice: 'ราคาอินพุต',
    integrationExamples: 'ตัวอย่างการเชื่อมต่อ',
    loading: 'กำลังโหลด',
    loadFailed: 'โหลดราคาไม่สำเร็จ',
    modelCategory: 'หมวดหมู่โมเดล',
    officialResource: 'แหล่งข้อมูลทางการ',
    output: 'เอาต์พุต',
    outputPrice: 'ราคาเอาต์พุต',
    paidModels: 'โมเดลคิดเงิน',
    pricingEyebrow: 'ราคา',
    refreshPrices: 'รีเฟรชราคา',
    searchPlaceholder: 'ค้นหาชื่อโมเดลหรือชื่อที่แสดง',
    searchResults: 'ผลการค้นหา',
    supportsStreaming: 'รองรับสตรีม',
    title: 'ตลาดโมเดล'
  },
  'it-IT': {
    allModels: 'Tutti i modelli',
    billingPolicy: 'Regole di addebito',
    billingPolicyBody: 'I token registrano solo l uso reale; i prezzi sono in USD / 1M tokens.',
    billingPolicyHint: 'Quando viene scalato il saldo, l importo viene convertito in CNY al cambio corrente.',
    close: 'Chiudi',
    copy: 'Copia',
    currentAccountAvailable: 'Disponibile per l account corrente',
    input: 'Input',
    inputPrice: 'Prezzo input',
    integrationExamples: 'Esempi di integrazione',
    loading: 'Caricamento',
    loadFailed: 'Caricamento prezzi non riuscito',
    modelCategory: 'Categoria modello',
    officialResource: 'Risorsa ufficiale',
    output: 'Output',
    outputPrice: 'Prezzo output',
    paidModels: 'Modelli a pagamento',
    pricingEyebrow: 'Prezzi',
    refreshPrices: 'Aggiorna prezzi',
    searchPlaceholder: 'Cerca modello o nome visualizzato',
    searchResults: 'Risultati',
    supportsStreaming: 'Supporta streaming',
    title: 'Mercato dei modelli'
  },
  'nl-NL': {
    allModels: 'Alle modellen',
    billingPolicy: 'Factureringsregels',
    billingPolicyBody: 'Tokens registreren alleen werkelijk gebruik; prijzen worden getoond in USD / 1M tokens.',
    billingPolicyHint: 'Bij afschrijving wordt het bedrag met de huidige koers naar CNY omgerekend.',
    close: 'Sluiten',
    copy: 'Kopieren',
    currentAccountAvailable: 'Beschikbaar voor het huidige account',
    input: 'Invoer',
    inputPrice: 'Invoerprijs',
    integrationExamples: 'Integratievoorbeelden',
    loading: 'Laden',
    loadFailed: 'Prijzen laden mislukt',
    modelCategory: 'Modelcategorie',
    officialResource: 'Officiele bron',
    output: 'Uitvoer',
    outputPrice: 'Uitvoerprijs',
    paidModels: 'Betaalde modellen',
    pricingEyebrow: 'Prijzen',
    refreshPrices: 'Prijzen vernieuwen',
    searchPlaceholder: 'Zoek model of weergavenaam',
    searchResults: 'Zoekresultaten',
    supportsStreaming: 'Streaming ondersteund',
    title: 'Modelmarktplaats'
  },
  'pl-PL': {
    allModels: 'Wszystkie modele',
    billingPolicy: 'Zasady rozliczen',
    billingPolicyBody: 'Tokeny rejestruja tylko rzeczywiste uzycie; ceny sa w USD / 1M tokens.',
    billingPolicyHint: 'Przy obciazaniu salda kwota jest przeliczana na CNY po aktualnym kursie.',
    close: 'Zamknij',
    copy: 'Kopiuj',
    currentAccountAvailable: 'Dostepne dla biezacego konta',
    input: 'Wejscie',
    inputPrice: 'Cena wejscia',
    integrationExamples: 'Przyklady integracji',
    loading: 'Ladowanie',
    loadFailed: 'Nie udalo sie wczytac cen',
    modelCategory: 'Kategoria modelu',
    officialResource: 'Oficjalne zrodlo',
    output: 'Wyjscie',
    outputPrice: 'Cena wyjscia',
    paidModels: 'Modele platne',
    pricingEyebrow: 'Ceny',
    refreshPrices: 'Odswiez ceny',
    searchPlaceholder: 'Szukaj modelu lub nazwy wyswietlanej',
    searchResults: 'Wyniki wyszukiwania',
    supportsStreaming: 'Obsluga streamingu',
    title: 'Rynek modeli'
  },
  'uk-UA': {
    allModels: 'Усі моделі',
    billingPolicy: 'Правила списання',
    billingPolicyBody: 'Токени фіксують лише реальне використання; ціни показані в USD / 1M tokens.',
    billingPolicyHint: 'Під час списання балансу сума конвертується в CNY за поточним курсом.',
    close: 'Закрити',
    copy: 'Копіювати',
    currentAccountAvailable: 'Доступно для поточного акаунта',
    input: 'Ввід',
    inputPrice: 'Ціна вводу',
    integrationExamples: 'Приклади інтеграції',
    loading: 'Завантаження',
    loadFailed: 'Не вдалося завантажити ціни',
    modelCategory: 'Категорія моделей',
    officialResource: 'Офіційний ресурс',
    output: 'Вивід',
    outputPrice: 'Ціна виводу',
    paidModels: 'Платні моделі',
    pricingEyebrow: 'Ціни',
    refreshPrices: 'Оновити ціни',
    searchPlaceholder: 'Пошук моделі або відображуваної назви',
    searchResults: 'Результати пошуку',
    supportsStreaming: 'Підтримує стримінг',
    title: 'Маркет моделей'
  },
  'ms-MY': {
    allModels: 'Semua model',
    billingPolicy: 'Peraturan bil',
    billingPolicyBody: 'Token hanya merekod penggunaan sebenar; harga dipaparkan dalam USD / 1M tokens.',
    billingPolicyHint: 'Apabila baki ditolak, sistem menukar jumlah kepada CNY mengikut kadar semasa.',
    close: 'Tutup',
    copy: 'Salin',
    currentAccountAvailable: 'Tersedia untuk akaun semasa',
    input: 'Input',
    inputPrice: 'Harga input',
    integrationExamples: 'Contoh integrasi',
    loading: 'Memuat',
    loadFailed: 'Gagal memuatkan harga',
    modelCategory: 'Kategori model',
    officialResource: 'Sumber rasmi',
    output: 'Output',
    outputPrice: 'Harga output',
    paidModels: 'Model berbayar',
    pricingEyebrow: 'Harga',
    refreshPrices: 'Segar semula harga',
    searchPlaceholder: 'Cari model atau nama paparan',
    searchResults: 'Hasil carian',
    supportsStreaming: 'Sokong streaming',
    title: 'Pasaran model'
  },
  'fa-IR': {
    allModels: 'همه مدل‌ها',
    billingPolicy: 'قواعد صورتحساب',
    billingPolicyBody: 'توکن فقط مصرف واقعی را ثبت می‌کند؛ قیمت‌ها به USD / 1M tokens نمایش داده می‌شوند.',
    billingPolicyHint: 'هنگام کسر موجودی، مبلغ با نرخ فعلی به CNY تبدیل می‌شود.',
    close: 'بستن',
    copy: 'کپی',
    currentAccountAvailable: 'برای حساب فعلی در دسترس است',
    input: 'ورودی',
    inputPrice: 'قیمت ورودی',
    integrationExamples: 'نمونه‌های اتصال',
    loading: 'در حال بارگذاری',
    loadFailed: 'بارگذاری قیمت‌ها ناموفق بود',
    modelCategory: 'دسته مدل',
    officialResource: 'منبع رسمی',
    output: 'خروجی',
    outputPrice: 'قیمت خروجی',
    paidModels: 'مدل‌های پولی',
    pricingEyebrow: 'قیمت‌ها',
    refreshPrices: 'به‌روزرسانی قیمت‌ها',
    searchPlaceholder: 'جستجوی نام مدل یا نام نمایشی',
    searchResults: 'نتایج جستجو',
    supportsStreaming: 'پشتیبانی از استریم',
    title: 'بازار مدل‌ها'
  }
};

function getPricingCopy(language: LanguageCode): PricingCopy {
  const base =
    language === 'zh-CN' || language === 'zh-TW' || language === 'en-US' ? PRICING_COPY[language] : PRICING_COPY['en-US'];

  return applyCopyOverrides(base, PRICING_COPY_OVERRIDES[language]);
}

function formatUsdPer1m(value: number) {
  return formatUsdPerMillionFromUnits(value);
}

function getProviderMeta(id: ProviderId) {
  return PROVIDER_FILTERS.find((item) => item.id === id) ?? PROVIDER_FILTERS[6];
}

function getProviderLabel(provider: ProviderFilter, copy: PricingCopy) {
  return copy[provider.labelKey];
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
