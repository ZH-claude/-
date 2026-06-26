ALTER TABLE "upstream_providers"
  ADD COLUMN "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "circuit_opened_until" TIMESTAMP(3),
  ADD COLUMN "last_failure_at" TIMESTAMP(3),
  ADD COLUMN "last_success_at" TIMESTAMP(3);

CREATE INDEX "upstream_providers_circuit_opened_until_idx" ON "upstream_providers"("circuit_opened_until");
