export const BILLING_FORMULA =
  'ceil(((promptTokens * inputPriceCentsPer1k + completionTokens * outputPriceCentsPer1k) / 1000) * modelMultiplier * groupMultiplier)';

export const BILLING_ROUNDING = 'ceil_to_integer_cents';
