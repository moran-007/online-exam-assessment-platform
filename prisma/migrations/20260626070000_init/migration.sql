-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'TEACHER', 'ASSISTANT', 'STUDENT', 'PARENT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'LOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "RoleStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "PermissionType" AS ENUM ('MENU', 'BUTTON', 'API');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KnowledgePointStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TagType" AS ENUM ('QUESTION', 'PAPER', 'EXAM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TagStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'programming', 'material', 'file_upload', 'scratch_project', 'arduino_project');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('draft', 'pending_review', 'published', 'disabled', 'archived');

-- CreateEnum
CREATE TYPE "PaperType" AS ENUM ('fixed', 'rule', 'random', 'practice');

-- CreateEnum
CREATE TYPE "PaperStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('draft', 'scheduled', 'running', 'ended', 'archived');

-- CreateEnum
CREATE TYPE "ShowAnswerMode" AS ENUM ('never', 'after_submit', 'after_exam_end', 'after_manual');

-- CreateEnum
CREATE TYPE "ShowScoreMode" AS ENUM ('never', 'after_submit', 'after_graded', 'after_exam_end', 'after_manual');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('not_started', 'in_progress', 'submitted', 'grading', 'graded', 'cancelled', 'timeout_submitted');

-- CreateEnum
CREATE TYPE "AnswerRecordStatus" AS ENUM ('saved', 'submitted', 'auto_graded', 'manual_needed', 'manual_graded', 'judge_pending', 'judge_done');

-- CreateEnum
CREATE TYPE "WrongQuestionSourceType" AS ENUM ('exam', 'practice', 'manual', 'ai_recommendation');

-- CreateEnum
CREATE TYPE "MasteryStatus" AS ENUM ('unmastered', 'reviewing', 'mastered', 'ignored');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('pending', 'processing', 'success', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('public', 'private', 'temporary');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "phone" VARCHAR(32),
    "email" VARCHAR(128),
    "password_hash" VARCHAR(255) NOT NULL,
    "real_name" VARCHAR(64),
    "avatar_url" TEXT,
    "user_type" "UserType" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "provider_user_id" VARCHAR(128) NOT NULL,
    "union_id" VARCHAR(128),
    "credential_json" JSONB,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "jti" VARCHAR(64) NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "ip" VARCHAR(64),
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "status" "RoleStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "code" VARCHAR(128) NOT NULL,
    "type" "PermissionType" NOT NULL,
    "parent_id" UUID,
    "path" VARCHAR(255),
    "method" VARCHAR(16),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" VARCHAR(32) NOT NULL DEFAULT 'GLOBAL',
    "scope_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "cover_url" TEXT,
    "status" "CourseStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_points" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(128) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "KnowledgePointStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "type" "TagType" NOT NULL DEFAULT 'QUESTION',
    "status" "TagStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "type" "QuestionType" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "default_score" DECIMAL(8,2) NOT NULL,
    "analysis" TEXT,
    "status" "QuestionStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "allow_option_shuffle" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "updated_by" UUID,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_options" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "option_key" VARCHAR(16) NOT NULL,
    "content" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_answers" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "answer_json" JSONB NOT NULL,
    "scoring_rule_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_knowledge_points" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "knowledge_point_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_knowledge_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_tags" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_versions" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot_json" JSONB NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "papers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "course_id" UUID NOT NULL,
    "total_score" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "type" "PaperType" NOT NULL DEFAULT 'fixed',
    "status" "PaperStatus" NOT NULL DEFAULT 'draft',
    "shuffle_questions" BOOLEAN NOT NULL DEFAULT false,
    "shuffle_options" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "papers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_sections" (
    "id" UUID NOT NULL,
    "paper_id" UUID NOT NULL,
    "title" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "score" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "shuffle_questions" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paper_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_questions" (
    "id" UUID NOT NULL,
    "paper_id" UUID NOT NULL,
    "section_id" UUID,
    "question_id" UUID NOT NULL,
    "question_snapshot_json" JSONB NOT NULL,
    "score" DECIMAL(8,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paper_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_rules" (
    "id" UUID NOT NULL,
    "paper_id" UUID NOT NULL,
    "rule_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paper_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "paper_id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "course_id" UUID NOT NULL,
    "class_id" UUID,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "attempt_limit" INTEGER NOT NULL DEFAULT 1,
    "show_answer_mode" "ShowAnswerMode" NOT NULL DEFAULT 'after_exam_end',
    "show_score_mode" "ShowScoreMode" NOT NULL DEFAULT 'after_submit',
    "anti_cheat_config_json" JSONB,
    "status" "ExamStatus" NOT NULL DEFAULT 'draft',
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_instances" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "paper_snapshot_json" JSONB NOT NULL,
    "question_order_json" JSONB NOT NULL,
    "option_order_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_attempts" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "paper_instance_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "status" "AttemptStatus" NOT NULL DEFAULT 'in_progress',
    "objective_score" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "subjective_score" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "judge_score" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "total_score" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_records" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "question_snapshot_id" UUID,
    "answer_json" JSONB NOT NULL,
    "is_correct" BOOLEAN,
    "score" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "status" "AnswerRecordStatus" NOT NULL DEFAULT 'saved',
    "auto_result_json" JSONB,
    "manual_comment" TEXT,
    "graded_by" UUID,
    "graded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "answer_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wrong_questions" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "source_type" "WrongQuestionSourceType" NOT NULL,
    "source_id" UUID NOT NULL,
    "wrong_answer_json" JSONB NOT NULL,
    "correct_answer_json" JSONB NOT NULL,
    "score" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "mastery_status" "MasteryStatus" NOT NULL DEFAULT 'unmastered',
    "wrong_count" INTEGER NOT NULL DEFAULT 1,
    "last_wrong_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wrong_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_sessions" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID,
    "source_type" VARCHAR(64) NOT NULL,
    "rule_json" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" VARCHAR(32) NOT NULL DEFAULT 'in_progress',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programming_problem_refs" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "judge_provider" VARCHAR(32) NOT NULL DEFAULT 'hydro',
    "external_problem_id" VARCHAR(128) NOT NULL,
    "external_problem_url" TEXT,
    "language_config_json" JSONB,
    "time_limit" INTEGER,
    "memory_limit" INTEGER,
    "judge_config_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programming_problem_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hydro_accounts" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "platform_user_id" UUID,
    "hydro_user_id" VARCHAR(128) NOT NULL,
    "hydro_username" VARCHAR(128) NOT NULL,
    "bind_status" VARCHAR(32) NOT NULL DEFAULT 'bound',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hydro_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "judge_submissions" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL DEFAULT 'hydro',
    "external_submission_id" VARCHAR(128),
    "language" VARCHAR(64) NOT NULL,
    "code_snapshot" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "score" DECIMAL(8,2),
    "result_json" JSONB,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "judged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "judge_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hydro_tasks" (
    "id" UUID NOT NULL,
    "title" VARCHAR(128) NOT NULL,
    "course_id" UUID,
    "class_id" UUID,
    "exam_id" UUID,
    "hydro_url" TEXT NOT NULL,
    "hydro_problem_id" VARCHAR(128),
    "hydro_contest_id" VARCHAR(128),
    "start_time" TIMESTAMP(3),
    "end_time" TIMESTAMP(3),
    "status" VARCHAR(32) NOT NULL DEFAULT 'draft',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hydro_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hydro_results" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "hydro_user_id" VARCHAR(128) NOT NULL,
    "score" DECIMAL(8,2),
    "status" VARCHAR(32) NOT NULL DEFAULT 'not_started',
    "submit_count" INTEGER NOT NULL DEFAULT 0,
    "last_submit_at" TIMESTAMP(3),
    "raw_result" JSONB,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hydro_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analysis_reports" (
    "id" UUID NOT NULL,
    "student_id" UUID,
    "exam_id" UUID,
    "attempt_id" UUID,
    "class_id" UUID,
    "type" VARCHAR(64) NOT NULL,
    "input_snapshot_json" JSONB NOT NULL,
    "output_json" JSONB,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "model_name" VARCHAR(128),
    "error_message" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_analysis_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompt_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "template_content" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_tasks" (
    "id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "params_json" JSONB NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'pending',
    "file_url" TEXT,
    "error_message" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "export_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "bucket" VARCHAR(64) NOT NULL,
    "object_key" TEXT NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_ext" VARCHAR(32),
    "mime_type" VARCHAR(128),
    "file_size" BIGINT NOT NULL DEFAULT 0,
    "url" TEXT,
    "visibility" "FileVisibility" NOT NULL DEFAULT 'private',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(128) NOT NULL,
    "module" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(64),
    "target_id" UUID,
    "before_data" JSONB,
    "after_data" JSONB,
    "ip" VARCHAR(64),
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(128) NOT NULL,
    "content" TEXT,
    "type" VARCHAR(32) NOT NULL,
    "biz_type" VARCHAR(64),
    "biz_id" UUID,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_user_type_idx" ON "users"("user_type");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "auth_accounts_user_id_provider_idx" ON "auth_accounts"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "auth_accounts_provider_provider_user_id_key" ON "auth_accounts"("provider", "provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_jti_key" ON "refresh_tokens"("jti");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_parent_id_idx" ON "permissions"("parent_id");

-- CreateIndex
CREATE INDEX "role_permissions_role_id_idx" ON "role_permissions"("role_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "user_roles_user_id_idx" ON "user_roles"("user_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_key" ON "courses"("code");

-- CreateIndex
CREATE INDEX "courses_status_idx" ON "courses"("status");

-- CreateIndex
CREATE INDEX "knowledge_points_course_id_idx" ON "knowledge_points"("course_id");

-- CreateIndex
CREATE INDEX "knowledge_points_parent_id_idx" ON "knowledge_points"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_points_course_id_code_key" ON "knowledge_points"("course_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tags_code_key" ON "tags"("code");

-- CreateIndex
CREATE INDEX "tags_type_idx" ON "tags"("type");

-- CreateIndex
CREATE INDEX "questions_course_id_idx" ON "questions"("course_id");

-- CreateIndex
CREATE INDEX "questions_type_idx" ON "questions"("type");

-- CreateIndex
CREATE INDEX "questions_difficulty_idx" ON "questions"("difficulty");

-- CreateIndex
CREATE INDEX "questions_status_idx" ON "questions"("status");

-- CreateIndex
CREATE INDEX "questions_created_by_idx" ON "questions"("created_by");

-- CreateIndex
CREATE INDEX "question_options_question_id_idx" ON "question_options"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_options_question_id_option_key_key" ON "question_options"("question_id", "option_key");

-- CreateIndex
CREATE UNIQUE INDEX "question_answers_question_id_key" ON "question_answers"("question_id");

-- CreateIndex
CREATE INDEX "question_knowledge_points_question_id_idx" ON "question_knowledge_points"("question_id");

-- CreateIndex
CREATE INDEX "question_knowledge_points_knowledge_point_id_idx" ON "question_knowledge_points"("knowledge_point_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_knowledge_points_question_id_knowledge_point_id_key" ON "question_knowledge_points"("question_id", "knowledge_point_id");

-- CreateIndex
CREATE INDEX "question_tags_question_id_idx" ON "question_tags"("question_id");

-- CreateIndex
CREATE INDEX "question_tags_tag_id_idx" ON "question_tags"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_tags_question_id_tag_id_key" ON "question_tags"("question_id", "tag_id");

-- CreateIndex
CREATE INDEX "question_versions_question_id_idx" ON "question_versions"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_versions_question_id_version_key" ON "question_versions"("question_id", "version");

-- CreateIndex
CREATE INDEX "papers_course_id_idx" ON "papers"("course_id");

-- CreateIndex
CREATE INDEX "papers_type_idx" ON "papers"("type");

-- CreateIndex
CREATE INDEX "papers_status_idx" ON "papers"("status");

-- CreateIndex
CREATE INDEX "papers_created_by_idx" ON "papers"("created_by");

-- CreateIndex
CREATE INDEX "paper_sections_paper_id_idx" ON "paper_sections"("paper_id");

-- CreateIndex
CREATE INDEX "paper_questions_paper_id_idx" ON "paper_questions"("paper_id");

-- CreateIndex
CREATE INDEX "paper_questions_section_id_idx" ON "paper_questions"("section_id");

-- CreateIndex
CREATE INDEX "paper_questions_question_id_idx" ON "paper_questions"("question_id");

-- CreateIndex
CREATE INDEX "paper_rules_paper_id_idx" ON "paper_rules"("paper_id");

-- CreateIndex
CREATE INDEX "exams_paper_id_idx" ON "exams"("paper_id");

-- CreateIndex
CREATE INDEX "exams_course_id_idx" ON "exams"("course_id");

-- CreateIndex
CREATE INDEX "exams_class_id_idx" ON "exams"("class_id");

-- CreateIndex
CREATE INDEX "exams_status_idx" ON "exams"("status");

-- CreateIndex
CREATE INDEX "exams_start_time_idx" ON "exams"("start_time");

-- CreateIndex
CREATE INDEX "exams_end_time_idx" ON "exams"("end_time");

-- CreateIndex
CREATE INDEX "paper_instances_exam_id_idx" ON "paper_instances"("exam_id");

-- CreateIndex
CREATE INDEX "paper_instances_student_id_idx" ON "paper_instances"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "paper_instances_exam_id_student_id_key" ON "paper_instances"("exam_id", "student_id");

-- CreateIndex
CREATE INDEX "exam_attempts_exam_id_idx" ON "exam_attempts"("exam_id");

-- CreateIndex
CREATE INDEX "exam_attempts_student_id_idx" ON "exam_attempts"("student_id");

-- CreateIndex
CREATE INDEX "exam_attempts_user_id_idx" ON "exam_attempts"("user_id");

-- CreateIndex
CREATE INDEX "exam_attempts_status_idx" ON "exam_attempts"("status");

-- CreateIndex
CREATE INDEX "answer_records_attempt_id_idx" ON "answer_records"("attempt_id");

-- CreateIndex
CREATE INDEX "answer_records_question_id_idx" ON "answer_records"("question_id");

-- CreateIndex
CREATE INDEX "answer_records_status_idx" ON "answer_records"("status");

-- CreateIndex
CREATE UNIQUE INDEX "answer_records_attempt_id_question_id_key" ON "answer_records"("attempt_id", "question_id");

-- CreateIndex
CREATE INDEX "wrong_questions_student_id_idx" ON "wrong_questions"("student_id");

-- CreateIndex
CREATE INDEX "wrong_questions_question_id_idx" ON "wrong_questions"("question_id");

-- CreateIndex
CREATE INDEX "wrong_questions_source_type_idx" ON "wrong_questions"("source_type");

-- CreateIndex
CREATE INDEX "wrong_questions_mastery_status_idx" ON "wrong_questions"("mastery_status");

-- CreateIndex
CREATE UNIQUE INDEX "wrong_questions_student_id_question_id_key" ON "wrong_questions"("student_id", "question_id");

-- CreateIndex
CREATE INDEX "practice_sessions_student_id_idx" ON "practice_sessions"("student_id");

-- CreateIndex
CREATE INDEX "practice_sessions_course_id_idx" ON "practice_sessions"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "programming_problem_refs_question_id_key" ON "programming_problem_refs"("question_id");

-- CreateIndex
CREATE INDEX "programming_problem_refs_judge_provider_idx" ON "programming_problem_refs"("judge_provider");

-- CreateIndex
CREATE UNIQUE INDEX "programming_problem_refs_judge_provider_external_problem_id_key" ON "programming_problem_refs"("judge_provider", "external_problem_id");

-- CreateIndex
CREATE UNIQUE INDEX "hydro_accounts_student_id_key" ON "hydro_accounts"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "hydro_accounts_hydro_user_id_key" ON "hydro_accounts"("hydro_user_id");

-- CreateIndex
CREATE INDEX "hydro_accounts_hydro_username_idx" ON "hydro_accounts"("hydro_username");

-- CreateIndex
CREATE INDEX "judge_submissions_attempt_id_idx" ON "judge_submissions"("attempt_id");

-- CreateIndex
CREATE INDEX "judge_submissions_question_id_idx" ON "judge_submissions"("question_id");

-- CreateIndex
CREATE INDEX "judge_submissions_student_id_idx" ON "judge_submissions"("student_id");

-- CreateIndex
CREATE INDEX "judge_submissions_status_idx" ON "judge_submissions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "judge_submissions_provider_external_submission_id_key" ON "judge_submissions"("provider", "external_submission_id");

-- CreateIndex
CREATE INDEX "hydro_tasks_course_id_idx" ON "hydro_tasks"("course_id");

-- CreateIndex
CREATE INDEX "hydro_tasks_class_id_idx" ON "hydro_tasks"("class_id");

-- CreateIndex
CREATE INDEX "hydro_tasks_exam_id_idx" ON "hydro_tasks"("exam_id");

-- CreateIndex
CREATE INDEX "hydro_results_task_id_idx" ON "hydro_results"("task_id");

-- CreateIndex
CREATE INDEX "hydro_results_student_id_idx" ON "hydro_results"("student_id");

-- CreateIndex
CREATE INDEX "ai_analysis_reports_student_id_idx" ON "ai_analysis_reports"("student_id");

-- CreateIndex
CREATE INDEX "ai_analysis_reports_exam_id_idx" ON "ai_analysis_reports"("exam_id");

-- CreateIndex
CREATE INDEX "ai_analysis_reports_attempt_id_idx" ON "ai_analysis_reports"("attempt_id");

-- CreateIndex
CREATE INDEX "ai_analysis_reports_class_id_idx" ON "ai_analysis_reports"("class_id");

-- CreateIndex
CREATE INDEX "ai_analysis_reports_type_idx" ON "ai_analysis_reports"("type");

-- CreateIndex
CREATE INDEX "ai_analysis_reports_status_idx" ON "ai_analysis_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_templates_code_key" ON "ai_prompt_templates"("code");

-- CreateIndex
CREATE INDEX "export_tasks_type_idx" ON "export_tasks"("type");

-- CreateIndex
CREATE INDEX "export_tasks_status_idx" ON "export_tasks"("status");

-- CreateIndex
CREATE INDEX "export_tasks_created_by_idx" ON "export_tasks"("created_by");

-- CreateIndex
CREATE INDEX "export_tasks_created_at_idx" ON "export_tasks"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_module_idx" ON "audit_logs"("module");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- AddForeignKey
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "permissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_points" ADD CONSTRAINT "knowledge_points_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_points" ADD CONSTRAINT "knowledge_points_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "knowledge_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_knowledge_points" ADD CONSTRAINT "question_knowledge_points_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_knowledge_points" ADD CONSTRAINT "question_knowledge_points_knowledge_point_id_fkey" FOREIGN KEY ("knowledge_point_id") REFERENCES "knowledge_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_tags" ADD CONSTRAINT "question_tags_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_tags" ADD CONSTRAINT "question_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "papers" ADD CONSTRAINT "papers_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_sections" ADD CONSTRAINT "paper_sections_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_questions" ADD CONSTRAINT "paper_questions_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_questions" ADD CONSTRAINT "paper_questions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "paper_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_questions" ADD CONSTRAINT "paper_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_rules" ADD CONSTRAINT "paper_rules_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_instances" ADD CONSTRAINT "paper_instances_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_paper_instance_id_fkey" FOREIGN KEY ("paper_instance_id") REFERENCES "paper_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_records" ADD CONSTRAINT "answer_records_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_records" ADD CONSTRAINT "answer_records_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wrong_questions" ADD CONSTRAINT "wrong_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programming_problem_refs" ADD CONSTRAINT "programming_problem_refs_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "judge_submissions" ADD CONSTRAINT "judge_submissions_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "judge_submissions" ADD CONSTRAINT "judge_submissions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analysis_reports" ADD CONSTRAINT "ai_analysis_reports_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
