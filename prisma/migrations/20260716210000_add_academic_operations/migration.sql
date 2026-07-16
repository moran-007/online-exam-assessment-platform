-- CreateEnum
CREATE TYPE "CourseUnitStatus" AS ENUM ('active', 'disabled', 'archived');

-- CreateEnum
CREATE TYPE "ScheduleRuleStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "LessonSessionStatus" AS ENUM ('planned', 'completed', 'cancelled', 'rescheduled');

-- CreateEnum
CREATE TYPE "LessonSessionKind" AS ENUM ('regular', 'temporary', 'makeup', 'trial');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('unconfirmed', 'present', 'late', 'early_leave', 'leave', 'absent', 'makeup');

-- CreateEnum
CREATE TYPE "LessonHourLedgerType" AS ENUM ('opening_balance', 'purchase', 'gift', 'consume', 'reversal', 'refund', 'transfer_in', 'transfer_out', 'manual_adjustment');

-- AlterTable
ALTER TABLE "class_students" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "class_teachers" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "lesson_types" (
    "id" UUID NOT NULL,
    "name" VARCHAR(96) NOT NULL,
    "default_hours" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "count_in_statistics" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_unit_templates" (
    "id" UUID NOT NULL,
    "code" VARCHAR(128) NOT NULL,
    "course_id" UUID,
    "lesson_type_id" UUID NOT NULL,
    "category" VARCHAR(96),
    "stage" VARCHAR(96),
    "unit_no" INTEGER,
    "name" VARCHAR(160) NOT NULL,
    "default_hours" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "teaching_content" TEXT,
    "status" "CourseUnitStatus" NOT NULL DEFAULT 'active',
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_unit_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_schedule_rules" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "teacher_id" UUID,
    "lesson_type_id" UUID NOT NULL,
    "unit_template_id" UUID,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    "lesson_hours" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "classroom" VARCHAR(128),
    "status" "ScheduleRuleStatus" NOT NULL DEFAULT 'active',
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_schedule_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_sessions" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "teacher_id" UUID,
    "lesson_type_id" UUID NOT NULL,
    "unit_template_id" UUID,
    "schedule_rule_id" UUID,
    "source_session_id" UUID,
    "generation_key" VARCHAR(180) NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "kind" "LessonSessionKind" NOT NULL DEFAULT 'regular',
    "status" "LessonSessionStatus" NOT NULL DEFAULT 'planned',
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    "lesson_hours" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "classroom" VARCHAR(128),
    "cancel_reason" TEXT,
    "source_system" VARCHAR(64),
    "legacy_id" VARCHAR(128),
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'unconfirmed',
    "deduct_hours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "confirmed_by" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "correction_reason" TEXT,
    "legacy_baseline" BOOLEAN NOT NULL DEFAULT false,
    "source_system" VARCHAR(64),
    "legacy_id" VARCHAR(128),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_revisions" (
    "id" UUID NOT NULL,
    "attendance_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "before_status" "AttendanceStatus" NOT NULL,
    "before_deduct_hours" DECIMAL(8,2) NOT NULL,
    "after_status" "AttendanceStatus" NOT NULL,
    "after_deduct_hours" DECIMAL(8,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "corrected_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_hour_ledger" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID,
    "class_id" UUID,
    "session_id" UUID,
    "attendance_id" UUID,
    "type" "LessonHourLedgerType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "idempotency_key" VARCHAR(180) NOT NULL,
    "reversal_of_id" UUID,
    "source_system" VARCHAR(64),
    "legacy_id" VARCHAR(128),
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_hour_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lesson_types_name_key" ON "lesson_types"("name");

-- CreateIndex
CREATE INDEX "lesson_types_active_name_idx" ON "lesson_types"("active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "course_unit_templates_code_key" ON "course_unit_templates"("code");

-- CreateIndex
CREATE INDEX "course_unit_templates_course_id_status_idx" ON "course_unit_templates"("course_id", "status");

-- CreateIndex
CREATE INDEX "course_unit_templates_lesson_type_id_status_idx" ON "course_unit_templates"("lesson_type_id", "status");

-- CreateIndex
CREATE INDEX "course_unit_templates_category_stage_unit_no_idx" ON "course_unit_templates"("category", "stage", "unit_no");

-- CreateIndex
CREATE INDEX "class_schedule_rules_class_id_status_idx" ON "class_schedule_rules"("class_id", "status");

-- CreateIndex
CREATE INDEX "class_schedule_rules_teacher_id_status_idx" ON "class_schedule_rules"("teacher_id", "status");

-- CreateIndex
CREATE INDEX "class_schedule_rules_effective_from_effective_to_idx" ON "class_schedule_rules"("effective_from", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_sessions_generation_key_key" ON "lesson_sessions"("generation_key");

-- CreateIndex
CREATE INDEX "lesson_sessions_class_id_starts_at_idx" ON "lesson_sessions"("class_id", "starts_at");

-- CreateIndex
CREATE INDEX "lesson_sessions_teacher_id_starts_at_idx" ON "lesson_sessions"("teacher_id", "starts_at");

-- CreateIndex
CREATE INDEX "lesson_sessions_status_starts_at_idx" ON "lesson_sessions"("status", "starts_at");

-- CreateIndex
CREATE INDEX "lesson_sessions_schedule_rule_id_starts_at_idx" ON "lesson_sessions"("schedule_rule_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_sessions_source_system_legacy_id_key" ON "lesson_sessions"("source_system", "legacy_id");

-- CreateIndex
CREATE INDEX "attendance_records_student_id_confirmed_at_idx" ON "attendance_records"("student_id", "confirmed_at");

-- CreateIndex
CREATE INDEX "attendance_records_status_confirmed_at_idx" ON "attendance_records"("status", "confirmed_at");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_session_id_student_id_key" ON "attendance_records"("session_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_source_system_legacy_id_key" ON "attendance_records"("source_system", "legacy_id");

-- CreateIndex
CREATE INDEX "attendance_revisions_corrected_by_created_at_idx" ON "attendance_revisions"("corrected_by", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_revisions_attendance_id_version_key" ON "attendance_revisions"("attendance_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_hour_ledger_idempotency_key_key" ON "lesson_hour_ledger"("idempotency_key");

-- CreateIndex
CREATE INDEX "lesson_hour_ledger_student_id_created_at_idx" ON "lesson_hour_ledger"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "lesson_hour_ledger_class_id_created_at_idx" ON "lesson_hour_ledger"("class_id", "created_at");

-- CreateIndex
CREATE INDEX "lesson_hour_ledger_session_id_idx" ON "lesson_hour_ledger"("session_id");

-- CreateIndex
CREATE INDEX "lesson_hour_ledger_attendance_id_idx" ON "lesson_hour_ledger"("attendance_id");

-- CreateIndex
CREATE INDEX "lesson_hour_ledger_reversal_of_id_idx" ON "lesson_hour_ledger"("reversal_of_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_hour_ledger_source_system_legacy_id_key" ON "lesson_hour_ledger"("source_system", "legacy_id");

-- AddForeignKey
ALTER TABLE "course_unit_templates" ADD CONSTRAINT "course_unit_templates_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_unit_templates" ADD CONSTRAINT "course_unit_templates_lesson_type_id_fkey" FOREIGN KEY ("lesson_type_id") REFERENCES "lesson_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedule_rules" ADD CONSTRAINT "class_schedule_rules_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedule_rules" ADD CONSTRAINT "class_schedule_rules_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedule_rules" ADD CONSTRAINT "class_schedule_rules_lesson_type_id_fkey" FOREIGN KEY ("lesson_type_id") REFERENCES "lesson_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedule_rules" ADD CONSTRAINT "class_schedule_rules_unit_template_id_fkey" FOREIGN KEY ("unit_template_id") REFERENCES "course_unit_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_sessions" ADD CONSTRAINT "lesson_sessions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_sessions" ADD CONSTRAINT "lesson_sessions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_sessions" ADD CONSTRAINT "lesson_sessions_lesson_type_id_fkey" FOREIGN KEY ("lesson_type_id") REFERENCES "lesson_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_sessions" ADD CONSTRAINT "lesson_sessions_unit_template_id_fkey" FOREIGN KEY ("unit_template_id") REFERENCES "course_unit_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_sessions" ADD CONSTRAINT "lesson_sessions_schedule_rule_id_fkey" FOREIGN KEY ("schedule_rule_id") REFERENCES "class_schedule_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_sessions" ADD CONSTRAINT "lesson_sessions_source_session_id_fkey" FOREIGN KEY ("source_session_id") REFERENCES "lesson_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "lesson_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_revisions" ADD CONSTRAINT "attendance_revisions_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendance_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_revisions" ADD CONSTRAINT "attendance_revisions_corrected_by_fkey" FOREIGN KEY ("corrected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_hour_ledger" ADD CONSTRAINT "lesson_hour_ledger_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_hour_ledger" ADD CONSTRAINT "lesson_hour_ledger_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_hour_ledger" ADD CONSTRAINT "lesson_hour_ledger_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_hour_ledger" ADD CONSTRAINT "lesson_hour_ledger_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "lesson_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_hour_ledger" ADD CONSTRAINT "lesson_hour_ledger_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendance_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_hour_ledger" ADD CONSTRAINT "lesson_hour_ledger_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "lesson_hour_ledger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain invariants
ALTER TABLE "class_schedule_rules"
  ADD CONSTRAINT "class_schedule_rules_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
  ADD CONSTRAINT "class_schedule_rules_time_check" CHECK ("start_minute" BETWEEN 0 AND 1439 AND "end_minute" BETWEEN 1 AND 1440 AND "end_minute" > "start_minute"),
  ADD CONSTRAINT "class_schedule_rules_date_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  ADD CONSTRAINT "class_schedule_rules_hours_check" CHECK ("lesson_hours" >= 0);

ALTER TABLE "lesson_sessions"
  ADD CONSTRAINT "lesson_sessions_time_check" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "lesson_sessions_hours_check" CHECK ("lesson_hours" >= 0);

ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_hours_check" CHECK ("deduct_hours" >= 0);

ALTER TABLE "lesson_hour_ledger"
  ADD CONSTRAINT "lesson_hour_ledger_amount_check" CHECK ("amount" <> 0),
  ADD CONSTRAINT "lesson_hour_ledger_reversal_check" CHECK (
    ("type" = 'reversal' AND "reversal_of_id" IS NOT NULL)
    OR ("type" <> 'reversal' AND "reversal_of_id" IS NULL)
  );

-- Ledger rows are append-only. Corrections must create a reversal/new entry pair.
CREATE OR REPLACE FUNCTION prevent_lesson_hour_ledger_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'lesson_hour_ledger is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "lesson_hour_ledger_no_update"
BEFORE UPDATE ON "lesson_hour_ledger"
FOR EACH ROW EXECUTE FUNCTION prevent_lesson_hour_ledger_mutation();

CREATE TRIGGER "lesson_hour_ledger_no_delete"
BEFORE DELETE ON "lesson_hour_ledger"
FOR EACH ROW EXECUTE FUNCTION prevent_lesson_hour_ledger_mutation();

-- Permissions are migrated with the schema so non-seeded environments are usable.
INSERT INTO "permissions" (
  "id", "name", "description", "code", "type", "sort_order", "created_at", "updated_at"
)
VALUES
  (gen_random_uuid(), '查看课型', '查看课型', 'lesson-type:read', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '管理课型', '新增和维护课型', 'lesson-type:manage', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '查看课程单元', '查看课程单元模板', 'course-unit:read', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '管理课程单元', '新增和维护课程单元模板', 'course-unit:manage', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '查看排课', '按数据范围查看排课', 'schedule:read', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '管理排课', '维护规则、生成课次和调课', 'schedule:manage', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '查看考勤', '按数据范围查看考勤', 'attendance:read', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '确认考勤', '确认考勤并扣减课时', 'attendance:confirm', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '更正考勤', '通过冲正台账更正考勤', 'attendance:correct', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '查看课时', '按数据范围查看课时余额与台账', 'lesson-hour:read', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '调整课时', '新增购买、赠送、退款和人工调整', 'lesson-hour:adjust', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '核对课时', '重算并核对课时台账', 'lesson-hour:reconcile', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON (
  (role."code" IN ('super_admin', 'academic_admin') AND permission."code" IN (
    'lesson-type:read', 'lesson-type:manage', 'course-unit:read', 'course-unit:manage',
    'schedule:read', 'schedule:manage', 'attendance:read', 'attendance:confirm',
    'attendance:correct', 'lesson-hour:read', 'lesson-hour:adjust', 'lesson-hour:reconcile'
  ))
  OR (role."code" = 'teacher' AND permission."code" IN (
    'lesson-type:read', 'course-unit:read', 'schedule:read', 'schedule:manage',
    'attendance:read', 'attendance:confirm', 'attendance:correct', 'lesson-hour:read'
  ))
  OR (role."code" IN ('student', 'parent') AND permission."code" IN (
    'schedule:read', 'attendance:read', 'lesson-hour:read'
  ))
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
