import { Inject, Injectable } from '@nestjs/common';
import { AnnouncementCategory, AnnouncementStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

const SECTION_DEFINITIONS = [
  { category: AnnouncementCategory.ANNOUNCEMENT, key: 'announcement', title: '平台公告' },
  { category: AnnouncementCategory.UPDATE_LOG, key: 'update_log', title: '更新日志' },
  { category: AnnouncementCategory.USAGE_GUIDE, key: 'usage_guide', title: '使用建议' }
] as const;

@Injectable()
export class AnnouncementsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listPublished() {
    const announcements = await this.prisma.announcement.findMany({
      where: {
        status: AnnouncementStatus.PUBLISHED
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: 60
    });

    const publicItems = announcements.map((announcement) => ({
      id: announcement.id,
      title: announcement.title,
      content: announcement.content,
      category: announcement.category.toLowerCase(),
      publishedAt: announcement.publishedAt?.toISOString() ?? null,
      createdAt: announcement.createdAt.toISOString(),
      updatedAt: announcement.updatedAt.toISOString()
    }));

    return {
      generatedAt: new Date().toISOString(),
      total: publicItems.length,
      sections: SECTION_DEFINITIONS.map((section) => ({
        key: section.key,
        title: section.title,
        items: publicItems.filter((item) => item.category === section.key)
      }))
    };
  }
}
