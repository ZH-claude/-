const BILLING_UNIT_SCALE = 1_000_000;
const TOKENS_PER_1M_TO_1K_RATIO = 1000;

export function formatBillingCny(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-';
  }

  const amount = value / BILLING_UNIT_SCALE;
  const absAmount = Math.abs(amount);
  const fractionDigits = absAmount > 0 && absAmount < 1 ? 6 : 2;

  return `CNY ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(amount)}`;
}

export function formatBillingCnyForInput(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '';
  }

  const amount = value / BILLING_UNIT_SCALE;
  return amount.toFixed(6).replace(/\.?0+$/, '');
}

export function formatBillingCnyNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '';
  }

  return (value / BILLING_UNIT_SCALE).toFixed(6);
}

export function parseBillingCnyInput(value: string, fieldName = 'Amount') {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = stripCurrencyPrefix(trimmed);
  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return new Error(`${fieldName} must be a non-negative CNY amount`);
  }

  const scaledValue = Math.round(numericValue * BILLING_UNIT_SCALE);
  if (!Number.isSafeInteger(scaledValue)) {
    return new Error(`${fieldName} exceeds the supported amount range`);
  }

  return scaledValue;
}

export function formatMoneyCny(cents: number | null | undefined) {
  if (cents === null || cents === undefined) {
    return '-';
  }

  return `CNY ${(cents / 100).toFixed(2)}`;
}

export const formatBillingUsd = formatBillingCny;
export const formatBillingUsdForInput = formatBillingCnyForInput;
export const formatBillingUsdNumber = formatBillingCnyNumber;
export const parseBillingUsdInput = parseBillingCnyInput;

export function usdUnitsPer1kToUsdPerMillion(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return value / TOKENS_PER_1M_TO_1K_RATIO;
}

export function formatUsdPerMillionFromUnits(value: number | null | undefined) {
  const usdPerMillion = usdUnitsPer1kToUsdPerMillion(value);
  if (usdPerMillion === null) {
    return '-';
  }

  return `$ ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  }).format(usdPerMillion)} / 1M tokens`;
}

export function formatUsdPerMillionInputFromUnits(value: number | null | undefined) {
  const usdPerMillion = usdUnitsPer1kToUsdPerMillion(value);
  if (usdPerMillion === null) {
    return '';
  }

  return usdPerMillion.toFixed(4).replace(/\.?0+$/, '');
}

export function parseUsdPerMillionToUnits(value: string, fieldName = 'USD price') {
  const trimmed = value.trim();
  if (!trimmed) {
    return new Error(`${fieldName} cannot be empty`);
  }

  const normalized = stripCurrencyPrefix(trimmed);
  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return new Error(`${fieldName} must be a non-negative USD number`);
  }

  const scaledRawValue = numericValue * TOKENS_PER_1M_TO_1K_RATIO;
  const scaledValue = Math.round(scaledRawValue);
  if (Math.abs(scaledRawValue - scaledValue) > 1e-8) {
    return new Error(`${fieldName} minimum precision is 0.001 USD / 1M tokens`);
  }

  if (!Number.isSafeInteger(scaledValue)) {
    return new Error(`${fieldName} exceeds the supported price range`);
  }

  return scaledValue;
}

function stripCurrencyPrefix(value: string) {
  return value
    .replace(/^(?:CNY|RMB|USD)\s*/i, '')
    .replace(/^[\u00a5$]\s*/, '')
    .replace(/,/g, '');
}
