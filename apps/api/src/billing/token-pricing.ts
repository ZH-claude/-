export const BASE_TOKEN_CNY_CENTS_PER_MILLION = 800;
export const DEFAULT_RELAY_MARGIN_PERCENT = 10;
export const DEFAULT_USD_TO_CNY_RATE = 7.2;
export const USD_UNITS_PER_USD = 1_000_000;
export const TOKENS_PER_MILLION = 1_000_000;
export const TOKENS_PER_1K = 1_000;

export type TokenPricingCurrency = 'CNY' | 'USD';

export function deepSeekBaseUsdUnitsPer1k(usdToCnyRate = DEFAULT_USD_TO_CNY_RATE) {
  assertFinitePositive(usdToCnyRate, 'usdToCnyRate');
  const baseCnyPerMillion = BASE_TOKEN_CNY_CENTS_PER_MILLION / 100;
  const baseUsdPerMillion = baseCnyPerMillion / usdToCnyRate;
  return usdPerMillionToUsdUnitsPer1k(baseUsdPerMillion);
}

export function calculateRelayUsdPricing(input: {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  currency: TokenPricingCurrency;
  usdToCnyRate?: number;
  marginPercent?: number;
}) {
  assertFiniteNonNegative(input.inputPricePerMillion, 'inputPricePerMillion');
  assertFiniteNonNegative(input.outputPricePerMillion, 'outputPricePerMillion');

  const exchangeRate = normalizeExchangeRate(input.usdToCnyRate);
  const marginPercent = normalizeMarginPercent(input.marginPercent ?? DEFAULT_RELAY_MARGIN_PERCENT);
  const marginFactor = 1 + marginPercent / 100;

  const inputUsdPerMillion =
    input.currency === 'CNY' ? input.inputPricePerMillion / exchangeRate : input.inputPricePerMillion;
  const outputUsdPerMillion =
    input.currency === 'CNY' ? input.outputPricePerMillion / exchangeRate : input.outputPricePerMillion;

  return {
    currency: input.currency,
    exchangeRate,
    marginPercent,
    inputUsdPerMillion: inputUsdPerMillion * marginFactor,
    outputUsdPerMillion: outputUsdPerMillion * marginFactor,
    inputUsdUnitsPer1k: usdPerMillionToUsdUnitsPer1k(inputUsdPerMillion * marginFactor),
    outputUsdUnitsPer1k: usdPerMillionToUsdUnitsPer1k(outputUsdPerMillion * marginFactor)
  };
}

export function usdPerMillionToUsdUnitsPer1k(value: number) {
  assertFiniteNonNegative(value, 'usdPerMillion');
  return ceilUsdUnits(value * (USD_UNITS_PER_USD / TOKENS_PER_MILLION) * TOKENS_PER_1K);
}

function ceilUsdUnits(value: number) {
  return Math.ceil(Number(value.toFixed(8)));
}

function normalizeExchangeRate(value: number | undefined) {
  if (value === undefined) {
    return DEFAULT_USD_TO_CNY_RATE;
  }

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
