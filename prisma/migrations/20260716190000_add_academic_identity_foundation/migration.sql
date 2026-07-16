-- Extend account activation lifecycle without importing legacy passwords.
ALTER TYPE "UserStatus" ADD VALUE 'PENDING_ACTIVATION' BEFORE 'ACTIVE';

CREATE TYPE "ClassMemberStatus" AS ENUM ('ACTIVE', 'LEFT');
CREATE TYPE "ClassTeacherRole" AS ENUM ('LEAD', 'INSTRUCTOR', 'ASSISTANT');
CREATE TYPE "MigrationRunStatus" AS ENUM (
    'PREFLIGHT_BLOCKED',
    'READY',
    'APPROVED',
    'APPLYING',
    'COMPLETED',
    'FAILED'
);
CREATE TYPE "MigrationConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'WAIVED');

ALTER TABLE "users"
    ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "activated_at" TIMESTAMP(3);

DROP INDEX "class_students_class_id_idx";
DROP INDEX "class_students_student_id_idx";
ALTER TABLE "class_students"
    ADD COLUMN "status" "ClassMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "left_at" TIMESTAMP(3),
    ADD COLUMN "source_system" VARCHAR(64),
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "class_students_class_id_status_idx" ON "class_students"("class_id", "status");
CREATE INDEX "class_students_student_id_status_idx" ON "class_students"("student_id", "status");

DROP INDEX "class_teachers_class_id_idx";
DROP INDEX "class_teachers_teacher_id_idx";
ALTER TABLE "class_teachers"
    ADD COLUMN "role" "ClassTeacherRole" NOT NULL DEFAULT 'INSTRUCTOR',
    ADD COLUMN "status" "ClassMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "left_at" TIMESTAMP(3),
    ADD COLUMN "source_system" VARCHAR(64),
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "class_teachers_class_id_status_idx" ON "class_teachers"("class_id", "status");
CREATE INDEX "class_teachers_teacher_id_status_idx" ON "class_teachers"("teacher_id", "status");

CREATE TABLE "student_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "student_no" VARCHAR(64),
    "gender" VARCHAR(16),
    "birth_date" DATE,
    "school" VARCHAR(128),
    "grade" VARCHAR(64),
    "enrollment_status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "enrolled_at" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "student_profiles_user_id_key" ON "student_profiles"("user_id");
CREATE UNIQUE INDEX "student_profiles_student_no_key" ON "student_profiles"("student_no");
CREATE INDEX "student_profiles_enrollment_status_idx" ON "student_profiles"("enrollment_status");

CREATE TABLE "teacher_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_no" VARCHAR(64),
    "subject" VARCHAR(128),
    "employment_status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "joined_at" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "teacher_profiles_user_id_key" ON "teacher_profiles"("user_id");
CREATE UNIQUE INDEX "teacher_profiles_employee_no_key" ON "teacher_profiles"("employee_no");
CREATE INDEX "teacher_profiles_employment_status_idx" ON "teacher_profiles"("employment_status");

CREATE TABLE "parent_students" (
    "id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "relationship" VARCHAR(32) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" "ClassMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinked_at" TIMESTAMP(3),
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "parent_students_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "parent_students_parent_id_student_id_key" ON "parent_students"("parent_id", "student_id");
CREATE INDEX "parent_students_parent_id_status_idx" ON "parent_students"("parent_id", "status");
CREATE INDEX "parent_students_student_id_status_idx" ON "parent_students"("student_id", "status");

CREATE TABLE "migration_runs" (
    "id" UUID NOT NULL,
    "source_system" VARCHAR(64) NOT NULL,
    "source_version" VARCHAR(64) NOT NULL,
    "input_fingerprint" VARCHAR(128) NOT NULL,
    "status" "MigrationRunStatus" NOT NULL,
    "summary" JSONB NOT NULL,
    "conflict_count" INTEGER NOT NULL DEFAULT 0,
    "mapping_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "failure_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "migration_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "migration_runs_source_system_input_fingerprint_idx" ON "migration_runs"("source_system", "input_fingerprint");
CREATE INDEX "migration_runs_status_created_at_idx" ON "migration_runs"("status", "created_at");

CREATE TABLE "legacy_id_mappings" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "source_system" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(32) NOT NULL,
    "legacy_id" VARCHAR(128) NOT NULL,
    "target_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "legacy_id_mappings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "legacy_id_mappings_source_system_entity_type_legacy_id_key"
    ON "legacy_id_mappings"("source_system", "entity_type", "legacy_id");
CREATE INDEX "legacy_id_mappings_target_id_idx" ON "legacy_id_mappings"("target_id");

CREATE TABLE "migration_conflicts" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "conflict_key" VARCHAR(160) NOT NULL,
    "entity_type" VARCHAR(32) NOT NULL,
    "legacy_id" VARCHAR(128) NOT NULL,
    "conflict_type" VARCHAR(64) NOT NULL,
    "summary" JSONB NOT NULL,
    "status" "MigrationConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "migration_conflicts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "migration_conflicts_run_id_conflict_key_key" ON "migration_conflicts"("run_id", "conflict_key");
CREATE INDEX "migration_conflicts_run_id_status_idx" ON "migration_conflicts"("run_id", "status");

ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "parent_students" ADD CONSTRAINT "parent_students_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "parent_students" ADD CONSTRAINT "parent_students_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legacy_id_mappings" ADD CONSTRAINT "legacy_id_mappings_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "migration_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "migration_conflicts" ADD CONSTRAINT "migration_conflicts_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "migration_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
