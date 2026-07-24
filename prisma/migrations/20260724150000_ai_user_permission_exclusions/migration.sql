CREATE TABLE "ai_user_permission_exclusions" (
  "id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ai_user_permission_exclusions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_user_permission_exclusions_permission_id_key"
ON "ai_user_permission_exclusions"("permission_id");

CREATE INDEX "ai_user_permission_exclusions_updated_by_idx"
ON "ai_user_permission_exclusions"("updated_by");

ALTER TABLE "ai_user_permission_exclusions"
ADD CONSTRAINT "ai_user_permission_exclusions_permission_id_fkey"
FOREIGN KEY ("permission_id") REFERENCES "permissions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve readable permissions that an administrator already disabled before
-- this explicit exclusion table was introduced.
INSERT INTO "ai_user_permission_exclusions" (
  "id",
  "permission_id",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  permission."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "permissions" permission
WHERE (
    permission."code" LIKE 'ai.data.%'
    OR RIGHT(permission."code", 5) IN (':read', '.read')
    OR RIGHT(permission."code", 9) = ':download'
    OR permission."code" = 'attachment:preview'
  )
  AND EXISTS (
    SELECT 1 FROM "roles" role WHERE role."code" = 'ai_user'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permissions" assignment
    JOIN "roles" role ON role."id" = assignment."role_id"
    WHERE role."code" = 'ai_user'
      AND assignment."permission_id" = permission."id"
  )
ON CONFLICT ("permission_id") DO NOTHING;
