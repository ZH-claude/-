CREATE TYPE "RechargeCodeStatus" AS ENUM ('UNUSED', 'USED', 'DISABLED');

ALTER TABLE "wallet_transactions" ADD COLUMN "recharge_code_id" UUID;

CREATE TABLE "recharge_codes" (
    "id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "RechargeCodeStatus" NOT NULL DEFAULT 'UNUSED',
    "created_by_admin_id" UUID NOT NULL,
    "used_by_user_id" UUID,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recharge_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recharge_codes_amount_positive_check" CHECK ("amount_cents" > 0),
    CONSTRAINT "recharge_codes_used_state_check" CHECK (
        ("status" = 'USED' AND "used_by_user_id" IS NOT NULL AND "used_at" IS NOT NULL) OR
        ("status" <> 'USED' AND "used_by_user_id" IS NULL AND "used_at" IS NULL)
    )
);

CREATE UNIQUE INDEX "recharge_codes_code_hash_key" ON "recharge_codes"("code_hash");
CREATE INDEX "recharge_codes_status_created_at_idx" ON "recharge_codes"("status", "created_at");
CREATE INDEX "recharge_codes_created_by_admin_id_idx" ON "recharge_codes"("created_by_admin_id", "created_at");
CREATE INDEX "recharge_codes_used_by_user_id_idx" ON "recharge_codes"("used_by_user_id", "used_at");

CREATE UNIQUE INDEX "wallet_transactions_recharge_code_id_key" ON "wallet_transactions"("recharge_code_id");

ALTER TABLE "recharge_codes" ADD CONSTRAINT "recharge_codes_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recharge_codes" ADD CONSTRAINT "recharge_codes_used_by_user_id_fkey" FOREIGN KEY ("used_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_recharge_code_id_fkey" FOREIGN KEY ("recharge_code_id") REFERENCES "recharge_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_recharge_shape_check" CHECK (
    "type" <> 'RECHARGE' OR
    ("amount_cents" > 0 AND "recharge_code_id" IS NOT NULL AND "usage_event_id" IS NULL)
);
