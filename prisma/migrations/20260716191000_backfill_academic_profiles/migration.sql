INSERT INTO "student_profiles" (
    "id", "user_id", "created_at", "updated_at"
)
SELECT gen_random_uuid(), "id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users"
WHERE "user_type" = 'STUDENT' AND "deleted_at" IS NULL
ON CONFLICT ("user_id") DO NOTHING;

INSERT INTO "teacher_profiles" (
    "id", "user_id", "created_at", "updated_at"
)
SELECT gen_random_uuid(), "id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users"
WHERE "user_type" IN ('TEACHER', 'ASSISTANT') AND "deleted_at" IS NULL
ON CONFLICT ("user_id") DO NOTHING;
