WITH definition(code, name, description) AS (
  VALUES ('ai.chat.general-knowledge', 'AI 通用知识问答', '允许 AI 助手回答平台题库和试卷之外的通用学科知识')
), permission_row AS (
  INSERT INTO "permissions" ("id", "name", "description", "code", "type", "created_at", "updated_at")
  SELECT gen_random_uuid(), name, description, code, 'API'::"PermissionType", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM definition
  ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "updated_at" = CURRENT_TIMESTAMP
  RETURNING "id"
)
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."id", permission_row."id", CURRENT_TIMESTAMP
FROM "roles" role
CROSS JOIN permission_row
WHERE role."code" IN ('super_admin', 'academic_admin', 'teacher', 'assistant', 'student', 'parent')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
