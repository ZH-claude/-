export const BILLING_FORMULA =
  'ceil(((((promptTokens * inputUsdUnitsPer1k + completionTokens * outputUsdUnitsPer1k) / 1000) * groupMultiplier) * usdToCnyRate * cnyBillingUnitsPerCny) / usdUnitsPerUsd)';

export const BILLING_ROUNDING = 'ceil_to_integer_cny_billing_unit';
