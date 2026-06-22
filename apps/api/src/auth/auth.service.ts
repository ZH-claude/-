import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { ApiTokenStatus, Prisma, UserStatus } from '../generated/prisma/client';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { ModelCatalogService } from '../model-catalog.service';
import { PrismaService } from '../prisma.service';
import { SecurityAuditService } from '../security-audit/security-audit.service';
import { AuthContext, AuthenticatedUser } from './auth.types';

type RegisterInput = {
  username?: unknown;
  password?: unknown;
};

type LoginInput = {
  username?: unknown;
  password?: unknown;
};

type ChangePasswordInput = {
  currentPassword?: unknown;
  newPassword?: unknown;
};

type TimezoneInput = {
  timezone?: unknown;
};

const SESSION_TTL_DAYS = 7;
const PASSWORD_HASH_ROUNDS = 12;
const USER_INCLUDE = {
  group: true,
  wallet: true
} satisfies Prisma.UserInclude;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ModelCatalogService) private readonly modelCatalogService: ModelCatalogService,
    @Inject(SecurityAuditService) private readonly securityAuditService: SecurityAuditService
  ) {}

  async register(input: RegisterInput, ipAddress?: string) {
    const username = this.normalizeUsername(input.username);
    const password = this.validatePassword(input.password, 'password');

    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const group = await tx.userGroup.upsert({
          where: { code: 'default' },
          update: {},
          create: {
            code: 'default',
            name: '默认分组'
          }
        });

        const createdUser = await tx.user.create({
          data: {
            username,
            passwordHash,
            groupId: group.id,
            inviteCode: this.createInviteCode(),
            lastLoginAt: new Date(),
            lastLoginIp: ipAddress
          }
        });

        await tx.wallet.create({
          data: {
            userId: createdUser.id
          }
        });

        await this.securityAuditService.record({
          tx,
          actorUserId: createdUser.id,
          action: 'user_registered',
          targetType: 'user',
          targetId: createdUser.id,
          ipAddress,
          metadata: {
            username: createdUser.username
          }
        });

        return tx.user.findUniqueOrThrow({
          where: { id: createdUser.id },
          include: USER_INCLUDE
        });
      });

      const token = await this.createSession(user.id);

      return {
        token,
        user: await this.toPublicUserWithModels(user)
      };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('用户名已存在');
      }

      throw error;
    }
  }

  async login(input: LoginInput, ipAddress?: string) {
    const username = this.normalizeUsername(input.username);
    const password = this.validatePassword(input.password, 'password');

    const user = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      include: USER_INCLUDE
    });

    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    this.assertActiveUser(user.status);

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const [updatedUser, token] = await this.prisma.$transaction(async (tx) => {
      const nextUser = await tx.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          lastLoginIp: ipAddress
        },
        include: USER_INCLUDE
      });

      const sessionToken = await this.createSession(nextUser.id, tx);
      await this.securityAuditService.record({
        tx,
        actorUserId: nextUser.id,
        action: 'user_login_succeeded',
        targetType: 'user',
        targetId: nextUser.id,
        ipAddress,
        metadata: {
          username: nextUser.username
        }
      });
      return [nextUser, sessionToken] as const;
    });

    return {
      token,
      user: await this.toPublicUserWithModels(updatedUser)
    };
  }

  async getContextFromToken(token: string): Promise<AuthContext> {
    const tokenHash = this.hashToken(token);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: USER_INCLUDE
        }
      }
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.deletedAt) {
      throw new UnauthorizedException('会话无效或已过期');
    }

    this.assertActiveUser(session.user.status);

    await this.prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() }
    });

    return {
      session,
      user: session.user
    };
  }

  async getProfile(user: AuthenticatedUser) {
    return {
      user: await this.toPublicUserWithModels(user)
    };
  }

  async updateTimezone(context: AuthContext, input: TimezoneInput, ipAddress?: string) {
    const timezone = this.validateTimezone(input.timezone);
    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const nextUser = await tx.user.update({
        where: { id: context.user.id },
        data: { timezone },
        include: USER_INCLUDE
      });

      await this.securityAuditService.record({
        tx,
        actorUserId: context.user.id,
        action: 'user_timezone_updated',
        targetType: 'user',
        targetId: context.user.id,
        ipAddress,
        metadata: {
          timezone
        }
      });

      return nextUser;
    });

    return {
      user: await this.toPublicUserWithModels(updatedUser)
    };
  }

  async logout(context: AuthContext, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: context.session.id },
        data: { revokedAt: new Date() }
      });

      await this.securityAuditService.record({
        tx,
        actorUserId: context.user.id,
        action: 'user_logged_out',
        targetType: 'session',
        targetId: context.session.id,
        ipAddress,
        metadata: {
          username: context.user.username
        }
      });
    });

    return { ok: true };
  }

  async changePassword(context: AuthContext, input: ChangePasswordInput, ipAddress?: string) {
    const currentPassword = this.validatePassword(input.currentPassword, 'currentPassword');
    const newPassword = this.validatePassword(input.newPassword, 'newPassword');

    if (currentPassword === newPassword) {
      throw new BadRequestException('新密码不能与当前密码相同');
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: context.user.id },
      include: USER_INCLUDE
    });

    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('当前密码错误');
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_HASH_ROUNDS);
    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const nextUser = await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
        include: USER_INCLUDE
      });

      await tx.session.updateMany({
        where: {
          userId: user.id,
          id: { not: context.session.id },
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      });

      await this.securityAuditService.record({
        tx,
        actorUserId: user.id,
        action: 'user_password_changed',
        targetType: 'user',
        targetId: user.id,
        ipAddress,
        metadata: {
          otherSessionsRevoked: true
        }
      });

      return nextUser;
    });

    return {
      user: await this.toPublicUserWithModels(updatedUser)
    };
  }

  private async createSession(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await tx.session.create({
      data: {
        userId,
        tokenHash: this.hashToken(token),
        expiresAt
      }
    });

    return token;
  }

  private normalizeUsername(value: unknown) {
    if (typeof value !== 'string') {
      throw new BadRequestException('用户名不能为空');
    }

    const username = value.trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
      throw new BadRequestException('用户名仅支持 3-32 位小写字母、数字、下划线和短横线');
    }

    return username;
  }

  private validatePassword(value: unknown, fieldName: string) {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${fieldName} 不能为空`);
    }

    if (value.length < 8 || value.length > 128) {
      throw new BadRequestException(`${fieldName} 长度必须为 8-128 位`);
    }

    return value;
  }

  private createInviteCode() {
    return randomBytes(4).toString('hex');
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private toPublicUser(user: AuthenticatedUser) {
    return {
      id: user.id,
      username: user.username,
      status: user.status.toLowerCase(),
      role: user.role.toLowerCase(),
      timezone: user.timezone,
      lastLoginIp: user.lastLoginIp ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      group: {
        id: user.group.id,
        code: user.group.code,
        name: user.group.name
      },
      wallet: {
        balanceCents: user.wallet?.balanceCents ?? 0,
        totalSpendCents: user.wallet?.totalSpendCents ?? 0
      }
    };
  }

  private async toPublicUserWithModels(user: AuthenticatedUser) {
    const [availableModels, totalCallCount, activeTokenCount] = await Promise.all([
      this.modelCatalogService.listAvailableModelsForGroup(user.group.id),
      this.prisma.usageEvent.count({
        where: {
          userId: user.id
        }
      }),
      this.prisma.apiToken.count({
        where: {
          userId: user.id,
          deletedAt: null,
          revokedAt: null,
          status: ApiTokenStatus.ACTIVE,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        }
      })
    ]);

    return {
      ...this.toPublicUser(user),
      metrics: {
        totalCallCount,
        activeTokenCount
      },
      availableModels
    };
  }

  private validateTimezone(value: unknown) {
    if (typeof value !== 'string') {
      throw new BadRequestException('timezone 不能为空');
    }

    const timezone = value.trim();
    if (timezone.length < 1 || timezone.length > 64) {
      throw new BadRequestException('timezone 长度必须为 1-64 位');
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    } catch {
      throw new BadRequestException('timezone 不是有效时区');
    }

    return timezone;
  }

  private assertActiveUser(status: UserStatus) {
    if (status === UserStatus.DISABLED) {
      throw new ForbiddenException('账号已禁用');
    }

    if (status === UserStatus.RISK_LOCKED) {
      throw new ForbiddenException('账号已被风控锁定');
    }
  }

  private isUniqueViolation(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
