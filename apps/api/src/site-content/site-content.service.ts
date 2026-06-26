import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { resolveAutoTranslatedFields } from '../i18n/auto-translate';
import { normalizeTranslations, resolveLocalizedText } from '../i18n/localized-content';
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
  translations?: unknown;
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
  translations: unknown;
  updatedAt: Date;
};

const SITE_CONTENT_CONFIG_ID = 'default';
const FONT_FAMILIES = new Set(['system', 'serif', 'rounded', 'mono']);
const DEFAULT_HOME_TITLE = '蔚蓝星球中转站';
const DEFAULT_HOME_SUBTITLE = '智能服务中转后台';
const DEFAULT_HOME_TITLE_TRANSLATIONS = {
  'zh-CN': DEFAULT_HOME_TITLE,
  'zh-TW': '蔚藍星球中轉站',
  'en-US': 'Azure Planet Relay'
};
const DEFAULT_HOME_SUBTITLE_TRANSLATIONS = {
  'zh-CN': DEFAULT_HOME_SUBTITLE,
  'zh-TW': '智慧服務中轉後台',
  'en-US': 'AI service relay console'
};
const DEFAULT_TEXT_COLOR = '#111827';
const DEFAULT_ACCENT_COLOR = '#2563eb';
const SITE_CONTENT_TRANSLATION_RULES = {
  homeTitle: 80,
  homeSubtitle: 160,
  homeContent: 1200,
  popupTitle: 120,
  popupContent: 2000
};

@Injectable()
export class SiteContentService {
  private readonly logger = new Logger(SiteContentService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getConfig(language?: string | null, options: { includeTranslations?: boolean } = {}) {
    const config = await this.prisma.siteContentConfig.findUnique({
      where: { id: SITE_CONTENT_CONFIG_ID }
    });

    return this.toPublicConfig(config, language, options);
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

    return this.toPublicConfig(config, null, { includeTranslations: true });
  }

  private parseInput(body: SiteContentInput) {
    const popupEnabled = this.optionalBoolean(body.popupEnabled);
    const popupTitle = this.optionalText(body.popupTitle, 'popupTitle', 120);
    const popupContent = this.optionalText(body.popupContent, 'popupContent', 2000);

    if (popupEnabled && (!popupTitle || !popupContent)) {
      throw new BadRequestException('popupTitle and popupContent are required when popup is enabled');
    }

    const translations = normalizeTranslations(body.translations, SITE_CONTENT_TRANSLATION_RULES);

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
      popupAccentColor: this.normalizeColor(body.popupAccentColor, DEFAULT_ACCENT_COLOR, 'popupAccentColor'),
      ...(translations !== undefined ? { translations: translations ?? Prisma.DbNull } : {})
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

  private async toPublicConfig(
    config: SiteContentRecord | null,
    language?: string | null,
    options: { includeTranslations?: boolean } = {}
  ) {
    const localized = await this.resolveLocalizedSiteContent(config, language);
    const popupTitle = localized.popupTitle;
    const popupContent = localized.popupContent;
    const popupEnabled = Boolean(config?.popupEnabled && popupTitle && popupContent);

    const response = {
      id: SITE_CONTENT_CONFIG_ID,
      home: {
        title: localized.homeTitle,
        subtitle: localized.homeSubtitle,
        content: localized.homeContent,
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

    return options.includeTranslations
      ? {
          ...response,
          translations: localized.translations
        }
      : response;
  }

  private async resolveLocalizedSiteContent(config: SiteContentRecord | null, language?: string | null) {
    const fallbackFields = {
      homeTitle: config?.homeTitle ?? getDefaultText(DEFAULT_HOME_TITLE_TRANSLATIONS, language),
      homeSubtitle: config?.homeSubtitle ?? getDefaultText(DEFAULT_HOME_SUBTITLE_TRANSLATIONS, language),
      homeContent: config?.homeContent ?? null,
      popupTitle: config?.popupTitle ?? null,
      popupContent: config?.popupContent ?? null
    };
    const glossary = await this.getActiveTranslationGlossaryMap();
    const localized = await resolveAutoTranslatedFields({
      translations: config?.translations,
      language,
      fields: fallbackFields,
      maxLengths: SITE_CONTENT_TRANSLATION_RULES,
      glossary
    });

    if (localized.errors.length > 0) {
      this.logger.warn(
        `Auto translation skipped for site content (${language ?? 'default'}): ${localized.errors.join('; ')}`
      );
    }
    if (config && localized.changed && localized.translations) {
      await this.persistSiteContentTranslations(config.updatedAt, localized.translations, language);
    }

    return {
      homeTitle:
        localized.values.homeTitle ??
        resolveLocalizedText(config?.translations, language, 'homeTitle', fallbackFields.homeTitle),
      homeSubtitle:
        localized.values.homeSubtitle ??
        resolveLocalizedText(config?.translations, language, 'homeSubtitle', fallbackFields.homeSubtitle),
      homeContent:
        localized.values.homeContent ??
        resolveLocalizedText(config?.translations, language, 'homeContent', fallbackFields.homeContent),
      popupTitle:
        localized.values.popupTitle ??
        resolveLocalizedText(config?.translations, language, 'popupTitle', fallbackFields.popupTitle),
      popupContent:
        localized.values.popupContent ??
        resolveLocalizedText(config?.translations, language, 'popupContent', fallbackFields.popupContent),
      translations: localized.translations ?? config?.translations ?? null
    };
  }

  private async getActiveTranslationGlossaryMap() {
    const rows = await this.prisma.translationGlossaryTerm.findMany({
      where: { isActive: true },
      select: { sourceTerm: true, replacementTerm: true },
      orderBy: { sourceTerm: 'asc' },
      take: 500
    });

    return Object.fromEntries(
      rows
        .map((row) => [row.sourceTerm.trim(), row.replacementTerm.trim()] as const)
        .filter(([sourceTerm, replacementTerm]) => sourceTerm.length > 0 && replacementTerm.length > 0)
        .sort(([left], [right]) => right.length - left.length)
    );
  }

  private async persistSiteContentTranslations(
    currentUpdatedAt: Date,
    translations: Prisma.InputJsonValue,
    language?: string | null
  ) {
    try {
      await this.prisma.siteContentConfig.updateMany({
        where: { id: SITE_CONTENT_CONFIG_ID, updatedAt: currentUpdatedAt },
        data: { translations, updatedAt: currentUpdatedAt }
      });
    } catch (error) {
      this.logger.warn(
        `Failed to cache site content translation (${language ?? 'default'}): ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    }
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
      hasTranslations: Boolean(config.translations),
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

function getDefaultText(texts: Record<'zh-CN' | 'zh-TW' | 'en-US', string>, language?: string | null) {
  const normalized = language?.toLowerCase() ?? '';
  if (normalized.startsWith('zh-tw') || normalized.startsWith('zh-hk') || normalized.startsWith('zh-mo')) {
    return texts['zh-TW'];
  }
  if (normalized.startsWith('zh')) {
    return texts['zh-CN'];
  }
  return texts['en-US'];
}
