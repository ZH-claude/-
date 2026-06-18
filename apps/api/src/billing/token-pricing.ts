export const BASE_TOKEN_CNY_CENTS_PER_MILLION = 800;
export const DEFAULT_RELAY_MARGIN_PERCENT = 10;
export const BASE_TOKENS_PER_1K_AT_ONE_X = 1000;

export type TokenPricingCurrency = 'CNY' | 'USD';

export function multiplierToBaseTokensPer1k(multiplier: number) {
  assertFinitePositive(multiplier, 'multiplier');
  return ceilTokenAmount(multiplier * BASE_TOKENS_PER_1K_AT_ONE_X);
}

export function calculateRelayTokenPricing(input: {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  currency: TokenPricingCurrency;
  usdToCnyRate?: number;
  marginPercent?: number;
}) {
  assertFiniteNonNegative(input.inputPricePerMillion, 'inputPricePerMillion');
  assertFiniteNonNegative(input.outputPricePerMillion, 'outputPricePerMillion');

  const exchangeRate = input.currency === 'USD' ? normalizeExchangeRate(input.usdToCnyRate) : 1;
  const marginPercent = normalizeMarginPercent(input.marginPercent ?? DEFAULT_RELAY_MARGIN_PERCENT);
  const marginFactor = 1 + marginPercent / 100;
  const baseCnyPerMillion = BASE_TOKEN_CNY_CENTS_PER_MILLION / 100;

  const inputMultiplier = (input.inputPricePerMillion * exchangeRate * marginFactor) / baseCnyPerMillion;
  const outputMultiplier = (input.outputPricePerMillion * exchangeRate * marginFactor) / baseCnyPerMillion;

  return {
    currency: input.currency,
    exchangeRate,
    marginPercent,
    inputMultiplier,
    outputMultiplier,
    inputBaseTokensPer1k: multiplierToBaseTokensPer1k(inputMultiplier),
    outputBaseTokensPer1k: multiplierToBaseTokensPer1k(outputMultiplier)
  };
}

function ceilTokenAmount(value: number) {
  return Math.ceil(Number(value.toFixed(8)));
}

function normalizeExchangeRate(value: number | undefined) {
  assertFinitePositive(value, 'usdToCnyRate');
  return value;
}

function normalizeMarginPercent(value: number) {
  assertFiniteNonNegative(value, 'marginPercent');
  if (value > 1000) {
    throw new Error('marginPercent is too large');
  }

  return value;
}

function assertFinitePositive(value: number | undefined, fieldName: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
}

function assertFiniteNonNegative(value: number, fieldName: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }
}
