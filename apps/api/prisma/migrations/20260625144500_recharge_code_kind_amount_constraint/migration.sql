ALTER TABLE "recharge_codes"
  DROP CONSTRAINT IF EXISTS "recharge_codes_amount_positive_check";

ALTER TABLE "recharge_codes"
  ADD CONSTRAINT "recharge_codes_kind_amount_check"
  CHECK (
    (
      "kind" = 'BALANCE'
      AND "amount_cents" > 0
      AND "quota_hours" IS NULL
      AND "quota_period_days" IS NULL
      AND "token_quota" IS NULL
    )
    OR
    (
      "kind" = 'VIBE_CODING'
      AND "amount_cents" = 0
      AND "quota_hours" IS NOT NULL
      AND "quota_period_days" IS NOT NULL
      AND "token_quota" IS NOT NULL
    )
  );
