-- CreateEnum
CREATE TYPE "AsyncTaskKind" AS ENUM ('GENERIC', 'IMAGE');

-- CreateEnum
CREATE TYPE "AsyncTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "async_tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "upstream_provider_id" UUID,
    "external_task_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" "AsyncTaskKind" NOT NULL DEFAULT 'GENERIC',
    "status" "AsyncTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "model" TEXT,
    "prompt" TEXT,
    "progress" INTEGER,
    "result_json" JSONB,
    "error_message" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "async_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "async_tasks_platform_external_task_id_key" ON "async_tasks"("platform", "external_task_id");
CREATE INDEX "async_tasks_user_created_at_idx" ON "async_tasks"("user_id", "created_at");
CREATE INDEX "async_tasks_user_status_idx" ON "async_tasks"("user_id", "status");
CREATE INDEX "async_tasks_user_kind_created_at_idx" ON "async_tasks"("user_id", "kind", "created_at");
CREATE INDEX "async_tasks_upstream_provider_id_idx" ON "async_tasks"("upstream_provider_id");

-- AddForeignKey
ALTER TABLE "async_tasks" ADD CONSTRAINT "async_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "async_tasks" ADD CONSTRAINT "async_tasks_upstream_provider_id_fkey" FOREIGN KEY ("upstream_provider_id") REFERENCES "upstream_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
