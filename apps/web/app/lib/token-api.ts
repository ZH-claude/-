export type ApiToken = {
  id: string;
  name: string;
  keyPreview: string;
  status: 'active' | 'disabled' | 'deleted' | string;
  quotaCents?: number | null;
  usedCents: number;
  expiresAt: string | null;
  note?: string | null;
  lastUsedAt?: string | null;
  rateLimitRequestsPerMinute?: number | null;
  modelRateLimitRequestsPerMinute?: number | null;
  ipRateLimitRequestsPerMinute?: number | null;
  ipWhitelist: string[];
  activationTtlSeconds?: number | null;
  activatedAt?: string | null;
  activationExpiresAt?: string | null;
  revokedAt?: string | null;
  modelNames: string[];
  createdAt: string;
  updatedAt: string;
};

export type CreateApiTokenPayload = {
  name: string;
  note?: string;
  quotaCents?: number | null;
  expiresAt?: string | null;
  modelNames?: string[];
  rateLimitRequestsPerMinute?: number | null;
  modelRateLimitRequestsPerMinute?: number | null;
  ipRateLimitRequestsPerMinute?: number | null;
  ipWhitelist?: string[];
  activationTtlSeconds?: number | null;
};

type TokenListResponse = {
  items: ApiToken[];
};

type TokenResponse = {
  token: ApiToken;
};

type TokenKeyResponse = {
  apiKey: string;
  token: ApiToken;
};

const API_BASE_URL = '/api';

export async function listTokens() {
  return request<TokenListResponse>('/tokens');
}

export async function createToken(payload: CreateApiTokenPayload) {
  return request<TokenKeyResponse>('/tokens', {
    method: 'POST',
    body: payload
  });
}

export async function disableToken(tokenId: string) {
  return request<TokenResponse>(`/tokens/${encodeURIComponent(tokenId)}/disable`, {
    method: 'POST'
  });
}

export async function resetToken(tokenId: string) {
  return request<TokenKeyResponse>(`/tokens/${encodeURIComponent(tokenId)}/reset`, {
    method: 'POST'
  });
}

export async function updateToken(tokenId: string, payload: CreateApiTokenPayload) {
  return request<TokenResponse>(`/tokens/${encodeURIComponent(tokenId)}/update`, {
    method: 'POST',
    body: payload
  });
}

export async function deleteToken(tokenId: string) {
  return request<{ ok: boolean; token: ApiToken }>(`/tokens/${encodeURIComponent(tokenId)}`, {
    method: 'DELETE'
  });
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE';
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

  return (data as T) as T;
}
