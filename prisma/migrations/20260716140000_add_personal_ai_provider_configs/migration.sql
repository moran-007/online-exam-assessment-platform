CREATE TYPE "AiProviderConfigScope" AS ENUM ('system', 'personal');

ALTER TABLE "ai_provider_configs"
  ADD COLUMN "scope" "AiProviderConfigScope" NOT NULL DEFAULT 'system',
  ADD COLUMN "owner_user_id" UUID;

ALTER TABLE "ai_provider_configs"
  ADD CONSTRAINT "ai_provider_configs_scope_owner_consistency" CHECK (
    ("scope" = 'system' AND "owner_user_id" IS NULL) OR
    ("scope" = 'personal' AND "owner_user_id" IS NOT NULL)
  );

ALTER TABLE "ai_provider_configs"
  ADD CONSTRAINT "ai_provider_configs_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ai_provider_configs_scope_owner_user_id_enabled_idx"
  ON "ai_provider_configs"("scope", "owner_user_id", "enabled");

CREATE UNIQUE INDEX "ai_provider_configs_one_system_default"
  ON "ai_provider_configs"("is_default")
  WHERE "scope" = 'system' AND "is_default" = true;

CREATE UNIQUE INDEX "ai_provider_configs_one_personal_default_per_owner"
  ON "ai_provider_configs"("owner_user_id")
  WHERE "scope" = 'personal' AND "is_default" = true;

WITH permission_row AS (
  INSERT INTO "permissions" ("id", "name", "description", "code", "type", "created_at", "updated_at")
  VALUES (
    gen_random_uuid(), '管理个人 AI 模型配置', '管理个人 AI 模型配置',
    'ai.provider.manage-own', 'API'::"PermissionType", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
  ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "updated_at" = CURRENT_TIMESTAMP
  RETURNING "id"
)
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" role
CROSS JOIN permission_row permission
WHERE role."code" IN ('super_admin', 'teacher')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
