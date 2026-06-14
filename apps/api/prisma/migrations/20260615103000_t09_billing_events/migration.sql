CREATE TYPE "UsageEventStatus" AS ENUM ('BILLABLE', 'FREE', 'FAILED', 'METERING_UNKNOWN');
CREATE TYPE "WalletTransactionType" AS ENUM ('RECHARGE', 'DEBIT', 'REFUND', 'ADMIN_ADJUST');

ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_cents_non_negative_check" CHECK ("balance_cents" >= 0);
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_total_spend_cents_non_negative_check" CHECK ("total_spend_cents" >= 0);
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_version_non_negative_check" CHECK ("version" >= 0);

ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_used_cents_non_negative_check" CHECK ("used_cents" >= 0);
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_quota_cents_non_negative_check" CHECK ("quota_cents" IS NULL OR "quota_cents" >= 0);
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_used_cents_quota_check" CHECK ("quota_cents" IS NULL OR "used_cents" <= "quota_cents");

CREATE TABLE "usage_events" (
    "id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "token_id" UUID NOT NULL,
    "upstream_provider_id" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "upstream_model" TEXT,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "UsageEventStatus" NOT NULL,
    "error_code" TEXT,
    "price_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "usage_events_prompt_tokens_non_negative_check" CHECK ("prompt_tokens" >= 0),
    CONSTRAINT "usage_events_completion_tokens_non_negative_check" CHECK ("completion_tokens" >= 0),
    CONSTRAINT "usage_events_total_tokens_non_negative_check" CHECK ("total_tokens" >= 0),
    CONSTRAINT "usage_events_cost_cents_non_negative_check" CHECK ("cost_cents" >= 0)
);

CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "balance_after_cents" INTEGER NOT NULL,
    "usage_event_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_transactions_balance_after_non_negative_check" CHECK ("balance_after_cents" >= 0)
);

CREATE UNIQUE INDEX "usage_events_request_id_key" ON "usage_events"("request_id");
CREATE INDEX "usage_events_user_created_at_idx" ON "usage_events"("user_id", "created_at");
CREATE INDEX "usage_events_token_created_at_idx" ON "usage_events"("token_id", "created_at");
CREATE INDEX "usage_events_model_created_at_idx" ON "usage_events"("model", "created_at");
CREATE INDEX "usage_events_status_created_at_idx" ON "usage_events"("status", "created_at");

CREATE UNIQUE INDEX "wallet_transactions_usage_event_id_key" ON "wallet_transactions"("usage_event_id");
CREATE UNIQUE INDEX "wallet_transactions_idempotency_key_key" ON "wallet_transactions"("idempotency_key");
CREATE INDEX "wallet_transactions_user_created_at_idx" ON "wallet_transactions"("user_id", "created_at");
CREATE INDEX "wallet_transactions_type_idx" ON "wallet_transactions"("type");

ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "api_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_upstream_provider_id_fkey" FOREIGN KEY ("upstream_provider_id") REFERENCES "upstream_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_usage_event_id_fkey" FOREIGN KEY ("usage_event_id") REFERENCES "usage_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
