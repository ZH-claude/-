export const BASE_TOKEN_RECHARGE_RATE = {
  cnyCents: 100,
  baseTokens: 1_000_000
} as const;

export const CNY_CENTS_PER_CNY = 100;
export const BASE_TOKEN_UNITS_PER_CNY =
  (BASE_TOKEN_RECHARGE_RATE.baseTokens * CNY_CENTS_PER_CNY) / BASE_TOKEN_RECHARGE_RATE.cnyCents;

export const MAX_RECHARGE_FACE_VALUE_CNY_CENTS = 200_000;
export const MAX_RECHARGE_BASE_TOKENS = 2_000_000_000;

export function cnyCentsToBaseTokens(cnyCents: number) {
  const baseTokens = Math.round((cnyCents * BASE_TOKEN_RECHARGE_RATE.baseTokens) / BASE_TOKEN_RECHARGE_RATE.cnyCents);

  if (!Number.isSafeInteger(baseTokens) || baseTokens < 1 || baseTokens > MAX_RECHARGE_BASE_TOKENS) {
    throw new Error('Base token amount is outside the safe integer range');
  }

  return baseTokens;
}

export function baseTokenRechargeRateSnapshot() {
  return {
    faceValueCnyCents: BASE_TOKEN_RECHARGE_RATE.cnyCents,
    baseTokens: BASE_TOKEN_RECHARGE_RATE.baseTokens
  };
}
