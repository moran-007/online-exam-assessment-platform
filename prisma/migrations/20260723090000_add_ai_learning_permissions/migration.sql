WITH definitions(code, name, description) AS (
  VALUES
    ('ai.data.question-bank', 'AI 读取题库', '允许 AI 助手按题目名称或内容检索题库'),
    ('ai.data.papers', 'AI 读取试卷', '允许 AI 助手按试卷名称检索试卷及题目结构'),
    ('ai.answer.direct', 'AI 直接给出答案', '允许 AI 助手输出最终答案、正确选项和完整解法')
), permission_rows AS (
  INSERT INTO "permissions" ("id", "name", "description", "code", "type", "created_at", "updated_at")
  SELECT gen_random_uuid(), name, description, code, 'API'::"PermissionType", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM definitions
  ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "updated_at" = CURRENT_TIMESTAMP
  RETURNING "id", "code"
), default_grants AS (
  SELECT role."id" AS role_id, permission."id" AS permission_id
  FROM "roles" role
  CROSS JOIN permission_rows permission
  WHERE
    (permission."code" IN ('ai.data.question-bank', 'ai.data.papers')
      AND role."code" IN ('super_admin', 'academic_admin', 'teacher', 'assistant', 'student', 'parent'))
    OR (permission."code" = 'ai.answer.direct'
      AND role."code" IN ('super_admin', 'academic_admin', 'teacher', 'assistant', 'parent'))
)
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role_id, permission_id, CURRENT_TIMESTAMP
FROM default_grants
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
