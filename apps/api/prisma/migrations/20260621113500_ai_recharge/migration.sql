CREATE TYPE "AiRechargeProductStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "AiRechargeOrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'FULFILLED', 'CANCELED', 'FAILED');

CREATE TABLE "ai_recharge_products" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "plan_name" TEXT NOT NULL,
    "duration_days" INTEGER,
    "price_cny_cents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "purchase_note" TEXT,
    "delivery_note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "status" "AiRechargeProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_admin_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_recharge_products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_recharge_products_price_positive_check" CHECK ("price_cny_cents" >= 0),
    CONSTRAINT "ai_recharge_products_duration_positive_check" CHECK ("duration_days" IS NULL OR "duration_days" > 0)
);

CREATE TABLE "ai_recharge_orders" (
    "id" UUID NOT NULL,
    "order_no" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_title_snapshot" TEXT NOT NULL,
    "platform_snapshot" TEXT NOT NULL,
    "plan_name_snapshot" TEXT NOT NULL,
    "amount_cny_cents" INTEGER NOT NULL,
    "customer_account" TEXT NOT NULL,
    "customer_contact" TEXT NOT NULL,
    "customer_note" TEXT,
    "merchant_note" TEXT,
    "status" "AiRechargeOrderStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_recharge_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_recharge_orders_amount_positive_check" CHECK ("amount_cny_cents" >= 0)
);

CREATE INDEX "ai_recharge_products_public_idx" ON "ai_recharge_products"("status", "sort_order", "created_at");
CREATE INDEX "ai_recharge_products_created_by_admin_idx" ON "ai_recharge_products"("created_by_admin_id", "created_at");
CREATE UNIQUE INDEX "ai_recharge_orders_order_no_key" ON "ai_recharge_orders"("order_no");
CREATE INDEX "ai_recharge_orders_user_created_at_idx" ON "ai_recharge_orders"("user_id", "created_at");
CREATE INDEX "ai_recharge_orders_product_created_at_idx" ON "ai_recharge_orders"("product_id", "created_at");
CREATE INDEX "ai_recharge_orders_status_created_at_idx" ON "ai_recharge_orders"("status", "created_at");

ALTER TABLE "ai_recharge_products" ADD CONSTRAINT "ai_recharge_products_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_recharge_orders" ADD CONSTRAINT "ai_recharge_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_recharge_orders" ADD CONSTRAINT "ai_recharge_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "ai_recharge_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
