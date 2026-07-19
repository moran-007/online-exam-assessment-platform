-- CreateEnum
CREATE TYPE "ScratchTemplateStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "ScratchAssignmentStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "ScratchWorkStatus" AS ENUM ('draft', 'submitted', 'reviewed');

-- CreateEnum
CREATE TYPE "ScratchWorkVersionSource" AS ENUM ('template_copy', 'student_save', 'submission', 'import');

-- CreateEnum
CREATE TYPE "ScratchJudgeMode" AS ENUM ('none', 'manual', 'external');

-- CreateEnum
CREATE TYPE "ScratchJudgeRunStatus" AS ENUM ('pending', 'processing', 'retry', 'awaiting_review', 'succeeded', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "scratch_templates" (
    "id" UUID NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "status" "ScratchTemplateStatus" NOT NULL DEFAULT 'active',
    "project_asset_id" UUID NOT NULL,
    "thumbnail_asset_id" UUID,
    "runtime_provider" VARCHAR(64),
    "runtime_problem_id" VARCHAR(128),
    "runtime_problem_url" TEXT,
    "validation_json" JSONB,
    "source_system" VARCHAR(64),
    "legacy_id" VARCHAR(128),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scratch_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_scratch_assignments" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "statement_md" TEXT,
    "bind_note" TEXT,
    "due_at" TIMESTAMPTZ(3),
    "max_score" DECIMAL(8,2) NOT NULL DEFAULT 100,
    "status" "ScratchAssignmentStatus" NOT NULL DEFAULT 'draft',
    "judge_mode" "ScratchJudgeMode" NOT NULL DEFAULT 'manual',
    "runtime_config_json" JSONB,
    "published_at" TIMESTAMPTZ(3),
    "source_system" VARCHAR(64),
    "legacy_id" VARCHAR(128),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lesson_scratch_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scratch_works" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "status" "ScratchWorkStatus" NOT NULL DEFAULT 'draft',
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "submit_note" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),
    "source_system" VARCHAR(64),
    "legacy_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scratch_works_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scratch_work_versions" (
    "id" UUID NOT NULL,
    "work_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "source" "ScratchWorkVersionSource" NOT NULL,
    "project_asset_id" UUID NOT NULL,
    "thumbnail_asset_id" UUID,
    "note" TEXT,
    "source_system" VARCHAR(64),
    "legacy_id" VARCHAR(128),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scratch_work_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scratch_reviews" (
    "id" UUID NOT NULL,
    "work_id" UUID NOT NULL,
    "work_version_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "score" DECIMAL(8,2),
    "comment" TEXT,
    "rubric_json" JSONB,
    "source_system" VARCHAR(64),
    "legacy_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scratch_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scratch_judge_runs" (
    "id" UUID NOT NULL,
    "work_id" UUID NOT NULL,
    "work_version_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(180) NOT NULL,
    "status" "ScratchJudgeRunStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "next_attempt_at" TIMESTAMPTZ(3),
    "lease_owner" VARCHAR(128),
    "lease_expires_at" TIMESTAMPTZ(3),
    "external_job_id" VARCHAR(180),
    "external_result_json" JSONB,
    "score" DECIMAL(8,2),
    "passed" BOOLEAN,
    "message" TEXT,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "source_system" VARCHAR(64),
    "legacy_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scratch_judge_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scratch_judge_callbacks" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "callback_id" VARCHAR(180) NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scratch_judge_callbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scratch_templates_status_created_at_idx" ON "scratch_templates"("status", "created_at");

-- CreateIndex
CREATE INDEX "scratch_templates_runtime_provider_runtime_problem_id_idx" ON "scratch_templates"("runtime_provider", "runtime_problem_id");

-- CreateIndex
CREATE UNIQUE INDEX "scratch_templates_source_system_legacy_id_key" ON "scratch_templates"("source_system", "legacy_id");

-- CreateIndex
CREATE INDEX "lesson_scratch_assignments_session_id_status_idx" ON "lesson_scratch_assignments"("session_id", "status");

-- CreateIndex
CREATE INDEX "lesson_scratch_assignments_template_id_idx" ON "lesson_scratch_assignments"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_scratch_assignments_session_id_template_id_key" ON "lesson_scratch_assignments"("session_id", "template_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_scratch_assignments_source_system_legacy_id_key" ON "lesson_scratch_assignments"("source_system", "legacy_id");

-- CreateIndex
CREATE INDEX "scratch_works_student_id_status_updated_at_idx" ON "scratch_works"("student_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "scratch_works_assignment_id_status_idx" ON "scratch_works"("assignment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scratch_works_assignment_id_student_id_key" ON "scratch_works"("assignment_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "scratch_works_source_system_legacy_id_key" ON "scratch_works"("source_system", "legacy_id");

-- CreateIndex
CREATE INDEX "scratch_work_versions_work_id_created_at_idx" ON "scratch_work_versions"("work_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "scratch_work_versions_work_id_version_key" ON "scratch_work_versions"("work_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "scratch_work_versions_source_system_legacy_id_key" ON "scratch_work_versions"("source_system", "legacy_id");

-- CreateIndex
CREATE INDEX "scratch_reviews_work_id_created_at_idx" ON "scratch_reviews"("work_id", "created_at");

-- CreateIndex
CREATE INDEX "scratch_reviews_reviewer_id_created_at_idx" ON "scratch_reviews"("reviewer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "scratch_reviews_source_system_legacy_id_key" ON "scratch_reviews"("source_system", "legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "scratch_judge_runs_idempotency_key_key" ON "scratch_judge_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "scratch_judge_runs_status_next_attempt_at_idx" ON "scratch_judge_runs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "scratch_judge_runs_external_job_id_idx" ON "scratch_judge_runs"("external_job_id");

-- CreateIndex
CREATE INDEX "scratch_judge_runs_work_id_created_at_idx" ON "scratch_judge_runs"("work_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "scratch_judge_runs_source_system_legacy_id_key" ON "scratch_judge_runs"("source_system", "legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "scratch_judge_callbacks_callback_id_key" ON "scratch_judge_callbacks"("callback_id");

-- CreateIndex
CREATE INDEX "scratch_judge_callbacks_run_id_received_at_idx" ON "scratch_judge_callbacks"("run_id", "received_at");

-- AddForeignKey
ALTER TABLE "scratch_templates" ADD CONSTRAINT "scratch_templates_project_asset_id_fkey" FOREIGN KEY ("project_asset_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_templates" ADD CONSTRAINT "scratch_templates_thumbnail_asset_id_fkey" FOREIGN KEY ("thumbnail_asset_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_scratch_assignments" ADD CONSTRAINT "lesson_scratch_assignments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "lesson_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_scratch_assignments" ADD CONSTRAINT "lesson_scratch_assignments_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "scratch_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_works" ADD CONSTRAINT "scratch_works_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "lesson_scratch_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_works" ADD CONSTRAINT "scratch_works_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_work_versions" ADD CONSTRAINT "scratch_work_versions_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "scratch_works"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_work_versions" ADD CONSTRAINT "scratch_work_versions_project_asset_id_fkey" FOREIGN KEY ("project_asset_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_work_versions" ADD CONSTRAINT "scratch_work_versions_thumbnail_asset_id_fkey" FOREIGN KEY ("thumbnail_asset_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_reviews" ADD CONSTRAINT "scratch_reviews_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "scratch_works"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_reviews" ADD CONSTRAINT "scratch_reviews_work_version_id_fkey" FOREIGN KEY ("work_version_id") REFERENCES "scratch_work_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_reviews" ADD CONSTRAINT "scratch_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_judge_runs" ADD CONSTRAINT "scratch_judge_runs_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "scratch_works"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_judge_runs" ADD CONSTRAINT "scratch_judge_runs_work_version_id_fkey" FOREIGN KEY ("work_version_id") REFERENCES "scratch_work_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_judge_runs" ADD CONSTRAINT "scratch_judge_runs_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "lesson_scratch_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_judge_callbacks" ADD CONSTRAINT "scratch_judge_callbacks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "scratch_judge_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants.
ALTER TABLE "lesson_scratch_assignments"
  ADD CONSTRAINT "lesson_scratch_assignments_max_score_check" CHECK ("max_score" > 0);
ALTER TABLE "scratch_works"
  ADD CONSTRAINT "scratch_works_current_version_check" CHECK ("current_version" >= 0);
ALTER TABLE "scratch_work_versions"
  ADD CONSTRAINT "scratch_work_versions_version_check" CHECK ("version" >= 1);
ALTER TABLE "scratch_reviews"
  ADD CONSTRAINT "scratch_reviews_score_check" CHECK ("score" IS NULL OR "score" >= 0);
ALTER TABLE "scratch_judge_runs"
  ADD CONSTRAINT "scratch_judge_runs_attempts_check" CHECK (
    "attempt_count" >= 0 AND "max_attempts" >= 1 AND "attempt_count" <= "max_attempts"
  );
ALTER TABLE "scratch_judge_runs"
  ADD CONSTRAINT "scratch_judge_runs_score_check" CHECK ("score" IS NULL OR "score" >= 0);

-- Work versions, reviews and received callbacks are audit-grade append-only evidence.
CREATE OR REPLACE FUNCTION prevent_scratch_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "scratch_work_versions_no_update"
BEFORE UPDATE ON "scratch_work_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_scratch_evidence_mutation();

CREATE TRIGGER "scratch_work_versions_no_delete"
BEFORE DELETE ON "scratch_work_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_scratch_evidence_mutation();

CREATE TRIGGER "scratch_reviews_no_update"
BEFORE UPDATE ON "scratch_reviews"
FOR EACH ROW EXECUTE FUNCTION prevent_scratch_evidence_mutation();

CREATE TRIGGER "scratch_reviews_no_delete"
BEFORE DELETE ON "scratch_reviews"
FOR EACH ROW EXECUTE FUNCTION prevent_scratch_evidence_mutation();

CREATE TRIGGER "scratch_judge_callbacks_no_update"
BEFORE UPDATE ON "scratch_judge_callbacks"
FOR EACH ROW EXECUTE FUNCTION prevent_scratch_evidence_mutation();

CREATE TRIGGER "scratch_judge_callbacks_no_delete"
BEFORE DELETE ON "scratch_judge_callbacks"
FOR EACH ROW EXECUTE FUNCTION prevent_scratch_evidence_mutation();

-- Permissions are installed with the schema for non-seeded environments.
INSERT INTO "permissions" (
  "id", "name", "description", "code", "type", "sort_order", "created_at", "updated_at"
)
VALUES
  (gen_random_uuid(), '查看 Scratch 模板', '查看可用 Scratch 模板元数据', 'scratch-template:read', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '维护 Scratch 模板', '上传、修改和归档 Scratch 模板', 'scratch-template:manage', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '查看 Scratch 任务', '按课次和学习者范围查看 Scratch 任务', 'scratch-assignment:read', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '维护 Scratch 任务', '绑定模板并维护任务草稿', 'scratch-assignment:manage', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '发布 Scratch 任务', '发布或归档 Scratch 课堂任务', 'scratch-assignment:publish', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '查看 Scratch 作品', '按数据范围查看作品和版本', 'scratch-work:read', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '保存 Scratch 作品', '保存本人 Scratch 作品的新版本', 'scratch-work:save', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '提交 Scratch 作品', '提交本人 Scratch 作品', 'scratch-work:submit', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '批阅 Scratch 作品', '为任教课次作品追加评分和点评', 'scratch-work:review', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '读取 Scratch 文件', '按作品与模板数据范围下载文件', 'scratch-asset:download', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '管理 Scratch 判定', '重试和查看外部运行时判定任务', 'scratch-judge:manage', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON (
  (role."code" IN ('super_admin', 'academic_admin') AND permission."code" LIKE 'scratch-%')
  OR (role."code" = 'teacher' AND permission."code" IN (
    'scratch-template:read', 'scratch-template:manage', 'scratch-assignment:read',
    'scratch-assignment:manage', 'scratch-assignment:publish', 'scratch-work:read',
    'scratch-work:review', 'scratch-asset:download', 'scratch-judge:manage'
  ))
  OR (role."code" = 'student' AND permission."code" IN (
    'scratch-assignment:read', 'scratch-work:read', 'scratch-work:save',
    'scratch-work:submit', 'scratch-asset:download'
  ))
  OR (role."code" = 'parent' AND permission."code" IN (
    'scratch-assignment:read', 'scratch-work:read', 'scratch-asset:download'
  ))
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
