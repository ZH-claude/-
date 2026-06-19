const USD_UNIT_SCALE = 1_000_000;

export function formatBillingUsd(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-';
  }

  const amount = value / USD_UNIT_SCALE;
  const absAmount = Math.abs(amount);
  const fractionDigits = absAmount > 0 && absAmount < 1 ? 6 : 2;

  return `$${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(amount)}`;
}

export function formatBillingUsdForInput(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '';
  }

  const amount = value / USD_UNIT_SCALE;
  return amount.toFixed(6).replace(/\.?0+$/, '');
}

export function formatBillingUsdNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '';
  }

  return (value / USD_UNIT_SCALE).toFixed(6);
}

export function parseBillingUsdInput(value: string, fieldName = '额度') {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/^\$/, '').replace(/,/g, '');
  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return new Error(`${fieldName}必须是大于等于 0 的美元数字`);
  }

  const scaledValue = Math.round(numericValue * USD_UNIT_SCALE);
  if (!Number.isSafeInteger(scaledValue)) {
    return new Error(`${fieldName}超出可支持范围`);
  }

  return scaledValue;
}
