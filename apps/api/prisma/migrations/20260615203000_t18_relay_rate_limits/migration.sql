ALTER TABLE "users"
  ADD COLUMN "rate_limit_requests_per_minute" INTEGER,
  ADD COLUMN "risk_locked_until" TIMESTAMP(3),
  ADD COLUMN "risk_reason" TEXT;

ALTER TABLE "api_tokens"
  ADD COLUMN "rate_limit_requests_per_minute" INTEGER,
  ADD COLUMN "model_rate_limit_requests_per_minute" INTEGER,
  ADD COLUMN "ip_rate_limit_requests_per_minute" INTEGER,
  ADD COLUMN "ip_whitelist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "activation_ttl_seconds" INTEGER,
  ADD COLUMN "activated_at" TIMESTAMP(3),
  ADD COLUMN "activation_expires_at" TIMESTAMP(3);

CREATE TABLE "relay_rate_limit_events" (
  "id" UUID NOT NULL,
  "request_id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "token_id" UUID NOT NULL,
  "model" TEXT,
  "ip_address" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "relay_rate_limit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "relay_rate_limit_events_request_id_key" ON "relay_rate_limit_events"("request_id");
CREATE INDEX "relay_rate_limit_events_user_created_at_idx" ON "relay_rate_limit_events"("user_id", "created_at");
CREATE INDEX "relay_rate_limit_events_token_created_at_idx" ON "relay_rate_limit_events"("token_id", "created_at");
CREATE INDEX "relay_rate_limit_events_token_model_created_at_idx" ON "relay_rate_limit_events"("token_id", "model", "created_at");
CREATE INDEX "relay_rate_limit_events_token_ip_created_at_idx" ON "relay_rate_limit_events"("token_id", "ip_address", "created_at");

ALTER TABLE "relay_rate_limit_events"
  ADD CONSTRAINT "relay_rate_limit_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "relay_rate_limit_events"
  ADD CONSTRAINT "relay_rate_limit_events_token_id_fkey"
  FOREIGN KEY ("token_id") REFERENCES "api_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
