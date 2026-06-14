import { BadRequestException, ConflictException, Injectable, Inject, NotFoundException, OnModuleInit } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  Prisma,
  AnnouncementStatus,
  UpstreamHealthStatus,
  UpstreamProviderStatus,
  UserRole,
  UserStatus
} from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { decryptUpstreamApiKey, encryptUpstreamApiKey, maskUpstreamApiKey } from './upstream-key-crypto';

type ListUsersOptions = {
  page: number;
  limit: number;
};

type AnnouncementInput = {
  title?: unknown;
  content?: unknown;
  status?: unknown;
};

type UpstreamProviderInput = {
  name?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  status?: unknown;
};

const PASSWORD_HASH_ROUNDS = 12;
const UPSTREAM_HEALTH_CHECK_TIMEOUT_MS = 8000;
const UPSTREAM_HEALTH_ERROR_MAX_LENGTH = 240;
const UPSTREAM_DNS_LOOKUP_TIMEOUT_MS = 3000;
const PRIVATE_UPSTREAM_ADDRESS_ERROR = 'Private or local upstream address is not allowed';
const BLOCKED_UPSTREAM_HOSTNAMES = new Set(['localhost', 'host.docker.internal', 'metadata.google.internal']);

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.bootstrapAdminFromEnv();
  }

  async listUsers(options: ListUsersOptions) {
    const { page, limit } = options;
    const skip = (page - 1) * limit;

    const where = { deletedAt: null };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          group: true,
          wallet: true
        }
      }),
      this.prisma.user.count({ where })
    ]);

    return {
      items: users.map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role.toLowerCase(),
        status: user.status.toLowerCase(),
        timezone: user.timezone,
        group: {
          id: user.group.id,
          code: user.group.code,
          name: user.group.name
        },
        wallet: {
          balanceCents: user.wallet?.balanceCents ?? 0,
          totalSpendCents: user.wallet?.totalSpendCents ?? 0
        },
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString()
      })),
      total,
      page,
      limit
    };
  }

  async listAnnouncements() {
    const announcements = await this.prisma.announcement.findMany({
      include: {
        createdByAdmin: {
          select: { username: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    return {
      items: announcements.map((announcement) => ({
        id: announcement.id,
        title: announcement.title,
        content: announcement.content,
        status: announcement.status.toLowerCase(),
        publishedAt: announcement.publishedAt?.toISOString() ?? null,
        createdBy: announcement.createdByAdmin.username,
        createdAt: announcement.createdAt.toISOString(),
        updatedAt: announcement.updatedAt.toISOString()
      }))
    };
  }

  async createAnnouncement(adminUserId: string, body: AnnouncementInput) {
    const title = this.requiredText(body.title, 'title', 3, 120);
    const content = this.requiredText(body.content, 'content', 1, 5000);
    const status = this.normalizeStatus(body.status);

    const announcement = await this.prisma.$transaction(async (tx) => {
      const createdAnnouncement = await tx.announcement.create({
        data: {
          title,
          content,
          status,
          publishedAt: status === AnnouncementStatus.PUBLISHED ? new Date() : null,
          createdByAdminId: adminUserId
        }
      });

      await tx.adminAuditLog.create({
        data: {
          adminUserId,
          action: 'announcement_created',
          targetType: 'announcement',
          targetId: createdAnnouncement.id,
          beforeSnapshot: Prisma.JsonNull,
          afterSnapshot: {
            id: createdAnnouncement.id,
            title,
            status: createdAnnouncement.status.toLowerCase()
          }
        }
      });

      return createdAnnouncement;
    });

    return {
      id: announcement.id,
      title: announcement.title,
      content: announcement.content,
      status: announcement.status.toLowerCase(),
      publishedAt: announcement.publishedAt?.toISOString() ?? null,
      createdByAdminId: announcement.createdByAdminId,
      createdAt: announcement.createdAt.toISOString()
    };
  }

  async listUpstreamProviders() {
    const providers = await this.prisma.upstreamProvider.findMany({
      include: {
        createdByAdmin: {
          select: { username: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    return {
      items: providers.map((provider) => this.toPublicUpstreamProvider(provider))
    };
  }

  async createUpstreamProvider(adminUserId: string, body: UpstreamProviderInput) {
    const name = this.requiredText(body.name, 'name', 2, 80);
    const baseUrl = this.normalizeBaseUrl(body.baseUrl);
    const apiKey = this.requiredText(body.apiKey, 'apiKey', 8, 512);
    const status = this.normalizeUpstreamStatus(body.status);
    const apiKeyPreview = maskUpstreamApiKey(apiKey);
    const encryptedApiKey = encryptUpstreamApiKey(apiKey);

    try {
      const provider = await this.prisma.$transaction(async (tx) => {
        const createdProvider = await tx.upstreamProvider.create({
          data: {
            name,
            baseUrl,
            encryptedApiKey,
            apiKeyPreview,
            status,
            createdByAdminId: adminUserId
          },
          include: {
            createdByAdmin: {
              select: { username: true }
            }
          }
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId,
            action: 'upstream_provider_created',
            targetType: 'upstream_provider',
            targetId: createdProvider.id,
            beforeSnapshot: Prisma.JsonNull,
            afterSnapshot: {
              id: createdProvider.id,
              name,
              baseUrl,
              status: status.toLowerCase(),
              apiKeyPreview
            }
          }
        });

        return createdProvider;
      });

      return this.toPublicUpstreamProvider(provider);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Upstream provider name already exists');
      }

      throw error;
    }
  }

  async checkUpstreamHealth(adminUserId: string, upstreamProviderId: string) {
    const provider = await this.prisma.upstreamProvider.findUnique({
      where: { id: upstreamProviderId }
    });

    if (!provider) {
      throw new NotFoundException('Upstream provider not found');
    }

    const result = await this.fetchUpstreamHealth(provider.baseUrl, decryptUpstreamApiKey(provider.encryptedApiKey));
    const checkedAt = new Date();

    const updatedProvider = await this.prisma.$transaction(async (tx) => {
      const nextProvider = await tx.upstreamProvider.update({
        where: { id: provider.id },
        data: {
          healthStatus: result.healthStatus,
          lastHealthCheckAt: checkedAt,
          lastHealthLatencyMs: result.latencyMs,
          lastHealthError: result.error
        },
        include: {
          createdByAdmin: {
            select: { username: true }
          }
        }
      });

      await tx.adminAuditLog.create({
        data: {
          adminUserId,
          action: 'upstream_provider_health_checked',
          targetType: 'upstream_provider',
          targetId: provider.id,
          beforeSnapshot: {
            healthStatus: provider.healthStatus.toLowerCase(),
            lastHealthCheckAt: provider.lastHealthCheckAt?.toISOString() ?? null
          },
          afterSnapshot: {
            healthStatus: result.healthStatus.toLowerCase(),
            latencyMs: result.latencyMs,
            error: result.error
          }
        }
      });

      return nextProvider;
    });

    return {
      reachable: result.healthStatus === UpstreamHealthStatus.HEALTHY,
      checkedAt: checkedAt.toISOString(),
      provider: this.toPublicUpstreamProvider(updatedProvider)
    };
  }

  private requiredText(value: unknown, field: string, min: number, max: number) {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
      throw new BadRequestException(`${field} must be a string with ${min}-${max} characters`);
    }

    return value.trim();
  }

  private normalizeBaseUrl(value: unknown) {
    const rawValue = this.requiredText(value, 'baseUrl', 8, 2048);
    let parsed: URL;

    try {
      parsed = new URL(rawValue);
    } catch {
      throw new BadRequestException('baseUrl must be a valid http or https URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('baseUrl must use http or https');
    }

    if (parsed.username || parsed.password) {
      throw new BadRequestException('baseUrl must not include credentials');
    }

    parsed.hash = '';
    parsed.search = '';

    const normalized = parsed.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  }

  private normalizeUpstreamStatus(value: unknown): UpstreamProviderStatus {
    if (value === undefined || value === null || value === '') {
      return UpstreamProviderStatus.ACTIVE;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('status must be active or disabled');
    }

    const normalized = value.toLowerCase();
    if (normalized === UpstreamProviderStatus.ACTIVE.toLowerCase()) {
      return UpstreamProviderStatus.ACTIVE;
    }
    if (normalized === UpstreamProviderStatus.DISABLED.toLowerCase()) {
      return UpstreamProviderStatus.DISABLED;
    }

    throw new BadRequestException('status must be active or disabled');
  }

  private normalizeStatus(value: unknown): AnnouncementStatus {
    if (value === undefined || value === null || value === '') {
      return AnnouncementStatus.PUBLISHED;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('status must be draft, published, or archived');
    }

    const normalized = value.toLowerCase();
    if (normalized === AnnouncementStatus.DRAFT.toLowerCase()) {
      return AnnouncementStatus.DRAFT;
    }
    if (normalized === AnnouncementStatus.PUBLISHED.toLowerCase()) {
      return AnnouncementStatus.PUBLISHED;
    }
    if (normalized === AnnouncementStatus.ARCHIVED.toLowerCase()) {
      return AnnouncementStatus.ARCHIVED;
    }

    throw new BadRequestException('status must be draft, published, or archived');
  }

  private async bootstrapAdminFromEnv() {
    const username = process.env.ADMIN_BOOTSTRAP_USERNAME?.trim().toLowerCase();
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    const forceReset = this.isBootstrapForceResetEnabled();

    if (!username && !password) {
      return;
    }

    if (!username || !password) {
      throw new Error('ADMIN_BOOTSTRAP_USERNAME and ADMIN_BOOTSTRAP_PASSWORD must be set together');
    }

    if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
      throw new Error('ADMIN_BOOTSTRAP_USERNAME must be 3-32 lowercase letters, numbers, underscores, or hyphens');
    }

    if (password.length < 12 || password.length > 128) {
      throw new Error('ADMIN_BOOTSTRAP_PASSWORD must be 12-128 characters');
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);

    await this.prisma.$transaction(async (tx) => {
      const group = await tx.userGroup.upsert({
        where: { code: 'default' },
        update: {},
        create: {
          code: 'default',
          name: '默认分组'
        }
      });

      const existingUser = await tx.user.findUnique({
        where: { username }
      });

      if (existingUser) {
        const isActiveAdmin =
          existingUser.role === UserRole.ADMIN &&
          existingUser.status === UserStatus.ACTIVE &&
          !existingUser.deletedAt;

        if (isActiveAdmin && !forceReset) {
          return;
        }

        if (!forceReset) {
          throw new Error(
            'ADMIN_BOOTSTRAP_USERNAME already exists but is not an active admin. Set ADMIN_BOOTSTRAP_FORCE_RESET=true to intentionally reset it'
          );
        }

        await tx.user.update({
          where: { id: existingUser.id },
          data: {
            passwordHash,
            role: UserRole.ADMIN,
            status: UserStatus.ACTIVE,
            deletedAt: null
          }
        });
        return;
      }

      const admin = await tx.user.create({
        data: {
          username,
          passwordHash,
          role: UserRole.ADMIN,
          groupId: group.id,
          inviteCode: this.createBootstrapInviteCode()
        }
      });

      await tx.wallet.create({
        data: { userId: admin.id }
      });
    });
  }

  private createBootstrapInviteCode() {
    return `admin-${randomBytes(4).toString('hex')}`;
  }

  private isBootstrapForceResetEnabled() {
    const configured = process.env.ADMIN_BOOTSTRAP_FORCE_RESET?.trim().toLowerCase();
    if (!configured) {
      return false;
    }

    if (configured === 'true') {
      return true;
    }

    if (configured === 'false') {
      return false;
    }

    throw new Error('ADMIN_BOOTSTRAP_FORCE_RESET must be true or false');
  }

  private isUniqueViolation(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private async fetchUpstreamHealth(baseUrl: string, apiKey: string) {
    const startedAt = Date.now();
    const addressError = await this.getPublicUpstreamAddressError(baseUrl);
    if (addressError) {
      return {
        healthStatus: UpstreamHealthStatus.UNHEALTHY,
        latencyMs: Date.now() - startedAt,
        error: addressError
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_HEALTH_CHECK_TIMEOUT_MS);

    try {
      const response = await fetch(this.buildUpstreamModelsUrl(baseUrl), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        signal: controller.signal
      });
      await response.text().catch(() => undefined);

      return {
        healthStatus: response.ok ? UpstreamHealthStatus.HEALTHY : UpstreamHealthStatus.UNHEALTHY,
        latencyMs: Date.now() - startedAt,
        error: response.ok ? null : `HTTP ${response.status}`
      };
    } catch (error) {
      return {
        healthStatus: UpstreamHealthStatus.UNHEALTHY,
        latencyMs: Date.now() - startedAt,
        error: this.normalizeHealthCheckError(error)
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildUpstreamModelsUrl(baseUrl: string) {
    return `${baseUrl.replace(/\/+$/, '')}/v1/models`;
  }

  private async getPublicUpstreamAddressError(baseUrl: string) {
    const parsed = new URL(baseUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (this.isBlockedUpstreamHostname(hostname)) {
      return PRIVATE_UPSTREAM_ADDRESS_ERROR;
    }

    if (isIP(hostname)) {
      return this.isPrivateOrLocalAddress(hostname) ? PRIVATE_UPSTREAM_ADDRESS_ERROR : null;
    }

    try {
      const addresses = await this.lookupUpstreamAddresses(hostname);
      if (!addresses.length) {
        return 'Upstream host could not be resolved';
      }

      return addresses.some((entry) => this.isPrivateOrLocalAddress(entry.address))
        ? PRIVATE_UPSTREAM_ADDRESS_ERROR
        : null;
    } catch (error) {
      return this.normalizeHealthCheckError(error);
    }
  }

  private async lookupUpstreamAddresses(hostname: string) {
    let lookupTimeout: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        lookup(hostname, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => {
          lookupTimeout = setTimeout(() => reject(new Error('DNS lookup timed out')), UPSTREAM_DNS_LOOKUP_TIMEOUT_MS);
        })
      ]);
    } finally {
      if (lookupTimeout) {
        clearTimeout(lookupTimeout);
      }
    }
  }

  private isBlockedUpstreamHostname(hostname: string) {
    return BLOCKED_UPSTREAM_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
  }

  private isPrivateOrLocalAddress(address: string) {
    const normalized = address.toLowerCase();
    const ipv4Mapped = normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized;

    if (isIP(ipv4Mapped) === 4) {
      return this.isPrivateOrLocalIpv4(ipv4Mapped);
    }

    if (isIP(normalized) === 6) {
      return this.isPrivateOrLocalIpv6(normalized);
    }

    return false;
  }

  private isPrivateOrLocalIpv4(address: string) {
    const parts = address.split('.').map((part) => Number(part));
    const [first, second, third] = parts;

    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 168) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113)
    );
  }

  private isPrivateOrLocalIpv6(address: string) {
    return (
      address === '::' ||
      address === '::1' ||
      address.startsWith('fc') ||
      address.startsWith('fd') ||
      address.startsWith('fe80:')
    );
  }

  private normalizeHealthCheckError(error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return 'Health check timed out';
    }

    if (error instanceof Error && error.message) {
      return this.truncateHealthError(error.message);
    }

    return 'Health check failed';
  }

  private truncateHealthError(message: string) {
    return message.length > UPSTREAM_HEALTH_ERROR_MAX_LENGTH
      ? `${message.slice(0, UPSTREAM_HEALTH_ERROR_MAX_LENGTH)}...`
      : message;
  }

  private toPublicUpstreamProvider(provider: {
    id: string;
    name: string;
    baseUrl: string;
    apiKeyPreview: string;
    status: UpstreamProviderStatus;
    healthStatus: UpstreamHealthStatus;
    lastHealthCheckAt: Date | null;
    lastHealthLatencyMs: number | null;
    lastHealthError: string | null;
    createdAt: Date;
    updatedAt: Date;
    createdByAdmin?: { username: string };
  }) {
    return {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKeyPreview: provider.apiKeyPreview,
      status: provider.status.toLowerCase(),
      healthStatus: provider.healthStatus.toLowerCase(),
      lastHealthCheckAt: provider.lastHealthCheckAt?.toISOString() ?? null,
      lastHealthLatencyMs: provider.lastHealthLatencyMs,
      lastHealthError: provider.lastHealthError,
      createdBy: provider.createdByAdmin?.username,
      createdAt: provider.createdAt.toISOString(),
      updatedAt: provider.updatedAt.toISOString()
    };
  }
}
