-- CreateEnum
CREATE TYPE "ModelStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "model_prices" (
    "id" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "display_name" TEXT,
    "input_price_cents_per_1k" INTEGER NOT NULL DEFAULT 0,
    "output_price_cents_per_1k" INTEGER NOT NULL DEFAULT 0,
    "model_multiplier" DECIMAL(10,4) NOT NULL DEFAULT 1.0,
    "status" "ModelStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upstream_models" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "public_model" TEXT NOT NULL,
    "upstream_model" TEXT NOT NULL,
    "status" "ModelStatus" NOT NULL DEFAULT 'ACTIVE',
    "supports_stream" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upstream_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_group_accesses" (
    "id" UUID NOT NULL,
    "model_price_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_group_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "model_prices_model_key" ON "model_prices"("model");

-- CreateIndex
CREATE INDEX "model_prices_status_idx" ON "model_prices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "upstream_models_provider_public_upstream_key" ON "upstream_models"("provider_id", "public_model", "upstream_model");

-- CreateIndex
CREATE INDEX "upstream_models_provider_id_idx" ON "upstream_models"("provider_id");

-- CreateIndex
CREATE INDEX "upstream_models_public_status_idx" ON "upstream_models"("public_model", "status");

-- CreateIndex
CREATE UNIQUE INDEX "model_group_accesses_model_group_key" ON "model_group_accesses"("model_price_id", "group_id");

-- CreateIndex
CREATE INDEX "model_group_accesses_group_id_idx" ON "model_group_accesses"("group_id");

-- AddForeignKey
ALTER TABLE "upstream_models" ADD CONSTRAINT "upstream_models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "upstream_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upstream_models" ADD CONSTRAINT "upstream_models_public_model_fkey" FOREIGN KEY ("public_model") REFERENCES "model_prices"("model") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_group_accesses" ADD CONSTRAINT "model_group_accesses_model_price_id_fkey" FOREIGN KEY ("model_price_id") REFERENCES "model_prices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_group_accesses" ADD CONSTRAINT "model_group_accesses_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "user_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
