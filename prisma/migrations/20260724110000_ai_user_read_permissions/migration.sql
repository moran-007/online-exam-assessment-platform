INSERT INTO "permissions" ("id", "name", "description", "code", "type", "sort_order", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), '查看教案', '查看教案、教案模板和教学流程预设', 'lesson-plan:read', 'API'::"PermissionType", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '管理教案', '创建、修改和删除教案及个人预设', 'lesson-plan:manage', 'API'::"PermissionType", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'AI 读取教案', '允许 AI 在调用者权限范围内读取和统计教案', 'ai.data.lesson-plans', 'API'::"PermissionType", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '管理 AI 用户读取权限', '验证超级管理员密码后配置 AI 用户的全局只读上限', 'ai.user.manage', 'API'::"PermissionType", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "roles" ("id", "name", "code", "description", "status", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'AI 用户',
  'ai_user',
  'AI 平台数据只读权限上限；只能由超级管理员验证密码后配置',
  'ACTIVE'::"RoleStatus",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "status" = 'ACTIVE'::"RoleStatus",
  "updated_at" = CURRENT_TIMESTAMP;

-- Existing roles that could read/manage teaching records retain their lesson-plan access.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), source_role."role_id", target_permission."id", CURRENT_TIMESTAMP
FROM "role_permissions" source_role
JOIN "permissions" source_permission ON source_permission."id" = source_role."permission_id"
JOIN "permissions" target_permission ON target_permission."code" =
  CASE source_permission."code"
    WHEN 'lesson-record:read' THEN 'lesson-plan:read'
    WHEN 'lesson-record:manage' THEN 'lesson-plan:manage'
  END
WHERE source_permission."code" IN ('lesson-record:read', 'lesson-record:manage')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- The AI user starts with every current read-like permission enabled.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role."code" = 'ai_user'
  AND (
    permission."code" LIKE 'ai.data.%'
    OR RIGHT(permission."code", 5) IN (':read', '.read')
    OR RIGHT(permission."code", 9) = ':download'
    OR permission."code" = 'attachment:preview'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Super administrators receive the newly registered permissions immediately.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role."code" = 'super_admin'
  AND permission."code" IN (
    'lesson-plan:read',
    'lesson-plan:manage',
    'ai.data.lesson-plans',
    'ai.user.manage'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
