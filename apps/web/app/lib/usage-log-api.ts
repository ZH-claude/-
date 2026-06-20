export type UsageLogStatus = 'billable' | 'free' | 'failed' | 'metering_unknown';

export type UsageLogEntry = {
  id: string;
  requestId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costCents: number;
  status: UsageLogStatus | string;
  errorCode: string | null;
  createdAt: string;
  token: {
    id: string;
    name: string;
    keyPreview: string;
  };
  walletTransaction: {
    id: string;
    amountCents: number;
    balanceAfterCents: number;
    createdAt: string;
  } | null;
};

export type UsageLogSummary = {
  total: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalCostCents: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  statusCounts: Record<UsageLogStatus, number>;
};

export type UsageLogFilters = {
  from?: string;
  to?: string;
  model?: string;
  tokenId?: string;
  status?: UsageLogStatus | '';
  limit?: number;
};

export type UsageLogsResponse = {
  items: UsageLogEntry[];
  summary: UsageLogSummary;
  filters: {
    limit: number;
    models: string[];
    tokens: Array<{
      id: string;
      name: string;
      keyPreview: string;
    }>;
  };
};

const API_BASE_URL = '/api';

export async function listUsageLogs(filters: UsageLogFilters = {}) {
  const search = new URLSearchParams();
  if (filters.from) {
    search.set('from', filters.from);
  }
  if (filters.to) {
    search.set('to', filters.to);
  }
  if (filters.model) {
    search.set('model', filters.model);
  }
  if (filters.tokenId) {
    search.set('tokenId', filters.tokenId);
  }
  if (filters.status) {
    search.set('status', filters.status);
  }
  if (filters.limit) {
    search.set('limit', String(filters.limit));
  }

  return request<UsageLogsResponse>(`/usage/logs${search.toString() ? `?${search.toString()}` : ''}`);
}

async function request<T>(path: string) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    credentials: 'include'
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
