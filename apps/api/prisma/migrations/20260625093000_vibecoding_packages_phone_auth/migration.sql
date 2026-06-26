CREATE TYPE "AiRechargeProductKind" AS ENUM ('AI_RECHARGE', 'VIBE_CODING');

ALTER TABLE "users" ADD COLUMN "phone_number" TEXT;
ALTER TABLE "users" ADD COLUMN "phone_verified_at" TIMESTAMP(3);

ALTER TABLE "ai_recharge_products" ADD COLUMN "product_kind" "AiRechargeProductKind" NOT NULL DEFAULT 'AI_RECHARGE';
ALTER TABLE "ai_recharge_products" ADD COLUMN "quota_hours" INTEGER;
ALTER TABLE "ai_recharge_products" ADD COLUMN "quota_period_days" INTEGER;
ALTER TABLE "ai_recharge_products" ADD COLUMN "token_quota" INTEGER;

CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");
CREATE INDEX "ai_recharge_products_kind_status_idx" ON "ai_recharge_products"("product_kind", "status", "sort_order", "created_at");
