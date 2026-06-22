CREATE TYPE "PaymentChannel" AS ENUM ('ALIPAY', 'WECHAT');
CREATE TYPE "PaymentOrderStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CLOSED', 'FAILED');

ALTER TABLE "wallet_transactions" ADD COLUMN "payment_order_id" UUID;

CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "order_no" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'PENDING',
    "face_value_cny_cents" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "provider_trade_no" TEXT,
    "provider_payload" JSONB,
    "pay_url" TEXT,
    "qr_code_content" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_orders_face_value_positive_check" CHECK ("face_value_cny_cents" > 0),
    CONSTRAINT "payment_orders_amount_positive_check" CHECK ("amount_cents" > 0),
    CONSTRAINT "payment_orders_paid_state_check" CHECK (
        ("status" = 'PAID' AND "paid_at" IS NOT NULL) OR
        ("status" <> 'PAID' AND "paid_at" IS NULL)
    )
);

CREATE UNIQUE INDEX "payment_orders_order_no_key" ON "payment_orders"("order_no");
CREATE INDEX "payment_orders_user_created_at_idx" ON "payment_orders"("user_id", "created_at");
CREATE INDEX "payment_orders_status_expires_at_idx" ON "payment_orders"("status", "expires_at");
CREATE INDEX "payment_orders_channel_status_idx" ON "payment_orders"("channel", "status");
CREATE UNIQUE INDEX "wallet_transactions_payment_order_id_key" ON "wallet_transactions"("payment_order_id");

ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_transactions" DROP CONSTRAINT IF EXISTS "wallet_transactions_recharge_shape_check";
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_recharge_shape_check" CHECK (
    "type" <> 'RECHARGE' OR
    (
        "amount_cents" > 0 AND
        "usage_event_id" IS NULL AND
        (
            ("recharge_code_id" IS NOT NULL AND "payment_order_id" IS NULL) OR
            ("recharge_code_id" IS NULL AND "payment_order_id" IS NOT NULL)
        )
    )
);
