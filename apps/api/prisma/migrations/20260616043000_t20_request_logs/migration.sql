CREATE TABLE "request_logs" (
  "id" UUID NOT NULL,
  "request_id" TEXT NOT NULL,
  "user_id" UUID,
  "token_id" UUID,
  "upstream_provider_id" UUID,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "model" TEXT,
  "status_code" INTEGER,
  "error_code" TEXT,
  "latency_ms" INTEGER,
  "upstream_latency_ms" INTEGER,
  "upstream_status_code" INTEGER,
  "upstream_status" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),

  CONSTRAINT "request_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "request_logs_request_id_key" ON "request_logs"("request_id");
CREATE INDEX "request_logs_user_created_at_idx" ON "request_logs"("user_id", "created_at");
CREATE INDEX "request_logs_token_created_at_idx" ON "request_logs"("token_id", "created_at");
CREATE INDEX "request_logs_status_created_at_idx" ON "request_logs"("status_code", "created_at");
CREATE INDEX "request_logs_error_created_at_idx" ON "request_logs"("error_code", "created_at");

ALTER TABLE "request_logs"
  ADD CONSTRAINT "request_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "request_logs"
  ADD CONSTRAINT "request_logs_token_id_fkey"
  FOREIGN KEY ("token_id") REFERENCES "api_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "request_logs"
  ADD CONSTRAINT "request_logs_upstream_provider_id_fkey"
  FOREIGN KEY ("upstream_provider_id") REFERENCES "upstream_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
