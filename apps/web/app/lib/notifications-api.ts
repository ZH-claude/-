import { createApiClientError } from './api-error-copy';

export type NotificationDeliveryStatus = 'sent' | 'failed';
export type NotificationEventType =
  | 'test'
  | 'balance_low'
  | 'security_alert'
  | 'system_announcement'
  | 'promotion'
  | 'model_price_update';

export type NotificationChannel = {
  type: 'webhook' | 'email';
  name: string;
  enabled: boolean;
  configured: boolean;
  supported: boolean;
  targetPreview: string | null;
  lastTestStatus: NotificationDeliveryStatus | null;
  lastTestAt: string | null;
  lastTestError: string | null;
};

export type NotificationDelivery = {
  id: string;
  eventType: NotificationEventType;
  status: NotificationDeliveryStatus;
  targetPreview: string | null;
  responseStatus: number | null;
  errorMessage: string | null;
  createdAt: string;
};

export type NotificationSettingsResponse = {
  wallet: {
    balanceCents: number;
    totalSpendCents: number;
  };
  preference: {
    balanceLowEnabled: boolean;
    balanceLowThresholdCents: number | null;
    balanceLowLastNotifiedAt: string | null;
    securityAlertsEnabled: boolean;
    systemAnnouncementsEnabled: boolean;
    promotionsEnabled: boolean;
    modelPriceUpdatesEnabled: boolean;
  };
  channels: {
    webhook: NotificationChannel;
    email: NotificationChannel;
  };
  deliveries: NotificationDelivery[];
};

export type UpdateNotificationSettingsPayload = {
  preference: {
    balanceLowEnabled: boolean;
    balanceLowThresholdCents: number | null;
    securityAlertsEnabled: boolean;
    systemAnnouncementsEnabled: boolean;
    promotionsEnabled: boolean;
    modelPriceUpdatesEnabled: boolean;
  };
  webhook: {
    name: string;
    enabled: boolean;
    url?: string;
  };
};

const API_BASE_URL = '/api';

export async function getNotificationSettings(language?: string) {
  return request<NotificationSettingsResponse>('/notifications/settings', {}, language);
}

export async function updateNotificationSettings(payload: UpdateNotificationSettingsPayload, language?: string) {
  return request<NotificationSettingsResponse>('/notifications/settings', {
    method: 'PUT',
    body: payload
  }, language);
}

export async function testWebhookNotification(language?: string) {
  return request<{ delivery: NotificationDelivery }>('/notifications/test-webhook', {
    method: 'POST'
  }, language);
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT';
    body?: Record<string, unknown>;
  } = {},
  language?: string
) {
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  if (language) {
    headers['Accept-Language'] = language;
  }

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw createApiClientError(language, response.status, data);
  }

  return data as T;
}
