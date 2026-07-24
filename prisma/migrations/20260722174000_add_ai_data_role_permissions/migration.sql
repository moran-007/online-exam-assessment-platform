WITH definitions(code, name, description, domain) AS (
  VALUES
    ('ai.data.grade-history', 'AI 读取成绩历史', '允许 AI 读取考试成绩、题目表现、知识点掌握及历史趋势', 'grade_history'),
    ('ai.data.attendance', 'AI 读取出勤情况', '允许 AI 读取到课、迟到、请假、早退与缺勤记录', 'attendance'),
    ('ai.data.schedule', 'AI 读取排课情况', '允许 AI 读取课次时间、课程安排与课堂公开记录', 'schedule'),
    ('ai.data.student-identity', 'AI 使用学生实名', '允许向模型发送并输出学生真实姓名', 'student_identity'),
    ('ai.data.teacher-identity', 'AI 使用教师实名', '允许向模型发送并输出教师真实姓名', 'teacher_identity'),
    ('ai.data.teacher-materials', 'AI 读取教师教学资料', '允许 AI 读取教学记录、课堂表现、备课内容与内部备注', 'teacher_materials')
), permission_rows AS (
  INSERT INTO "permissions" ("id", "name", "description", "code", "type", "created_at", "updated_at")
  SELECT gen_random_uuid(), name, description, code, 'API'::"PermissionType", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM definitions
  ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "updated_at" = CURRENT_TIMESTAMP
  RETURNING "id", "code"
), legacy_grants AS (
  SELECT role."id" AS role_id, permission."id" AS permission_id
  FROM "roles" role
  CROSS JOIN permission_rows permission
  JOIN definitions definition ON definition.code = permission.code
  JOIN "ai_data_permissions" legacy ON legacy."domain" = definition.domain
  WHERE legacy."enabled" = true AND (
    (role."code" = 'super_admin' AND legacy."allow_super_admin" = true)
    OR (role."code" = 'academic_admin' AND legacy."allow_admin" = true)
    OR (role."code" = 'teacher' AND (legacy."allow_teacher" = true OR legacy."allow_assistant" = true))
    OR (role."code" = 'assistant' AND legacy."allow_assistant" = true)
  )
)
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role_id, permission_id, CURRENT_TIMESTAMP
FROM legacy_grants
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
