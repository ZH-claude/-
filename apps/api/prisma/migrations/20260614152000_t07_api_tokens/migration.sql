CREATE TYPE "ApiTokenStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DELETED');

CREATE TABLE "api_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "key_preview" TEXT NOT NULL,
    "status" "ApiTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "quota_cents" INTEGER,
    "used_cents" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "note" TEXT,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "api_token_model_accesses" (
    "id" UUID NOT NULL,
    "api_token_id" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_token_model_accesses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");
CREATE INDEX "api_tokens_user_status_idx" ON "api_tokens"("user_id", "status");
CREATE INDEX "api_tokens_expires_at_idx" ON "api_tokens"("expires_at");
CREATE UNIQUE INDEX "api_token_model_accesses_token_model_key" ON "api_token_model_accesses"("api_token_id", "model");
CREATE INDEX "api_token_model_accesses_model_idx" ON "api_token_model_accesses"("model");

ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_token_model_accesses" ADD CONSTRAINT "api_token_model_accesses_api_token_id_fkey" FOREIGN KEY ("api_token_id") REFERENCES "api_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_token_model_accesses" ADD CONSTRAINT "api_token_model_accesses_model_fkey" FOREIGN KEY ("model") REFERENCES "model_prices"("model") ON DELETE CASCADE ON UPDATE CASCADE;
