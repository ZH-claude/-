ALTER TABLE "wallet_transactions"
  DROP CONSTRAINT IF EXISTS "wallet_transactions_recharge_shape_check";

ALTER TABLE "wallet_transactions"
  ADD CONSTRAINT "wallet_transactions_recharge_shape_check"
  CHECK (
    "type" <> 'RECHARGE'
    OR
    (
      "usage_event_id" IS NULL
      AND
      (
        (
          "recharge_code_id" IS NOT NULL
          AND "payment_order_id" IS NULL
          AND "amount_cents" >= 0
        )
        OR
        (
          "recharge_code_id" IS NULL
          AND "payment_order_id" IS NOT NULL
          AND "amount_cents" > 0
        )
      )
    )
  );
