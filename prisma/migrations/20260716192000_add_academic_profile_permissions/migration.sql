INSERT INTO "permissions" (
    "id", "name", "description", "code", "type", "sort_order", "created_at", "updated_at"
)
VALUES
    (gen_random_uuid(), '按数据范围查看教务档案', '按数据范围查看教务档案', 'academic-profile:read', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), '维护学生和教师档案', '维护学生和教师档案', 'academic-profile:update', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), '维护家长与学生关系', '维护家长与学生关系', 'parent-student:manage', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), '管理历史数据迁移', '预检、处置和批准历史数据迁移', 'legacy-migration:manage', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "roles" ("id", "name", "code", "description", "status", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), '教务管理员', 'academic_admin', '教务档案、家长关系和迁移管理', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), '家长', 'parent', '查看明确关联学生的档案与已发布内容', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON (
    (role."code" = 'super_admin' AND permission."code" IN (
        'academic-profile:read', 'academic-profile:update', 'parent-student:manage', 'legacy-migration:manage'
    ))
    OR (role."code" = 'academic_admin' AND permission."code" IN (
        'academic-profile:read', 'academic-profile:update', 'parent-student:manage', 'legacy-migration:manage'
    ))
    OR (role."code" IN ('teacher', 'student', 'parent') AND permission."code" = 'academic-profile:read')
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "user_roles" ("id", "user_id", "role_id", "scope_type", "created_at")
SELECT gen_random_uuid(), user_row."id", role."id", 'GLOBAL', CURRENT_TIMESTAMP
FROM "users" user_row
JOIN "roles" role ON (
    (user_row."user_type" = 'PARENT' AND role."code" = 'parent')
    OR (user_row."user_type" = 'ADMIN' AND role."code" = 'academic_admin')
)
WHERE user_row."deleted_at" IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM "user_roles" existing
      WHERE existing."user_id" = user_row."id" AND existing."role_id" = role."id"
  );
