WITH permission_row AS (
  INSERT INTO "permissions" ("id", "name", "description", "code", "type", "created_at", "updated_at")
  VALUES (
    gen_random_uuid(), '使用 AI 问答助手', '使用不自动读取业务数据的全局 AI 连续问答助手',
    'ai.chat.use', 'API'::"PermissionType", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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
WHERE role."code" IN ('super_admin', 'academic_admin', 'teacher', 'student', 'parent')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
