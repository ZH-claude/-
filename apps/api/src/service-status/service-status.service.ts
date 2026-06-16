import { Inject, Injectable } from '@nestjs/common';
import net from 'node:net';
import tls from 'node:tls';
import { UpstreamHealthStatus, UpstreamProviderStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

type ComponentStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'not_configured' | 'disabled';
type ComponentSource = 'builtin' | 'uptime_kuma' | 'database' | 'redis' | 'web';

type ServiceComponent = {
  key: string;
  label: string;
  status: ComponentStatus;
  required: boolean;
  source: ComponentSource;
  checkedAt: string;
  latencyMs: number | null;
  message: string | null;
};

type UpstreamStatus = 'healthy' | 'unhealthy' | 'unknown' | 'disabled';

const PROBE_TIMEOUT_MS = 3000;
const HTTP_HEALTHY_MIN = 200;
const HTTP_HEALTHY_MAX = 399;

@Injectable()
export class ServiceStatusService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getServiceStatus() {
    const generatedAt = new Date();
    const checkedAt = generatedAt.toISOString();

    const [database, redis, web, externalMonitor, upstreams] = await Promise.all([
      this.probeDatabase(checkedAt),
      this.probeRedis(checkedAt),
      this.probeWeb(checkedAt),
      this.probeExternalMonitor(checkedAt),
      this.listUpstreams()
    ]);

    const components: ServiceComponent[] = [
      {
        key: 'api',
        label: 'API 服务',
        status: 'healthy',
        required: true,
        source: 'builtin',
        checkedAt,
        latencyMs: 0,
        message: 'api_process_responding'
      },
      database,
      redis,
      web,
      externalMonitor
    ];

    return {
      generatedAt: checkedAt,
      mode: externalMonitor.status === 'not_configured' ? 'builtin' : 'external_monitor_configured',
      summary: this.toSummary(components, upstreams),
      components,
      upstreams
    };
  }

  private async probeDatabase(checkedAt: string): Promise<ServiceComponent> {
    const startedAt = Date.now();

    try {
      await this.prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
      return this.component('database', '数据库', 'healthy', true, 'database', checkedAt, startedAt, 'database_query_ok');
    } catch (error) {
      return this.component(
        'database',
        '数据库',
        'unhealthy',
        true,
        'database',
        checkedAt,
        startedAt,
        this.normalizeProbeError(error)
      );
    }
  }

  private async probeRedis(checkedAt: string): Promise<ServiceComponent> {
    const redisUrl = process.env.REDIS_URL?.trim();

    if (!redisUrl) {
      return this.notConfigured('redis', 'Redis', true, 'redis', checkedAt, 'redis_url_not_configured');
    }

    return this.probeTcpUrl({
      key: 'redis',
      label: 'Redis',
      url: redisUrl,
      required: true,
      source: 'redis',
      checkedAt,
      defaultPort: 6379,
      allowedProtocols: new Set(['redis:', 'rediss:'])
    });
  }

  private async probeWeb(checkedAt: string): Promise<ServiceComponent> {
    const webHealthUrl = process.env.WEB_HEALTH_URL?.trim();

    if (!webHealthUrl) {
      return this.notConfigured('web', 'Web 前端', false, 'web', checkedAt, 'web_health_url_not_configured');
    }

    return this.probeHttpUrl('web', 'Web 前端', webHealthUrl, true, 'web', checkedAt, 'web_process_reachable');
  }

  private async probeExternalMonitor(checkedAt: string): Promise<ServiceComponent> {
    const uptimeKumaStatusUrl = process.env.UPTIME_KUMA_STATUS_URL?.trim();

    if (!uptimeKumaStatusUrl) {
      return this.notConfigured(
        'external_monitor',
        '外部监控',
        false,
        'uptime_kuma',
        checkedAt,
        'uptime_kuma_not_configured'
      );
    }

    return this.probeHttpUrl(
      'external_monitor',
      '外部监控',
      uptimeKumaStatusUrl,
      false,
      'uptime_kuma',
      checkedAt,
      'uptime_kuma_status_page_reachable'
    );
  }

  private async probeHttpUrl(
    key: string,
    label: string,
    url: string,
    required: boolean,
    source: ComponentSource,
    checkedAt: string,
    successMessage: string
  ): Promise<ServiceComponent> {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      return this.component(key, label, 'unhealthy', required, source, checkedAt, Date.now(), 'invalid_url');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return this.component(key, label, 'unhealthy', required, source, checkedAt, Date.now(), 'unsupported_protocol');
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    try {
      const response = await fetch(parsed.toString(), {
        method: 'GET',
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal
      });
      await response.arrayBuffer().catch(() => undefined);

      if (response.status >= HTTP_HEALTHY_MIN && response.status <= HTTP_HEALTHY_MAX) {
        return this.component(key, label, 'healthy', required, source, checkedAt, startedAt, successMessage);
      }

      return this.component(key, label, 'unhealthy', required, source, checkedAt, startedAt, `http_${response.status}`);
    } catch (error) {
      return this.component(key, label, 'unhealthy', required, source, checkedAt, startedAt, this.normalizeProbeError(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  private async probeTcpUrl(input: {
    key: string;
    label: string;
    url: string;
    required: boolean;
    source: ComponentSource;
    checkedAt: string;
    defaultPort: number;
    allowedProtocols: Set<string>;
  }): Promise<ServiceComponent> {
    let parsed: URL;

    try {
      parsed = new URL(input.url);
    } catch {
      return this.component(
        input.key,
        input.label,
        'unhealthy',
        input.required,
        input.source,
        input.checkedAt,
        Date.now(),
        'invalid_url'
      );
    }

    if (!input.allowedProtocols.has(parsed.protocol)) {
      return this.component(
        input.key,
        input.label,
        'unhealthy',
        input.required,
        input.source,
        input.checkedAt,
        Date.now(),
        'unsupported_protocol'
      );
    }

    const port = parsed.port ? Number(parsed.port) : input.defaultPort;
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || !parsed.hostname) {
      return this.component(
        input.key,
        input.label,
        'unhealthy',
        input.required,
        input.source,
        input.checkedAt,
        Date.now(),
        'invalid_host_or_port'
      );
    }

    const startedAt = Date.now();

    return new Promise<ServiceComponent>((resolve) => {
      let settled = false;
      const socket =
        parsed.protocol === 'rediss:'
          ? tls.connect({ host: parsed.hostname, port, servername: parsed.hostname })
          : net.connect({ host: parsed.hostname, port });

      const finish = (status: ComponentStatus, message: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(this.component(input.key, input.label, status, input.required, input.source, input.checkedAt, startedAt, message));
      };

      socket.setTimeout(PROBE_TIMEOUT_MS, () => finish('unhealthy', 'timeout'));
      if (parsed.protocol === 'rediss:') {
        socket.once('secureConnect', () => finish('healthy', 'tcp_connect_ok'));
      } else {
        socket.once('connect', () => finish('healthy', 'tcp_connect_ok'));
      }
      socket.once('error', (error) => finish('unhealthy', this.normalizeProbeError(error)));
    });
  }

  private async listUpstreams() {
    const providers = await this.prisma.upstreamProvider.findMany({
      orderBy: { name: 'asc' },
      select: {
        name: true,
        status: true,
        healthStatus: true,
        lastHealthCheckAt: true,
        lastHealthLatencyMs: true,
        lastHealthError: true,
        updatedAt: true
      }
    });

    return providers.map((provider) => ({
      name: provider.name,
      status: this.toUpstreamStatus(provider.status, provider.healthStatus),
      providerStatus: provider.status.toLowerCase(),
      healthStatus: provider.healthStatus.toLowerCase(),
      lastHealthCheckAt: provider.lastHealthCheckAt?.toISOString() ?? null,
      lastHealthLatencyMs: provider.lastHealthLatencyMs,
      lastHealthError: this.sanitizeUpstreamHealthError(provider.lastHealthError),
      updatedAt: provider.updatedAt.toISOString()
    }));
  }

  private toUpstreamStatus(status: UpstreamProviderStatus, healthStatus: UpstreamHealthStatus): UpstreamStatus {
    if (status === UpstreamProviderStatus.DISABLED) {
      return 'disabled';
    }

    if (healthStatus === UpstreamHealthStatus.HEALTHY) {
      return 'healthy';
    }

    if (healthStatus === UpstreamHealthStatus.UNHEALTHY) {
      return 'unhealthy';
    }

    return 'unknown';
  }

  private toSummary(
    components: ServiceComponent[],
    upstreams: Array<{ status: UpstreamStatus; providerStatus: string }>
  ) {
    const componentStatusCounts = this.countByStatus(components.map((component) => component.status));
    const upstreamStatusCounts = this.countByStatus(upstreams.map((upstream) => upstream.status));
    const requiredComponents = components.filter((component) => component.required);
    const activeUpstreams = upstreams.filter((upstream) => upstream.providerStatus === 'active');
    const hasRequiredFailure = requiredComponents.some((component) => component.status === 'unhealthy');
    const hasDegradedRequiredComponent = requiredComponents.some((component) =>
      ['degraded', 'unknown', 'not_configured'].includes(component.status)
    );
    const hasUnhealthyUpstream = activeUpstreams.some((upstream) => upstream.status === 'unhealthy');
    const hasUnknownUpstream = activeUpstreams.some((upstream) => upstream.status === 'unknown');
    const overallStatus =
      hasRequiredFailure || hasUnhealthyUpstream
        ? 'unhealthy'
        : hasDegradedRequiredComponent || hasUnknownUpstream || activeUpstreams.length === 0
          ? 'degraded'
          : 'healthy';

    return {
      overallStatus,
      totalComponents: components.length,
      requiredComponents: requiredComponents.length,
      componentStatusCounts,
      totalUpstreams: upstreams.length,
      activeUpstreams: activeUpstreams.length,
      upstreamStatusCounts
    };
  }

  private countByStatus(statuses: string[]) {
    const counts: Record<string, number> = {};
    for (const status of statuses) {
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return counts;
  }

  private notConfigured(
    key: string,
    label: string,
    required: boolean,
    source: ComponentSource,
    checkedAt: string,
    message: string
  ): ServiceComponent {
    return {
      key,
      label,
      status: 'not_configured',
      required,
      source,
      checkedAt,
      latencyMs: null,
      message
    };
  }

  private component(
    key: string,
    label: string,
    status: ComponentStatus,
    required: boolean,
    source: ComponentSource,
    checkedAt: string,
    startedAt: number,
    message: string | null
  ): ServiceComponent {
    return {
      key,
      label,
      status,
      required,
      source,
      checkedAt,
      latencyMs: Math.max(0, Date.now() - startedAt),
      message
    };
  }

  private normalizeProbeError(error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return 'timeout';
    }

    const code = typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : '';
    const normalizedCode = code.toLowerCase();
    if (['econnrefused', 'econnreset', 'enotfound', 'etimedout', 'eai_again'].includes(normalizedCode)) {
      return normalizedCode;
    }

    return 'probe_failed';
  }

  private sanitizeUpstreamHealthError(error: string | null) {
    if (!error) {
      return null;
    }

    const normalized = error.toLowerCase();
    if (/^http \d{3}$/i.test(error)) {
      return error;
    }
    if (normalized.includes('timed out')) {
      return 'health_check_timed_out';
    }
    if (normalized.includes('private or local upstream address')) {
      return 'private_or_local_upstream_blocked';
    }
    if (normalized.includes('could not be resolved')) {
      return 'upstream_host_unresolved';
    }

    return 'health_check_failed';
  }
}
