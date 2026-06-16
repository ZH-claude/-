'use client';

import {
  BellOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined,
  WalletOutlined
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import {
  getNotificationSettings,
  testWebhookNotification,
  updateNotificationSettings,
  type NotificationDelivery,
  type NotificationSettingsResponse
} from '../../lib/notifications-api';

export default function NotificationSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<NotificationSettingsResponse | null>(null);
  const [balanceLowEnabled, setBalanceLowEnabled] = useState(false);
  const [thresholdYuan, setThresholdYuan] = useState('');
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
      const result = await getNotificationSettings();
      applySettings(result);
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '通知设置加载失败';
      setError(nextMessage);
      if (nextMessage.startsWith('401:') || nextMessage.includes('认证') || nextMessage.includes('会话')) {
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

    try {
      const thresholdCents = thresholdYuan.trim() ? Math.round(Number(thresholdYuan) * 100) : null;
      if (thresholdYuan.trim() && (!Number.isFinite(Number(thresholdYuan)) || Number(thresholdYuan) < 0)) {
        throw new Error('余额阈值必须是非负金额');
      }

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
      });
      applySettings(result);
      setWebhookUrl('');
      setMessage('通知设置已保存');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '通知设置保存失败');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTestWebhook() {
    setIsTesting(true);
    setError('');
    setMessage('');

    try {
      const result = await testWebhookNotification();
      setMessage(`Webhook 测试成功：${result.delivery.responseStatus ?? 'sent'}`);
      await loadSettings();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Webhook 测试失败');
      await loadSettings().catch(() => undefined);
    } finally {
      setIsTesting(false);
    }
  }

  function applySettings(nextSettings: NotificationSettingsResponse) {
    setSettings(nextSettings);
    setBalanceLowEnabled(nextSettings.preference.balanceLowEnabled);
    setThresholdYuan(
      nextSettings.preference.balanceLowThresholdCents === null
        ? ''
        : (nextSettings.preference.balanceLowThresholdCents / 100).toFixed(2)
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
    <main className="account-page">
      <header className="topbar">
        <Link className="auth-brand compact" href="/">
          <span className="shell-logo-mark">R</span>
          <span>Relay Console</span>
        </Link>
        <nav className="admin-top-actions" aria-label="通知设置导航">
          <Link className="ghost-button" href="/account/profile">
            <WalletOutlined />
            账户
          </Link>
          <button className="ghost-button" disabled={isLoading} onClick={() => void loadSettings()} type="button">
            <ReloadOutlined />
            刷新
          </button>
        </nav>
      </header>

      <section className="account-grid">
        <section className="account-panel account-summary">
          <div>
            <p className="eyebrow">通知设置</p>
            <h1>{isLoading ? '加载中' : formatCents(settings?.wallet.balanceCents ?? 0)}</h1>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadSettings()} title="刷新通知设置" type="button">
            <ReloadOutlined />
          </button>
        </section>

        <div className="metric-panel">
          <span>余额预警</span>
          <strong>{balanceLowEnabled ? '已启用' : '未启用'}</strong>
          <small>阈值 {thresholdYuan ? `${thresholdYuan} 元` : '-'}</small>
        </div>
        <div className="metric-panel">
          <span>Webhook</span>
          <strong>{webhook?.configured ? '已配置' : '未配置'}</strong>
          <small>{webhook?.targetPreview ?? '-'}</small>
        </div>
        <div className="metric-panel">
          <span>最近通知</span>
          <strong>{formatDeliveryStatus(settings?.deliveries[0]?.status ?? null)}</strong>
          <small>{formatDateTime(settings?.deliveries[0]?.createdAt ?? null) ?? '-'}</small>
        </div>

        {error ? <p className="form-error wide-panel">{error}</p> : null}
        {message ? <p className="form-success wide-panel">{message}</p> : null}

        <form className="account-panel wide-panel notification-settings-form" onSubmit={handleSave}>
          <div className="panel-title">
            <BellOutlined />
            <h2>事件订阅</h2>
          </div>

          <div className="notification-form-grid">
            <label className="toggle-label">
              <input checked={balanceLowEnabled} onChange={(event) => setBalanceLowEnabled(event.target.checked)} type="checkbox" />
              余额预警
            </label>
            <label>
              余额阈值（元）
              <input
                inputMode="decimal"
                min="0"
                onChange={(event) => setThresholdYuan(event.target.value)}
                placeholder="10.00"
                step="0.01"
                type="number"
                value={thresholdYuan}
              />
            </label>
            <label className="toggle-label">
              <input
                checked={securityAlertsEnabled}
                onChange={(event) => setSecurityAlertsEnabled(event.target.checked)}
                type="checkbox"
              />
              安全警报
            </label>
            <label className="toggle-label">
              <input
                checked={systemAnnouncementsEnabled}
                onChange={(event) => setSystemAnnouncementsEnabled(event.target.checked)}
                type="checkbox"
              />
              系统公告
            </label>
            <label className="toggle-label">
              <input checked={promotionsEnabled} onChange={(event) => setPromotionsEnabled(event.target.checked)} type="checkbox" />
              促销通知
            </label>
            <label className="toggle-label">
              <input
                checked={modelPriceUpdatesEnabled}
                onChange={(event) => setModelPriceUpdatesEnabled(event.target.checked)}
                type="checkbox"
              />
              模型价格更新
            </label>
          </div>

          <div className="panel-title secondary-panel-title">
            <SendOutlined />
            <h2>通知渠道</h2>
          </div>
          <div className="channel-grid">
            <section className="channel-box">
              <div className="channel-heading">
                <strong>Webhook</strong>
                {renderChannelStatus(webhook?.enabled ?? false, webhook?.configured ?? false, webhook?.supported ?? true)}
              </div>
              <label className="toggle-label">
                <input checked={webhookEnabled} onChange={(event) => setWebhookEnabled(event.target.checked)} type="checkbox" />
                启用 Webhook
              </label>
              <label>
                名称
                <input maxLength={80} onChange={(event) => setWebhookName(event.target.value)} value={webhookName} />
              </label>
              <label>
                Webhook URL
                <input
                  maxLength={2048}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                  placeholder={webhook?.targetPreview ?? '输入 HTTPS Webhook URL'}
                  type="url"
                  value={webhookUrl}
                />
              </label>
              <small className="table-note">当前目标：{webhook?.targetPreview ?? '-'}</small>
              <button
                className="ghost-button"
                disabled={isTesting || !webhook?.enabled || !webhook.configured}
                onClick={handleTestWebhook}
                type="button"
              >
                <SendOutlined />
                {isTesting ? '测试中' : '测试 Webhook'}
              </button>
            </section>

            <section className="channel-box">
              <div className="channel-heading">
                <strong>Email</strong>
                {renderChannelStatus(email?.enabled ?? false, email?.configured ?? false, email?.supported ?? false)}
              </div>
              <small className="table-note">状态：{email?.lastTestError ?? 'email_sender_not_configured'}</small>
              <button className="ghost-button" disabled type="button">
                <SendOutlined />
                测试 Email
              </button>
            </section>
          </div>

          <div className="filter-actions notification-actions">
            <button className="primary-button" disabled={isSaving} type="submit">
              <SaveOutlined />
              {isSaving ? '保存中' : '保存设置'}
            </button>
          </div>
        </form>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <CheckCircleOutlined />
            <h2>投递记录</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table notification-table">
              <thead>
                <tr>
                  <th>事件</th>
                  <th>状态</th>
                  <th>目标</th>
                  <th>HTTP</th>
                  <th>错误</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {(settings?.deliveries ?? []).map((delivery) => (
                  <DeliveryRow delivery={delivery} key={delivery.id} />
                ))}
                {!isLoading && !(settings?.deliveries ?? []).length ? (
                  <tr>
                    <td colSpan={6}>暂无真实投递记录</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function DeliveryRow({ delivery }: { delivery: NotificationDelivery }) {
  return (
    <tr>
      <td>{formatEvent(delivery.eventType)}</td>
      <td>{delivery.status === 'sent' ? <span className="status-pill status-pill-success">成功</span> : <span className="status-pill status-pill-danger">失败</span>}</td>
      <td>{delivery.targetPreview ?? '-'}</td>
      <td>{delivery.responseStatus ?? '-'}</td>
      <td>{delivery.errorMessage ?? '-'}</td>
      <td>{formatDateTime(delivery.createdAt) ?? '-'}</td>
    </tr>
  );
}

function renderChannelStatus(enabled: boolean, configured: boolean, supported: boolean) {
  if (!supported) {
    return <span className="status-pill status-pill-muted">未接入</span>;
  }

  if (enabled && configured) {
    return <span className="status-pill status-pill-success">可用</span>;
  }

  if (configured) {
    return <span className="status-pill status-pill-warning">已配置</span>;
  }

  return <span className="status-pill status-pill-muted">未配置</span>;
}

function formatEvent(eventType: string) {
  const labels: Record<string, string> = {
    test: '测试通知',
    balance_low: '余额预警',
    security_alert: '安全警报',
    system_announcement: '系统公告',
    promotion: '促销通知',
    model_price_update: '模型价格更新'
  };

  return labels[eventType] ?? eventType;
}

function formatDeliveryStatus(status: string | null) {
  if (status === 'sent') {
    return '成功';
  }

  if (status === 'failed') {
    return '失败';
  }

  return '-';
}

function formatCents(value: number) {
  return `${(value / 100).toFixed(2)} 元`;
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : null;
}
