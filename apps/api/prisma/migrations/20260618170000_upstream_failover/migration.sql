ALTER TABLE "upstream_models"
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "timeout_ms" INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN "upstream_prompt" TEXT;

CREATE INDEX "upstream_models_public_status_priority_idx"
  ON "upstream_models"("public_model", "status", "priority");
