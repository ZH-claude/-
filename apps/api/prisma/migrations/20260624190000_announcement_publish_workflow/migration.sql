ALTER TABLE "announcements" ADD COLUMN "is_pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "announcements" ADD COLUMN "scheduled_at" TIMESTAMP(3);

CREATE INDEX "announcements_status_scheduled_at_idx" ON "announcements"("status", "scheduled_at");
CREATE INDEX "announcements_public_workflow_idx" ON "announcements"("status", "is_pinned", "scheduled_at", "published_at");
