ALTER TABLE "export_tasks"
  ADD COLUMN "lease_owner" VARCHAR(128),
  ADD COLUMN "lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "heartbeat_at" TIMESTAMP(3);

CREATE INDEX "export_tasks_status_lease_expires_at_idx"
  ON "export_tasks"("status", "lease_expires_at");
