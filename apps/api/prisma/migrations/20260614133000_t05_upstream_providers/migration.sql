CREATE TYPE "UpstreamProviderStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TYPE "UpstreamHealthStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'UNHEALTHY');

CREATE TABLE "upstream_providers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "encrypted_api_key" TEXT NOT NULL,
    "api_key_preview" TEXT NOT NULL,
    "status" "UpstreamProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "health_status" "UpstreamHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "last_health_check_at" TIMESTAMP(3),
    "last_health_latency_ms" INTEGER,
    "last_health_error" TEXT,
    "created_by_admin_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upstream_providers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "upstream_providers_name_key" ON "upstream_providers"("name");
CREATE INDEX "upstream_providers_status_idx" ON "upstream_providers"("status");
CREATE INDEX "upstream_providers_health_status_idx" ON "upstream_providers"("health_status");

ALTER TABLE "upstream_providers" ADD CONSTRAINT "upstream_providers_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
