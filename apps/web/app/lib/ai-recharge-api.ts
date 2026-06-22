export type AiRechargeProduct = {
  id: string;
  title: string;
  platform: string;
  planName: string;
  durationDays: number | null;
  priceCnyCents: number;
  description: string;
  purchaseNote: string | null;
  deliveryNote: string | null;
  sortOrder: number;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
};

export type AiRechargeOrder = {
  id: string;
  orderNo: string;
  userId: string;
  productId: string;
  productTitle: string;
  platform: string;
  planName: string;
  amountCnyCents: number;
  customerAccount: string;
  customerContact: string;
  customerNote: string | null;
  merchantNote: string | null;
  status: 'pending' | 'processing' | 'fulfilled' | 'canceled' | 'failed';
  createdAt: string;
  updatedAt: string;
};

export type AiRechargePageConfig = {
  id: string;
  introTitle: string | null;
  introContent: string | null;
  introImageDataUrl: string | null;
  updatedAt: string | null;
};

type ProductListResponse = {
  items: AiRechargeProduct[];
};

type OrderListResponse = {
  items: AiRechargeOrder[];
};

type OrderResponse = {
  order: AiRechargeOrder;
};

const API_BASE_URL = '/api';

export async function listAiRechargeProducts() {
  return request<ProductListResponse>('/ai-recharge/products');
}

export async function getAiRechargePageConfig() {
  return request<AiRechargePageConfig>('/ai-recharge/page-config');
}

export async function listAiRechargeOrders() {
  return request<OrderListResponse>('/ai-recharge/orders');
}

export async function createAiRechargeOrder(payload: {
  productId: string;
  customerAccount: string;
  customerContact: string;
  customerNote?: string;
}) {
  return request<OrderResponse>('/ai-recharge/orders', {
    method: 'POST',
    body: payload
  });
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
  } = {}
) {
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

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
    const message =
      data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : `请求失败：${response.status}`;
    throw new Error(message);
  }

  return data as T;
}
