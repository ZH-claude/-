ALTER TABLE "upstream_providers" ADD COLUMN "max_concurrency" INTEGER;

CREATE TABLE "user_upstream_assignments" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "public_model" TEXT NOT NULL,
  "upstream_provider_id" UUID NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_upstream_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "upstream_concurrency_slots" (
  "id" UUID NOT NULL,
  "request_id" TEXT NOT NULL,
  "upstream_provider_id" UUID NOT NULL,
  "user_id" UUID,
  "public_model" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "upstream_concurrency_slots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_upstream_assignments_user_model_key" ON "user_upstream_assignments"("user_id", "public_model");
CREATE INDEX "user_upstream_assignments_model_provider_idx" ON "user_upstream_assignments"("public_model", "upstream_provider_id");
CREATE INDEX "user_upstream_assignments_provider_idx" ON "user_upstream_assignments"("upstream_provider_id");

CREATE UNIQUE INDEX "upstream_concurrency_slots_request_id_key" ON "upstream_concurrency_slots"("request_id");
CREATE INDEX "upstream_concurrency_slots_provider_expires_idx" ON "upstream_concurrency_slots"("upstream_provider_id", "expires_at");
CREATE INDEX "upstream_concurrency_slots_user_created_at_idx" ON "upstream_concurrency_slots"("user_id", "created_at");

ALTER TABLE "user_upstream_assignments"
  ADD CONSTRAINT "user_upstream_assignments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_upstream_assignments"
  ADD CONSTRAINT "user_upstream_assignments_upstream_provider_id_fkey"
  FOREIGN KEY ("upstream_provider_id") REFERENCES "upstream_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "upstream_concurrency_slots"
  ADD CONSTRAINT "upstream_concurrency_slots_upstream_provider_id_fkey"
  FOREIGN KEY ("upstream_provider_id") REFERENCES "upstream_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
