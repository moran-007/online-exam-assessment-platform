CREATE TYPE "AiSummaryType" AS ENUM ('exam', 'student', 'class', 'parent_report', 'lesson');
CREATE TYPE "AiSummaryTaskStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'cancelled');
CREATE TYPE "AiSummaryReviewStatus" AS ENUM ('draft', 'in_review', 'approved', 'published', 'revoked');

CREATE TABLE "ai_provider_capabilities" (
  "id" UUID NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "model_pattern" VARCHAR(160) NOT NULL,
  "supports_json_object" BOOLEAN NOT NULL DEFAULT false,
  "supports_json_schema" BOOLEAN NOT NULL DEFAULT false,
  "supports_streaming" BOOLEAN NOT NULL DEFAULT false,
  "supports_thinking" BOOLEAN NOT NULL DEFAULT false,
  "max_context_tokens" INTEGER,
  "max_output_tokens" INTEGER,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_provider_capabilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_provider_capabilities_token_limits" CHECK (
    ("max_context_tokens" IS NULL OR "max_context_tokens" > 0) AND
    ("max_output_tokens" IS NULL OR "max_output_tokens" > 0)
  )
);

CREATE TABLE "ai_summary_prompt_templates" (
  "id" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "summary_type" "AiSummaryType" NOT NULL,
  "version" INTEGER NOT NULL,
  "system_prompt" TEXT NOT NULL,
  "output_schema" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "reviewed_by" UUID,
  "change_reason" VARCHAR(300),
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_summary_prompt_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_summary_prompt_templates_version_positive" CHECK ("version" > 0),
  CONSTRAINT "ai_summary_prompt_templates_review_required" CHECK (NOT "enabled" OR "reviewed_by" IS NOT NULL)
);

CREATE TABLE "ai_summary_tasks" (
  "id" UUID NOT NULL,
  "type" "AiSummaryType" NOT NULL,
  "subject_id" UUID NOT NULL,
  "scope_json" JSONB NOT NULL,
  "input_hash" VARCHAR(64) NOT NULL,
  "dataset_version" VARCHAR(32) NOT NULL,
  "prompt_template_id" UUID NOT NULL,
  "prompt_version" INTEGER NOT NULL,
  "schema_version" VARCHAR(32) NOT NULL,
  "provider_config_id" UUID NOT NULL,
  "model_snapshot" VARCHAR(160) NOT NULL,
  "status" "AiSummaryTaskStatus" NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "correlation_id" VARCHAR(64) NOT NULL,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "estimated_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "created_by" UUID NOT NULL,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "sanitized_error" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_summary_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_summary_tasks_input_hash_format" CHECK ("input_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_summary_tasks_nonnegative_usage" CHECK (
    "attempt_count" >= 0 AND "input_tokens" >= 0 AND "output_tokens" >= 0 AND "estimated_cost" >= 0
  ),
  CONSTRAINT "ai_summary_tasks_versions_positive" CHECK ("prompt_version" > 0)
);

CREATE TABLE "ai_summaries" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "type" "AiSummaryType" NOT NULL,
  "subject_id" UUID NOT NULL,
  "summary_json" JSONB NOT NULL,
  "source_snapshot_json" JSONB NOT NULL,
  "evidence_index_json" JSONB NOT NULL,
  "review_status" "AiSummaryReviewStatus" NOT NULL DEFAULT 'draft',
  "draft_version" INTEGER NOT NULL DEFAULT 1,
  "edited_by" UUID,
  "reviewed_by" UUID,
  "published_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_summaries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_summaries_draft_version_positive" CHECK ("draft_version" > 0),
  CONSTRAINT "ai_summaries_publication_state" CHECK (
    ("review_status" <> 'published' OR ("published_at" IS NOT NULL AND "revoked_at" IS NULL)) AND
    ("review_status" <> 'revoked' OR "revoked_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ai_provider_capabilities_provider_model_pattern_key"
  ON "ai_provider_capabilities"("provider", "model_pattern");
CREATE INDEX "ai_provider_capabilities_provider_enabled_idx"
  ON "ai_provider_capabilities"("provider", "enabled");
CREATE UNIQUE INDEX "ai_summary_prompt_templates_code_version_key"
  ON "ai_summary_prompt_templates"("code", "version");
CREATE INDEX "ai_summary_prompt_templates_summary_type_enabled_idx"
  ON "ai_summary_prompt_templates"("summary_type", "enabled");
CREATE UNIQUE INDEX "ai_summary_tasks_correlation_id_key"
  ON "ai_summary_tasks"("correlation_id");
CREATE UNIQUE INDEX "ai_summary_tasks_idempotency_key"
  ON "ai_summary_tasks"(
    "type", "subject_id", "input_hash", "dataset_version", "prompt_version",
    "schema_version", "provider_config_id", "model_snapshot"
  );
CREATE INDEX "ai_summary_tasks_status_created_at_idx"
  ON "ai_summary_tasks"("status", "created_at");
CREATE INDEX "ai_summary_tasks_type_subject_id_created_at_idx"
  ON "ai_summary_tasks"("type", "subject_id", "created_at");
CREATE INDEX "ai_summary_tasks_created_by_created_at_idx"
  ON "ai_summary_tasks"("created_by", "created_at");
CREATE UNIQUE INDEX "ai_summaries_task_id_key" ON "ai_summaries"("task_id");
CREATE INDEX "ai_summaries_type_subject_id_created_at_idx"
  ON "ai_summaries"("type", "subject_id", "created_at");
CREATE INDEX "ai_summaries_review_status_published_at_idx"
  ON "ai_summaries"("review_status", "published_at");

ALTER TABLE "ai_summary_tasks" ADD CONSTRAINT "ai_summary_tasks_provider_config_id_fkey"
  FOREIGN KEY ("provider_config_id") REFERENCES "ai_provider_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_summary_tasks" ADD CONSTRAINT "ai_summary_tasks_prompt_template_id_fkey"
  FOREIGN KEY ("prompt_template_id") REFERENCES "ai_summary_prompt_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "ai_summary_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

WITH ai_permissions(code, name) AS (
  VALUES
    ('ai.summary.exam.generate', '生成考试总结'),
    ('ai.summary.student.generate', '生成学生总结'),
    ('ai.summary.class.generate', '生成班级总结'),
    ('ai.summary.parent-report.generate', '生成家长报告'),
    ('ai.summary.review', '审核 AI 总结'),
    ('ai.summary.publish', '发布 AI 总结'),
    ('ai.summary.revoke', '撤回 AI 总结'),
    ('ai.summary.view-own', '查看本人已发布 AI 总结'),
    ('ai.summary.view-class', '查看班级 AI 总结'),
    ('ai.prompt.manage', '管理 AI 提示模板'),
    ('ai.provider.manage', '管理 AI 模型配置')
)
INSERT INTO "permissions" ("id", "name", "description", "code", "type", "created_at", "updated_at")
SELECT gen_random_uuid(), name, name, code, 'API'::"PermissionType", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM ai_permissions
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON permission."code" LIKE 'ai.%'
WHERE role."code" = 'super_admin'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON permission."code" IN (
  'ai.summary.exam.generate',
  'ai.summary.student.generate',
  'ai.summary.class.generate',
  'ai.summary.parent-report.generate',
  'ai.summary.review',
  'ai.summary.publish',
  'ai.summary.revoke',
  'ai.summary.view-class'
)
WHERE role."code" = 'teacher'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON permission."code" = 'ai.summary.view-own'
WHERE role."code" = 'student'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
