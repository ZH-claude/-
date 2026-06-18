export type RechargeRecord = {
  id: string;
  rechargeCodeId: string | null;
  amountCents: number;
  amountBaseTokens: number;
  faceValueCnyCents: number | null;
  balanceAfterCents: number;
  balanceAfterBaseTokens: number;
  status: string;
  createdAt: string;
};

export type RedeemRechargeResponse = {
  recharge: {
    id: string;
    amountCents: number;
    amountBaseTokens: number;
    faceValueCnyCents: number;
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

const API_BASE_URL = '/api';

export async function redeemRechargeCode(payload: { code: string }) {
  return request<RedeemRechargeResponse>('/recharge/redeem', {
    method: 'POST',
    body: payload
  });
}

export async function listRechargeRecords() {
  return request<RechargeRecordsResponse>('/recharge/records');
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
