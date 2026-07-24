CREATE TABLE "ai_data_permissions" (
    "id" UUID NOT NULL,
    "domain" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allow_super_admin" BOOLEAN NOT NULL DEFAULT true,
    "allow_admin" BOOLEAN NOT NULL DEFAULT false,
    "allow_teacher" BOOLEAN NOT NULL DEFAULT false,
    "allow_assistant" BOOLEAN NOT NULL DEFAULT false,
    "change_reason" VARCHAR(300),
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_data_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_data_permissions_domain_key" ON "ai_data_permissions"("domain");
CREATE INDEX "ai_data_permissions_enabled_idx" ON "ai_data_permissions"("enabled");

INSERT INTO "ai_data_permissions"
    ("id", "domain", "enabled", "allow_super_admin", "allow_admin", "allow_teacher", "allow_assistant", "change_reason", "updated_at")
VALUES
    (gen_random_uuid(), 'grade_history', true, true, true, true, true, '系统初始化：沿用现有成绩分析能力', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'attendance', true, true, true, true, true, '系统初始化：沿用现有考勤分析能力', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'schedule', true, true, true, true, true, '系统初始化：沿用现有排课分析能力', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'student_identity', true, true, false, false, false, '系统初始化：学生实名仅向超级管理员开放', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'teacher_identity', true, true, false, false, false, '系统初始化：教师实名仅向超级管理员开放', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'teacher_materials', true, true, true, true, true, '系统初始化：沿用现有教学记录分析能力', CURRENT_TIMESTAMP);
