ALTER TABLE "announcements"
  ADD COLUMN "translations" JSONB;

ALTER TABLE "site_content_configs"
  ADD COLUMN "translations" JSONB;

ALTER TABLE "ai_recharge_products"
  ADD COLUMN "translations" JSONB;

ALTER TABLE "ai_recharge_page_configs"
  ADD COLUMN "translations" JSONB;
