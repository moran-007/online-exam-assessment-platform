ALTER TABLE "ai_summary_tasks"
  ADD COLUMN "generation_key" VARCHAR(64) NOT NULL DEFAULT 'initial';

DROP INDEX "ai_summary_tasks_idempotency_key";

CREATE UNIQUE INDEX "ai_summary_tasks_idempotency_key"
  ON "ai_summary_tasks"(
    "type", "subject_id", "input_hash", "dataset_version", "prompt_version",
    "schema_version", "provider_config_id", "model_snapshot", "generation_key"
  );
