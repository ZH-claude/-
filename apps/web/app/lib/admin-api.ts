export type AdminUser = {
  id: string;
  username: string;
  role: string;
  status: string;
  timezone: string;
  group: {
    id: string;
    code: string;
    name: string;
  };
  wallet: {
    balanceCents: number;
    totalSpendCents?: number;
  };
  lastLoginAt: string | null;
  createdAt: string;
};

export type Announcement = {
  id: string;
  title: string;
  content: string;
  category: AnnouncementCategory;
  status: string;
  publishedAt: string | null;
  createdBy?: string;
  createdByAdminId?: string;
  createdAt: string;
  updatedAt?: string;
};

export type AnnouncementCategory = 'announcement' | 'update_log' | 'usage_guide';

export type UpstreamProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyPreview: string;
  status: string;
  healthStatus: string;
  lastHealthCheckAt: string | null;
  lastHealthLatencyMs: number | null;
  lastHealthError: string | null;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminGroup = {
  id: string;
  code: string;
  name: string;
  multiplier: string;
  status: string;
  userCount: number;
  modelAccessCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminModelPrice = {
  id: string;
  model: string;
  displayName: string | null;
  inputPriceCentsPer1k: number;
  outputPriceCentsPer1k: number;
  modelMultiplier: string;
  status: string;
  groups: Array<{
    id: string;
    code: string;
    name: string;
  }>;
  upstreamMappings: Array<{
    id: string;
    providerId: string;
    providerName: string;
    providerStatus: string;
    upstreamModel: string;
    status: string;
    supportsStream: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type UpstreamModelMapping = {
  id: string;
  providerId: string;
  providerName: string;
  providerStatus: string;
  publicModel: string;
  displayName: string | null;
  upstreamModel: string;
  status: string;
  supportsStream: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminRechargeCode = {
  id: string;
  amountCents: number;
  status: string;
  createdBy?: string;
  usedBy?: string | null;
  usedByUserId?: string | null;
  usedAt: string | null;
  walletTransactionId?: string | null;
  createdAt: string;
};

export type CreatedRechargeCode = {
  id: string;
  code: string;
  amountCents: number;
  status: string;
  createdAt: string;
};

type UserListResponse = {
  items: AdminUser[];
  total: number;
  page: number;
  limit: number;
};

type AnnouncementListResponse = {
  items: Announcement[];
};

type UpstreamProviderListResponse = {
  items: UpstreamProvider[];
};

type ModelConfigurationResponse = {
  groups: AdminGroup[];
  models: AdminModelPrice[];
  upstreamModels: UpstreamModelMapping[];
  upstreamModelsPagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type UpstreamHealthCheckResponse = {
  reachable: boolean;
  checkedAt: string;
  provider: UpstreamProvider;
};

type RechargeCodeListResponse = {
  items: AdminRechargeCode[];
};

type CreateRechargeCodesResponse = {
  items: CreatedRechargeCode[];
};

const API_BASE_URL = '/api';

export async function listAdminUsers() {
  return request<UserListResponse>('/admin/users?limit=100');
}

export async function listAnnouncements() {
  return request<AnnouncementListResponse>('/admin/announcements');
}

export async function createAnnouncement(payload: {
  title: string;
  content: string;
  category: AnnouncementCategory;
  status: 'draft' | 'published';
}) {
  return request<Announcement>('/admin/announcements', {
    method: 'POST',
    body: payload
  });
}

export async function listUpstreamProviders() {
  return request<UpstreamProviderListResponse>('/admin/upstreams');
}

export async function listModelConfiguration(options: { upstreamModelsPage?: number; upstreamModelsLimit?: number } = {}) {
  const params = new URLSearchParams();
  if (options.upstreamModelsPage) {
    params.set('upstreamModelsPage', String(options.upstreamModelsPage));
  }
  if (options.upstreamModelsLimit) {
    params.set('upstreamModelsLimit', String(options.upstreamModelsLimit));
  }

  const queryString = params.toString();
  return request<ModelConfigurationResponse>(`/admin/model-config${queryString ? `?${queryString}` : ''}`);
}

export async function createUpstreamProvider(payload: {
  name: string;
  baseUrl: string;
  apiKey: string;
  status: 'active' | 'disabled';
}) {
  return request<UpstreamProvider>('/admin/upstreams', {
    method: 'POST',
    body: payload
  });
}

export async function createUserGroup(payload: {
  code: string;
  name: string;
  multiplier: string;
  status: 'active' | 'disabled';
}) {
  return request<AdminGroup>('/admin/groups', {
    method: 'POST',
    body: payload
  });
}

export async function assignUserGroup(userId: string, payload: { groupId: string }) {
  return request<AdminUser>(`/admin/users/${encodeURIComponent(userId)}/group`, {
    method: 'POST',
    body: payload
  });
}

export async function createModelPrice(payload: {
  model: string;
  displayName?: string;
  inputPriceCentsPer1k: number;
  outputPriceCentsPer1k: number;
  modelMultiplier: string;
  status: 'active' | 'disabled';
  groupIds: string[];
}) {
  return request<AdminModelPrice>('/admin/models', {
    method: 'POST',
    body: payload
  });
}

export async function createUpstreamModel(payload: {
  providerId: string;
  publicModel: string;
  upstreamModel: string;
  status: 'active' | 'disabled';
  supportsStream: boolean;
}) {
  return request<UpstreamModelMapping>('/admin/upstream-models', {
    method: 'POST',
    body: payload
  });
}

export async function checkUpstreamHealth(providerId: string) {
  return request<UpstreamHealthCheckResponse>(`/admin/upstreams/${encodeURIComponent(providerId)}/health-check`, {
    method: 'POST'
  });
}

export async function listRechargeCodes() {
  return request<RechargeCodeListResponse>('/admin/recharge-codes');
}

export async function createRechargeCodes(payload: { amountCents: number; count: number }) {
  return request<CreateRechargeCodesResponse>('/admin/recharge-codes', {
    method: 'POST',
    body: payload
  });
}

export async function disableRechargeCode(codeId: string) {
  return request<AdminRechargeCode>(`/admin/recharge-codes/${encodeURIComponent(codeId)}/disable`, {
    method: 'POST'
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
