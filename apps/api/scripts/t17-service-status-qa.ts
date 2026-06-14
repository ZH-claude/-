import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import {
  PrismaClient,
  UpstreamHealthStatus,
  UpstreamProviderStatus,
  UserRole
} from '../src/generated/prisma/client';
import { encryptUpstreamApiKey, maskUpstreamApiKey } from '../src/admin/upstream-key-crypto';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  cookie?: string;
};

type RegisterResponse = {
  user: {
    id: string;
    username: string;
  };
};

type ServiceStatusComponent = {
  key: string;
  label: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'not_configured' | 'disabled';
  required: boolean;
  source: string;
  checkedAt: string;
  latencyMs: number | null;
  message: string | null;
};

type ServiceStatusUpstream = {
  name: string;
  status: 'healthy' | 'unhealthy' | 'unknown' | 'disabled';
  providerStatus: 'active' | 'disabled';
  healthStatus: 'unknown' | 'healthy' | 'unhealthy';
  lastHealthCheckAt: string | null;
  lastHealthLatencyMs: number | null;
  lastHealthError: string | null;
  updatedAt: string;
  id?: string;
  baseUrl?: string;
  apiKeyPreview?: string;
  encryptedApiKey?: string;
};

type ServiceStatusResponse = {
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

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T17 service status QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const prefix = `qa_t17_${suffix}`;
const password = `qa-password-${suffix}`;
const upstreamKey = `qa-t17-upstream-key-${suffix}`;
const checks: string[] = [];
const providerIds: string[] = [];

async function main() {
  let residualBeforeCleanup: Record<string, number> | null = null;

  try {
    const existingProviderCount = await prisma.upstreamProvider.count();
    const admin = await register(`${prefix}_admin`);
    await prisma.user.update({
      where: { id: admin.json.user.id },
      data: { role: UserRole.ADMIN }
    });

    await seedProviders(admin.json.user.id);
    checks.push('real_upstream_provider_health_rows_are_written_to_postgres');

    const publicStatus = await getFromBase<ServiceStatusResponse>(API_BASE_URL, '/service-status');
    assert(publicStatus.status === 200, `public service status failed with ${publicStatus.status}`);
    assert(publicStatus.json.mode === 'builtin', `expected builtin mode without Uptime Kuma config, got ${publicStatus.json.mode}`);
    assert(publicStatus.json.summary.totalComponents >= 5, 'service status should expose platform components');
    assertComponent(publicStatus.json, 'api', 'healthy');
    assertComponent(publicStatus.json, 'database', 'healthy');
    assertComponent(publicStatus.json, 'redis', 'healthy');
    assertComponent(publicStatus.json, 'web', 'healthy');
    assertComponent(publicStatus.json, 'external_monitor', 'not_configured');
    checks.push('builtin_probes_report_real_api_database_redis_web_and_unconfigured_monitor');

    assertUpstream(publicStatus.json, `${prefix}_healthy_provider`, {
      status: 'healthy',
      providerStatus: 'active',
      healthStatus: 'healthy',
      latency: 123,
      error: null
    });
    assertUpstream(publicStatus.json, `${prefix}_unhealthy_provider`, {
      status: 'unhealthy',
      providerStatus: 'active',
      healthStatus: 'unhealthy',
      latency: 987,
      error: 'HTTP 503'
    });
    assertUpstream(publicStatus.json, `${prefix}_unknown_provider`, {
      status: 'unknown',
      providerStatus: 'active',
      healthStatus: 'unknown',
      latency: null,
      error: null
    });
    assertUpstream(publicStatus.json, `${prefix}_disabled_provider`, {
      status: 'disabled',
      providerStatus: 'disabled',
      healthStatus: 'healthy',
      latency: 8,
      error: null
    });
    checks.push('service_status_uses_real_upstream_health_fields');

    const nextProxy = await getFromBase<ServiceStatusResponse>(WEB_BASE_URL, '/api/service-status');
    assert(nextProxy.status === 200, `Next service status proxy failed with ${nextProxy.status}`);
    assert(
      nextProxy.json.upstreams.some((upstream) => upstream.name === `${prefix}_healthy_provider`),
      'Next proxy did not return seeded upstream provider'
    );
    assertComponent(nextProxy.json, 'external_monitor', 'not_configured');
    checks.push('next_proxy_returns_real_service_status');

    const serialized = JSON.stringify({ publicStatus: publicStatus.json, nextProxy: nextProxy.json });
    for (const forbidden of [
      'encryptedApiKey',
      'apiKeyPreview',
      'baseUrl',
      'DATABASE_URL',
      'REDIS_URL',
      'postgresql://',
      'redis://',
      upstreamKey,
      admin.json.user.id,
      ...providerIds
    ]) {
      assert(!serialized.includes(forbidden), `service status response leaked forbidden field/value: ${forbidden}`);
    }
    assert(!/https?:\/\/[^"]+/i.test(serialized), 'service status response leaked a URL');
    checks.push('service_status_response_uses_sensitive_field_allowlist');

    await prisma.upstreamProvider.deleteMany({ where: { id: { in: providerIds } } });
    const afterProviderRemoval = await getFromBase<ServiceStatusResponse>(API_BASE_URL, '/service-status');
    assert(afterProviderRemoval.status === 200, `service status after provider removal failed with ${afterProviderRemoval.status}`);
    assert(
      !afterProviderRemoval.json.upstreams.some((upstream) => upstream.name.startsWith(prefix)),
      'service status still returned deleted QA providers'
    );
    if (existingProviderCount === 0) {
      assert(afterProviderRemoval.json.upstreams.length === 0, 'empty upstream state should return zero upstream rows');
      checks.push('empty_upstream_state_returns_no_synthetic_provider_rows');
    } else {
      checks.push('refresh_reads_provider_deletions_without_stale_rows');
    }

    residualBeforeCleanup = await countResidual();
    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          checks,
          residualBeforeCleanup
        },
        null,
        2
      )
    );
  } finally {
    await cleanup();
    const residualAfterCleanup = await countResidual();
    console.log(JSON.stringify({ cleanup: true, suffix, residualAfterCleanup }, null, 2));
    await prisma.$disconnect();
  }
}

async function seedProviders(adminUserId: string) {
  const rows = [
    {
      name: `${prefix}_healthy_provider`,
      status: UpstreamProviderStatus.ACTIVE,
      healthStatus: UpstreamHealthStatus.HEALTHY,
      lastHealthLatencyMs: 123,
      lastHealthError: null,
      lastHealthCheckAt: new Date()
    },
    {
      name: `${prefix}_unhealthy_provider`,
      status: UpstreamProviderStatus.ACTIVE,
      healthStatus: UpstreamHealthStatus.UNHEALTHY,
      lastHealthLatencyMs: 987,
      lastHealthError: 'HTTP 503',
      lastHealthCheckAt: new Date()
    },
    {
      name: `${prefix}_unknown_provider`,
      status: UpstreamProviderStatus.ACTIVE,
      healthStatus: UpstreamHealthStatus.UNKNOWN,
      lastHealthLatencyMs: null,
      lastHealthError: null,
      lastHealthCheckAt: null
    },
    {
      name: `${prefix}_disabled_provider`,
      status: UpstreamProviderStatus.DISABLED,
      healthStatus: UpstreamHealthStatus.HEALTHY,
      lastHealthLatencyMs: 8,
      lastHealthError: null,
      lastHealthCheckAt: new Date()
    }
  ];

  for (const row of rows) {
    const provider = await prisma.upstreamProvider.create({
      data: {
        ...row,
        baseUrl: `https://${row.name}.example.invalid`,
        encryptedApiKey: encryptUpstreamApiKey(upstreamKey),
        apiKeyPreview: maskUpstreamApiKey(upstreamKey),
        createdByAdminId: adminUserId
      },
      select: { id: true }
    });
    providerIds.push(provider.id);
  }
}

async function register(username: string) {
  const result = await post<RegisterResponse>('/auth/register', { username, password });
  assert(result.status >= 200 && result.status < 300, `register ${username} failed with ${result.status}`);
  assert(result.cookie, `register ${username} did not return a session cookie`);
  return result;
}

async function post<T = unknown>(path: string, body: unknown) {
  return requestFromBase<T>(API_BASE_URL, 'POST', path, body);
}

async function getFromBase<T>(baseUrl: string, path: string) {
  return requestFromBase<T>(baseUrl, 'GET', path);
}

async function requestFromBase<T>(baseUrl: string, method: string, path: string, body?: unknown): Promise<HttpResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      accept: 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  return {
    status: response.status,
    json,
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}

function assertComponent(response: ServiceStatusResponse, key: string, status: ServiceStatusComponent['status']) {
  const component = response.components.find((item) => item.key === key);
  assert(component, `missing component ${key}`);
  assert(component!.status === status, `component ${key} status mismatch: ${component!.status}`);
  assert(component!.checkedAt, `component ${key} missing checkedAt`);
  if (status === 'healthy') {
    assert(typeof component!.latencyMs === 'number', `component ${key} should have measured latency`);
  }
}

function assertUpstream(
  response: ServiceStatusResponse,
  name: string,
  expected: {
    status: ServiceStatusUpstream['status'];
    providerStatus: ServiceStatusUpstream['providerStatus'];
    healthStatus: ServiceStatusUpstream['healthStatus'];
    latency: number | null;
    error: string | null;
  }
) {
  const upstream = response.upstreams.find((item) => item.name === name);
  assert(upstream, `missing upstream ${name}`);
  assert(upstream!.status === expected.status, `${name} status mismatch: ${upstream!.status}`);
  assert(upstream!.providerStatus === expected.providerStatus, `${name} providerStatus mismatch`);
  assert(upstream!.healthStatus === expected.healthStatus, `${name} healthStatus mismatch`);
  assert(upstream!.lastHealthLatencyMs === expected.latency, `${name} latency mismatch`);
  assert(upstream!.lastHealthError === expected.error, `${name} health error mismatch`);
}

async function countResidual() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  return {
    users: users.length,
    sessions: await prisma.session.count({ where: { userId: { in: userIds } } }),
    wallets: await prisma.wallet.count({ where: { userId: { in: userIds } } }),
    upstream_providers: await prisma.upstreamProvider.count({ where: { name: { startsWith: prefix } } })
  };
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  await prisma.upstreamProvider.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
