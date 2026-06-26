'use client';

import {
  BellOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { ConsoleShell } from '../../components/console-shell';
import { useI18n } from '../../components/language-provider';
import { isAuthenticationApiError } from '../../lib/api-error-copy';
import { formatBillingUsd, formatBillingUsdForInput, parseBillingUsdInput } from '../../lib/billing-format';
import { applyCopyOverrides, type CopyOverrides } from '../../lib/copy-overrides';
import type { LanguageCode } from '../../lib/i18n';
import { pageTerm } from '../../lib/page-copy-terms';
import {
  getNotificationSettings,
  testWebhookNotification,
  updateNotificationSettings,
  type NotificationDelivery,
  type NotificationSettingsResponse
} from '../../lib/notifications-api';

type NotificationCopy = {
  balanceLow: string;
  channelStatuses: {
    available: string;
    configured: string;
    notConfigured: string;
    unsupported: string;
  };
  channels: string;
  currentTarget: string;
  deliveryRecords: string;
  deliveryStatuses: {
    failed: string;
    sent: string;
  };
  emailStatus: string;
  emptyDeliveries: string;
  enableWebhook: string;
  eventLabels: Record<string, string>;
  events: string;
  fields: {
    event: string;
    error: string;
    http: string;
    name: string;
    status: string;
    target: string;
    time: string;
    webhookUrl: string;
  };
  loadFailed: string;
  loading: string;
  modelPriceUpdates: string;
  name: string;
  notEnabled: string;
  promotions: string;
  refresh: string;
  save: string;
  saveFailed: string;
  saved: string;
  saving: string;
  securityAlerts: string;
  systemAnnouncements: string;
  testEmail: string;
  testFailed: string;
  testSuccess: (status: string | number) => string;
  testWebhook: string;
  testing: string;
  threshold: string;
  thresholdPreview: (value: string) => string;
  title: string;
  webHookPlaceholder: string;
};

const NOTIFICATION_COPY = {
  'zh-CN': {
    balanceLow: '余额预警',
    channelStatuses: { available: '可用', configured: '已配置', notConfigured: '未配置', unsupported: '未接入' },
    channels: '通知渠道',
    currentTarget: '当前目标',
    deliveryRecords: '投递记录',
    deliveryStatuses: { failed: '失败', sent: '成功' },
    emailStatus: '状态',
    emptyDeliveries: '暂无真实投递记录',
    enableWebhook: '启用 Webhook',
    eventLabels: {
      balance_low: '余额预警',
      model_price_update: '模型价格更新',
      promotion: '促销通知',
      security_alert: '安全警报',
      system_announcement: '系统公告',
      test: '测试通知'
    },
    events: '事件订阅',
    fields: { event: '事件', error: '错误', http: 'HTTP', name: '名称', status: '状态', target: '目标', time: '时间', webhookUrl: 'Webhook URL' },
    loadFailed: '通知设置加载失败',
    loading: '加载中',
    modelPriceUpdates: '模型价格更新',
    name: '名称',
    notEnabled: '未启用',
    promotions: '促销通知',
    refresh: '刷新通知设置',
    save: '保存设置',
    saveFailed: '通知设置保存失败',
    saved: '通知设置已保存',
    saving: '保存中',
    securityAlerts: '安全警报',
    systemAnnouncements: '系统公告',
    testEmail: '测试 Email',
    testFailed: 'Webhook 测试失败',
    testSuccess: (status) => `Webhook 测试成功：${status}`,
    testWebhook: '测试 Webhook',
    testing: '测试中',
    threshold: '余额阈值（人民币）',
    thresholdPreview: (value) => `阈值 ${value}`,
    title: '通知设置',
    webHookPlaceholder: '输入 HTTPS Webhook URL'
  },
  'zh-TW': {
    balanceLow: '餘額預警',
    channelStatuses: { available: '可用', configured: '已配置', notConfigured: '未配置', unsupported: '未接入' },
    channels: '通知渠道',
    currentTarget: '目前目標',
    deliveryRecords: '投遞記錄',
    deliveryStatuses: { failed: '失敗', sent: '成功' },
    emailStatus: '狀態',
    emptyDeliveries: '暫無真實投遞記錄',
    enableWebhook: '啟用 Webhook',
    eventLabels: {
      balance_low: '餘額預警',
      model_price_update: '模型價格更新',
      promotion: '促銷通知',
      security_alert: '安全警報',
      system_announcement: '系統公告',
      test: '測試通知'
    },
    events: '事件訂閱',
    fields: { event: '事件', error: '錯誤', http: 'HTTP', name: '名稱', status: '狀態', target: '目標', time: '時間', webhookUrl: 'Webhook URL' },
    loadFailed: '通知設定載入失敗',
    loading: '載入中',
    modelPriceUpdates: '模型價格更新',
    name: '名稱',
    notEnabled: '未啟用',
    promotions: '促銷通知',
    refresh: '重新整理通知設定',
    save: '保存設定',
    saveFailed: '通知設定保存失敗',
    saved: '通知設定已保存',
    saving: '保存中',
    securityAlerts: '安全警報',
    systemAnnouncements: '系統公告',
    testEmail: '測試 Email',
    testFailed: 'Webhook 測試失敗',
    testSuccess: (status) => `Webhook 測試成功：${status}`,
    testWebhook: '測試 Webhook',
    testing: '測試中',
    threshold: '餘額閾值（人民幣）',
    thresholdPreview: (value) => `閾值 ${value}`,
    title: '通知設定',
    webHookPlaceholder: '輸入 HTTPS Webhook URL'
  },
  'en-US': {
    balanceLow: 'Low balance alert',
    channelStatuses: { available: 'Available', configured: 'Configured', notConfigured: 'Not configured', unsupported: 'Not connected' },
    channels: 'Notification channels',
    currentTarget: 'Current target',
    deliveryRecords: 'Delivery records',
    deliveryStatuses: { failed: 'Failed', sent: 'Sent' },
    emailStatus: 'Status',
    emptyDeliveries: 'No real delivery records',
    enableWebhook: 'Enable Webhook',
    eventLabels: {
      balance_low: 'Low balance alert',
      model_price_update: 'Model price update',
      promotion: 'Promotion',
      security_alert: 'Security alert',
      system_announcement: 'System announcement',
      test: 'Test notification'
    },
    events: 'Event subscriptions',
    fields: { event: 'Event', error: 'Error', http: 'HTTP', name: 'Name', status: 'Status', target: 'Target', time: 'Time', webhookUrl: 'Webhook URL' },
    loadFailed: 'Failed to load notification settings',
    loading: 'Loading',
    modelPriceUpdates: 'Model price updates',
    name: 'Name',
    notEnabled: 'Disabled',
    promotions: 'Promotions',
    refresh: 'Refresh notification settings',
    save: 'Save settings',
    saveFailed: 'Failed to save notification settings',
    saved: 'Notification settings saved',
    saving: 'Saving',
    securityAlerts: 'Security alerts',
    systemAnnouncements: 'System announcements',
    testEmail: 'Test Email',
    testFailed: 'Webhook test failed',
    testSuccess: (status) => `Webhook test succeeded: ${status}`,
    testWebhook: 'Test Webhook',
    testing: 'Testing',
    threshold: 'Balance threshold (CNY)',
    thresholdPreview: (value) => `Threshold ${value}`,
    title: 'Notification settings',
    webHookPlaceholder: 'Enter HTTPS Webhook URL'
  }
} satisfies Record<'zh-CN' | 'zh-TW' | 'en-US', NotificationCopy>;

function getNotificationCopy(language: LanguageCode) {
  if (language === 'zh-CN' || language === 'zh-TW') {
    return NOTIFICATION_COPY[language];
  }

  const base = NOTIFICATION_COPY['en-US'];
  if (language === 'en-US') {
    return base;
  }

  return applyCopyOverrides(base, getNotificationCopyOverrides(language));
}

function getNotificationCopyOverrides(language: LanguageCode): CopyOverrides<NotificationCopy> {
  return {
    balanceLow: pageTerm(language, 'lowBalanceAlert'),
    channelStatuses: {
      available: pageTerm(language, 'active'),
      configured: pageTerm(language, 'configured'),
      notConfigured: pageTerm(language, 'notConfigured'),
      unsupported: pageTerm(language, 'disabled')
    },
    channels: pageTerm(language, 'notificationChannels'),
    currentTarget: pageTerm(language, 'target'),
    deliveryRecords: pageTerm(language, 'deliveryRecords'),
    deliveryStatuses: {
      failed: pageTerm(language, 'failed'),
      sent: pageTerm(language, 'sent')
    },
    emailStatus: pageTerm(language, 'status'),
    emptyDeliveries: pageTerm(language, 'emptyRecords'),
    enableWebhook: `${pageTerm(language, 'enabled')} ${pageTerm(language, 'webhook')}`,
    eventLabels: {
      balance_low: pageTerm(language, 'lowBalanceAlert'),
      model_price_update: pageTerm(language, 'modelPriceUpdates'),
      promotion: pageTerm(language, 'promotions'),
      security_alert: pageTerm(language, 'securityAlerts'),
      system_announcement: pageTerm(language, 'systemAnnouncements'),
      test: pageTerm(language, 'test')
    },
    events: pageTerm(language, 'eventSubscriptions'),
    fields: {
      event: pageTerm(language, 'event'),
      error: pageTerm(language, 'error'),
      name: pageTerm(language, 'name'),
      status: pageTerm(language, 'status'),
      target: pageTerm(language, 'target'),
      time: pageTerm(language, 'time'),
      webhookUrl: 'Webhook URL'
    },
    loadFailed: `${pageTerm(language, 'loading')} ${pageTerm(language, 'failed')}`,
    loading: pageTerm(language, 'loading'),
    modelPriceUpdates: pageTerm(language, 'modelPriceUpdates'),
    name: pageTerm(language, 'name'),
    notEnabled: pageTerm(language, 'notEnabled'),
    promotions: pageTerm(language, 'promotions'),
    refresh: `${pageTerm(language, 'refresh')} ${pageTerm(language, 'notificationSettings')}`,
    save: pageTerm(language, 'saveSettings'),
    saveFailed: `${pageTerm(language, 'save')} ${pageTerm(language, 'failed')}`,
    saved: `${pageTerm(language, 'notificationSettings')} ${pageTerm(language, 'save')}`,
    saving: pageTerm(language, 'saving'),
    securityAlerts: pageTerm(language, 'securityAlerts'),
    systemAnnouncements: pageTerm(language, 'systemAnnouncements'),
    testEmail: `${pageTerm(language, 'test')} Email`,
    testFailed: `${pageTerm(language, 'test')} ${pageTerm(language, 'failed')}`,
    testSuccess: (status) => `${pageTerm(language, 'test')}: ${status}`,
    testWebhook: `${pageTerm(language, 'test')} Webhook`,
    testing: pageTerm(language, 'testing'),
    threshold: pageTerm(language, 'threshold'),
    thresholdPreview: (value) => `${pageTerm(language, 'threshold')} ${value}`,
    title: pageTerm(language, 'notificationSettings'),
    webHookPlaceholder: 'HTTPS Webhook URL'
  };
}

export default function NotificationSettingsPage() {
  const router = useRouter();
  const { language } = useI18n();
  const copy = getNotificationCopy(language);
  const [settings, setSettings] = useState<NotificationSettingsResponse | null>(null);
  const [balanceLowEnabled, setBalanceLowEnabled] = useState(false);
  const [thresholdBaseTokens, setThresholdBaseTokens] = useState('');
  const [securityAlertsEnabled, setSecurityAlertsEnabled] = useState(true);
  const [systemAnnouncementsEnabled, setSystemAnnouncementsEnabled] = useState(true);
  const [promotionsEnabled, setPromotionsEnabled] = useState(false);
  const [modelPriceUpdatesEnabled, setModelPriceUpdatesEnabled] = useState(false);
  const [webhookName, setWebhookName] = useState('Webhook');
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    setIsLoading(true);
    setError('');

    try {
      const result = await getNotificationSettings(language);
      applySettings(result);
    } catch (nextError) {
      setError(copy.loadFailed);
      if (isAuthenticationApiError(nextError)) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError('');
    setMessage('');

    const thresholdCents = parseBillingUsdInput(thresholdBaseTokens, copy.balanceLow);
    if (thresholdCents instanceof Error) {
      setError(thresholdCents.message);
      setIsSaving(false);
      return;
    }

    try {
      const result = await updateNotificationSettings({
        preference: {
          balanceLowEnabled,
          balanceLowThresholdCents: thresholdCents,
          securityAlertsEnabled,
          systemAnnouncementsEnabled,
          promotionsEnabled,
          modelPriceUpdatesEnabled
        },
        webhook: {
          name: webhookName.trim() || 'Webhook',
          enabled: webhookEnabled,
          ...(webhookUrl.trim() ? { url: webhookUrl.trim() } : {})
        }
      }, language);
      applySettings(result);
      setWebhookUrl('');
      setMessage(copy.saved);
    } catch {
      setError(copy.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTestWebhook() {
    setIsTesting(true);
    setError('');
    setMessage('');

    try {
      const result = await testWebhookNotification(language);
      setMessage(copy.testSuccess(result.delivery.responseStatus ?? 'sent'));
      await loadSettings();
    } catch {
      setError(copy.testFailed);
      await loadSettings().catch(() => undefined);
    } finally {
      setIsTesting(false);
    }
  }

  function applySettings(nextSettings: NotificationSettingsResponse) {
    setSettings(nextSettings);
    setBalanceLowEnabled(nextSettings.preference.balanceLowEnabled);
    setThresholdBaseTokens(
      nextSettings.preference.balanceLowThresholdCents === null
        ? ''
        : formatBillingUsdForInput(nextSettings.preference.balanceLowThresholdCents)
    );
    setSecurityAlertsEnabled(nextSettings.preference.securityAlertsEnabled);
    setSystemAnnouncementsEnabled(nextSettings.preference.systemAnnouncementsEnabled);
    setPromotionsEnabled(nextSettings.preference.promotionsEnabled);
    setModelPriceUpdatesEnabled(nextSettings.preference.modelPriceUpdatesEnabled);
    setWebhookName(nextSettings.channels.webhook.name);
    setWebhookEnabled(nextSettings.channels.webhook.enabled);
  }

  const webhook = settings?.channels.webhook;
  const email = settings?.channels.email;

  return (
    <ConsoleShell activePath="/account/notificationSettings" isRefreshing={isLoading} onRefresh={() => void loadSettings()}>
      <section className="console-content-grid">
        <section className="account-panel account-summary">
          <div>
            <p className="eyebrow">{copy.title}</p>
            <h1>{isLoading ? copy.loading : formatBillingUsd(settings?.wallet.balanceCents ?? 0)}</h1>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadSettings()} title={copy.refresh} type="button">
            <ReloadOutlined />
          </button>
        </section>

        <div className="metric-panel">
          <span>{copy.balanceLow}</span>
          <strong>{balanceLowEnabled ? copy.channelStatuses.available : copy.notEnabled}</strong>
          <small>{copy.thresholdPreview(formatThresholdPreview(thresholdBaseTokens))}</small>
        </div>
        <div className="metric-panel">
          <span>Webhook</span>
          <strong>{webhook?.configured ? copy.channelStatuses.configured : copy.channelStatuses.notConfigured}</strong>
          <small>{webhook?.targetPreview ?? '-'}</small>
        </div>
        <div className="metric-panel">
          <span>{copy.deliveryRecords}</span>
          <strong>{formatDeliveryStatus(settings?.deliveries[0]?.status ?? null, copy)}</strong>
          <small>{formatDateTime(settings?.deliveries[0]?.createdAt ?? null, language) ?? '-'}</small>
        </div>

        {error ? <p className="form-error wide-panel">{error}</p> : null}
        {message ? <p className="form-success wide-panel">{message}</p> : null}

        <form className="account-panel wide-panel notification-settings-form" onSubmit={handleSave}>
          <div className="panel-title">
            <BellOutlined />
            <h2>{copy.events}</h2>
          </div>

          <div className="notification-form-grid">
            <label className="toggle-label">
              <input checked={balanceLowEnabled} onChange={(event) => setBalanceLowEnabled(event.target.checked)} type="checkbox" />
              {copy.balanceLow}
            </label>
            <label>
              {copy.threshold}
              <input
                inputMode="decimal"
                min="0"
                onChange={(event) => setThresholdBaseTokens(event.target.value)}
                placeholder="10.00"
                step="0.000001"
                type="number"
                value={thresholdBaseTokens}
              />
            </label>
            <label className="toggle-label">
              <input
                checked={securityAlertsEnabled}
                onChange={(event) => setSecurityAlertsEnabled(event.target.checked)}
                type="checkbox"
              />
              {copy.securityAlerts}
            </label>
            <label className="toggle-label">
              <input
                checked={systemAnnouncementsEnabled}
                onChange={(event) => setSystemAnnouncementsEnabled(event.target.checked)}
                type="checkbox"
              />
              {copy.systemAnnouncements}
            </label>
            <label className="toggle-label">
              <input checked={promotionsEnabled} onChange={(event) => setPromotionsEnabled(event.target.checked)} type="checkbox" />
              {copy.promotions}
            </label>
            <label className="toggle-label">
              <input
                checked={modelPriceUpdatesEnabled}
                onChange={(event) => setModelPriceUpdatesEnabled(event.target.checked)}
                type="checkbox"
              />
              {copy.modelPriceUpdates}
            </label>
          </div>

          <div className="panel-title secondary-panel-title">
            <SendOutlined />
            <h2>{copy.channels}</h2>
          </div>
          <div className="channel-grid">
            <section className="channel-box">
              <div className="channel-heading">
                <strong>Webhook</strong>
                {renderChannelStatus(webhook?.enabled ?? false, webhook?.configured ?? false, webhook?.supported ?? true, copy)}
              </div>
              <label className="toggle-label">
                <input checked={webhookEnabled} onChange={(event) => setWebhookEnabled(event.target.checked)} type="checkbox" />
                {copy.enableWebhook}
              </label>
              <label>
                {copy.fields.name}
                <input maxLength={80} onChange={(event) => setWebhookName(event.target.value)} value={webhookName} />
              </label>
              <label>
                {copy.fields.webhookUrl}
                <input
                  maxLength={2048}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                  placeholder={webhook?.targetPreview ?? copy.webHookPlaceholder}
                  type="url"
                  value={webhookUrl}
                />
              </label>
              <small className="table-note">{copy.currentTarget}: {webhook?.targetPreview ?? '-'}</small>
              <button
                className="ghost-button"
                disabled={isTesting || !webhook?.enabled || !webhook.configured}
                onClick={handleTestWebhook}
                type="button"
              >
                <SendOutlined />
                {isTesting ? copy.testing : copy.testWebhook}
              </button>
            </section>

            <section className="channel-box">
              <div className="channel-heading">
                <strong>Email</strong>
                {renderChannelStatus(email?.enabled ?? false, email?.configured ?? false, email?.supported ?? false, copy)}
              </div>
              <small className="table-note">{copy.emailStatus}: {email?.lastTestError ?? copy.channelStatuses.notConfigured}</small>
              <button className="ghost-button" disabled type="button">
                <SendOutlined />
                {copy.testEmail}
              </button>
            </section>
          </div>

          <div className="filter-actions notification-actions">
            <button className="primary-button" disabled={isSaving} type="submit">
              <SaveOutlined />
              {isSaving ? copy.saving : copy.save}
            </button>
          </div>
        </form>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <CheckCircleOutlined />
            <h2>{copy.deliveryRecords}</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table notification-table">
              <thead>
                <tr>
                  <th>{copy.fields.event}</th>
                  <th>{copy.fields.status}</th>
                  <th>{copy.fields.target}</th>
                  <th>HTTP</th>
                  <th>{copy.fields.error}</th>
                  <th>{copy.fields.time}</th>
                </tr>
              </thead>
              <tbody>
                {(settings?.deliveries ?? []).map((delivery) => (
                  <DeliveryRow copy={copy} delivery={delivery} key={delivery.id} language={language} />
                ))}
                {!isLoading && !(settings?.deliveries ?? []).length ? (
                  <tr>
                    <td colSpan={6}>{copy.emptyDeliveries}</td>
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

function DeliveryRow({ copy, delivery, language }: { copy: NotificationCopy; delivery: NotificationDelivery; language: LanguageCode }) {
  return (
    <tr>
      <td>{formatEvent(delivery.eventType, copy)}</td>
      <td>{delivery.status === 'sent' ? <span className="status-pill status-pill-success">{copy.deliveryStatuses.sent}</span> : <span className="status-pill status-pill-danger">{copy.deliveryStatuses.failed}</span>}</td>
      <td>{delivery.targetPreview ?? '-'}</td>
      <td>{delivery.responseStatus ?? '-'}</td>
      <td>{delivery.errorMessage ?? '-'}</td>
      <td>{formatDateTime(delivery.createdAt, language) ?? '-'}</td>
    </tr>
  );
}

function renderChannelStatus(enabled: boolean, configured: boolean, supported: boolean, copy: NotificationCopy) {
  if (!supported) {
    return <span className="status-pill status-pill-muted">{copy.channelStatuses.unsupported}</span>;
  }

  if (enabled && configured) {
    return <span className="status-pill status-pill-success">{copy.channelStatuses.available}</span>;
  }

  if (configured) {
    return <span className="status-pill status-pill-warning">{copy.channelStatuses.configured}</span>;
  }

  return <span className="status-pill status-pill-muted">{copy.channelStatuses.notConfigured}</span>;
}

function formatEvent(eventType: string, copy: NotificationCopy) {
  return copy.eventLabels[eventType] ?? eventType;
}

function formatDeliveryStatus(status: string | null, copy: NotificationCopy) {
  if (status === 'sent') {
    return copy.deliveryStatuses.sent;
  }

  if (status === 'failed') {
    return copy.deliveryStatuses.failed;
  }

  return '-';
}

function formatThresholdPreview(value: string) {
  const parsed = parseBillingUsdInput(value);
  return parsed === null || parsed instanceof Error ? '-' : formatBillingUsd(parsed);
}

function formatDateTime(value: string | null, language: LanguageCode) {
  return value ? new Date(value).toLocaleString(language) : null;
}
