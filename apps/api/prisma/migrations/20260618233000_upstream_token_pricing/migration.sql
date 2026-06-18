CREATE TYPE "UpstreamProviderKind" AS ENUM ('GENERIC', 'DEEPSEEK', 'RELAY');

CREATE TYPE "ModelPricingMode" AS ENUM ('MANUAL', 'DEEPSEEK_BASE', 'RELAY_PRICE');

ALTER TABLE "upstream_providers"
  ADD COLUMN "kind" "UpstreamProviderKind" NOT NULL DEFAULT 'GENERIC';

ALTER TABLE "model_prices"
  ADD COLUMN "pricing_mode" "ModelPricingMode" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "upstream_input_price_per_million" DECIMAL(12,4),
  ADD COLUMN "upstream_output_price_per_million" DECIMAL(12,4),
  ADD COLUMN "upstream_currency" TEXT,
  ADD COLUMN "upstream_exchange_rate" DECIMAL(12,6),
  ADD COLUMN "margin_percent" DECIMAL(8,4);
