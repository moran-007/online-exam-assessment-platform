ALTER TABLE "ai_provider_configs"
  ADD COLUMN "monthly_token_budget" INTEGER;

ALTER TABLE "ai_provider_configs"
  ADD CONSTRAINT "ai_provider_configs_monthly_token_budget_positive"
  CHECK ("monthly_token_budget" IS NULL OR "monthly_token_budget" > 0);

CREATE TABLE "ai_usage_events" (
  "id" UUID NOT NULL,
  "provider_config_id" UUID NOT NULL,
  "operation" VARCHAR(64) NOT NULL,
  "correlation_id" VARCHAR(64) NOT NULL,
  "requested_output_tokens" INTEGER NOT NULL,
  "input_tokens" INTEGER NOT NULL,
  "output_tokens" INTEGER NOT NULL,
  "total_tokens" INTEGER NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_usage_events_nonnegative_tokens" CHECK (
    "requested_output_tokens" > 0 AND
    "input_tokens" >= 0 AND
    "output_tokens" >= 0 AND
    "total_tokens" >= "input_tokens" + "output_tokens"
  )
);

CREATE UNIQUE INDEX "ai_usage_events_correlation_id_key"
  ON "ai_usage_events"("correlation_id");
CREATE INDEX "ai_usage_events_provider_config_id_created_at_idx"
  ON "ai_usage_events"("provider_config_id", "created_at");
CREATE INDEX "ai_usage_events_operation_created_at_idx"
  ON "ai_usage_events"("operation", "created_at");

ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_provider_config_id_fkey"
  FOREIGN KEY ("provider_config_id") REFERENCES "ai_provider_configs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
