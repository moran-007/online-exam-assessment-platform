ALTER TABLE "ai_provider_configs"
  ALTER COLUMN "max_tokens" DROP DEFAULT,
  ALTER COLUMN "max_tokens" DROP NOT NULL;

ALTER TABLE "ai_usage_events"
  ADD COLUMN "reservation_output_tokens" INTEGER;

UPDATE "ai_usage_events"
SET "reservation_output_tokens" = "requested_output_tokens";

ALTER TABLE "ai_usage_events"
  ALTER COLUMN "reservation_output_tokens" SET NOT NULL,
  ALTER COLUMN "requested_output_tokens" DROP NOT NULL,
  DROP CONSTRAINT "ai_usage_events_nonnegative_tokens";

ALTER TABLE "ai_usage_events"
  ADD CONSTRAINT "ai_usage_events_nonnegative_tokens" CHECK (
    ("requested_output_tokens" IS NULL OR "requested_output_tokens" > 0) AND
    "reservation_output_tokens" > 0 AND
    "input_tokens" >= 0 AND
    "output_tokens" >= 0 AND
    "total_tokens" >= "input_tokens" + "output_tokens"
  );

ALTER TABLE "ai_summary_tasks"
  ADD COLUMN "reservation_output_tokens" INTEGER,
  ADD COLUMN "output_limit_key" INTEGER;

UPDATE "ai_summary_tasks"
SET
  "reservation_output_tokens" = "requested_output_tokens",
  "output_limit_key" = "requested_output_tokens";

ALTER TABLE "ai_summary_tasks"
  ALTER COLUMN "reservation_output_tokens" SET NOT NULL,
  ALTER COLUMN "output_limit_key" SET NOT NULL,
  ALTER COLUMN "output_limit_key" SET DEFAULT 0,
  ALTER COLUMN "requested_output_tokens" DROP DEFAULT,
  ALTER COLUMN "requested_output_tokens" DROP NOT NULL;

ALTER TABLE "ai_summary_tasks"
  ADD CONSTRAINT "ai_summary_tasks_output_token_policy_valid" CHECK (
    ("requested_output_tokens" IS NULL OR "requested_output_tokens" > 0) AND
    "reservation_output_tokens" > 0 AND
    "output_limit_key" >= 0
  );

DROP INDEX IF EXISTS "ai_summary_tasks_idempotency_key";

CREATE UNIQUE INDEX "ai_summary_tasks_idempotency_key"
ON "ai_summary_tasks" (
  "type",
  "subject_id",
  "input_hash",
  "dataset_version",
  "prompt_version",
  "schema_version",
  "provider_config_id",
  "model_snapshot",
  "generation_key",
  "output_limit_key"
);
