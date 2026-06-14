import { Injectable, Inject, BadRequestException, OnModuleInit } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Prisma, AnnouncementStatus, UserRole, UserStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

type ListUsersOptions = {
  page: number;
  limit: number;
};

type AnnouncementInput = {
  title?: unknown;
  content?: unknown;
  status?: unknown;
};

const PASSWORD_HASH_ROUNDS = 12;

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

  private requiredText(value: unknown, field: string, min: number, max: number) {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
      throw new BadRequestException(`${field} must be a string with ${min}-${max} characters`);
    }

    return value.trim();
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
}
