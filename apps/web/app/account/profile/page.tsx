'use client';

import {
  ApiOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  GiftOutlined,
  KeyOutlined,
  LineChartOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ConsoleShell } from '../../components/console-shell';
import { useI18n } from '../../components/language-provider';
import { changePassword, getProfile, logout, updateTimezone } from '../../lib/auth-api';
import type { AvailableModel, PublicUser } from '../../lib/auth-api';
import { formatBillingUsd } from '../../lib/billing-format';
import { applyCopyOverrides, type CopyOverrides } from '../../lib/copy-overrides';
import type { LanguageCode } from '../../lib/i18n';
import { pageTerm } from '../../lib/page-copy-terms';
import { listUsageLogs, type UsageLogEntry, type UsageLogsResponse } from '../../lib/usage-log-api';

const commonTimezones = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Singapore',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London'
];

type ProfileCopy = {
  accountOptions: string;
  accountStatus: string;
  adminRole: string;
  availableModels: string;
  availableModelCount: (count: number) => string;
  averageTokens: string;
  balance: string;
  balanceDetail: string;
  changePassword: string;
  changePasswordFailed: string;
  copyAllModels: string;
  copyFailed: (label: string) => string;
  copyModelName: string;
  copied: (label: string) => string;
  currentPassword: string;
  dateTrendAria: (label: string, tokens: string) => string;
  emptyModels: string;
  emptyUsage: string;
  globalModelConfig: string;
  historicalSpend: string;
  inputOutput: (input: string, output: string) => string;
  lastLoginAt: string;
  lastLoginIp: string;
  loadFailed: string;
  loading: string;
  modelConfig: string;
  modelDistribution: string;
  modelList: string;
  modelSearch: string;
  modelSearchPlaceholder: string;
  modelsCount: (count: number) => string;
  newPassword: string;
  noCopyModels: string;
  rawTokensCharged: (charge: string) => string;
  refresh: string;
  range: string;
  rangeDays: (days: number) => string;
  saveTimezoneFailed: string;
  savedTimezone: string;
  saving: string;
  successfulCharges: string;
  successfulRequests: string;
  systemToken: string;
  timezone: string;
  tokenTrend: string;
  todayTokens: string;
  totalSpendDetail: string;
  unconfiguredModelRatio: string;
  userInfo: string;
  userRole: string;
  usageAverageDetail: string;
  usageFailureDetail: (count: string) => string;
  usageNote: string;
};

const PROFILE_COPY = {
  'zh-CN': {
    accountOptions: '账户选项',
    accountStatus: 'API 中转账户',
    adminRole: '管理员',
    availableModels: '可用模型',
    availableModelCount: (count) => `可用模型数量：${count}`,
    averageTokens: '平均每次 token',
    balance: '余额',
    balanceDetail: '账号可用余额',
    changePassword: '修改密码',
    changePasswordFailed: '修改密码失败',
    copyAllModels: '复制全部模型',
    copyFailed: (label) => `${label}复制失败，请手动选中`,
    copyModelName: '复制模型名',
    copied: (label) => `${label}已复制`,
    currentPassword: '当前密码',
    dateTrendAria: (label, tokens) => `${label} token 消耗 ${tokens}`,
    emptyModels: '暂无可用模型',
    emptyUsage: '暂无数据',
    globalModelConfig: '使用全局配置',
    historicalSpend: '累计消耗',
    inputOutput: (input, output) => `原始输入 ${input} / 输出 ${output}`,
    lastLoginAt: '上次登录时间',
    lastLoginIp: '上次登录 IP',
    loadFailed: '会话已失效',
    loading: '加载中',
    modelConfig: '模型配置',
    modelDistribution: '模型分布',
    modelList: '模型列表',
    modelSearch: '搜索模型',
    modelSearchPlaceholder: '搜索模型',
    modelsCount: (count) => `${count} 个模型`,
    newPassword: '新密码',
    noCopyModels: '当前没有可复制的模型',
    rawTokensCharged: (charge) => `原始 token；扣费 ${charge}`,
    refresh: '刷新',
    range: '时间范围：',
    rangeDays: (days) => `近 ${days} 天`,
    saveTimezoneFailed: '时区保存失败',
    savedTimezone: '时区已保存',
    saving: '保存中',
    successfulCharges: '扣费成功',
    successfulRequests: '成功请求',
    systemToken: '系统令牌',
    timezone: '时区',
    tokenTrend: 'token 使用趋势',
    todayTokens: '今日 token',
    totalSpendDetail: '历史累计',
    unconfiguredModelRatio: '接受未配置倍率的模型',
    userInfo: '用户信息',
    userRole: '普通用户',
    usageAverageDetail: '按成功请求平均；包含客户端随请求发送的上下文',
    usageFailureDetail: (count) => `失败或未知 ${count} 次，不参与 token 和扣费统计`,
    usageNote:
      '说明：token 显示接口实际记录的原始输入和输出；模型价格按输入单价和输出单价分别展示为美元，实际扣余额会按汇率折算成人民币。Claude Code 如果开着长会话，会把历史上下文一起发送，所以屏幕上只看到一句话，也可能产生较高输入 token。新开空会话测试，短问句 token 会明显下降。'
  },
  'zh-TW': {
    accountOptions: '帳戶選項',
    accountStatus: 'API 中轉帳戶',
    adminRole: '管理員',
    availableModels: '可用模型',
    availableModelCount: (count) => `可用模型數量：${count}`,
    averageTokens: '平均每次 token',
    balance: '餘額',
    balanceDetail: '帳戶可用餘額',
    changePassword: '修改密碼',
    changePasswordFailed: '修改密碼失敗',
    copyAllModels: '複製全部模型',
    copyFailed: (label) => `${label}複製失敗，請手動選取`,
    copyModelName: '複製模型名',
    copied: (label) => `${label}已複製`,
    currentPassword: '目前密碼',
    dateTrendAria: (label, tokens) => `${label} token 消耗 ${tokens}`,
    emptyModels: '暫無可用模型',
    emptyUsage: '暫無資料',
    globalModelConfig: '使用全域配置',
    historicalSpend: '累計消耗',
    inputOutput: (input, output) => `原始輸入 ${input} / 輸出 ${output}`,
    lastLoginAt: '上次登入時間',
    lastLoginIp: '上次登入 IP',
    loadFailed: '會話已失效',
    loading: '載入中',
    modelConfig: '模型配置',
    modelDistribution: '模型分布',
    modelList: '模型列表',
    modelSearch: '搜尋模型',
    modelSearchPlaceholder: '搜尋模型',
    modelsCount: (count) => `${count} 個模型`,
    newPassword: '新密碼',
    noCopyModels: '目前沒有可複製的模型',
    rawTokensCharged: (charge) => `原始 token；扣費 ${charge}`,
    refresh: '重新整理',
    range: '時間範圍：',
    rangeDays: (days) => `近 ${days} 天`,
    saveTimezoneFailed: '時區保存失敗',
    savedTimezone: '時區已保存',
    saving: '保存中',
    successfulCharges: '扣費成功',
    successfulRequests: '成功請求',
    systemToken: '系統權杖',
    timezone: '時區',
    tokenTrend: 'token 使用趨勢',
    todayTokens: '今日 token',
    totalSpendDetail: '歷史累計',
    unconfiguredModelRatio: '接受未配置倍率的模型',
    userInfo: '使用者資訊',
    userRole: '一般使用者',
    usageAverageDetail: '按成功請求平均；包含用戶端隨請求發送的上下文',
    usageFailureDetail: (count) => `失敗或未知 ${count} 次，不參與 token 和扣費統計`,
    usageNote:
      '說明：token 顯示介面實際記錄的原始輸入和輸出；模型價格按輸入單價和輸出單價分別展示為美元，實際扣餘額會按匯率折算成人民幣。Claude Code 如果開著長會話，會把歷史上下文一起發送，所以畫面上只看到一句話，也可能產生較高輸入 token。新開空會話測試，短問句 token 會明顯下降。'
  },
  'en-US': {
    accountOptions: 'Account options',
    accountStatus: 'API relay account',
    adminRole: 'Admin',
    availableModels: 'Available models',
    availableModelCount: (count) => `Available models: ${count}`,
    averageTokens: 'Average tokens per call',
    balance: 'Balance',
    balanceDetail: 'Available account balance',
    changePassword: 'Change password',
    changePasswordFailed: 'Failed to change password',
    copyAllModels: 'Copy all models',
    copyFailed: (label) => `Failed to copy ${label}. Select it manually.`,
    copyModelName: 'Copy model name',
    copied: (label) => `${label} copied`,
    currentPassword: 'Current password',
    dateTrendAria: (label, tokens) => `${label} token usage ${tokens}`,
    emptyModels: 'No available models',
    emptyUsage: 'No data',
    globalModelConfig: 'Use global configuration',
    historicalSpend: 'Total spend',
    inputOutput: (input, output) => `Raw input ${input} / output ${output}`,
    lastLoginAt: 'Last login time',
    lastLoginIp: 'Last login IP',
    loadFailed: 'Session expired',
    loading: 'Loading',
    modelConfig: 'Model configuration',
    modelDistribution: 'Model distribution',
    modelList: 'Model list',
    modelSearch: 'Search models',
    modelSearchPlaceholder: 'Search models',
    modelsCount: (count) => `${count} models`,
    newPassword: 'New password',
    noCopyModels: 'No models to copy',
    rawTokensCharged: (charge) => `Raw tokens; charged ${charge}`,
    refresh: 'Refresh',
    range: 'Time range:',
    rangeDays: (days) => `Last ${days} days`,
    saveTimezoneFailed: 'Failed to save timezone',
    savedTimezone: 'Timezone saved',
    saving: 'Saving',
    successfulCharges: 'Charged calls',
    successfulRequests: 'Successful requests',
    systemToken: 'System tokens',
    timezone: 'Timezone',
    tokenTrend: 'Token usage trend',
    todayTokens: 'Today tokens',
    totalSpendDetail: 'Historical total',
    unconfiguredModelRatio: 'Accept models without configured ratio',
    userInfo: 'User information',
    userRole: 'User',
    usageAverageDetail: 'Average by successful request, including context sent by the client',
    usageFailureDetail: (count) => `${count} failed or unknown calls, excluded from token and charge totals`,
    usageNote:
      'Token usage shows the raw input and output recorded by the API. Model prices are shown in USD for input and output separately, while actual balance deductions are converted to CNY by exchange rate. Claude Code can send long conversation context upstream, so a short visible message can still generate high input tokens. Starting a fresh empty session will reduce token usage for short prompts.'
  }
} satisfies Record<'zh-CN' | 'zh-TW' | 'en-US', ProfileCopy>;

function getProfileCopy(language: LanguageCode) {
  if (language === 'zh-CN' || language === 'zh-TW') {
    return PROFILE_COPY[language];
  }

  const base = PROFILE_COPY['en-US'];
  if (language === 'en-US') {
    return base;
  }

  return applyCopyOverrides(base, getProfileCopyOverrides(language));
}

function getProfileCopyOverrides(language: LanguageCode): CopyOverrides<ProfileCopy> {
  return {
    accountOptions: pageTerm(language, 'accountOptions'),
    accountStatus: pageTerm(language, 'accountOptions'),
    adminRole: pageTerm(language, 'admin'),
    availableModels: pageTerm(language, 'availableModels'),
    availableModelCount: (count) => `${pageTerm(language, 'availableModels')}: ${count}`,
    averageTokens: pageTerm(language, 'totalTokens'),
    balance: pageTerm(language, 'balance'),
    balanceDetail: pageTerm(language, 'balance'),
    changePassword: pageTerm(language, 'password'),
    changePasswordFailed: `${pageTerm(language, 'password')} ${pageTerm(language, 'failed')}`,
    copyAllModels: pageTerm(language, 'copyAllModels'),
    copyFailed: (label) => `${pageTerm(language, 'copy')} ${label} ${pageTerm(language, 'failed')}`,
    copyModelName: pageTerm(language, 'copyModelName'),
    copied: (label) => `${label} ${pageTerm(language, 'copy')}`,
    currentPassword: pageTerm(language, 'currentPassword'),
    dateTrendAria: (label, tokens) => `${label} ${pageTerm(language, 'totalTokens')} ${tokens}`,
    emptyModels: pageTerm(language, 'emptyModels'),
    emptyUsage: pageTerm(language, 'noData'),
    globalModelConfig: pageTerm(language, 'modelConfig'),
    historicalSpend: pageTerm(language, 'totalSpend'),
    inputOutput: (input, output) => `${pageTerm(language, 'input')} ${input} / ${pageTerm(language, 'output')} ${output}`,
    lastLoginAt: pageTerm(language, 'lastLogin'),
    lastLoginIp: pageTerm(language, 'lastLoginIp'),
    loadFailed: `${pageTerm(language, 'loading')} ${pageTerm(language, 'failed')}`,
    loading: pageTerm(language, 'loading'),
    modelConfig: pageTerm(language, 'modelConfig'),
    modelDistribution: pageTerm(language, 'modelDistribution'),
    modelList: pageTerm(language, 'modelList'),
    modelSearch: pageTerm(language, 'modelSearch'),
    modelSearchPlaceholder: pageTerm(language, 'modelSearch'),
    modelsCount: (count) => `${count} ${pageTerm(language, 'model')}`,
    newPassword: pageTerm(language, 'newPassword'),
    noCopyModels: pageTerm(language, 'noCopyModels'),
    rawTokensCharged: (charge) => `${pageTerm(language, 'totalTokens')}; ${pageTerm(language, 'charged')} ${charge}`,
    refresh: pageTerm(language, 'refresh'),
    range: `${pageTerm(language, 'timeRange')}:`,
    rangeDays: (days) => `${days} ${pageTerm(language, 'time')}`,
    saveTimezoneFailed: `${pageTerm(language, 'timezone')} ${pageTerm(language, 'failed')}`,
    savedTimezone: `${pageTerm(language, 'timezone')} ${pageTerm(language, 'save')}`,
    saving: pageTerm(language, 'saving'),
    successfulCharges: pageTerm(language, 'charged'),
    successfulRequests: pageTerm(language, 'active'),
    systemToken: pageTerm(language, 'systemToken'),
    timezone: pageTerm(language, 'timezone'),
    tokenTrend: pageTerm(language, 'totalTokens'),
    todayTokens: pageTerm(language, 'totalTokens'),
    totalSpendDetail: pageTerm(language, 'totalSpend'),
    unconfiguredModelRatio: pageTerm(language, 'modelConfig'),
    userInfo: pageTerm(language, 'userInfo'),
    userRole: pageTerm(language, 'user'),
    usageAverageDetail: `${pageTerm(language, 'totalTokens')} / ${pageTerm(language, 'records')}`,
    usageFailureDetail: (count) => `${count} ${pageTerm(language, 'failedCalls')}; ${pageTerm(language, 'totalTokens')} ${pageTerm(language, 'notConfigured')}`,
    usageNote: `${pageTerm(language, 'totalTokens')}: ${pageTerm(language, 'input')} + ${pageTerm(language, 'output')}. ${pageTerm(language, 'model')} ${pageTerm(language, 'billing')}: USD / 1M ${pageTerm(language, 'token')}.`
  };
}

export default function AccountProfilePage() {
  const router = useRouter();
  const { language } = useI18n();
  const copy = getProfileCopy(language);
  const tokenTerm = pageTerm(language, 'token');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [timezone, setTimezone] = useState('UTC');
  const [modelQuery, setModelQuery] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [usageData, setUsageData] = useState<UsageLogsResponse | null>(null);
  const [rangeDays, setRangeDays] = useState(7);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);
  const [isSavingTimezone, setIsSavingTimezone] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const profileRequestSeq = useRef(0);

  useEffect(() => {
    void loadProfile();
  }, [language]);

  useEffect(() => {
    void loadUsageOverview(rangeDays);
  }, [rangeDays]);

  const filteredModels = useMemo(() => {
    const keyword = modelQuery.trim().toLowerCase();
    const models = user?.availableModels ?? [];
    if (!keyword) {
      return models;
    }

    return models.filter((model) =>
      [model.model, model.displayName ?? ''].some((value) => value.toLowerCase().includes(keyword))
    );
  }, [modelQuery, user?.availableModels]);

  const usageRows = usageData?.items ?? [];
  const successfulUsageRows = useMemo(() => usageRows.filter(isSuccessfulUsage), [usageRows]);
  const todayUsage = useMemo(() => summarizeTodayUsage(successfulUsageRows), [successfulUsageRows]);
  const modelBreakdown = useMemo(() => getModelBreakdown(successfulUsageRows), [successfulUsageRows]);
  const tokenTrend = useMemo(() => getTokenTrend(successfulUsageRows, rangeDays), [rangeDays, successfulUsageRows]);
  const usageSummary = usageData?.summary;
  const periodChargedUsd = usageSummary?.totalCostCents ?? 0;
  const periodRawTokens = usageSummary?.totalTokens ?? 0;
  const periodSuccessCount = useMemo(() => {
    if (usageSummary?.successfulRequests !== undefined) {
      return usageSummary.successfulRequests;
    }

    if (!usageSummary) {
      return 0;
    }

    return (usageSummary.statusCounts.billable ?? 0) + (usageSummary.statusCounts.free ?? 0);
  }, [usageSummary]);
  const periodFailureCount = useMemo(() => {
    if (usageSummary?.failedRequests !== undefined) {
      return usageSummary.failedRequests;
    }

    if (!usageSummary) {
      return 0;
    }

    return (usageSummary.statusCounts.failed ?? 0) + (usageSummary.statusCounts.metering_unknown ?? 0);
  }, [usageSummary]);
  const periodAvgTokensPerCall = useMemo(() => {
    if (periodSuccessCount === 0) {
      return 0;
    }

    return Math.round(periodRawTokens / periodSuccessCount);
  }, [periodRawTokens, periodSuccessCount]);

  async function loadProfile() {
    const requestId = profileRequestSeq.current + 1;
    profileRequestSeq.current = requestId;
    setIsLoading(true);
    setError('');

    try {
      const result = await getProfile(language);
      if (requestId !== profileRequestSeq.current) {
        return;
      }
      setUser(result.user);
      setTimezone(result.user.timezone);
    } catch {
      if (requestId !== profileRequestSeq.current) {
        return;
      }
      setError(copy.loadFailed);
      router.replace('/login');
    } finally {
      if (requestId === profileRequestSeq.current) {
        setIsLoading(false);
      }
    }
  }

  async function loadUsageOverview(days = rangeDays) {
    setIsLoadingUsage(true);

    try {
      const from = new Date();
      from.setDate(from.getDate() - days + 1);
      from.setHours(0, 0, 0, 0);

      const result = await listUsageLogs({
        from: from.toISOString(),
        limit: 100
      }, language);
      setUsageData(result);
    } catch {
      setUsageData(null);
    } finally {
      setIsLoadingUsage(false);
    }
  }

  async function handleTimezoneChange(nextTimezone: string) {
    if (!user || nextTimezone === user.timezone) {
      setTimezone(nextTimezone);
      return;
    }

    setTimezone(nextTimezone);
    setError('');
    setMessage('');
    setIsSavingTimezone(true);

    try {
      const result = await updateTimezone({ timezone: nextTimezone }, language);
      setUser(result.user);
      setMessage(copy.savedTimezone);
    } catch {
      setTimezone(user.timezone);
      setError(copy.saveTimezoneFailed);
    } finally {
      setIsSavingTimezone(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsChangingPassword(true);

    try {
      const result = await changePassword({ currentPassword, newPassword }, language);
      setUser(result.user);
      setCurrentPassword('');
      setNewPassword('');
      setMessage(copy.copied(copy.changePassword));
    } catch {
      setError(copy.changePasswordFailed);
    } finally {
      setIsChangingPassword(false);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  async function copyText(value: string, label: string) {
    setError('');
    setMessage('');
    try {
      await navigator.clipboard.writeText(value);
      setMessage(copy.copied(label));
    } catch {
      setError(copy.copyFailed(label));
    }
  }

  async function copyAllModels() {
    const modelNames = filteredModels.map((model) => model.model);
    if (!modelNames.length) {
      setError(copy.noCopyModels);
      return;
    }

    await copyText(modelNames.join('\n'), copy.modelList);
  }

  return (
    <ConsoleShell
      activePath="/account/profile"
      isRefreshing={isLoading}
      onLogout={() => void handleLogout()}
      onRefresh={() => void loadProfile()}
      username={user?.username}
    >
          {error ? <p className="form-error">{error}</p> : null}
          {message ? <p className="form-success">{message}</p> : null}

          <section className="profile-card profile-identity">
            <div className="profile-avatar" aria-hidden="true">
              {user?.username.slice(0, 1).toUpperCase() ?? 'R'}
            </div>
            <div className="profile-identity-main">
              <h1>{isLoading ? copy.loading : user?.username ?? '-'}</h1>
              <div className="profile-tag-row">
                <span className="profile-tag blue">
                  <CheckCircleOutlined />
                  {formatRole(user?.role, copy)}
                </span>
              </div>
            </div>
            <div className="profile-helper-panel">
              <span>{copy.accountStatus}</span>
              <strong>{user?.status ?? '-'}</strong>
            </div>
          </section>

          <section className="profile-metrics">
            <MetricBlock
              accent="green"
              detail={copy.balanceDetail}
              icon={<GiftOutlined />}
              label={copy.balance}
              value={formatBillingUsd(user?.wallet.balanceCents ?? 0)}
            />
            <MetricBlock
              accent="red"
              detail={copy.totalSpendDetail}
              icon={<BarChartOutlined />}
              label={copy.historicalSpend}
              value={formatBillingUsd(user?.wallet.totalSpendCents ?? 0)}
            />
            <MetricBlock
              accent="blue"
              detail={copy.rawTokensCharged(formatBillingUsd(periodChargedUsd))}
              icon={<LineChartOutlined />}
              label={`${copy.rangeDays(rangeDays)} ${tokenTerm}`}
              unit={tokenTerm}
              value={formatNumber(periodRawTokens, language)}
            />
            <MetricBlock
              accent="violet"
              detail={copy.usageAverageDetail}
              icon={<TeamOutlined />}
              label={copy.successfulCharges}
              value={formatNumber(periodSuccessCount, language)}
            />
          </section>

          <section className="profile-usage-band">
            <div className="profile-usage-cards">
              <UsageTile
                accent="orange"
                detail={copy.inputOutput(formatNumber(todayUsage.promptTokens, language), formatNumber(todayUsage.completionTokens, language))}
                icon={<ApiOutlined />}
                label={copy.todayTokens}
                value={`${formatNumber(todayUsage.totalTokens, language)} ${tokenTerm}`}
              />
              <UsageTile
                accent="blue"
                detail={copy.usageFailureDetail(formatNumber(periodFailureCount, language))}
                icon={<BarChartOutlined />}
                label={copy.successfulRequests}
                value={formatNumber(periodSuccessCount, language)}
              />
              <UsageTile
                accent="violet"
                detail={copy.usageAverageDetail}
                icon={<LineChartOutlined />}
                label={copy.averageTokens}
                value={formatNumber(periodAvgTokensPerCall, language)}
              />
            </div>
            <p className="profile-usage-note">
              {copy.usageNote}
            </p>

            <div className="profile-usage-toolbar">
              <label>
                {copy.range}
                <select onChange={(event) => setRangeDays(Number(event.target.value))} value={rangeDays}>
                  <option value={7}>{copy.rangeDays(7)}</option>
                  <option value={14}>{copy.rangeDays(14)}</option>
                  <option value={30}>{copy.rangeDays(30)}</option>
                </select>
              </label>
              <button className="ghost-button compact-button" disabled={isLoadingUsage} onClick={() => void loadUsageOverview()} type="button">
                <ReloadOutlined />
                {copy.refresh}
              </button>
            </div>

            <div className="profile-usage-panels">
              <section className="profile-usage-panel">
                <div className="profile-usage-panel-title">
                  <h2>{copy.modelDistribution}</h2>
                  <span>{copy.modelsCount(modelBreakdown.length)}</span>
                </div>
                {modelBreakdown.length ? (
                  <div className="profile-model-bars">
                    {modelBreakdown.map((entry) => (
                      <div className="profile-model-bar" key={entry.model}>
                        <div>
                          <strong>{entry.model}</strong>
                          <span>{formatNumber(entry.tokens, language)} {tokenTerm}</span>
                        </div>
                        <i style={{ width: `${entry.percent}%` }} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="profile-chart-empty">{copy.emptyUsage}</p>
                )}
              </section>

              <section className="profile-usage-panel">
                <div className="profile-usage-panel-title">
                  <h2>{copy.tokenTrend}</h2>
                  <span>{copy.rangeDays(rangeDays)}</span>
                </div>
                {tokenTrend.some((entry) => entry.tokens > 0) ? (
                  <div className="profile-token-trend">
                    {tokenTrend.map((entry) => (
                      <div
                        aria-label={copy.dateTrendAria(entry.label, formatNumber(entry.tokens, language))}
                        className="profile-token-trend-item"
                        key={entry.label}
                        tabIndex={0}
                      >
                        <i style={{ height: `${entry.percent}%` }}>
                          <em>{entry.label}: {formatNumber(entry.tokens, language)} {tokenTerm}</em>
                        </i>
                        <span>{entry.label}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="profile-chart-empty">{copy.emptyUsage}</p>
                )}
              </section>
            </div>
          </section>

          <section className="profile-card profile-user-info">
            <div className="profile-section-title">
              <UserOutlined />
              <h2>{copy.userInfo}</h2>
            </div>
            <div className="profile-info-grid">
              <label>
                <span>{copy.timezone}</span>
                <select
                  disabled={!user || isSavingTimezone}
                  onChange={(event) => void handleTimezoneChange(event.target.value)}
                  value={timezone}
                >
                  {Array.from(new Set([timezone, ...commonTimezones])).map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span>{copy.lastLoginIp}</span>
                <strong>{user?.lastLoginIp ?? '-'}</strong>
              </div>
              <div>
                <span>{copy.lastLoginAt}</span>
                <strong>{formatDateTime(user?.lastLoginAt, language)}</strong>
              </div>
            </div>
          </section>

          <section className="profile-card profile-models">
            <div className="profile-section-title">
              <ApiOutlined />
              <h2>{copy.availableModels}</h2>
            </div>
            <label className="profile-search">
              <SearchOutlined />
              <input
                aria-label={copy.modelSearch}
                onChange={(event) => setModelQuery(event.target.value)}
                placeholder={copy.modelSearchPlaceholder}
                type="search"
                value={modelQuery}
              />
            </label>
            <div className="profile-model-summary">
              <span>{copy.availableModelCount(filteredModels.length)}</span>
              <button className="ghost-button compact-button" onClick={() => void copyAllModels()} type="button">
                <CopyOutlined />
                {copy.copyAllModels}
              </button>
            </div>
            <div className="profile-model-chip-list">
              {filteredModels.map((model) => (
                <ModelChip copy={copy} key={model.model} model={model} />
              ))}
              {!isLoading && filteredModels.length === 0 ? <p className="empty-state">{copy.emptyModels}</p> : null}
            </div>
          </section>

          <section className="profile-card profile-model-config">
            <div className="profile-section-title">
              <SettingOutlined />
              <h2>{copy.modelConfig}</h2>
            </div>
            <label>
              <span>{copy.unconfiguredModelRatio}</span>
              <select disabled value="global">
                <option value="global">{copy.globalModelConfig}</option>
              </select>
            </label>
          </section>

          <section className="profile-card profile-options">
            <div className="profile-section-title">
              <KeyOutlined />
              <h2>{copy.accountOptions}</h2>
            </div>
            <form className="auth-form compact-form" onSubmit={handleChangePassword}>
              <label>
                {copy.currentPassword}
                <input
                  autoComplete="current-password"
                  maxLength={128}
                  minLength={8}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                  type="password"
                  value={currentPassword}
                />
              </label>
              <label>
                {copy.newPassword}
                <input
                  autoComplete="new-password"
                  maxLength={128}
                  minLength={8}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  type="password"
                  value={newPassword}
                />
              </label>
              <div className="profile-option-actions">
                <button className="primary-button" disabled={isChangingPassword} type="submit">
                  <KeyOutlined />
                  {isChangingPassword ? copy.saving : copy.changePassword}
                </button>
                <Link className="secondary-link-button" href="/token">
                  <KeyOutlined />
                  {copy.systemToken}
                </Link>
              </div>
            </form>
          </section>
    </ConsoleShell>
  );
}

function UsageTile({
  accent,
  detail,
  icon,
  label,
  value
}: {
  accent: 'orange' | 'blue' | 'violet' | 'rose';
  detail: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className={`profile-usage-tile accent-${accent}`}>
      <div className="profile-usage-icon" aria-hidden="true">
        {icon}
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function MetricBlock({
  accent,
  label,
  value,
  unit,
  detail,
  icon
}: {
  accent: 'green' | 'red' | 'blue' | 'violet' | 'rose';
  label: string;
  value: string;
  unit?: string;
  detail?: string;
  icon?: ReactNode;
}) {
  return (
    <div className={`profile-metric-block accent-${accent}`}>
      <div className="profile-metric-icon" aria-hidden="true">
        {icon}
      </div>
      <div>
        <span>{label}</span>
        <strong>
          <span className="profile-metric-value">{value}</span>
          {unit ? <span className="profile-metric-unit">{unit}</span> : null}
        </strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}

function ModelChip({ copy, model }: { copy: ProfileCopy; model: AvailableModel }) {
  return (
    <button
      className="profile-model-chip"
      onClick={() => void navigator.clipboard.writeText(model.model)}
      title={copy.copyModelName}
      type="button"
    >
      {model.model}
    </button>
  );
}

function isSuccessfulUsage(row: UsageLogEntry) {
  return row.status === 'billable' || row.status === 'free';
}

function formatRole(role: string | undefined, copy: ProfileCopy) {
  if (role === 'admin') {
    return copy.adminRole;
  }

  if (role === 'user') {
    return copy.userRole;
  }

  return '-';
}

function summarizeTodayUsage(rows: UsageLogEntry[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return rows.reduce(
    (summary, row) => {
      if (new Date(row.createdAt) < today) {
        return summary;
      }

      summary.requests += 1;
      summary.promptTokens += row.promptTokens;
      summary.completionTokens += row.completionTokens;
      summary.totalTokens += row.totalTokens;
      return summary;
    },
    { completionTokens: 0, promptTokens: 0, requests: 0, totalTokens: 0 }
  );
}

function getModelBreakdown(rows: UsageLogEntry[]) {
  const totals = rows.reduce<Record<string, number>>((nextTotals, row) => {
    nextTotals[row.model] = (nextTotals[row.model] ?? 0) + row.totalTokens;
    return nextTotals;
  }, {});
  const maxTokens = Math.max(1, ...Object.values(totals));

  return Object.entries(totals)
    .map(([model, tokens]) => ({
      model,
      percent: Math.max(4, Math.round((tokens / maxTokens) * 100)),
      tokens
    }))
    .sort((left, right) => right.tokens - left.tokens)
    .slice(0, 5);
}

function getTokenTrend(rows: UsageLogEntry[], rangeDays: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayTotals = new Map<string, number>();

  for (const row of rows) {
    const rowDate = new Date(row.createdAt);
    rowDate.setHours(0, 0, 0, 0);
    const key = rowDate.toISOString().slice(0, 10);
    dayTotals.set(key, (dayTotals.get(key) ?? 0) + row.totalTokens);
  }

  const entries = Array.from({ length: rangeDays }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (rangeDays - index - 1));
    const key = date.toISOString().slice(0, 10);
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      tokens: dayTotals.get(key) ?? 0
    };
  });
  const maxTokens = Math.max(1, ...entries.map((entry) => entry.tokens));

  return entries.map((entry) => ({
    ...entry,
    percent: entry.tokens === 0 ? 4 : Math.max(10, Math.round((entry.tokens / maxTokens) * 100))
  }));
}

function formatNumber(value: number, language: LanguageCode) {
  return new Intl.NumberFormat(language).format(value);
}

function formatDateTime(value: string | null | undefined, language: LanguageCode) {
  return value ? new Date(value).toLocaleString(language) : '-';
}
