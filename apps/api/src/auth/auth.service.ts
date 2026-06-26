import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { ApiTokenStatus, Prisma, UserStatus } from '../generated/prisma/client';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ModelCatalogService } from '../model-catalog.service';
import { PrismaService } from '../prisma.service';
import { SecurityAuditService } from '../security-audit/security-audit.service';
import { AuthContext, AuthenticatedUser } from './auth.types';

type RegisterInput = {
  username?: unknown;
  phoneNumber?: unknown;
  password?: unknown;
};

type LoginInput = {
  username?: unknown;
  phoneNumber?: unknown;
  password?: unknown;
};

type PasswordRecoveryInput = {
  phoneNumber?: unknown;
};

type PasswordResetInput = {
  phoneNumber?: unknown;
  verificationCode?: unknown;
  newPassword?: unknown;
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
const AUTH_ABUSE_WINDOW_MS = 60_000;
const DEFAULT_PHONE_LOGIN_LIMIT_PER_MINUTE = 5;
const DEFAULT_PASSWORD_RECOVERY_LIMIT_PER_MINUTE = 5;
const DEFAULT_PASSWORD_RESET_LIMIT_PER_MINUTE = 5;
const MAX_AUTH_LIMIT_VALUE = 1_000_000;
const PASSWORD_RECOVERY_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RECOVERY_CODE_DIGITS = 6;
const PASSWORD_RECOVERY_MAX_ATTEMPTS = 5;
const PASSWORD_RECOVERY_SUCCESS_MESSAGE = 'If this phone number is registered, a recovery code has been sent.';
const PASSWORD_RECOVERY_INVALID_CODE_MESSAGE = 'Invalid or expired verification code';
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
    const phoneNumber = this.optionalPhoneNumber(input.phoneNumber);
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
            phoneNumber,
            phoneVerifiedAt: null,
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
            username: createdUser.username,
            hasPhoneNumber: Boolean(createdUser.phoneNumber)
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
        throw new ConflictException('用户名或手机号已存在');
      }

      throw error;
    }
  }

  async login(input: LoginInput, ipAddress?: string) {
    const username = this.optionalUsername(input.username);
    const phoneNumber = this.optionalPhoneNumber(input.phoneNumber);
    const loginIdentifier = username ?? phoneNumber;
    if (!loginIdentifier) {
      throw new BadRequestException('username or phoneNumber is required');
    }
    const password = this.validatePassword(input.password, 'password');
    const isPhoneLogin = Boolean(phoneNumber);

    if (isPhoneLogin) {
      await this.assertAuthRateLimit(
        'phone_login_attempted',
        ipAddress,
        this.getAuthLimit('AUTH_PHONE_LOGIN_PER_MINUTE_LIMIT', DEFAULT_PHONE_LOGIN_LIMIT_PER_MINUTE)
      );
    }

    const user = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        ...(phoneNumber ? { phoneNumber } : { username: loginIdentifier })
      },
      include: USER_INCLUDE
    });

    if (!user) {
      if (isPhoneLogin) {
        await this.recordPhoneAuthAttempt('phone_login_attempted', null, ipAddress, phoneNumber, 'unknown_user');
      }
      throw new UnauthorizedException('用户名或密码错误');
    }

    try {
      this.assertActiveUser(user.status);
    } catch (error) {
      if (isPhoneLogin) {
        await this.recordPhoneAuthAttempt('phone_login_attempted', user.id, ipAddress, phoneNumber, 'blocked_user');
      }
      throw error;
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      if (isPhoneLogin) {
        await this.recordPhoneAuthAttempt('phone_login_attempted', user.id, ipAddress, phoneNumber, 'wrong_password');
      }
      throw new UnauthorizedException('用户名或密码错误');
    }

    if (isPhoneLogin) {
      await this.recordPhoneAuthAttempt('phone_login_attempted', user.id, ipAddress, phoneNumber, 'accepted');
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
          username: nextUser.username,
          loginMethod: phoneNumber ? 'phone' : 'username'
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

  async getProfile(user: AuthenticatedUser, language?: string | null) {
    return {
      user: await this.toPublicUserWithModels(user, language)
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

  async requestPasswordRecovery(input: PasswordRecoveryInput, ipAddress?: string) {
    const phoneNumber = this.normalizePhoneNumber(input.phoneNumber);
    const providerConfigured = this.isPasswordRecoveryProviderConfigured();
    await this.assertAuthRateLimit(
      'password_recovery_requested',
      ipAddress,
      this.getAuthLimit('AUTH_PASSWORD_RECOVERY_PER_MINUTE_LIMIT', DEFAULT_PASSWORD_RECOVERY_LIMIT_PER_MINUTE)
    );

    const user = await this.prisma.user.findFirst({
      where: { phoneNumber, deletedAt: null },
      select: { id: true }
    });

    let debugCode: string | null = null;
    if (user) {
      const code = this.createPasswordRecoveryCode();
      debugCode = code;
      await this.prisma.passwordRecoveryCode.create({
        data: {
          userId: user.id,
          phoneDigest: this.digestPhoneNumber(phoneNumber),
          codeHash: this.hashPasswordRecoveryCode(user.id, phoneNumber, code),
          providerConfigured,
          expiresAt: new Date(Date.now() + PASSWORD_RECOVERY_TTL_MS),
          maxAttempts: PASSWORD_RECOVERY_MAX_ATTEMPTS
        }
      });
    }

    await this.recordPhoneAuthAttempt(
      'password_recovery_requested',
      user?.id ?? null,
      ipAddress,
      phoneNumber,
      user ? 'code_created' : 'unknown_user',
      providerConfigured
    );

    return {
      ok: true,
      channel: 'phone',
      providerConfigured,
      message: PASSWORD_RECOVERY_SUCCESS_MESSAGE,
      ...(debugCode && this.shouldExposePasswordRecoveryDebugCode() ? { debugCode } : {})
    };
  }

  async resetPasswordByPhone(input: PasswordResetInput, ipAddress?: string) {
    const phoneNumber = this.normalizePhoneNumber(input.phoneNumber);
    const verificationCode = this.requiredVerificationCode(input.verificationCode);
    const newPassword = this.validatePassword(input.newPassword, 'newPassword');
    await this.assertAuthRateLimit(
      'password_reset_by_phone_attempted',
      ipAddress,
      this.getAuthLimit('AUTH_PASSWORD_RESET_PER_MINUTE_LIMIT', DEFAULT_PASSWORD_RESET_LIMIT_PER_MINUTE)
    );

    const phoneDigest = this.digestPhoneNumber(phoneNumber);
    const user = await this.prisma.user.findFirst({
      where: { phoneNumber, deletedAt: null },
      select: { id: true, status: true }
    });

    if (!user) {
      await this.recordPasswordResetAttempt(null, ipAddress, phoneDigest, 'unknown_user');
      throw new BadRequestException(PASSWORD_RECOVERY_INVALID_CODE_MESSAGE);
    }

    this.assertActiveUser(user.status);

    const recoveryCode = await this.prisma.passwordRecoveryCode.findFirst({
      where: {
        userId: user.id,
        phoneDigest,
        consumedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!recoveryCode || recoveryCode.attemptCount >= recoveryCode.maxAttempts) {
      await this.recordPasswordResetAttempt(user.id, ipAddress, phoneDigest, 'missing_or_expired_code');
      throw new BadRequestException(PASSWORD_RECOVERY_INVALID_CODE_MESSAGE);
    }

    const expectedHash = this.hashPasswordRecoveryCode(user.id, phoneNumber, verificationCode);
    if (!this.secureHashEquals(recoveryCode.codeHash, expectedHash)) {
      await this.prisma.passwordRecoveryCode.update({
        where: { id: recoveryCode.id },
        data: { attemptCount: { increment: 1 } }
      });
      await this.recordPasswordResetAttempt(user.id, ipAddress, phoneDigest, 'invalid_code');
      throw new BadRequestException(PASSWORD_RECOVERY_INVALID_CODE_MESSAGE);
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_HASH_ROUNDS);
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordRecoveryCode.update({
        where: { id: recoveryCode.id },
        data: {
          consumedAt: new Date(),
          attemptCount: { increment: 1 }
        }
      });

      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          phoneVerifiedAt: new Date()
        }
      });

      await tx.session.updateMany({
        where: {
          userId: user.id,
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      });

      await this.securityAuditService.record({
        tx,
        actorUserId: user.id,
        action: 'password_reset_by_phone_completed',
        targetType: 'user',
        targetId: user.id,
        ipAddress,
        metadata: {
          phoneDigest,
          providerConfigured: recoveryCode.providerConfigured,
          allSessionsRevoked: true
        }
      });
    });

    return {
      ok: true,
      message: 'Password reset successful. You can now log in with your new password.'
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

  private optionalUsername(value: unknown) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    return this.normalizeUsername(value);
  }

  private optionalPhoneNumber(value: unknown) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    return this.normalizePhoneNumber(value);
  }

  private normalizePhoneNumber(value: unknown) {
    if (typeof value !== 'string') {
      throw new BadRequestException('phoneNumber is required');
    }

    const phoneNumber = value.trim().replace(/[\s-]/g, '');
    if (!/^\+?[1-9]\d{6,14}$/.test(phoneNumber)) {
      throw new BadRequestException('phoneNumber must be an E.164-like phone number');
    }

    return phoneNumber;
  }

  private requiredVerificationCode(value: unknown) {
    if (typeof value !== 'string' || !/^\d{4,8}$/.test(value.trim())) {
      throw new BadRequestException('verificationCode must be 4-8 digits');
    }

    return value.trim();
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

  private async assertAuthRateLimit(action: string, ipAddress: string | undefined, limit: number) {
    const normalizedIp = this.normalizeIp(ipAddress);
    const current = await this.prisma.securityAuditLog.count({
      where: {
        action,
        ipAddress: normalizedIp,
        createdAt: { gte: new Date(Date.now() - AUTH_ABUSE_WINDOW_MS) }
      }
    });

    if (current >= limit) {
      throw new HttpException(
        {
          code: 'auth_rate_limit_exceeded',
          message: 'Too many authentication attempts. Please try again later.',
          scope: action,
          limit,
          windowSeconds: AUTH_ABUSE_WINDOW_MS / 1000
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  private async recordPhoneAuthAttempt(
    action: string,
    actorUserId: string | null,
    ipAddress: string | undefined,
    phoneNumber: string | null,
    outcome: string,
    providerConfigured = false
  ) {
    await this.securityAuditService.record({
      actorUserId,
      action,
      targetType: 'user',
      targetId: actorUserId,
      ipAddress,
      metadata: {
        channel: 'phone',
        phoneDigest: phoneNumber ? this.digestPhoneNumber(phoneNumber) : null,
        providerConfigured,
        outcome
      }
    });
  }

  private async recordPasswordResetAttempt(
    actorUserId: string | null,
    ipAddress: string | undefined,
    phoneDigest: string,
    outcome: string
  ) {
    await this.securityAuditService.record({
      actorUserId,
      action: 'password_reset_by_phone_attempted',
      targetType: 'user',
      targetId: actorUserId,
      ipAddress,
      metadata: {
        channel: 'phone',
        phoneDigest,
        providerConfigured: this.isPasswordRecoveryProviderConfigured(),
        outcome
      }
    });
  }

  private createPasswordRecoveryCode() {
    return randomBytes(4).readUInt32BE(0).toString().padStart(PASSWORD_RECOVERY_CODE_DIGITS, '0').slice(-PASSWORD_RECOVERY_CODE_DIGITS)
      .replace(/^\d/, (firstDigit) => (firstDigit === '0' ? '1' : firstDigit))
      .slice(0, PASSWORD_RECOVERY_CODE_DIGITS);
  }

  private hashPasswordRecoveryCode(userId: string, phoneNumber: string, code: string) {
    const secret =
      process.env.PASSWORD_RECOVERY_CODE_SECRET ??
      process.env.API_TOKEN_KEY_ENCRYPTION_SECRET ??
      process.env.UPSTREAM_KEY_ENCRYPTION_SECRET ??
      'local-password-recovery-secret';
    return this.hashToken(`password-recovery:${secret}:${userId}:${phoneNumber}:${code}`);
  }

  private secureHashEquals(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private isPasswordRecoveryProviderConfigured() {
    return process.env.SMS_PROVIDER_ENABLED === 'true' || Boolean(process.env.SMS_PROVIDER_NAME);
  }

  private shouldExposePasswordRecoveryDebugCode() {
    const configured = process.env.AUTH_PASSWORD_RECOVERY_DEBUG_CODE;
    if (configured !== undefined) {
      return configured.toLowerCase() === 'true';
    }

    return process.env.NODE_ENV !== 'production';
  }

  private digestPhoneNumber(phoneNumber: string) {
    return this.hashToken(`phone:${phoneNumber}`);
  }

  private getAuthLimit(envName: string, fallback: number) {
    const rawValue = process.env[envName];
    if (rawValue === undefined || rawValue === '') {
      return fallback;
    }

    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_AUTH_LIMIT_VALUE) {
      return fallback;
    }

    return parsed;
  }

  private normalizeIp(value: string | null | undefined) {
    if (!value) {
      return null;
    }

    return value.split(',')[0]?.trim().replace(/^\[|\]$/g, '').replace(/^::ffff:/i, '') || null;
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
      phoneNumber: user.phoneNumber ?? null,
      phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
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

  private async toPublicUserWithModels(user: AuthenticatedUser, language?: string | null) {
    const [availableModels, totalCallCount, activeTokenCount] = await Promise.all([
      this.modelCatalogService.listAvailableModelsForGroup(user.group.id, language),
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
