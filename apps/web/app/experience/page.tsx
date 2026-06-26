'use client';

import {
  AppstoreOutlined,
  ApiOutlined,
  ClearOutlined,
  DollarOutlined,
  SearchOutlined,
  ReloadOutlined,
  SendOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConsoleShell } from '../components/console-shell';
import { useI18n } from '../components/language-provider';
import { ModelBrandMark, type ModelBrandId } from '../components/model-brand-mark';
import { isAuthenticationApiError } from '../lib/api-error-copy';
import { getProfile } from '../lib/auth-api';
import { formatBillingCny, formatUsdPerMillionFromUnits } from '../lib/billing-format';
import { applyCopyOverrides, type CopyOverrides } from '../lib/copy-overrides';
import {
  ExperienceApiError,
  listExperienceModels,
  sendExperienceChat,
  type ExperienceChatMessage,
  type ExperienceChatResponse,
  type ExperienceModel
} from '../lib/experience-api';
import type { LanguageCode } from '../lib/i18n';
import { pageTerm } from '../lib/page-copy-terms';

type LocalMessage = ExperienceChatMessage & {
  id: string;
  usage?: ExperienceChatResponse['usage'];
  billing?: ExperienceChatResponse['billing'];
};

type ModelFamilyId = ModelBrandId;

type ModelFamily = {
  id: ModelFamilyId;
  mark: string;
  className: string;
};

const MODEL_FAMILIES: ModelFamily[] = [
  { id: 'all', mark: 'AI', className: 'all' },
  { id: 'gpt', mark: 'GPT', className: 'gpt' },
  { id: 'claude', mark: 'AI', className: 'claude' },
  { id: 'google', mark: 'G', className: 'google' },
  { id: 'deepseek', mark: 'DS', className: 'deepseek' },
  { id: 'glm', mark: 'GLM', className: 'glm' },
  { id: 'other', mark: 'AI', className: 'other' }
];

type ExperienceCopy = {
  balance: string;
  billingNote: string;
  clearHistory: string;
  defaultAssistantReply: string;
  defaultSystemPrompt: string;
  emptyPrompt: string;
  familyAria: string;
  familyLabels: Record<ModelFamilyId, { hint: string; label: string }>;
  input: string;
  insufficientBalance: string;
  loadFailed: string;
  maxOutput: string;
  modelConfig: string;
  modeChat: string;
  modelPlaceholder: string;
  noMatchedModels: string;
  noModels: string;
  output: string;
  promptPlaceholder: string;
  requestFailed: string;
  responding: string;
  resultBalance: string;
  send: string;
  sending: string;
  switchModel: string;
  systemPrompt: string;
  total: string;
  usageCost: string;
  userRole: string;
  selectModel: string;
};

const EXPERIENCE_COPY = {
  'zh-CN': {
    balance: '当前余额',
    billingNote: '页面显示美元单价；实际扣余额按系统汇率折算成人民币。',
    clearHistory: '清空历史',
    defaultAssistantReply: '上游返回了空内容。',
    defaultSystemPrompt: '你是一个简洁、准确的 AI 助手。',
    emptyPrompt: '当前模型按真实输入、输出 token 计费。',
    familyAria: '模型品牌分类',
    familyLabels: {
      all: { hint: 'All models', label: '全部模型' },
      claude: { hint: 'Anthropic', label: 'Claude' },
      deepseek: { hint: 'DeepSeek', label: 'DeepSeek' },
      glm: { hint: 'Zhipu', label: 'GLM' },
      google: { hint: 'Google', label: 'Gemini' },
      gpt: { hint: 'OpenAI', label: 'GPT' },
      other: { hint: 'Other', label: '其他' }
    },
    input: '输入',
    insufficientBalance: '余额不足，请前往充值',
    loadFailed: '模型体验加载失败',
    maxOutput: '最大输出',
    modelConfig: '模型配置',
    modeChat: '聊天',
    modelPlaceholder: '搜索模型名称',
    noMatchedModels: '没有匹配模型',
    noModels: '暂无模型',
    output: '输出',
    promptPlaceholder: '说点什么...（Ctrl + Enter 发送）',
    requestFailed: '模型体验请求失败',
    responding: '模型正在回复...',
    resultBalance: '余额',
    send: '发送',
    sending: '发送中',
    switchModel: '换模型',
    systemPrompt: '系统提示词',
    total: '合计',
    usageCost: '扣费',
    userRole: '你',
    selectModel: '选择模型'
  },
  'zh-TW': {
    balance: '目前餘額',
    billingNote: '頁面顯示美元單價；實際扣餘額按系統匯率折算成人民幣。',
    clearHistory: '清空歷史',
    defaultAssistantReply: '上游返回了空內容。',
    defaultSystemPrompt: '你是一個簡潔、準確的 AI 助手。',
    emptyPrompt: '目前模型按真實輸入、輸出 token 計費。',
    familyAria: '模型品牌分類',
    familyLabels: {
      all: { hint: 'All models', label: '全部模型' },
      claude: { hint: 'Anthropic', label: 'Claude' },
      deepseek: { hint: 'DeepSeek', label: 'DeepSeek' },
      glm: { hint: 'Zhipu', label: 'GLM' },
      google: { hint: 'Google', label: 'Gemini' },
      gpt: { hint: 'OpenAI', label: 'GPT' },
      other: { hint: 'Other', label: '其他' }
    },
    input: '輸入',
    insufficientBalance: '餘額不足，請前往充值',
    loadFailed: '模型體驗載入失敗',
    maxOutput: '最大輸出',
    modelConfig: '模型配置',
    modeChat: '聊天',
    modelPlaceholder: '搜尋模型名稱',
    noMatchedModels: '沒有匹配模型',
    noModels: '暫無模型',
    output: '輸出',
    promptPlaceholder: '說點什麼...（Ctrl + Enter 發送）',
    requestFailed: '模型體驗請求失敗',
    responding: '模型正在回覆...',
    resultBalance: '餘額',
    send: '發送',
    sending: '發送中',
    switchModel: '換模型',
    systemPrompt: '系統提示詞',
    total: '合計',
    usageCost: '扣費',
    userRole: '你',
    selectModel: '選擇模型'
  },
  'en-US': {
    balance: 'Current balance',
    billingNote: 'Prices are shown in USD. Actual balance deductions are converted to CNY using the system exchange rate.',
    clearHistory: 'Clear history',
    defaultAssistantReply: 'The upstream returned empty content.',
    defaultSystemPrompt: 'You are a concise and accurate AI assistant.',
    emptyPrompt: 'This model is billed by real input and output tokens.',
    familyAria: 'Model brand categories',
    familyLabels: {
      all: { hint: 'All models', label: 'All models' },
      claude: { hint: 'Anthropic', label: 'Claude' },
      deepseek: { hint: 'DeepSeek', label: 'DeepSeek' },
      glm: { hint: 'Zhipu', label: 'GLM' },
      google: { hint: 'Google', label: 'Gemini' },
      gpt: { hint: 'OpenAI', label: 'GPT' },
      other: { hint: 'Other', label: 'Other' }
    },
    input: 'Input',
    insufficientBalance: 'Insufficient balance. Please top up.',
    loadFailed: 'Failed to load model playground',
    maxOutput: 'Max output',
    modelConfig: 'Model configuration',
    modeChat: 'Chat',
    modelPlaceholder: 'Search model name',
    noMatchedModels: 'No matching models',
    noModels: 'No models',
    output: 'Output',
    promptPlaceholder: 'Say something... (Ctrl + Enter to send)',
    requestFailed: 'Model playground request failed',
    responding: 'Model is replying...',
    resultBalance: 'Balance',
    send: 'Send',
    sending: 'Sending',
    switchModel: 'Switch model',
    systemPrompt: 'System prompt',
    total: 'Total',
    usageCost: 'Charge',
    userRole: 'You',
    selectModel: 'Choose model'
  }
} satisfies Record<'zh-CN' | 'zh-TW' | 'en-US', ExperienceCopy>;

const EXPERIENCE_COPY_BY_LANGUAGE: Partial<Record<LanguageCode, CopyOverrides<ExperienceCopy>>> = {
  'ja-JP': {
    balance: '現在の残高',
    billingNote:
      '価格は米ドル建てで表示されます。実際の残高の差し引きはシステムの為替レートを使用して人民元に換算されます。',
    clearHistory: '履歴を消去',
    defaultAssistantReply: '上流から空の内容が返されました。',
    defaultSystemPrompt: 'あなたは簡潔で正確な AI アシスタントです。',
    emptyPrompt: 'このモデルは入力/出力トークンの実数に基づいて課金されます。',
    familyAria: 'モデルブランドカテゴリ',
    familyLabels: {
      all: { hint: 'すべてのモデル', label: 'すべてのモデル' },
      claude: { hint: 'Anthropic', label: 'Claude' },
      deepseek: { hint: 'DeepSeek', label: 'DeepSeek' },
      glm: { hint: 'Zhipu', label: 'GLM' },
      google: { hint: 'Google', label: 'Gemini' },
      gpt: { hint: 'OpenAI', label: 'GPT' },
      other: { hint: 'その他', label: 'その他' }
    },
    input: '入力',
    insufficientBalance: '残高不足です。チャージしてください。',
    loadFailed: 'モデル体験の読み込みに失敗しました',
    maxOutput: '最大出力',
    modelConfig: 'モデル設定',
    modeChat: 'チャット',
    modelPlaceholder: 'モデル名を検索',
    noMatchedModels: '一致するモデルはありません',
    noModels: 'モデルなし',
    output: '出力',
    promptPlaceholder: '何か入力してください...（Ctrl + Enter で送信）',
    requestFailed: 'モデル体験リクエストに失敗しました',
    responding: 'モデルが返信しています...',
    resultBalance: '残高',
    send: '送信',
    sending: '送信中',
    switchModel: 'モデルを切り替える',
    systemPrompt: 'システムプロンプト',
    total: '合計',
    usageCost: '課金',
    userRole: 'あなた',
    selectModel: 'モデルを選択'
  }
};

const defaultSystemPrompts = Object.values(EXPERIENCE_COPY).map((copy) => copy.defaultSystemPrompt);

function getExperienceCopy(language: LanguageCode) {
  if (language === 'zh-CN' || language === 'zh-TW') {
    return EXPERIENCE_COPY[language];
  }

  return applyCopyOverrides(EXPERIENCE_COPY['en-US'], getExperienceCommonOverrides(language), EXPERIENCE_COPY_BY_LANGUAGE[language]);
}

function getExperienceCommonOverrides(language: LanguageCode): CopyOverrides<ExperienceCopy> | null {
  if (language === 'en-US') {
    return null;
  }

  return {
    balance: pageTerm(language, 'balance'),
    billingNote: `${pageTerm(language, 'billing')}: USD / 1M ${pageTerm(language, 'token')}; ${pageTerm(language, 'charged')}: CNY.`,
    clearHistory: `${pageTerm(language, 'delete')} ${pageTerm(language, 'records')}`,
    defaultAssistantReply: `${pageTerm(language, 'output')}: ${pageTerm(language, 'emptyRecords')}.`,
    defaultSystemPrompt: `AI ${pageTerm(language, 'model')}. ${pageTerm(language, 'output')}: ${pageTerm(language, 'records')}.`,
    emptyPrompt: `${pageTerm(language, 'model')} ${pageTerm(language, 'billing')}: ${pageTerm(language, 'input')} / ${pageTerm(language, 'output')} ${pageTerm(language, 'token')}.`,
    familyAria: `${pageTerm(language, 'model')} ${pageTerm(language, 'filters')}`,
    familyLabels: getLocalizedFamilyLabels(language),
    input: pageTerm(language, 'input'),
    insufficientBalance: `${pageTerm(language, 'balance')} ${pageTerm(language, 'failed')}; ${pageTerm(language, 'recharge')}.`,
    loadFailed: `${pageTerm(language, 'loading')} ${pageTerm(language, 'failed')}`,
    maxOutput: pageTerm(language, 'output'),
    modelConfig: pageTerm(language, 'modelConfig'),
    modeChat: pageTerm(language, 'send'),
    modelPlaceholder: pageTerm(language, 'modelSearch'),
    noMatchedModels: pageTerm(language, 'emptyModels'),
    noModels: pageTerm(language, 'emptyModels'),
    output: pageTerm(language, 'output'),
    promptPlaceholder: `${pageTerm(language, 'input')}... Ctrl + Enter ${pageTerm(language, 'send')}`,
    requestFailed: `${pageTerm(language, 'send')} ${pageTerm(language, 'failed')}`,
    responding: `${pageTerm(language, 'loading')}...`,
    resultBalance: pageTerm(language, 'balance'),
    send: pageTerm(language, 'send'),
    sending: pageTerm(language, 'loading'),
    switchModel: pageTerm(language, 'model'),
    systemPrompt: pageTerm(language, 'modelConfig'),
    total: pageTerm(language, 'totalTokens'),
    usageCost: pageTerm(language, 'charged'),
    userRole: pageTerm(language, 'user'),
    selectModel: pageTerm(language, 'modelConfig')
  };
}

function getLocalizedFamilyLabels(language: LanguageCode): ExperienceCopy['familyLabels'] {
  const allModels = pageTerm(language, 'allModels');
  const model = pageTerm(language, 'model');

  return {
    all: { hint: allModels, label: allModels },
    claude: { hint: 'Anthropic', label: 'Claude' },
    deepseek: { hint: 'DeepSeek', label: 'DeepSeek' },
    glm: { hint: 'Zhipu', label: 'GLM' },
    google: { hint: 'Google', label: 'Gemini' },
    gpt: { hint: 'OpenAI', label: 'GPT' },
    other: { hint: model, label: model }
  };
}

export default function ExperiencePage() {
  const router = useRouter();
  const { language } = useI18n();
  const copy = getExperienceCopy(language);
  const tokenTerm = pageTerm(language, 'token');
  const [models, setModels] = useState<ExperienceModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [activeFamily, setActiveFamily] = useState<ModelFamilyId>('all');
  const [modelQuery, setModelQuery] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(copy.defaultSystemPrompt);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [temperature, setTemperature] = useState(0.7);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<ExperienceChatResponse | null>(null);
  const [isChatFocused, setIsChatFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const experienceRequestSeq = useRef(0);

  useEffect(() => {
    void loadExperience();
  }, [language]);

  useEffect(() => {
    setSystemPrompt((current) => (defaultSystemPrompts.includes(current) ? copy.defaultSystemPrompt : current));
  }, [copy.defaultSystemPrompt]);

  const activeModel = useMemo(
    () => models.find((model) => model.model === selectedModel) ?? models[0] ?? null,
    [models, selectedModel]
  );

  const activeModelFamily = useMemo(
    () => MODEL_FAMILIES.find((family) => family.id === (activeModel ? inferModelFamily(activeModel) : activeFamily)) ?? MODEL_FAMILIES[0],
    [activeFamily, activeModel]
  );

  const familyStats = useMemo(
    () =>
      MODEL_FAMILIES.map((family) => ({
        ...family,
        count: family.id === 'all' ? models.length : models.filter((model) => inferModelFamily(model) === family.id).length
      })),
    [models]
  );

  const filteredModels = useMemo(() => {
    const normalizedQuery = modelQuery.trim().toLowerCase();

    return models.filter((model) => {
      const matchesFamily = activeFamily === 'all' || inferModelFamily(model) === activeFamily;
      const title = getModelTitle(model).toLowerCase();
      const matchesQuery = !normalizedQuery || title.includes(normalizedQuery) || model.model.toLowerCase().includes(normalizedQuery);
      return matchesFamily && matchesQuery;
    });
  }, [activeFamily, modelQuery, models]);

  useEffect(() => {
    if (!filteredModels.length) {
      return;
    }

    const selectedStillVisible = filteredModels.some((model) => model.model === selectedModel);
    if (!selectedModel || !selectedStillVisible) {
      setSelectedModel(filteredModels[0].model);
    }
  }, [filteredModels, selectedModel]);

  async function loadExperience() {
    const requestId = experienceRequestSeq.current + 1;
    experienceRequestSeq.current = requestId;
    setIsLoading(true);
    setError('');

    try {
      const [profile, modelResult] = await Promise.all([getProfile(language), listExperienceModels(language)]);
      if (requestId !== experienceRequestSeq.current) {
        return;
      }
      setBalanceCents(profile.user.wallet.balanceCents);
      setModels(modelResult.items);
      setSelectedModel((current) =>
        current && modelResult.items.some((model) => model.model === current) ? current : modelResult.items[0]?.model || ''
      );
    } catch (nextError) {
      if (requestId !== experienceRequestSeq.current) {
        return;
      }
      setError(copy.loadFailed);
      if (isAuthSessionError(nextError)) {
        router.replace('/login');
      }
    } finally {
      if (requestId === experienceRequestSeq.current) {
        setIsLoading(false);
      }
    }
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!content || !selectedModel || isSending) {
      return;
    }

    setIsChatFocused(true);
    const userMessage: LocalMessage = {
      id: createMessageId(),
      role: 'user',
      content
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft('');
    setError('');
    setIsSending(true);

    try {
      const result = await sendExperienceChat({
        model: selectedModel,
        messages: nextMessages.slice(-12).map(({ role, content: messageContent }) => ({ role, content: messageContent })),
        systemPrompt: systemPrompt.trim() || undefined,
        maxTokens,
        temperature
      }, language);
      const assistantMessage: LocalMessage = {
        id: createMessageId(),
        role: 'assistant',
        content: result.message || copy.defaultAssistantReply,
        usage: result.usage,
        billing: result.billing
      };
      setMessages([...nextMessages, assistantMessage]);
      setLastResult(result);
      if (result.billing.balanceAfterCents !== null) {
        setBalanceCents(result.billing.balanceAfterCents);
      }
    } catch (nextError) {
      if (isInsufficientBalanceError(nextError)) {
        const assistantMessage: LocalMessage = {
          id: createMessageId(),
          role: 'assistant',
          content: copy.insufficientBalance
        };
        setMessages([...nextMessages, assistantMessage]);
        setLastResult(null);
        setError('');
        return;
      }

      setMessages(messages);
      setError(copy.requestFailed);
      if (isAuthSessionError(nextError)) {
        router.replace('/login');
      }
    } finally {
      setIsSending(false);
    }
  }

  function clearConversation() {
    setMessages([]);
    setLastResult(null);
    setError('');
  }

  function handleSelectModel(model: string) {
    setSelectedModel(model);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setIsChatFocused(true);
    }
  }

  return (
    <ConsoleShell activePath="/experience" isRefreshing={isLoading} onRefresh={() => void loadExperience()}>
      <section className={`experience-page ${isChatFocused ? 'mobile-chat-focused' : 'mobile-model-focused'}`}>
        <div className="experience-status-row">
          <div className="experience-balance">
            <span>{copy.balance}</span>
            <strong>{formatBillingCny(balanceCents)}</strong>
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <section className="experience-family-bar" aria-label={copy.familyAria}>
          {familyStats.map((family) => (
            <button
              aria-pressed={activeFamily === family.id}
              className={`experience-family-card ${family.className} ${activeFamily === family.id ? 'active' : ''}`}
              disabled={isLoading || family.count === 0}
              key={family.id}
              onClick={() => setActiveFamily(family.id)}
              type="button"
            >
              <ModelBrandMark brand={family.id} label={copy.familyLabels[family.id].label} mark={family.mark} />
              <span>
                <strong>{copy.familyLabels[family.id].label}</strong>
                <small>{copy.familyLabels[family.id].hint}</small>
              </span>
              <em>{family.count}</em>
            </button>
          ))}
        </section>

        <section className="experience-shell">
          <aside className="experience-config">
            <div className="experience-mobile-picker-head">
              <span>{copy.selectModel}</span>
              <strong>{activeModel ? getModelTitle(activeModel) : copy.noModels}</strong>
            </div>

            <div className="panel-title">
              <SettingOutlined />
              <h2>{copy.modelConfig}</h2>
            </div>

            <div className="experience-model-picker">
              <label className="experience-search">
                <SearchOutlined />
                <input
                  disabled={isLoading}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder={copy.modelPlaceholder}
                  value={modelQuery}
                />
              </label>

              <div className="experience-model-list">
                {filteredModels.length ? (
                  filteredModels.map((model) => {
                    const family = MODEL_FAMILIES.find((item) => item.id === inferModelFamily(model)) ?? MODEL_FAMILIES[6];
                    const familyLabel = copy.familyLabels[family.id].label;

                    return (
                      <button
                        className={`experience-model-option ${selectedModel === model.model ? 'active' : ''}`}
                        disabled={isSending}
                        key={model.model}
                        onClick={() => handleSelectModel(model.model)}
                        type="button"
                      >
                        <ModelBrandMark brand={family.id} className="compact" label={familyLabel} mark={family.mark} />
                        <span className="experience-model-option-body">
                          <strong>{getModelTitle(model)}</strong>
                          <small>{familyLabel}</small>
                        </span>
                        <span className="experience-model-option-price">
                          <b>{copy.input} {formatUsdPerMillionFromUnits(model.inputPriceCentsPer1k)}</b>
                          <b>{copy.output} {formatUsdPerMillionFromUnits(model.outputPriceCentsPer1k)}</b>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="experience-no-model">
                    <AppstoreOutlined />
                    <span>{copy.noMatchedModels}</span>
                  </div>
                )}
              </div>
            </div>

            <label className="experience-advanced-control">
              {copy.systemPrompt}
              <textarea
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={3}
                value={systemPrompt}
              />
            </label>

            <label className="experience-advanced-control">
              {copy.maxOutput}
              <div className="experience-control-row">
                <input
                  max={4096}
                  min={1}
                  onChange={(event) => setMaxTokens(Number(event.target.value) || 1024)}
                  type="range"
                  value={maxTokens}
                />
                <input
                  max={4096}
                  min={1}
                  onChange={(event) => setMaxTokens(Number(event.target.value) || 1024)}
                  type="number"
                  value={maxTokens}
                />
              </div>
            </label>

            <label className="experience-advanced-control">
              temperature
              <div className="experience-control-row">
                <input
                  max={2}
                  min={0}
                  onChange={(event) => setTemperature(Number(event.target.value))}
                  step={0.1}
                  type="range"
                  value={temperature}
                />
                <input
                  max={2}
                  min={0}
                  onChange={(event) => setTemperature(Number(event.target.value))}
                  step={0.1}
                  type="number"
                  value={temperature}
                />
              </div>
            </label>

            {activeModel ? (
              <div className="experience-price-box experience-advanced-control">
                <span>
                  {copy.input} <strong>{formatUsdPerMillionFromUnits(activeModel.inputPriceCentsPer1k)}</strong>
                </span>
                <span>
                  {copy.output} <strong>{formatUsdPerMillionFromUnits(activeModel.outputPriceCentsPer1k)}</strong>
                </span>
                <small>{copy.billingNote}</small>
              </div>
            ) : null}
          </aside>

          <section className="experience-chat">
            <div className="experience-chat-head">
              <div className="experience-chat-title">
                <ModelBrandMark brand={activeModelFamily.id} label={copy.familyLabels[activeModelFamily.id].label} mark={activeModelFamily.mark} />
                <span>
                  <strong>{activeModel ? getModelTitle(activeModel) : copy.noModels}</strong>
                  {activeModel ? <small>{copy.familyLabels[activeModelFamily.id].label} / {copy.modeChat}</small> : null}
                </span>
              </div>
              {activeModel ? (
                <div className="experience-chat-prices">
                  <span>{copy.input} {formatUsdPerMillionFromUnits(activeModel.inputPriceCentsPer1k)}</span>
                  <span>{copy.output} {formatUsdPerMillionFromUnits(activeModel.outputPriceCentsPer1k)}</span>
                </div>
              ) : null}
              <div className="experience-chat-actions">
                <button className="secondary-link-button experience-model-switch" onClick={() => setIsChatFocused(false)} type="button">
                  <AppstoreOutlined />
                  {copy.switchModel}
                </button>
                <button className="ghost-button" disabled={isSending || messages.length === 0} onClick={clearConversation} type="button">
                  <ClearOutlined />
                  {copy.clearHistory}
                </button>
                <button className="icon-button" disabled={isLoading} onClick={() => void loadExperience()} title={copy.modelConfig} type="button">
                  <ReloadOutlined />
                </button>
              </div>
            </div>

            <div className="experience-messages">
              {messages.length === 0 ? (
                <div className="experience-empty">
                  <ModelBrandMark brand={activeModelFamily.id} className="hero" label={copy.familyLabels[activeModelFamily.id].label} mark={activeModelFamily.mark} />
                  <h2>{activeModel ? getModelTitle(activeModel) : copy.selectModel}</h2>
                  <p>{copy.emptyPrompt}</p>
                </div>
              ) : (
                messages.map((message) => (
                  <article className={`experience-message ${message.role}`} key={message.id}>
                    {message.role === 'assistant' ? (
                      <ModelBrandMark brand={activeModelFamily.id} className="compact" label={copy.familyLabels[activeModelFamily.id].label} mark={activeModelFamily.mark} />
                    ) : null}
                    <div className="experience-message-role">{message.role === 'user' ? copy.userRole : 'AI'}</div>
                    <div className="experience-message-body">
                      <p>{message.content}</p>
                      {message.role === 'assistant' && message.usage && message.billing ? (
                        <div className="experience-usage">
                          <span>{copy.input} {formatTokenCount(message.usage.promptTokens, language)}</span>
                          <span>{copy.output} {formatTokenCount(message.usage.completionTokens, language)}</span>
                          <span>{copy.total} {formatTokenCount(message.usage.totalTokens, language)} {tokenTerm}</span>
                          <span>
                            <DollarOutlined /> {copy.usageCost} {formatBillingCny(message.billing.costCents)}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))
              )}
              {isSending ? <div className="experience-loading">{copy.responding}</div> : null}
            </div>

            {lastResult ? (
              <div className="experience-result-strip">
                <span>request_id: {lastResult.requestId}</span>
                <span>usage_event: {lastResult.billing.usageEventId ?? '-'}</span>
                <span>{copy.resultBalance}: {formatBillingCny(lastResult.billing.balanceAfterCents ?? balanceCents)}</span>
              </div>
            ) : null}

            <div className="experience-input">
              <textarea
                disabled={isSending || isLoading || !selectedModel}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={copy.promptPlaceholder}
                rows={4}
                value={draft}
              />
              <button className="primary-button" disabled={isSending || !draft.trim() || !selectedModel} onClick={() => void sendMessage()} type="button">
                {isSending ? <ApiOutlined /> : <SendOutlined />}
                {isSending ? copy.sending : copy.send}
              </button>
            </div>
          </section>
        </section>
      </section>
    </ConsoleShell>
  );
}

function createMessageId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isInsufficientBalanceError(error: unknown) {
  if (error instanceof ExperienceApiError) {
    return error.code === 'insufficient_balance' || error.status === 402;
  }

  return false;
}

function isAuthSessionError(error: unknown) {
  return isAuthenticationApiError(error) || (error instanceof ExperienceApiError && error.status === 401);
}

function formatTokenCount(value: number, language: LanguageCode) {
  return new Intl.NumberFormat(language).format(value);
}

function getModelTitle(model: ExperienceModel) {
  return model.displayName || model.model;
}

function inferModelFamily(model: ExperienceModel): Exclude<ModelFamilyId, 'all'> {
  const text = `${model.model} ${model.displayName ?? ''}`.toLowerCase();

  if (text.includes('gpt') || text.includes('openai') || /\bo[134]\b/.test(text)) {
    return 'gpt';
  }

  if (text.includes('claude') || text.includes('anthropic')) {
    return 'claude';
  }

  if (text.includes('gemini') || text.includes('google') || text.includes('palm')) {
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
