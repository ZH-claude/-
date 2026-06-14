export type ServiceComponentStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'not_configured' | 'disabled';
export type UpstreamStatus = 'healthy' | 'unhealthy' | 'unknown' | 'disabled';

export type ServiceStatusComponent = {
  key: string;
  label: string;
  status: ServiceComponentStatus;
  required: boolean;
  source: string;
  checkedAt: string;
  latencyMs: number | null;
  message: string | null;
};

export type ServiceStatusUpstream = {
  name: string;
  status: UpstreamStatus;
  providerStatus: 'active' | 'disabled';
  healthStatus: 'unknown' | 'healthy' | 'unhealthy';
  lastHealthCheckAt: string | null;
  lastHealthLatencyMs: number | null;
  lastHealthError: string | null;
  updatedAt: string;
};

export type ServiceStatusResponse = {
  generatedAt: string;
  mode: 'builtin' | 'external_monitor_configured';
  summary: {
    overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    totalComponents: number;
    requiredComponents: number;
    componentStatusCounts: Record<string, number>;
    totalUpstreams: number;
    activeUpstreams: number;
    upstreamStatusCounts: Record<string, number>;
  };
  components: ServiceStatusComponent[];
  upstreams: ServiceStatusUpstream[];
};

const API_BASE_URL = '/api';

export async function getServiceStatus() {
  const response = await fetch(`${API_BASE_URL}/service-status`, {
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

  return data as ServiceStatusResponse;
}
