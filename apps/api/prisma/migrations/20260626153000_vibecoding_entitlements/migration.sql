CREATE TYPE "VibeCodingEntitlementStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

CREATE TABLE "vibe_coding_entitlements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "source_recharge_code_id" UUID,
  "source_ai_recharge_order_id" UUID,
  "quota_hours" INTEGER NOT NULL,
  "quota_period_days" INTEGER NOT NULL,
  "token_quota" INTEGER NOT NULL,
  "used_token_quota" INTEGER NOT NULL DEFAULT 0,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "status" "VibeCodingEntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vibe_coding_entitlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vibe_coding_entitlements_quota_check" CHECK (
    "quota_hours" > 0
    AND "quota_period_days" > 0
    AND "token_quota" > 0
    AND "used_token_quota" >= 0
    AND "used_token_quota" <= "token_quota"
    AND "expires_at" > "starts_at"
  ),
  CONSTRAINT "vibe_coding_entitlements_source_check" CHECK (
    (
      "source_recharge_code_id" IS NOT NULL
      AND "source_ai_recharge_order_id" IS NULL
    )
    OR
    (
      "source_recharge_code_id" IS NULL
      AND "source_ai_recharge_order_id" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "vibe_coding_entitlements_source_recharge_code_id_key"
  ON "vibe_coding_entitlements"("source_recharge_code_id");

CREATE UNIQUE INDEX "vibe_coding_entitlements_source_ai_recharge_order_id_key"
  ON "vibe_coding_entitlements"("source_ai_recharge_order_id");

CREATE INDEX "vibe_coding_entitlements_user_status_expires_idx"
  ON "vibe_coding_entitlements"("user_id", "status", "expires_at");

CREATE INDEX "vibe_coding_entitlements_status_expires_idx"
  ON "vibe_coding_entitlements"("status", "expires_at");

ALTER TABLE "vibe_coding_entitlements"
  ADD CONSTRAINT "vibe_coding_entitlements_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vibe_coding_entitlements"
  ADD CONSTRAINT "vibe_coding_entitlements_source_recharge_code_id_fkey"
  FOREIGN KEY ("source_recharge_code_id") REFERENCES "recharge_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vibe_coding_entitlements"
  ADD CONSTRAINT "vibe_coding_entitlements_source_ai_recharge_order_id_fkey"
  FOREIGN KEY ("source_ai_recharge_order_id") REFERENCES "ai_recharge_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
