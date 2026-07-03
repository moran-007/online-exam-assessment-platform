WITH new_permissions(code, name) AS (
  VALUES
    ('question:publish', 'Publish questions'),
    ('question:delete', 'Delete questions'),
    ('paper:update', 'Update papers'),
    ('exam:update', 'Update exams'),
    ('exam:delete', 'Delete exams'),
    ('hydro:platform:manage', 'Manage Hydro platforms'),
    ('hydro:problem:bind', 'Bind Hydro problems'),
    ('hydro:account:read', 'Read Hydro accounts'),
    ('hydro:account:update', 'Update Hydro accounts'),
    ('hydro:result:write', 'Write Hydro results')
)
INSERT INTO "permissions" ("id", "name", "code", "type", "created_at", "updated_at")
SELECT gen_random_uuid(), name, code, 'API'::"PermissionType", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM new_permissions
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON permission."code" IN (
  'question:publish',
  'question:delete',
  'paper:update',
  'exam:update',
  'exam:delete',
  'hydro:problem:bind',
  'hydro:account:read',
  'hydro:account:update',
  'hydro:result:write'
)
WHERE role."code" IN ('super_admin', 'teacher')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON permission."code" = 'hydro:platform:manage'
WHERE role."code" = 'super_admin'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
