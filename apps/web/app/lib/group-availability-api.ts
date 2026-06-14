export type GroupAvailabilityStatus = 'normal' | 'partial' | 'unavailable' | 'no_data';

export type GroupAvailabilityModel = {
  model: string;
  displayName: string | null;
  status: GroupAvailabilityStatus;
  reason: string;
  supportsStream: boolean;
  upstreams: {
    active: number;
    healthy: number;
    unhealthy: number;
    unknown: number;
  };
  usage: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    successRate: number | null;
  };
  lastCallAt: string | null;
  lastHealthCheckAt: string | null;
};

export type GroupAvailabilityResponse = {
  group: {
    code: string;
    name: string;
    status: string;
    userCount: number;
  };
  window: {
    hours: number;
    since: string;
  };
  summary: {
    totalModels: number;
    statusCounts: Record<GroupAvailabilityStatus, number>;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    successRate: number | null;
  };
  filters: {
    status: GroupAvailabilityStatus | null;
    statuses: GroupAvailabilityStatus[];
  };
  models: GroupAvailabilityModel[];
};

export type GroupAvailabilityFilters = {
  hours?: number;
  status?: GroupAvailabilityStatus | '';
};

const API_BASE_URL = '/api';

export async function getGroupAvailability(filters: GroupAvailabilityFilters = {}) {
  const search = new URLSearchParams();
  if (filters.hours) {
    search.set('hours', String(filters.hours));
  }
  if (filters.status) {
    search.set('status', filters.status);
  }

  return request<GroupAvailabilityResponse>(
    `/group-availability/models${search.toString() ? `?${search.toString()}` : ''}`
  );
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
    throw new Error(`${response.status}: ${message}`);
  }

  return data as T;
}
