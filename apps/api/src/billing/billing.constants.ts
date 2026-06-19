export const BILLING_FORMULA =
  'ceil(((promptTokens * inputUsdUnitsPer1k + completionTokens * outputUsdUnitsPer1k) / 1000) * priceMultiplier * groupMultiplier)';

export const BILLING_ROUNDING = 'ceil_to_integer_usd_units';
