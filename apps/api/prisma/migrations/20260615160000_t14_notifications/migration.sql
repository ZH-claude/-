CREATE TYPE "NotificationChannelType" AS ENUM ('WEBHOOK', 'EMAIL');
CREATE TYPE "NotificationEventType" AS ENUM (
  'TEST',
  'BALANCE_LOW',
  'SECURITY_ALERT',
  'SYSTEM_ANNOUNCEMENT',
  'PROMOTION',
  'MODEL_PRICE_UPDATE'
);
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('SENT', 'FAILED');

CREATE TABLE "notification_preferences" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "balance_low_enabled" BOOLEAN NOT NULL DEFAULT false,
  "balance_low_threshold_cents" INTEGER,
  "balance_low_last_notified_at" TIMESTAMP(3),
  "security_alerts_enabled" BOOLEAN NOT NULL DEFAULT true,
  "system_announcements_enabled" BOOLEAN NOT NULL DEFAULT true,
  "promotions_enabled" BOOLEAN NOT NULL DEFAULT false,
  "model_price_updates_enabled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_channels" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "type" "NotificationChannelType" NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "target_preview" TEXT,
  "encrypted_target" TEXT,
  "last_test_status" "NotificationDeliveryStatus",
  "last_test_at" TIMESTAMP(3),
  "last_test_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_deliveries" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "channel_id" UUID NOT NULL,
  "event_type" "NotificationEventType" NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL,
  "target_preview" TEXT,
  "response_status" INTEGER,
  "error_message" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");
CREATE UNIQUE INDEX "notification_channels_user_type_key" ON "notification_channels"("user_id", "type");
CREATE INDEX "notification_channels_user_enabled_idx" ON "notification_channels"("user_id", "enabled");
CREATE INDEX "notification_deliveries_user_created_at_idx" ON "notification_deliveries"("user_id", "created_at");
CREATE INDEX "notification_deliveries_channel_created_at_idx" ON "notification_deliveries"("channel_id", "created_at");

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_channels"
  ADD CONSTRAINT "notification_channels_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_channel_id_fkey"
  FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
