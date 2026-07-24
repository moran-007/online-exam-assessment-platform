DELETE FROM "role_permissions" assignment
USING "roles" role, "permissions" permission
WHERE assignment."role_id" = role."id"
  AND assignment."permission_id" = permission."id"
  AND role."code" = 'ai_user'
  AND NOT (
    permission."code" LIKE 'ai.data.%'
    OR RIGHT(permission."code", 5) IN (':read', '.read')
    OR RIGHT(permission."code", 9) = ':download'
    OR permission."code" = 'attachment:preview'
    OR permission."code" IN ('ai.summary.view-own', 'ai.summary.view-class')
  );
