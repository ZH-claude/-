export const BILLING_FORMULA =
  'ceil(((promptTokens * inputBaseTokensPer1k + completionTokens * outputBaseTokensPer1k) / 1000) * modelMultiplier * groupMultiplier)';

export const BILLING_ROUNDING = 'ceil_to_integer_base_tokens';
