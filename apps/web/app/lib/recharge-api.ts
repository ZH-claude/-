import { createApiClientError } from './api-error-copy';

export type RechargeRecord = {
  id: string;
  rechargeCodeId: string | null;
  paymentOrderId: string | null;
  paymentOrderNo: string | null;
  paymentChannel: 'alipay' | 'wechat' | null;
  rechargeCodeKind: 'balance' | 'vibe_coding' | null;
  amountCents: number;
  amountBaseTokens: number;
  faceValueCnyCents: number | null;
  quotaHours: number | null;
  quotaPeriodDays: number | null;
  tokenQuota: number | null;
  vibeCodingPackage?: {
    quotaHours: number | null;
    quotaPeriodDays: number | null;
    tokenQuota: number | null;
  } | null;
  vibeCodingEntitlement?: {
    id: string;
    quotaHours: number;
    quotaPeriodDays: number;
    tokenQuota: number;
    usedTokenQuota: number;
    startsAt: string;
    expiresAt: string;
    status: string;
  } | null;
  balanceAfterCents: number;
  balanceAfterBaseTokens: number;
  status: string;
  createdAt: string;
};

export type PaymentChannel = 'alipay' | 'wechat';

export type PaymentOrder = {
  id: string;
  orderNo: string;
  channel: PaymentChannel;
  status: string;
  amountCents: number;
  amountBaseTokens: number;
  faceValueCnyCents: number;
  providerTradeNo: string | null;
  payUrl: string | null;
  qrCodeContent: string | null;
  walletTransactionId?: string | null;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RedeemRechargeResponse = {
  recharge: {
    id: string;
    kind: 'balance' | 'vibe_coding';
    amountCents: number;
    amountBaseTokens: number;
    faceValueCnyCents: number;
    quotaHours: number | null;
    quotaPeriodDays: number | null;
    tokenQuota: number | null;
    vibeCodingPackage?: {
      quotaHours: number | null;
      quotaPeriodDays: number | null;
      tokenQuota: number | null;
    } | null;
    entitlement: {
      id: string;
      quotaHours: number;
      quotaPeriodDays: number;
      tokenQuota: number;
      usedTokenQuota: number;
      startsAt: string;
      expiresAt: string;
      status: string;
    } | null;
    usedAt: string;
  };
  wallet: {
    balanceCents: number;
    balanceBaseTokens: number;
    totalSpendCents: number;
  };
  transaction: {
    id: string;
    amountCents: number;
    amountBaseTokens: number;
    balanceAfterCents: number;
    balanceAfterBaseTokens: number;
    createdAt: string;
  };
};

type RechargeRecordsResponse = {
  items: RechargeRecord[];
};

type PaymentOrdersResponse = {
  items: PaymentOrder[];
};

type PaymentOrderResponse = {
  order: PaymentOrder;
};

const API_BASE_URL = '/api';

export async function redeemRechargeCode(payload: { code: string }, language?: string) {
  return request<RedeemRechargeResponse>('/recharge/redeem', {
    method: 'POST',
    body: payload
  }, language);
}

export async function listRechargeRecords(language?: string) {
  return request<RechargeRecordsResponse>('/recharge/records', {}, language);
}

export async function createPaymentOrder(payload: { amountCnyCents: number; channel: PaymentChannel }, language?: string) {
  return request<PaymentOrderResponse>('/recharge/payments/orders', {
    method: 'POST',
    body: payload
  }, language);
}

export async function listPaymentOrders(language?: string) {
  return request<PaymentOrdersResponse>('/recharge/payments/orders', {}, language);
}

export async function getPaymentOrder(orderNo: string, language?: string) {
  return request<PaymentOrderResponse>(`/recharge/payments/orders/${encodeURIComponent(orderNo)}`, {}, language);
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
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
