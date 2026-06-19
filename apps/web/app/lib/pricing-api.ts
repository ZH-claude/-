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
  unit: 'usd_units_per_1k_tokens' | string;
  billingFormula: {
    totalCostUsdUnits: string;
    rounding: string;
  };
  models: PricingModel[];
};

const API_BASE_URL = '/api';

export async function getModelPricing() {
  return request<PricingResponse>('/pricing/models');
}

async function request<T>(path: string) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    credentials: 'include'
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : `请求失败：${response.status}`;
    throw new Error(`${response.status}: ${message}`);
  }

  return data as T;
}
