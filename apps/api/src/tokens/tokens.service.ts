import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { AuthenticatedUser } from '../auth/auth.types';
import { ApiTokenStatus, Prisma, UserStatus } from '../generated/prisma/client';
import { ModelCatalogService } from '../model-catalog.service';
import { PrismaService } from '../prisma.service';
import { SecurityAuditService } from '../security-audit/security-audit.service';

type TokenInput = {
  name?: unknown;
  quotaCents?: unknown;
  expiresAt?: unknown;
  note?: unknown;
  modelNames?: unknown;
  rateLimitRequestsPerMinute?: unknown;
  modelRateLimitRequestsPerMinute?: unknown;
  ipRateLimitRequestsPerMinute?: unknown;
  ipWhitelist?: unknown;
  activationTtlSeconds?: unknown;
};

const API_KEY_PREFIX = 'sk-nr';
const API_KEY_COLLISION_RETRIES = 3;
const MAX_QUOTA_CENTS = 100_000_000_000;
const MAX_RATE_LIMIT_REQUESTS_PER_MINUTE = 1_000_000;
const MAX_ACTIVATION_TTL_SECONDS = 31_536_000;
const MAX_IP_WHITELIST_ENTRIES = 64;

@Injectable()
export class TokensService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ModelCatalogService) private readonly modelCatalogService: ModelCatalogService,
    @Inject(SecurityAuditService) private readonly securityAuditService: SecurityAuditService
  ) {}

  async listTokens(user: AuthenticatedUser) {
    const tokens = await this.prisma.apiToken.findMany({
      where: {
        userId: user.id,
        deletedAt: null
      },
      include: {
        modelAccesses: {
          orderBy: { model: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return {
      items: tokens.map((token) => this.toPublicToken(token))
    };
  }

  async createToken(user: AuthenticatedUser, body: TokenInput) {
    const name = this.requiredText(body.name, 'name', 2, 80);
    const quotaCents = this.optionalNonNegativeInt(body.quotaCents, 'quotaCents', MAX_QUOTA_CENTS);
    const expiresAt = this.optionalFutureDate(body.expiresAt, 'expiresAt');
    const note = this.optionalText(body.note, 'note', 1, 240) ?? null;
    const rateLimitRequestsPerMinute = this.optionalPositiveInt(
      body.rateLimitRequestsPerMinute,
      'rateLimitRequestsPerMinute',
      MAX_RATE_LIMIT_REQUESTS_PER_MINUTE
    );
    const modelRateLimitRequestsPerMinute = this.optionalPositiveInt(
      body.modelRateLimitRequestsPerMinute,
      'modelRateLimitRequestsPerMinute',
      MAX_RATE_LIMIT_REQUESTS_PER_MINUTE
    );
    const ipRateLimitRequestsPerMinute = this.optionalPositiveInt(
      body.ipRateLimitRequestsPerMinute,
      'ipRateLimitRequestsPerMinute',
      MAX_RATE_LIMIT_REQUESTS_PER_MINUTE
    );
    const ipWhitelist = this.normalizeIpWhitelist(body.ipWhitelist);
    const activationTtlSeconds = this.optionalPositiveInt(
      body.activationTtlSeconds,
      'activationTtlSeconds',
      MAX_ACTIVATION_TTL_SECONDS
    );
    const modelNames = await this.normalizeModelNames(user, body.modelNames);

    return this.createTokenWithKeyRetry(async (apiKey, tokenHash, keyPreview) => {
      const token = await this.prisma.$transaction(async (tx) => {
        const createdToken = await tx.apiToken.create({
          data: {
            userId: user.id,
            name,
            tokenHash,
            keyPreview,
            quotaCents,
            expiresAt,
            note,
            rateLimitRequestsPerMinute,
            modelRateLimitRequestsPerMinute,
            ipRateLimitRequestsPerMinute,
            ipWhitelist,
            activationTtlSeconds
          }
        });

        if (modelNames.length > 0) {
          await tx.apiTokenModelAccess.createMany({
            data: modelNames.map((model) => ({
              apiTokenId: createdToken.id,
              model
            }))
          });
        }

        await this.securityAuditService.record({
          tx,
          actorUserId: user.id,
          action: 'api_token_created',
          targetType: 'api_token',
          targetId: createdToken.id,
          metadata: {
            name,
            hasQuota: quotaCents !== null,
            hasExpiresAt: expiresAt !== null,
            modelCount: modelNames.length,
            hasTokenRateLimit: rateLimitRequestsPerMinute !== null,
            hasModelRateLimit: modelRateLimitRequestsPerMinute !== null,
            hasIpRateLimit: ipRateLimitRequestsPerMinute !== null,
            ipWhitelistCount: ipWhitelist.length,
            hasActivationTtl: activationTtlSeconds !== null
          }
        });

        return tx.apiToken.findUniqueOrThrow({
          where: { id: createdToken.id },
          include: {
            modelAccesses: {
              orderBy: { model: 'asc' }
            }
          }
        });
      });

      return {
        apiKey,
        token: this.toPublicToken(token)
      };
    });
  }

  async disableToken(user: AuthenticatedUser, tokenId: string) {
    const existingToken = await this.findOwnedActiveOrDisabledToken(user.id, tokenId);

    const token = await this.prisma.$transaction(async (tx) => {
      const updatedToken = await tx.apiToken.update({
        where: { id: existingToken.id },
        data: {
          status: ApiTokenStatus.DISABLED,
          revokedAt: existingToken.revokedAt ?? new Date()
        },
        include: {
          modelAccesses: {
            orderBy: { model: 'asc' }
          }
        }
      });

      await this.securityAuditService.record({
        tx,
        actorUserId: user.id,
        action: 'api_token_disabled',
        targetType: 'api_token',
        targetId: existingToken.id,
        metadata: {
          name: existingToken.name,
          previousStatus: existingToken.status.toLowerCase()
        }
      });

      return updatedToken;
    });

    return {
      token: this.toPublicToken(token)
    };
  }

  async resetToken(user: AuthenticatedUser, tokenId: string) {
    const existingToken = await this.findOwnedActiveOrDisabledToken(user.id, tokenId);

    return this.createTokenWithKeyRetry(async (apiKey, tokenHash, keyPreview) => {
      const token = await this.prisma.$transaction(async (tx) => {
        const updatedToken = await tx.apiToken.update({
          where: { id: existingToken.id },
          data: {
            tokenHash,
            keyPreview,
            status: ApiTokenStatus.ACTIVE,
            revokedAt: null,
            lastUsedAt: null,
            activatedAt: null,
            activationExpiresAt: null
          },
          include: {
            modelAccesses: {
              orderBy: { model: 'asc' }
            }
          }
        });

        await this.securityAuditService.record({
          tx,
          actorUserId: user.id,
          action: 'api_token_reset',
          targetType: 'api_token',
          targetId: existingToken.id,
          metadata: {
            name: existingToken.name,
            previousStatus: existingToken.status.toLowerCase()
          }
        });

        return updatedToken;
      });

      return {
        apiKey,
        token: this.toPublicToken(token)
      };
    });
  }

  async updateToken(user: AuthenticatedUser, tokenId: string, body: TokenInput) {
    const existingToken = await this.findOwnedTokenWithModelAccesses(user.id, tokenId);
    const name = body.name === undefined ? existingToken.name : this.requiredText(body.name, 'name', 2, 80);
    const quotaCents =
      body.quotaCents === undefined
        ? existingToken.quotaCents
        : this.optionalNonNegativeInt(body.quotaCents, 'quotaCents', MAX_QUOTA_CENTS);
    const expiresAt =
      body.expiresAt === undefined ? existingToken.expiresAt : this.optionalFutureDate(body.expiresAt, 'expiresAt');
    const note = body.note === undefined ? existingToken.note : this.optionalText(body.note, 'note', 1, 240) ?? null;
    const rateLimitRequestsPerMinute =
      body.rateLimitRequestsPerMinute === undefined
        ? existingToken.rateLimitRequestsPerMinute
        : this.optionalPositiveInt(
            body.rateLimitRequestsPerMinute,
            'rateLimitRequestsPerMinute',
            MAX_RATE_LIMIT_REQUESTS_PER_MINUTE
          );
    const modelRateLimitRequestsPerMinute =
      body.modelRateLimitRequestsPerMinute === undefined
        ? existingToken.modelRateLimitRequestsPerMinute
        : this.optionalPositiveInt(
            body.modelRateLimitRequestsPerMinute,
            'modelRateLimitRequestsPerMinute',
            MAX_RATE_LIMIT_REQUESTS_PER_MINUTE
          );
    const ipRateLimitRequestsPerMinute =
      body.ipRateLimitRequestsPerMinute === undefined
        ? existingToken.ipRateLimitRequestsPerMinute
        : this.optionalPositiveInt(
            body.ipRateLimitRequestsPerMinute,
            'ipRateLimitRequestsPerMinute',
            MAX_RATE_LIMIT_REQUESTS_PER_MINUTE
          );
    const ipWhitelist = body.ipWhitelist === undefined ? existingToken.ipWhitelist : this.normalizeIpWhitelist(body.ipWhitelist);
    const activationTtlSeconds =
      body.activationTtlSeconds === undefined
        ? existingToken.activationTtlSeconds
        : this.optionalPositiveInt(body.activationTtlSeconds, 'activationTtlSeconds', MAX_ACTIVATION_TTL_SECONDS);
    const modelNames =
      body.modelNames === undefined
        ? existingToken.modelAccesses.map((access) => access.model)
        : await this.normalizeModelNames(user, body.modelNames);

    const token = await this.prisma.$transaction(async (tx) => {
      const updatedToken = await tx.apiToken.update({
        where: { id: existingToken.id },
        data: {
          name,
          quotaCents,
          expiresAt,
          note,
          rateLimitRequestsPerMinute,
          modelRateLimitRequestsPerMinute,
          ipRateLimitRequestsPerMinute,
          ipWhitelist,
          activationTtlSeconds
        }
      });

      await tx.apiTokenModelAccess.deleteMany({
        where: { apiTokenId: updatedToken.id }
      });

      if (modelNames.length > 0) {
        await tx.apiTokenModelAccess.createMany({
          data: modelNames.map((model) => ({
            apiTokenId: updatedToken.id,
            model
          }))
        });
      }

      await this.securityAuditService.record({
        tx,
        actorUserId: user.id,
        action: 'api_token_updated',
        targetType: 'api_token',
        targetId: updatedToken.id,
        metadata: {
          name,
          previousName: existingToken.name,
          hasQuota: quotaCents !== null,
          hasExpiresAt: expiresAt !== null,
          modelCount: modelNames.length
        }
      });

      return tx.apiToken.findUniqueOrThrow({
        where: { id: updatedToken.id },
        include: {
          modelAccesses: {
            orderBy: { model: 'asc' }
          }
        }
      });
    });

    return {
      token: this.toPublicToken(token)
    };
  }

  async deleteToken(user: AuthenticatedUser, tokenId: string) {
    const existingToken = await this.findOwnedActiveOrDisabledToken(user.id, tokenId);
    const now = new Date();

    const token = await this.prisma.$transaction(async (tx) => {
      const deletedToken = await tx.apiToken.update({
        where: { id: existingToken.id },
        data: {
          status: ApiTokenStatus.DELETED,
          revokedAt: existingToken.revokedAt ?? now,
          deletedAt: now
        },
        include: {
          modelAccesses: {
            orderBy: { model: 'asc' }
          }
        }
      });

      await this.securityAuditService.record({
        tx,
        actorUserId: user.id,
        action: 'api_token_deleted',
        targetType: 'api_token',
        targetId: existingToken.id,
        metadata: {
          name: existingToken.name,
          previousStatus: existingToken.status.toLowerCase()
        }
      });

      return deletedToken;
    });

    return {
      ok: true,
      token: this.toPublicToken(token)
    };
  }

  async verifyApiToken(apiKey: string) {
    const tokenHash = this.hashApiKey(apiKey);
    const token = await this.prisma.apiToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            group: true,
            wallet: true
          }
        },
        modelAccesses: {
          orderBy: { model: 'asc' }
        }
      }
    });

    const now = new Date();

    if (!token || token.deletedAt || token.revokedAt || token.status !== ApiTokenStatus.ACTIVE) {
      throw new UnauthorizedException('API Key 无效或已停用');
    }

    if (token.expiresAt && token.expiresAt <= now) {
      throw new UnauthorizedException('API Key 已过期');
    }

    if (token.user.deletedAt) {
      throw new UnauthorizedException('API Key 无效');
    }

    this.assertActiveUser(token.user.status);

    if (token.quotaCents !== null && token.usedCents >= token.quotaCents) {
      throw new ForbiddenException({
        code: 'insufficient_balance',
        message: 'API token quota exceeded'
      });
    }

    if (token.activationExpiresAt && token.activationExpiresAt <= now) {
      throw new ForbiddenException({
        code: 'token_activation_expired',
        message: 'API token activation window expired'
      });
    }

    const availableModels = await this.modelCatalogService.listAvailableModelsForGroup(token.user.group.id);
    const restrictedModels = token.modelAccesses.map((access) => access.model);
    const allowedModels =
      restrictedModels.length === 0
        ? availableModels
        : availableModels.filter((model) => restrictedModels.includes(model.model));

    const updatedToken = await this.prisma.apiToken.update({
      where: { id: token.id },
      data: { lastUsedAt: now },
      include: {
        modelAccesses: {
          orderBy: { model: 'asc' }
        }
      }
    });

    return {
      ok: true,
      token: this.toPublicToken(updatedToken),
      user: {
        id: token.user.id,
        username: token.user.username,
        rateLimitRequestsPerMinute: token.user.rateLimitRequestsPerMinute,
        riskLockedUntil: token.user.riskLockedUntil,
        riskReason: token.user.riskReason,
        group: {
          id: token.user.group.id,
          code: token.user.group.code,
          name: token.user.group.name
        }
      },
      allowedModels
    };
  }

  async activateApiTokenIfNeeded(token: {
    id: string;
    activatedAt?: string | Date | null;
    activationTtlSeconds?: number | null;
  }) {
    if (token.activatedAt) {
      return;
    }

    const now = new Date();
    await this.prisma.apiToken.updateMany({
      where: {
        id: token.id,
        activatedAt: null,
        deletedAt: null,
        revokedAt: null,
        status: ApiTokenStatus.ACTIVE
      },
      data: {
        activatedAt: now,
        activationExpiresAt:
          token.activationTtlSeconds === null || token.activationTtlSeconds === undefined
            ? null
            : new Date(now.getTime() + token.activationTtlSeconds * 1000)
      }
    });
  }

  private async findOwnedActiveOrDisabledToken(userId: string, tokenId: string) {
    if (!this.isUuid(tokenId)) {
      throw new BadRequestException('tokenId must be a valid UUID');
    }

    const token = await this.prisma.apiToken.findFirst({
      where: {
        id: tokenId,
        userId,
        deletedAt: null
      }
    });

    if (!token) {
      throw new NotFoundException('API Token not found');
    }

    return token;
  }

  private async findOwnedTokenWithModelAccesses(userId: string, tokenId: string) {
    if (!this.isUuid(tokenId)) {
      throw new BadRequestException('tokenId must be a valid UUID');
    }

    const token = await this.prisma.apiToken.findFirst({
      where: {
        id: tokenId,
        userId,
        deletedAt: null
      },
      include: {
        modelAccesses: {
          orderBy: { model: 'asc' }
        }
      }
    });

    if (!token) {
      throw new NotFoundException('API Token not found');
    }

    return token;
  }

  private async createTokenWithKeyRetry<T>(
    action: (apiKey: string, tokenHash: string, keyPreview: string) => Promise<T>
  ) {
    let lastError: unknown;

    for (let attempt = 0; attempt < API_KEY_COLLISION_RETRIES; attempt += 1) {
      const apiKey = this.generateApiKey();
      const tokenHash = this.hashApiKey(apiKey);
      const keyPreview = this.maskApiKey(apiKey);

      try {
        return await action(apiKey, tokenHash, keyPreview);
      } catch (error) {
        if (!this.isTokenHashCollision(error)) {
          throw error;
        }

        lastError = error;
      }
    }

    throw new ConflictException('API Key 生成冲突，请重试', { cause: lastError });
  }

  private async normalizeModelNames(user: AuthenticatedUser, value: unknown) {
    if (value === undefined || value === null || value === '') {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new BadRequestException('modelNames must be an array');
    }

    const requestedModels = [...new Set(value.map((entry) => this.normalizeModelName(entry)))];
    if (requestedModels.length === 0) {
      return [];
    }

    const availableModels = await this.modelCatalogService.listAvailableModelsForGroup(user.group.id);
    const availableModelNames = new Set(availableModels.map((model) => model.model));
    const unknownModels = requestedModels.filter((model) => !availableModelNames.has(model));
    if (unknownModels.length > 0) {
      throw new BadRequestException(`modelNames contains unavailable models: ${unknownModels.join(', ')}`);
    }

    return requestedModels;
  }

  private requiredText(value: unknown, field: string, min: number, max: number) {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
      throw new BadRequestException(`${field} must be a string with ${min}-${max} characters`);
    }

    return value.trim();
  }

  private optionalText(value: unknown, field: string, min: number, max: number) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return this.requiredText(value, field, min, max);
  }

  private optionalNonNegativeInt(value: unknown, field: string, max: number) {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isInteger(numericValue) || numericValue < 0 || numericValue > max) {
      throw new BadRequestException(`${field} must be an integer between 0 and ${max}`);
    }

    return numericValue;
  }

  private optionalPositiveInt(value: unknown, field: string, max: number) {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > max) {
      throw new BadRequestException(`${field} must be an integer between 1 and ${max}`);
    }

    return numericValue;
  }

  private normalizeIpWhitelist(value: unknown) {
    if (value === undefined || value === null || value === '') {
      return [];
    }

    const entries =
      typeof value === 'string'
        ? value.split(/[,\s]+/)
        : Array.isArray(value)
          ? value
          : (() => {
              throw new BadRequestException('ipWhitelist must be an array of IP addresses');
            })();

    const normalized = entries
      .map((entry) => this.normalizeIpAddress(entry))
      .filter((entry): entry is string => Boolean(entry));
    const unique = [...new Set(normalized)];

    if (unique.length > MAX_IP_WHITELIST_ENTRIES) {
      throw new BadRequestException(`ipWhitelist cannot contain more than ${MAX_IP_WHITELIST_ENTRIES} entries`);
    }

    return unique;
  }

  private normalizeIpAddress(value: unknown) {
    if (typeof value !== 'string') {
      throw new BadRequestException('ipWhitelist contains an invalid IP address');
    }

    const ip = value.trim().replace(/^\[|\]$/g, '').replace(/^::ffff:/i, '');
    if (!ip) {
      return null;
    }

    if (isIP(ip) === 0) {
      throw new BadRequestException('ipWhitelist contains an invalid IP address');
    }

    return ip;
  }

  private optionalFutureDate(value: unknown, field: string) {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be an ISO datetime string`);
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO datetime string`);
    }

    if (date <= new Date()) {
      throw new BadRequestException(`${field} must be in the future`);
    }

    return date;
  }

  private normalizeModelName(value: unknown) {
    if (typeof value !== 'string') {
      throw new BadRequestException('modelNames contains invalid model name');
    }

    const model = value.trim();
    if (model.length < 2 || model.length > 120 || !/^[a-zA-Z0-9._:/+-]+$/.test(model)) {
      throw new BadRequestException('modelNames contains unsupported model name');
    }

    return model;
  }

  private generateApiKey() {
    return `${API_KEY_PREFIX}-${randomBytes(8).toString('base64url')}.${randomBytes(32).toString('base64url')}`;
  }

  private hashApiKey(apiKey: string) {
    return createHash('sha256').update(apiKey).digest('hex');
  }

  private maskApiKey(apiKey: string) {
    return `${apiKey.slice(0, 12)}...${apiKey.slice(-6)}`;
  }

  private toPublicToken(token: {
    id: string;
    name: string;
    keyPreview: string;
    status: ApiTokenStatus;
    quotaCents: number | null;
    usedCents: number;
    expiresAt: Date | null;
    note: string | null;
    lastUsedAt: Date | null;
    rateLimitRequestsPerMinute: number | null;
    modelRateLimitRequestsPerMinute: number | null;
    ipRateLimitRequestsPerMinute: number | null;
    ipWhitelist: string[];
    activationTtlSeconds: number | null;
    activatedAt: Date | null;
    activationExpiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    modelAccesses: Array<{ model: string }>;
  }) {
    return {
      id: token.id,
      name: token.name,
      keyPreview: token.keyPreview,
      status: token.status.toLowerCase(),
      quotaCents: token.quotaCents,
      usedCents: token.usedCents,
      expiresAt: token.expiresAt?.toISOString() ?? null,
      note: token.note,
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
      rateLimitRequestsPerMinute: token.rateLimitRequestsPerMinute,
      modelRateLimitRequestsPerMinute: token.modelRateLimitRequestsPerMinute,
      ipRateLimitRequestsPerMinute: token.ipRateLimitRequestsPerMinute,
      ipWhitelist: token.ipWhitelist,
      activationTtlSeconds: token.activationTtlSeconds,
      activatedAt: token.activatedAt?.toISOString() ?? null,
      activationExpiresAt: token.activationExpiresAt?.toISOString() ?? null,
      revokedAt: token.revokedAt?.toISOString() ?? null,
      modelNames: token.modelAccesses.map((access) => access.model),
      createdAt: token.createdAt.toISOString(),
      updatedAt: token.updatedAt.toISOString()
    };
  }

  private assertActiveUser(status: UserStatus) {
    if (status === UserStatus.DISABLED) {
      throw new ForbiddenException('账号已禁用');
    }

    if (status === UserStatus.RISK_LOCKED) {
      throw new ForbiddenException({
        code: 'risk_limit_exceeded',
        message: 'Account is locked by risk control'
      });
    }
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private isTokenHashCollision(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.includes('token_hash')
    );
  }
}
