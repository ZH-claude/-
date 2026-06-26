CREATE TYPE "RechargeCodeKind" AS ENUM ('BALANCE', 'VIBE_CODING');

ALTER TABLE "recharge_codes"
  ADD COLUMN "kind" "RechargeCodeKind" NOT NULL DEFAULT 'BALANCE',
  ADD COLUMN "quota_hours" INTEGER,
  ADD COLUMN "quota_period_days" INTEGER,
  ADD COLUMN "token_quota" INTEGER;

CREATE INDEX "recharge_codes_kind_status_created_at_idx"
  ON "recharge_codes"("kind", "status", "created_at");
