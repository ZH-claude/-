export type AsyncTaskKind = 'generic' | 'image';
export type AsyncTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type AsyncTaskEntry = {
  id: string;
  externalTaskId: string;
  platform: string;
  kind: AsyncTaskKind;
  status: AsyncTaskStatus;
  model: string | null;
  prompt: string | null;
  progress: number | null;
  result: unknown;
  errorMessage: string | null;
  submittedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  upstreamProvider: {
    name: string;
    status: string;
    healthStatus: string;
  } | null;
};

export type AsyncTasksResponse = {
  items: AsyncTaskEntry[];
  summary: {
    total: number;
    statusCounts: Record<AsyncTaskStatus, number>;
    kindCounts: Record<AsyncTaskKind, number>;
  };
  filters: {
    limit: number;
    platforms: string[];
    models: string[];
    statuses: AsyncTaskStatus[];
    kinds: AsyncTaskKind[];
  };
  capabilities: {
    taskSubmissionSupported: boolean;
    imageSubmissionSupported: boolean;
    statusSyncSupported: boolean;
  };
};

export type AsyncTaskFilters = {
  kind?: AsyncTaskKind;
  status?: AsyncTaskStatus;
  platform?: string;
  model?: string;
  limit?: number;
};

export async function listAsyncTasks(filters: AsyncTaskFilters = {}) {
  const params = new URLSearchParams();
  if (filters.kind) {
    params.set('kind', filters.kind);
  }
  if (filters.status) {
    params.set('status', filters.status);
  }
  if (filters.platform) {
    params.set('platform', filters.platform);
  }
  if (filters.model) {
    params.set('model', filters.model);
  }
  if (filters.limit) {
    params.set('limit', String(filters.limit));
  }

  const queryString = params.toString();
  return request<AsyncTasksResponse>(queryString ? `/async-tasks?${queryString}` : '/async-tasks');
}

async function request<T>(path: string) {
  const response = await fetch(`/api${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.message === 'string' ? body.message : `记录加载失败：HTTP ${response.status}`;
    throw new Error(`${response.status}: ${message}`);
  }

  return body as T;
}
