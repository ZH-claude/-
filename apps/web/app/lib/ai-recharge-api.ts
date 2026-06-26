import { createApiClientError } from './api-error-copy';
import { getLocalizedText, type LocaleTextSource } from './site-content-api';

export type AiRechargeProduct = {
  id: string;
  productKind: 'ai_recharge' | 'vibe_coding';
  title: string;
  platform: string;
  planName: string;
  durationDays: number | null;
  quotaHours: number | null;
  quotaPeriodDays: number | null;
  tokenQuota: number | null;
  priceCnyCents: number;
  description: string;
  purchaseNote: string | null;
  deliveryNote: string | null;
  sortOrder: number;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
  titleI18n?: LocaleTextSource;
  platformI18n?: LocaleTextSource;
  planNameI18n?: LocaleTextSource;
  descriptionI18n?: LocaleTextSource;
  purchaseNoteI18n?: LocaleTextSource;
  deliveryNoteI18n?: LocaleTextSource;
  i18n?: {
    title?: LocaleTextSource;
    platform?: LocaleTextSource;
    planName?: LocaleTextSource;
    description?: LocaleTextSource;
    purchaseNote?: LocaleTextSource;
    deliveryNote?: LocaleTextSource;
  };
  translations?: {
    title?: LocaleTextSource;
    platform?: LocaleTextSource;
    planName?: LocaleTextSource;
    description?: LocaleTextSource;
    purchaseNote?: LocaleTextSource;
    deliveryNote?: LocaleTextSource;
  };
  localized?: {
    title?: LocaleTextSource;
    platform?: LocaleTextSource;
    planName?: LocaleTextSource;
    description?: LocaleTextSource;
    purchaseNote?: LocaleTextSource;
    deliveryNote?: LocaleTextSource;
  };
};

export type AiRechargeOrder = {
  id: string;
  orderNo: string;
  userId: string;
  productId: string;
  productTitle: string;
  platform: string;
  planName: string;
  amountCnyCents: number;
  customerAccount: string;
  customerContact: string;
  customerNote: string | null;
  merchantNote: string | null;
  status: 'pending' | 'processing' | 'fulfilled' | 'canceled' | 'failed';
  createdAt: string;
  updatedAt: string;
};

export type AiRechargePageConfig = {
  id: string;
  introTitle: string | null;
  introContent: string | null;
  introImageDataUrl: string | null;
  introTitleI18n?: LocaleTextSource;
  introContentI18n?: LocaleTextSource;
  i18n?: {
    introTitle?: LocaleTextSource;
    introContent?: LocaleTextSource;
  };
  translations?: {
    introTitle?: LocaleTextSource;
    introContent?: LocaleTextSource;
  };
  localized?: {
    introTitle?: LocaleTextSource;
    introContent?: LocaleTextSource;
  };
  updatedAt: string | null;
};

type ProductListResponse = {
  items: AiRechargeProduct[];
};

type OrderListResponse = {
  items: AiRechargeOrder[];
};

type OrderResponse = {
  order: AiRechargeOrder;
};

const API_BASE_URL = '/api';

export async function listAiRechargeProducts(language?: string) {
  return request<ProductListResponse>('/ai-recharge/products', { language });
}

export async function getAiRechargePageConfig(language?: string) {
  return request<AiRechargePageConfig>('/ai-recharge/page-config', { language });
}

export async function listAiRechargeOrders(language?: string) {
  return request<OrderListResponse>('/ai-recharge/orders', { language });
}

export async function createAiRechargeOrder(payload: {
  productId: string;
  customerAccount: string;
  customerContact: string;
  customerNote?: string;
}, language?: string) {
  return request<OrderResponse>('/ai-recharge/orders', {
    method: 'POST',
    body: payload,
    language
  });
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
    language?: string;
  } = {}
) {
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  if (options.language) {
    headers['Accept-Language'] = options.language;
  }

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE_URL}${withLanguage(path, options.language)}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw createApiClientError(options.language, response.status, data);
  }

  const data = await response.json().catch(() => null);
  return data as T;
}

function withLanguage(path: string, language?: string) {
  if (!language) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${new URLSearchParams({ language }).toString()}`;
}

export function getLocalizedAiRechargeProductField(
  product: AiRechargeProduct,
  field: 'title' | 'platform' | 'planName' | 'description' | 'purchaseNote' | 'deliveryNote',
  language: string
) {
  const fieldMap = field === 'title'
    ? {
      base: product.title,
      raw: product.titleI18n,
      i18n: product.i18n?.title,
      translations: product.translations?.title,
      localized: product.localized?.title
    }
    : field === 'platform'
      ? {
          base: product.platform,
          raw: product.platformI18n,
          i18n: product.i18n?.platform,
          translations: product.translations?.platform,
          localized: product.localized?.platform
        }
      : field === 'planName'
        ? {
            base: product.planName,
            raw: product.planNameI18n,
            i18n: product.i18n?.planName,
            translations: product.translations?.planName,
            localized: product.localized?.planName
          }
        : field === 'description'
          ? {
              base: product.description,
              raw: product.descriptionI18n,
              i18n: product.i18n?.description,
              translations: product.translations?.description,
              localized: product.localized?.description
            }
          : field === 'purchaseNote'
            ? {
                base: product.purchaseNote,
                raw: product.purchaseNoteI18n,
                i18n: product.i18n?.purchaseNote,
                translations: product.translations?.purchaseNote,
                localized: product.localized?.purchaseNote
              }
            : {
                base: product.deliveryNote,
                raw: product.deliveryNoteI18n,
                i18n: product.i18n?.deliveryNote,
                translations: product.translations?.deliveryNote,
                localized: product.localized?.deliveryNote
              };

  const candidates = [fieldMap.raw, fieldMap.i18n, fieldMap.translations, fieldMap.localized];
  for (const candidate of candidates) {
    const localized = getLocalizedText(candidate, language, null);
    if (localized) {
      return localized;
    }
  }

  return fieldMap.base;
}

export function getLocalizedAiRechargePageField(
  config: AiRechargePageConfig,
  field: 'introTitle' | 'introContent',
  language: string
) {
  const fieldMap =
    field === 'introTitle'
      ? {
          base: config.introTitle,
          raw: config.introTitleI18n,
          i18n: config.i18n?.introTitle,
          translations: config.translations?.introTitle,
          localized: config.localized?.introTitle
        }
      : {
          base: config.introContent,
          raw: config.introContentI18n,
          i18n: config.i18n?.introContent,
          translations: config.translations?.introContent,
          localized: config.localized?.introContent
        };

  for (const candidate of [fieldMap.raw, fieldMap.i18n, fieldMap.translations, fieldMap.localized]) {
    const localized = getLocalizedText(candidate, language, null);
    if (localized) {
      return localized;
    }
  }

  return fieldMap.base;
}
