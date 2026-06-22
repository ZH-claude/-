CREATE TABLE "ai_recharge_page_configs" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "intro_title" TEXT,
  "intro_content" TEXT,
  "intro_image_data_url" TEXT,
  "updated_by_admin_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ai_recharge_page_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_recharge_page_configs_updated_by_admin_idx"
  ON "ai_recharge_page_configs" ("updated_by_admin_id");

ALTER TABLE "ai_recharge_page_configs"
  ADD CONSTRAINT "ai_recharge_page_configs_updated_by_admin_id_fkey"
  FOREIGN KEY ("updated_by_admin_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
