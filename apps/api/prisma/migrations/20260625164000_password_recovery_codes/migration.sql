CREATE TABLE IF NOT EXISTS "password_recovery_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "phone_digest" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "provider_configured" BOOLEAN NOT NULL DEFAULT false,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "password_recovery_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_recovery_codes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "password_recovery_codes_user_created_at_idx"
  ON "password_recovery_codes" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "password_recovery_codes_phone_created_at_idx"
  ON "password_recovery_codes" ("phone_digest", "created_at");

CREATE INDEX IF NOT EXISTS "password_recovery_codes_expires_at_idx"
  ON "password_recovery_codes" ("expires_at");

CREATE INDEX IF NOT EXISTS "password_recovery_codes_consumed_expires_idx"
  ON "password_recovery_codes" ("consumed_at", "expires_at");
