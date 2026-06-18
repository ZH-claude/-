ALTER TABLE "upstream_models"
  ADD COLUMN "pricing_mode" "ModelPricingMode",
  ADD COLUMN "input_price_cents_per_1k" INTEGER,
  ADD COLUMN "output_price_cents_per_1k" INTEGER,
  ADD COLUMN "model_multiplier" DECIMAL(10,4),
  ADD COLUMN "upstream_input_price_per_million" DECIMAL(12,4),
  ADD COLUMN "upstream_output_price_per_million" DECIMAL(12,4),
  ADD COLUMN "upstream_currency" TEXT,
  ADD COLUMN "upstream_exchange_rate" DECIMAL(12,6),
  ADD COLUMN "margin_percent" DECIMAL(8,4);
