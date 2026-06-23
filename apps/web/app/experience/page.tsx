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
import { useEffect, useMemo, useState } from 'react';
import { ConsoleShell } from '../components/console-shell';
import { ModelBrandMark, type ModelBrandId } from '../components/model-brand-mark';
import { getProfile } from '../lib/auth-api';
import { formatBillingCny, formatUsdPerMillionFromUnits } from '../lib/billing-format';
import {
  ExperienceApiError,
  listExperienceModels,
  sendExperienceChat,
  type ExperienceChatMessage,
  type ExperienceChatResponse,
  type ExperienceModel
} from '../lib/experience-api';

type LocalMessage = ExperienceChatMessage & {
  id: string;
  usage?: ExperienceChatResponse['usage'];
  billing?: ExperienceChatResponse['billing'];
};

type ModelFamilyId = ModelBrandId;

type ModelFamily = {
  id: ModelFamilyId;
  label: string;
  mark: string;
  hint: string;
  className: string;
};

const DEFAULT_SYSTEM_PROMPT = '你是一个简洁、准确的 AI 助手。';

const INSUFFICIENT_BALANCE_REPLY = '余额不足，请前往充值';

const MODEL_FAMILIES: ModelFamily[] = [
  { id: 'all', label: '全部模型', mark: 'All', hint: 'All models', className: 'all' },
  { id: 'gpt', label: 'GPT', mark: 'GPT', hint: 'OpenAI', className: 'gpt' },
  { id: 'claude', label: 'Claude', mark: 'AI', hint: 'Anthropic', className: 'claude' },
  { id: 'google', label: 'Gemini', mark: 'G', hint: 'Google', className: 'google' },
  { id: 'deepseek', label: 'DeepSeek', mark: 'DS', hint: 'DeepSeek', className: 'deepseek' },
  { id: 'glm', label: 'GLM', mark: 'GLM', hint: 'Zhipu', className: 'glm' },
  { id: 'other', label: '其他', mark: 'AI', hint: 'Other', className: 'other' }
];

export default function ExperiencePage() {
  const [models, setModels] = useState<ExperienceModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [activeFamily, setActiveFamily] = useState<ModelFamilyId>('all');
  const [modelQuery, setModelQuery] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
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

  useEffect(() => {
    void loadExperience();
  }, []);

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
    setIsLoading(true);
    setError('');

    try {
      const [profile, modelResult] = await Promise.all([getProfile(), listExperienceModels()]);
      setBalanceCents(profile.user.wallet.balanceCents);
      setModels(modelResult.items);
      setSelectedModel((current) => current || modelResult.items[0]?.model || '');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '模型体验加载失败');
    } finally {
      setIsLoading(false);
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
      });
      const assistantMessage: LocalMessage = {
        id: createMessageId(),
        role: 'assistant',
        content: result.message || '上游返回了空内容。',
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
          content: INSUFFICIENT_BALANCE_REPLY
        };
        setMessages([...nextMessages, assistantMessage]);
        setLastResult(null);
        setError('');
        return;
      }

      setMessages(messages);
      setError(nextError instanceof Error ? nextError.message : '模型体验请求失败');
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
            <span>当前余额</span>
            <strong>{formatBillingCny(balanceCents)}</strong>
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <section className="experience-family-bar" aria-label="模型品牌分类">
          {familyStats.map((family) => (
            <button
              aria-pressed={activeFamily === family.id}
              className={`experience-family-card ${family.className} ${activeFamily === family.id ? 'active' : ''}`}
              disabled={isLoading || family.count === 0}
              key={family.id}
              onClick={() => setActiveFamily(family.id)}
              type="button"
            >
              <ModelBrandMark brand={family.id} label={family.label} mark={family.mark} />
              <span>
                <strong>{family.label}</strong>
                <small>{family.hint}</small>
              </span>
              <em>{family.count}</em>
            </button>
          ))}
        </section>

        <section className="experience-shell">
          <aside className="experience-config">
            <div className="experience-mobile-picker-head">
              <span>选择模型</span>
              <strong>{activeModel ? getModelTitle(activeModel) : '暂无模型'}</strong>
            </div>

            <div className="panel-title">
              <SettingOutlined />
              <h2>模型配置</h2>
            </div>

            <div className="experience-model-picker">
              <label className="experience-search">
                <SearchOutlined />
                <input
                  disabled={isLoading}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder="搜索模型名称"
                  value={modelQuery}
                />
              </label>

              <div className="experience-model-list">
                {filteredModels.length ? (
                  filteredModels.map((model) => {
                    const family = MODEL_FAMILIES.find((item) => item.id === inferModelFamily(model)) ?? MODEL_FAMILIES[6];

                    return (
                      <button
                        className={`experience-model-option ${selectedModel === model.model ? 'active' : ''}`}
                        disabled={isSending}
                        key={model.model}
                        onClick={() => handleSelectModel(model.model)}
                        type="button"
                      >
                        <ModelBrandMark brand={family.id} className="compact" label={family.label} mark={family.mark} />
                        <span className="experience-model-option-body">
                          <strong>{getModelTitle(model)}</strong>
                          <small>{family.label}</small>
                        </span>
                        <span className="experience-model-option-price">
                          <b>输入 {formatUsdPerMillionFromUnits(model.inputPriceCentsPer1k)}</b>
                          <b>输出 {formatUsdPerMillionFromUnits(model.outputPriceCentsPer1k)}</b>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="experience-no-model">
                    <AppstoreOutlined />
                    <span>没有匹配模型</span>
                  </div>
                )}
              </div>
            </div>

            <label className="experience-advanced-control">
              系统提示词
              <textarea
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={3}
                value={systemPrompt}
              />
            </label>

            <label className="experience-advanced-control">
              最大输出
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
                  输入 <strong>{formatUsdPerMillionFromUnits(activeModel.inputPriceCentsPer1k)}</strong>
                </span>
                <span>
                  输出 <strong>{formatUsdPerMillionFromUnits(activeModel.outputPriceCentsPer1k)}</strong>
                </span>
                <small>页面显示美元单价；实际扣余额按系统汇率折算成人民币。</small>
              </div>
            ) : null}
          </aside>

          <section className="experience-chat">
            <div className="experience-chat-head">
              <div className="experience-chat-title">
                <ModelBrandMark brand={activeModelFamily.id} label={activeModelFamily.label} mark={activeModelFamily.mark} />
                <span>
                  <strong>{activeModel ? getModelTitle(activeModel) : '暂无模型'}</strong>
                  {activeModel ? <small>{activeModelFamily.label} / Chat</small> : null}
                </span>
              </div>
              {activeModel ? (
                <div className="experience-chat-prices">
                  <span>输入 {formatUsdPerMillionFromUnits(activeModel.inputPriceCentsPer1k)}</span>
                  <span>输出 {formatUsdPerMillionFromUnits(activeModel.outputPriceCentsPer1k)}</span>
                </div>
              ) : null}
              <div className="experience-chat-actions">
                <button className="secondary-link-button experience-model-switch" onClick={() => setIsChatFocused(false)} type="button">
                  <AppstoreOutlined />
                  换模型
                </button>
                <button className="ghost-button" disabled={isSending || messages.length === 0} onClick={clearConversation} type="button">
                  <ClearOutlined />
                  清空历史
                </button>
                <button className="icon-button" disabled={isLoading} onClick={() => void loadExperience()} title="刷新" type="button">
                  <ReloadOutlined />
                </button>
              </div>
            </div>

            <div className="experience-messages">
              {messages.length === 0 ? (
                <div className="experience-empty">
                  <ModelBrandMark brand={activeModelFamily.id} className="hero" label={activeModelFamily.label} mark={activeModelFamily.mark} />
                  <h2>{activeModel ? getModelTitle(activeModel) : '选择一个模型'}</h2>
                  <p>当前模型按真实输入、输出 token 计费。</p>
                </div>
              ) : (
                messages.map((message) => (
                  <article className={`experience-message ${message.role}`} key={message.id}>
                    {message.role === 'assistant' ? (
                      <ModelBrandMark brand={activeModelFamily.id} className="compact" label={activeModelFamily.label} mark={activeModelFamily.mark} />
                    ) : null}
                    <div className="experience-message-role">{message.role === 'user' ? '你' : 'AI'}</div>
                    <div className="experience-message-body">
                      <p>{message.content}</p>
                      {message.role === 'assistant' && message.usage && message.billing ? (
                        <div className="experience-usage">
                          <span>输入 {formatTokenCount(message.usage.promptTokens)}</span>
                          <span>输出 {formatTokenCount(message.usage.completionTokens)}</span>
                          <span>合计 {formatTokenCount(message.usage.totalTokens)} token</span>
                          <span>
                            <DollarOutlined /> 扣费 {formatBillingCny(message.billing.costCents)}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))
              )}
              {isSending ? <div className="experience-loading">模型正在回复...</div> : null}
            </div>

            {lastResult ? (
              <div className="experience-result-strip">
                <span>request_id: {lastResult.requestId}</span>
                <span>usage_event: {lastResult.billing.usageEventId ?? '-'}</span>
                <span>余额: {formatBillingCny(lastResult.billing.balanceAfterCents ?? balanceCents)}</span>
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
                placeholder="说点什么...（Ctrl + Enter 发送）"
                rows={4}
                value={draft}
              />
              <button className="primary-button" disabled={isSending || !draft.trim() || !selectedModel} onClick={() => void sendMessage()} type="button">
                {isSending ? <ApiOutlined /> : <SendOutlined />}
                发送
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

  return error instanceof Error && /insufficient balance|余额不足/i.test(error.message);
}

function formatTokenCount(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
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
