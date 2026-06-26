CREATE INDEX "users_deleted_created_at_idx" ON "users"("deleted_at", "created_at");
CREATE INDEX "wallet_transactions_type_created_at_idx" ON "wallet_transactions"("type", "created_at");
CREATE INDEX "usage_events_created_at_user_idx" ON "usage_events"("created_at", "user_id");
CREATE INDEX "request_logs_created_at_idx" ON "request_logs"("created_at");
