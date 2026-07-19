CREATE TYPE "AiFeedbackVerdict" AS ENUM ('helpful', 'partial', 'incorrect');
CREATE TYPE "AiFeedbackStatus" AS ENUM ('open', 'resolved', 'dismissed');
CREATE TYPE "AiRegressionStatus" AS ENUM ('running', 'passed', 'failed');

ALTER TABLE "ai_provider_configs"
  ADD COLUMN "input_cost_per_million" DECIMAL(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN "output_cost_per_million" DECIMAL(12,4) NOT NULL DEFAULT 0;

CREATE TABLE "ai_summary_cache_events" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "type" "AiSummaryType" NOT NULL,
  "cache_hit" BOOLEAN NOT NULL,
  "requested_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_summary_cache_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_summary_feedback" (
  "id" UUID NOT NULL,
  "summary_id" UUID NOT NULL,
  "reported_by" UUID NOT NULL,
  "verdict" "AiFeedbackVerdict" NOT NULL,
  "rating" INTEGER NOT NULL,
  "evidence_ref" VARCHAR(160),
  "comment" TEXT,
  "correction_text" TEXT,
  "status" "AiFeedbackStatus" NOT NULL DEFAULT 'open',
  "resolution_note" TEXT,
  "resolved_by" UUID,
  "resolved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_summary_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_summary_feedback_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

CREATE TABLE "ai_model_regression_runs" (
  "id" UUID NOT NULL,
  "provider_config_id" UUID NOT NULL,
  "prompt_template_id" UUID NOT NULL,
  "summary_type" "AiSummaryType" NOT NULL,
  "status" "AiRegressionStatus" NOT NULL DEFAULT 'running',
  "passed_cases" INTEGER NOT NULL DEFAULT 0,
  "total_cases" INTEGER NOT NULL DEFAULT 0,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "sanitized_error" VARCHAR(500),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  CONSTRAINT "ai_model_regression_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_summary_cache_events_type_created_at_idx" ON "ai_summary_cache_events"("type", "created_at");
CREATE INDEX "ai_summary_cache_events_task_id_created_at_idx" ON "ai_summary_cache_events"("task_id", "created_at");
CREATE INDEX "ai_summary_feedback_summary_id_status_idx" ON "ai_summary_feedback"("summary_id", "status");
CREATE INDEX "ai_summary_feedback_status_created_at_idx" ON "ai_summary_feedback"("status", "created_at");
CREATE INDEX "ai_summary_feedback_reported_by_created_at_idx" ON "ai_summary_feedback"("reported_by", "created_at");
CREATE INDEX "ai_model_regression_runs_summary_type_created_at_idx" ON "ai_model_regression_runs"("summary_type", "created_at");
CREATE INDEX "ai_model_regression_runs_provider_config_id_created_at_idx" ON "ai_model_regression_runs"("provider_config_id", "created_at");

ALTER TABLE "ai_summary_cache_events" ADD CONSTRAINT "ai_summary_cache_events_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "ai_summary_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_summary_feedback" ADD CONSTRAINT "ai_summary_feedback_summary_id_fkey"
  FOREIGN KEY ("summary_id") REFERENCES "ai_summaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_model_regression_runs" ADD CONSTRAINT "ai_model_regression_runs_provider_config_id_fkey"
  FOREIGN KEY ("provider_config_id") REFERENCES "ai_provider_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_model_regression_runs" ADD CONSTRAINT "ai_model_regression_runs_prompt_template_id_fkey"
  FOREIGN KEY ("prompt_template_id") REFERENCES "ai_summary_prompt_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $templates$
DECLARE
  admin_id UUID;
  reviewed BOOLEAN;
  base_schema JSONB;
BEGIN
  SELECT "id" INTO admin_id FROM "users"
  WHERE "user_type" = 'SUPER_ADMIN'::"UserType" ORDER BY "created_at" ASC LIMIT 1;
  reviewed := admin_id IS NOT NULL;
  SELECT "output_schema" INTO base_schema FROM "ai_summary_prompt_templates"
  WHERE "code" = 'student-summary' ORDER BY "version" DESC LIMIT 1;
  UPDATE "ai_summary_prompt_templates" SET "enabled" = false, "updated_at" = CURRENT_TIMESTAMP
  WHERE "code" IN ('student-summary', 'class-summary', 'parent-report', 'lesson-assistant');

  INSERT INTO "ai_summary_prompt_templates" (
    "id", "code", "summary_type", "version", "system_prompt", "output_schema",
    "enabled", "reviewed_by", "change_reason", "created_at", "updated_at"
  ) VALUES
  (
    gen_random_uuid(), 'student-summary', 'student'::"AiSummaryType", 2,
    '你是学习过程分析助手。只能使用输入数据集和 EvidenceRef，不得编造。考试只分析已评分数据；课堂信息只使用已发布教学记录。未提交、未评分和未确认考勤都不能解释为零分或缺勤。作业内容不代表已完成。generationMode=fact_card 时只输出中性事实卡，不生成优势、风险或推断性建议。不得推断态度、人格、家庭、心理、健康或纪律。只输出指定 JSON。',
    base_schema, reviewed, admin_id, '阶段 7 StudentSummaryDataset v2：接入教务事实与少数据降级',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(), 'class-summary', 'class'::"AiSummaryType", 1,
    '你是班级教学分析助手。只能使用班级聚合数据和 EvidenceRef，不得输出或推断任何学生姓名、学生 ID、个人成绩、个人作答或其他隐私明细。未评分不是零分，考勤不能用于推断态度或人格。输出共性问题和可执行教学建议，只返回指定 JSON。',
    jsonb_set(jsonb_set(base_schema, '{$id}', '"class-summary-output/v1"'), '{properties,schemaVersion,const}', '"class-summary-output/v1"'),
    reviewed, admin_id, '阶段 7 班级聚合总结初始受审模板', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(), 'parent-report', 'parent_report'::"AiSummaryType", 1,
    '你是家校沟通助手。只能使用家长可见的已确认或已发布数据和 EvidenceRef。使用中性、清晰、不贴标签的语言；隐藏成绩不可描述或推断，作业内容不代表已完成。不得包含其他学生、内部备注、未发布内容，必须由教师审核后发布。只返回指定 JSON。',
    jsonb_set(jsonb_set(base_schema, '{$id}', '"parent-report-output/v1"'), '{properties,schemaVersion,const}', '"parent-report-output/v1"'),
    reviewed, admin_id, '阶段 7 家长报告初始受审模板', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(), 'lesson-assistant', 'lesson'::"AiSummaryType", 1,
    '你是教师课堂记录助手。只能整理当前课次数据和 EvidenceRef，提出教学记录措辞、作业和下次计划草稿。不得添加学生身份、成绩或未发生事件，不得暴露内部敏感描述。输出永远是教师草稿，不能声称已发布、已布置或已通知。只返回指定 JSON。',
    jsonb_set(jsonb_set(base_schema, '{$id}', '"lesson-assistant-output/v1"'), '{properties,schemaVersion,const}', '"lesson-assistant-output/v1"'),
    reviewed, admin_id, '阶段 7 课堂助手初始受审模板', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
  ON CONFLICT ("code", "version") DO UPDATE SET
    "system_prompt" = EXCLUDED."system_prompt",
    "output_schema" = EXCLUDED."output_schema",
    "enabled" = EXCLUDED."enabled",
    "reviewed_by" = EXCLUDED."reviewed_by",
    "change_reason" = EXCLUDED."change_reason",
    "updated_at" = CURRENT_TIMESTAMP;
END
$templates$;

INSERT INTO "permissions" (
  "id", "name", "description", "code", "type", "sort_order", "created_at", "updated_at"
)
VALUES
  (gen_random_uuid(), '查看融合看板', '按角色和数据范围查看测评与教务融合指标', 'dashboard:read', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '生成课堂助手', '生成课次记录、作业和下次计划草稿', 'ai.summary.lesson.generate', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '提交 AI 反馈', '对本人可见的已发布 AI 内容提交质量反馈', 'ai.feedback.create', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '查看 AI 质量', '查看按功能、模型和模板聚合的 AI 质量数据', 'ai.quality.read', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '处置 AI 质量', '处置事实错误并执行模型回归评测', 'ai.quality.manage', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name", "description" = EXCLUDED."description", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON (
  (role."code" IN ('super_admin', 'academic_admin') AND permission."code" IN (
    'dashboard:read', 'ai.summary.lesson.generate', 'ai.feedback.create', 'ai.quality.read', 'ai.quality.manage'
  ))
  OR (role."code" = 'teacher' AND permission."code" IN (
    'dashboard:read', 'ai.summary.lesson.generate', 'ai.feedback.create', 'ai.quality.read', 'ai.quality.manage'
  ))
  OR (role."code" IN ('student', 'parent') AND permission."code" IN ('dashboard:read', 'ai.feedback.create'))
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
