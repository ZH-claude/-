CREATE TABLE "security_audit_logs" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" UUID,
  "ip_address" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "security_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "security_audit_logs_actor_created_at_idx" ON "security_audit_logs"("actor_user_id", "created_at");
CREATE INDEX "security_audit_logs_action_created_at_idx" ON "security_audit_logs"("action", "created_at");
CREATE INDEX "security_audit_logs_created_at_idx" ON "security_audit_logs"("created_at");

ALTER TABLE "security_audit_logs"
  ADD CONSTRAINT "security_audit_logs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
