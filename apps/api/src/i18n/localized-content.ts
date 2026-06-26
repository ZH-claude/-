import { BadRequestException } from '@nestjs/common';

export type TranslationRules = Record<string, number>;

export type TranslationScalar = string | boolean;

type TranslationRecord = Record<string, Record<string, TranslationScalar>>;

const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;
const TRANSLATION_STATUS_VALUES = new Set(['machine_draft', 'human_reviewed', 'manual_locked']);
const TRANSLATION_META_TEXT_LIMITS: Record<string, number> = {
  _source: 80,
  _updatedAt: 64
};
const SOURCE_FALLBACK_DRAFT_SOURCES = new Set(['source_fallback_draft', 'provider_disabled', 'provider_not_configured']);

export function getRequestedLanguage(language: unknown, acceptLanguage: unknown) {
  const explicitLanguage = readFirstString(language);
  if (explicitLanguage) {
    return normalizeLanguageCode(explicitLanguage);
  }

  const acceptLanguageHeader = readFirstString(acceptLanguage);
  if (!acceptLanguageHeader) {
    return null;
  }

  const firstCandidate = acceptLanguageHeader.split(',')[0]?.trim();
  return firstCandidate ? normalizeLanguageCode(firstCandidate.split(';')[0]?.trim()) : null;
}

export function resolveLocalizedText(
  translations: unknown,
  language: string | null | undefined,
  field: string,
  fallback: string | null
) {
  const translation = findLocalizedField(translations, language, field);
  if (translation) {
    return translation;
  }

  if (getLanguageBase(language) !== 'zh') {
    const englishFallback = findLocalizedField(translations, 'en-US', field);
    if (englishFallback) {
      return englishFallback;
    }
  }

  return fallback;
}

export function normalizeTranslations(value: unknown, rules: TranslationRules, fieldName = 'translations') {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  if (!isRecord(value)) {
    throw new BadRequestException(`${fieldName} must be an object`);
  }

  const normalized: TranslationRecord = {};
  for (const [languageKey, rawFields] of Object.entries(value)) {
    const language = normalizeLanguageCode(languageKey);
    if (!language || !LANGUAGE_CODE_PATTERN.test(language)) {
      throw new BadRequestException(`${fieldName}.${languageKey} must be a language code`);
    }
    if (!isRecord(rawFields)) {
      throw new BadRequestException(`${fieldName}.${language} must be an object`);
    }

    const nextFields: Record<string, TranslationScalar> = {};
    for (const [field, maxLength] of Object.entries(rules)) {
      const rawValue = rawFields[field];
      if (rawValue === undefined || rawValue === null || rawValue === '') {
        continue;
      }
      if (typeof rawValue !== 'string') {
        throw new BadRequestException(`${fieldName}.${language}.${field} must be a string`);
      }
      const text = rawValue.trim();
      if (!text) {
        continue;
      }
      if (text.length > maxLength) {
        throw new BadRequestException(`${fieldName}.${language}.${field} must be ${maxLength} characters or fewer`);
      }
      nextFields[field] = text;
    }

    for (const [field, rawValue] of Object.entries(rawFields)) {
      if (!field.startsWith('_') || field in rules) {
        continue;
      }

      if (field === '_locked') {
        const locked = normalizeMetadataBoolean(rawValue, `${fieldName}.${language}.${field}`);
        if (locked !== null) {
          nextFields[field] = locked;
        }
        continue;
      }

      if (field === '_status') {
        const status = normalizeMetadataStatus(rawValue, `${fieldName}.${language}.${field}`);
        if (status) {
          nextFields[field] = status;
        }
        continue;
      }

      const textLimit = TRANSLATION_META_TEXT_LIMITS[field];
      if (textLimit) {
        const text = normalizeMetadataText(rawValue, `${fieldName}.${language}.${field}`, textLimit);
        if (text) {
          nextFields[field] = text;
        }
      }
    }

    if (Object.keys(nextFields).length > 0) {
      normalized[language] = nextFields;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeMetadataBoolean(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === '') {
    return null;
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
  throw new BadRequestException(`${fieldName} must be a boolean`);
}

function normalizeMetadataStatus(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(`${fieldName} must be a string`);
  }
  const status = value.trim().toLowerCase();
  if (!TRANSLATION_STATUS_VALUES.has(status)) {
    throw new BadRequestException(`${fieldName} must be machine_draft, human_reviewed, or manual_locked`);
  }
  return status;
}

function normalizeMetadataText(value: unknown, fieldName: string, maxLength: number) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(`${fieldName} must be a string`);
  }
  const text = value.trim();
  if (!text) {
    return null;
  }
  if (text.length > maxLength) {
    throw new BadRequestException(`${fieldName} must be ${maxLength} characters or fewer`);
  }
  return text;
}

function findLocalizedField(translations: unknown, language: string | null | undefined, field: string) {
  if (!language || !isRecord(translations)) {
    return null;
  }

  for (const languageKey of getLanguageCandidates(language)) {
    const languageValue = getUnknownValue(translations, languageKey);
    if (field === 'title' && typeof languageValue === 'string' && languageValue.trim()) {
      return languageValue;
    }

    const languageRecord = getRecordValue(translations, languageKey);
    if (!languageRecord) {
      continue;
    }
    if (isSourceFallbackDraftRecord(languageRecord)) {
      continue;
    }

    const value = languageRecord[field];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return null;
}

function getLanguageCandidates(language: string) {
  const normalized = normalizeLanguageCode(language);
  if (!normalized) {
    return [];
  }

  const baseLanguage = normalized.split('-')[0];
  const candidates = [normalized, normalized.toLowerCase(), baseLanguage, baseLanguage.toLowerCase()];
  if (baseLanguage === 'zh') {
    const normalizedLower = normalized.toLowerCase();
    if (normalizedLower === 'zh') {
      candidates.push('zh-CN', 'zh-cn', 'zh-TW', 'zh-tw', 'zh');
    } else if (
      normalizedLower.includes('-tw') ||
      normalizedLower.includes('-hk') ||
      normalizedLower.includes('-mo') ||
      normalizedLower.includes('-hant')
    ) {
      candidates.push('zh-TW', 'zh-tw', 'zh');
    } else {
      candidates.push('zh-CN', 'zh-cn', 'zh');
    }
  }

  return Array.from(new Set(candidates));
}

function getLanguageBase(language: string | null | undefined) {
  const normalized = typeof language === 'string' ? normalizeLanguageCode(language) : null;
  return normalized?.split('-')[0] ?? null;
}

function getUnknownValue(record: Record<string, unknown>, key: string) {
  if (key in record) {
    return record[key];
  }

  const matchedKey = Object.keys(record).find((nextKey) => nextKey.toLowerCase() === key.toLowerCase());
  return matchedKey ? record[matchedKey] : null;
}

function getRecordValue(record: Record<string, unknown>, key: string) {
  const exactValue = getUnknownValue(record, key);
  if (isRecord(exactValue)) {
    return exactValue;
  }
  return null;
}

export function isSourceFallbackDraftRecord(record: Record<string, unknown>) {
  const status = typeof record._status === 'string' ? record._status.trim().toLowerCase() : '';
  const source = typeof record._source === 'string' ? record._source.trim().toLowerCase() : '';
  return status === 'machine_draft' && SOURCE_FALLBACK_DRAFT_SOURCES.has(source);
}

function normalizeLanguageCode(value: string | undefined) {
  const text = value?.trim();
  if (!text) {
    return null;
  }

  const [base, ...regions] = text.replace(/_/g, '-').split('-');
  if (!base) {
    return null;
  }

  return [base.toLowerCase(), ...regions.map((region) => region.toUpperCase())].join('-');
}

function readFirstString(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null;
  }
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
