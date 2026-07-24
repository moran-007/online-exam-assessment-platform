INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT
  gen_random_uuid(),
  role."id",
  permission."id",
  CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission
  ON permission."code" IN ('ai.summary.view-own', 'ai.summary.view-class')
WHERE role."code" = 'ai_user'
  AND NOT EXISTS (
    SELECT 1
    FROM "ai_user_permission_exclusions" exclusion
    WHERE exclusion."permission_id" = permission."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permissions" assignment
    WHERE assignment."role_id" = role."id"
      AND assignment."permission_id" = permission."id"
  );
