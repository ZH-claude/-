import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

type SiteContentInput = {
  homeTitle?: unknown;
  homeSubtitle?: unknown;
  homeContent?: unknown;
  homeFontFamily?: unknown;
  homeTextColor?: unknown;
  homeAccentColor?: unknown;
  popupEnabled?: unknown;
  popupTitle?: unknown;
  popupContent?: unknown;
  popupFontFamily?: unknown;
  popupTextColor?: unknown;
  popupAccentColor?: unknown;
};

type SiteContentRecord = {
  id: string;
  homeTitle: string | null;
  homeSubtitle: string | null;
  homeContent: string | null;
  homeFontFamily: string;
  homeTextColor: string;
  homeAccentColor: string;
  popupEnabled: boolean;
  popupTitle: string | null;
  popupContent: string | null;
  popupFontFamily: string;
  popupTextColor: string;
  popupAccentColor: string;
  updatedAt: Date;
};

const SITE_CONTENT_CONFIG_ID = 'default';
const FONT_FAMILIES = new Set(['system', 'serif', 'rounded', 'mono']);
const DEFAULT_HOME_TITLE = '蔚蓝星球中转站';
const DEFAULT_HOME_SUBTITLE = '智能服务中转后台';
const DEFAULT_TEXT_COLOR = '#111827';
const DEFAULT_ACCENT_COLOR = '#2563eb';

@Injectable()
export class SiteContentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getConfig() {
    const config = await this.prisma.siteContentConfig.findUnique({
      where: { id: SITE_CONTENT_CONFIG_ID }
    });

    return this.toPublicConfig(config);
  }

  async updateConfig(adminUserId: string, body: SiteContentInput) {
    const input = this.parseInput(body);
    const existing = await this.prisma.siteContentConfig.findUnique({
      where: { id: SITE_CONTENT_CONFIG_ID }
    });

    const config = await this.prisma.siteContentConfig.upsert({
      where: { id: SITE_CONTENT_CONFIG_ID },
      update: {
        ...input,
        updatedByAdminId: adminUserId
      },
      create: {
        id: SITE_CONTENT_CONFIG_ID,
        ...input,
        updatedByAdminId: adminUserId
      }
    });

    await this.writeAdminAudit(
      adminUserId,
      existing ? this.auditSnapshot(existing) : null,
      this.auditSnapshot(config)
    );

    return this.toPublicConfig(config);
  }

  private parseInput(body: SiteContentInput) {
    const popupEnabled = this.optionalBoolean(body.popupEnabled);
    const popupTitle = this.optionalText(body.popupTitle, 'popupTitle', 120);
    const popupContent = this.optionalText(body.popupContent, 'popupContent', 2000);

    if (popupEnabled && (!popupTitle || !popupContent)) {
      throw new BadRequestException('popupTitle and popupContent are required when popup is enabled');
    }

    return {
      homeTitle: this.optionalText(body.homeTitle, 'homeTitle', 80),
      homeSubtitle: this.optionalText(body.homeSubtitle, 'homeSubtitle', 160),
      homeContent: this.optionalText(body.homeContent, 'homeContent', 1200),
      homeFontFamily: this.normalizeFontFamily(body.homeFontFamily),
      homeTextColor: this.normalizeColor(body.homeTextColor, DEFAULT_TEXT_COLOR, 'homeTextColor'),
      homeAccentColor: this.normalizeColor(body.homeAccentColor, DEFAULT_ACCENT_COLOR, 'homeAccentColor'),
      popupEnabled,
      popupTitle,
      popupContent,
      popupFontFamily: this.normalizeFontFamily(body.popupFontFamily),
      popupTextColor: this.normalizeColor(body.popupTextColor, DEFAULT_TEXT_COLOR, 'popupTextColor'),
      popupAccentColor: this.normalizeColor(body.popupAccentColor, DEFAULT_ACCENT_COLOR, 'popupAccentColor')
    };
  }

  private optionalText(value: unknown, field: string, maxLength: number) {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a string`);
    }
    const text = value.trim();
    if (!text) {
      return null;
    }
    if (text.length > maxLength) {
      throw new BadRequestException(`${field} must be ${maxLength} characters or fewer`);
    }
    return text;
  }

  private optionalBoolean(value: unknown) {
    if (value === undefined || value === null || value === '') {
      return false;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }
    throw new BadRequestException('popupEnabled must be a boolean');
  }

  private normalizeFontFamily(value: unknown) {
    if (value === undefined || value === null || value === '') {
      return 'system';
    }
    if (typeof value !== 'string') {
      throw new BadRequestException('font family must be a string');
    }
    const normalized = value.trim().toLowerCase();
    if (!FONT_FAMILIES.has(normalized)) {
      throw new BadRequestException('font family must be system, serif, rounded, or mono');
    }
    return normalized;
  }

  private normalizeColor(value: unknown, fallback: string, field: string) {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a hex color`);
    }
    const normalized = value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      throw new BadRequestException(`${field} must be a 6-digit hex color`);
    }
    return normalized.toLowerCase();
  }

  private toPublicConfig(config: SiteContentRecord | null) {
    const popupTitle = config?.popupTitle ?? null;
    const popupContent = config?.popupContent ?? null;
    const popupEnabled = Boolean(config?.popupEnabled && popupTitle && popupContent);

    return {
      id: SITE_CONTENT_CONFIG_ID,
      home: {
        title: config?.homeTitle ?? DEFAULT_HOME_TITLE,
        subtitle: config?.homeSubtitle ?? DEFAULT_HOME_SUBTITLE,
        content: config?.homeContent ?? null,
        fontFamily: config?.homeFontFamily ?? 'system',
        textColor: config?.homeTextColor ?? DEFAULT_TEXT_COLOR,
        accentColor: config?.homeAccentColor ?? DEFAULT_ACCENT_COLOR
      },
      popup: {
        enabled: popupEnabled,
        title: popupTitle,
        content: popupContent,
        fontFamily: config?.popupFontFamily ?? 'system',
        textColor: config?.popupTextColor ?? DEFAULT_TEXT_COLOR,
        accentColor: config?.popupAccentColor ?? DEFAULT_ACCENT_COLOR
      },
      updatedAt: config?.updatedAt.toISOString() ?? null
    };
  }

  private auditSnapshot(config: SiteContentRecord): Prisma.InputJsonObject {
    return {
      homeTitle: config.homeTitle,
      homeSubtitle: config.homeSubtitle,
      hasHomeContent: Boolean(config.homeContent),
      homeFontFamily: config.homeFontFamily,
      homeTextColor: config.homeTextColor,
      homeAccentColor: config.homeAccentColor,
      popupEnabled: config.popupEnabled,
      popupTitle: config.popupTitle,
      hasPopupContent: Boolean(config.popupContent),
      popupFontFamily: config.popupFontFamily,
      popupTextColor: config.popupTextColor,
      popupAccentColor: config.popupAccentColor
    };
  }

  private async writeAdminAudit(
    adminUserId: string,
    beforeSnapshot: Prisma.InputJsonObject | null,
    afterSnapshot: Prisma.InputJsonObject
  ) {
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action: 'site_content_config_updated',
        targetType: 'site_content_config',
        targetId: null,
        beforeSnapshot: beforeSnapshot ?? Prisma.JsonNull,
        afterSnapshot
      }
    });
  }
}
