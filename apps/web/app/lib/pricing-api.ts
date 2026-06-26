import { createApiClientError } from './api-error-copy';

export type PricingModel = {
  model: string;
  displayName: string | null;
  inputPriceCentsPer1k: number;
  outputPriceCentsPer1k: number;
  modelMultiplier: string;
  groupMultiplier: string;
  supportsStream: boolean;
};

export type PricingResponse = {
  group: {
    code: string;
    name: string;
    multiplier: string;
  };
  currency: 'USD' | string;
  displayCurrency: 'USD' | string;
  settlementCurrency: 'CNY' | string;
  usdToCnyRate: number;
  unit: 'usd_per_1m_tokens' | string;
  billingFormula: {
    totalCostCnyUnits: string;
    rounding: string;
  };
  models: PricingModel[];
};

const API_BASE_URL = '/api';

export async function getModelPricing(language?: string) {
  return request<PricingResponse>(withLanguage('/pricing/models', language), language);
}

async function request<T>(path: string, language?: string) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(language ? { 'Accept-Language': language } : {})
    },
    credentials: 'include'
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw createApiClientError(language, response.status, data);
  }

  return data as T;
}

function withLanguage(path: string, language?: string) {
  if (!language) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${new URLSearchParams({ language }).toString()}`;
}
