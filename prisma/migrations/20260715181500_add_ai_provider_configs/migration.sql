CREATE TABLE "ai_provider_configs" (
  "id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "base_url" TEXT NOT NULL,
  "model" VARCHAR(160) NOT NULL,
  "api_key_ciphertext" TEXT NOT NULL,
  "api_key_iv" VARCHAR(64) NOT NULL,
  "api_key_auth_tag" VARCHAR(64) NOT NULL,
  "api_key_key_version" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "timeout_ms" INTEGER NOT NULL DEFAULT 30000,
  "max_tokens" INTEGER NOT NULL DEFAULT 800,
  "last_test_status" VARCHAR(32),
  "last_test_message" VARCHAR(300),
  "last_test_at" TIMESTAMP(3),
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_provider_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_provider_configs_key_envelope_complete" CHECK (
    "api_key_ciphertext" <> '' AND "api_key_iv" <> '' AND
    "api_key_auth_tag" <> '' AND "api_key_key_version" > 0
  )
);

CREATE INDEX "ai_provider_configs_enabled_is_default_idx" ON "ai_provider_configs"("enabled", "is_default");
CREATE INDEX "ai_provider_configs_provider_idx" ON "ai_provider_configs"("provider");
