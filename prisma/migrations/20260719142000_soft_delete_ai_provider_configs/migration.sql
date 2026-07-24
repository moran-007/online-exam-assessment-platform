ALTER TABLE "ai_provider_configs"
  ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "ai_provider_configs_deleted_at_idx"
  ON "ai_provider_configs"("deleted_at");
