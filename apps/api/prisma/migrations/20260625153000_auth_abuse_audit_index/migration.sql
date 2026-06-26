CREATE INDEX IF NOT EXISTS "security_audit_logs_action_ip_created_at_idx"
  ON "security_audit_logs" ("action", "ip_address", "created_at");
