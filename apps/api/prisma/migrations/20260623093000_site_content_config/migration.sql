CREATE TABLE "site_content_configs" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "home_title" TEXT,
  "home_subtitle" TEXT,
  "home_content" TEXT,
  "home_font_family" TEXT NOT NULL DEFAULT 'system',
  "home_text_color" TEXT NOT NULL DEFAULT '#111827',
  "home_accent_color" TEXT NOT NULL DEFAULT '#2563eb',
  "popup_enabled" BOOLEAN NOT NULL DEFAULT false,
  "popup_title" TEXT,
  "popup_content" TEXT,
  "popup_font_family" TEXT NOT NULL DEFAULT 'system',
  "popup_text_color" TEXT NOT NULL DEFAULT '#111827',
  "popup_accent_color" TEXT NOT NULL DEFAULT '#2563eb',
  "updated_by_admin_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "site_content_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "site_content_configs_updated_by_admin_idx"
  ON "site_content_configs" ("updated_by_admin_id");

ALTER TABLE "site_content_configs"
  ADD CONSTRAINT "site_content_configs_updated_by_admin_id_fkey"
  FOREIGN KEY ("updated_by_admin_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
