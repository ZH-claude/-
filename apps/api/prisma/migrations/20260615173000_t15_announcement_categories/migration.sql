-- CreateEnum
CREATE TYPE "AnnouncementCategory" AS ENUM ('ANNOUNCEMENT', 'UPDATE_LOG', 'USAGE_GUIDE');

-- AlterTable
ALTER TABLE "announcements"
ADD COLUMN "category" "AnnouncementCategory" NOT NULL DEFAULT 'ANNOUNCEMENT';

-- CreateIndex
CREATE INDEX "announcements_public_feed_idx" ON "announcements"("status", "category", "published_at");
