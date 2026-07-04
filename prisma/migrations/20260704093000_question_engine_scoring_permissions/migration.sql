CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "permissions" ADD COLUMN "description" TEXT;

CREATE TYPE "ScoringEvaluationSource" AS ENUM ('auto', 'manual', 'judge', 'regrade', 'ai_suggestion');
CREATE TYPE "ScoringEvaluationStatus" AS ENUM ('trial', 'official', 'superseded');
CREATE TYPE "RegradeRunStatus" AS ENUM ('processing', 'previewed', 'applying', 'applied', 'cancelled', 'failed', 'expired');
CREATE TYPE "RegradeRuleSource" AS ENUM ('snapshot', 'latest', 'specified');

ALTER TABLE "question_answers" ADD COLUMN "current_rule_version_id" UUID;
ALTER TABLE "answer_records" ADD COLUMN "current_evaluation_id" UUID;
ALTER TABLE "wrong_questions" ADD COLUMN "context_snapshot_json" JSONB;
ALTER TABLE "files" ADD COLUMN "sha256" VARCHAR(64), ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "question_compositions" (
  "id" UUID NOT NULL, "parent_question_id" UUID NOT NULL,
  "child_question_id" UUID NOT NULL, "score" DECIMAL(8,2) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0, "config_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "question_compositions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scoring_rule_versions" (
  "id" UUID NOT NULL, "question_id" UUID NOT NULL, "version" INTEGER NOT NULL,
  "adapter_key" VARCHAR(64) NOT NULL, "adapter_version" INTEGER NOT NULL DEFAULT 1,
  "answer_json" JSONB NOT NULL, "rule_json" JSONB, "rubric_json" JSONB,
  "checksum" VARCHAR(64) NOT NULL, "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scoring_rule_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "regrade_runs" (
  "id" UUID NOT NULL, "status" "RegradeRunStatus" NOT NULL DEFAULT 'processing',
  "exam_id" UUID NOT NULL, "requested_by" UUID NOT NULL, "confirmed_by" UUID,
  "rule_source" "RegradeRuleSource" NOT NULL DEFAULT 'snapshot', "scoring_rule_version_id" UUID,
  "filters_json" JSONB NOT NULL, "summary_json" JSONB, "reason" TEXT, "fingerprint" VARCHAR(64),
  "error_message" TEXT, "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  "confirmed_at" TIMESTAMP(3), CONSTRAINT "regrade_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scoring_evaluations" (
  "id" UUID NOT NULL, "answer_record_id" UUID NOT NULL,
  "scoring_rule_version_id" UUID, "regrade_run_id" UUID,
  "source" "ScoringEvaluationSource" NOT NULL, "status" "ScoringEvaluationStatus" NOT NULL,
  "adapter_key" VARCHAR(64) NOT NULL, "adapter_version" INTEGER NOT NULL DEFAULT 1,
  "score" DECIMAL(8,2) NOT NULL, "max_score" DECIMAL(8,2) NOT NULL, "is_correct" BOOLEAN,
  "detail_json" JSONB NOT NULL, "rule_snapshot_json" JSONB, "answer_fingerprint" VARCHAR(64) NOT NULL,
  "graded_by" UUID, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scoring_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scoring_evaluations_ai_not_official_check" CHECK ("source" <> 'ai_suggestion' OR "status" <> 'official')
);

CREATE UNIQUE INDEX "question_compositions_parent_question_id_child_question_id_key" ON "question_compositions"("parent_question_id", "child_question_id");
CREATE INDEX "question_compositions_parent_question_id_sort_order_idx" ON "question_compositions"("parent_question_id", "sort_order");
CREATE INDEX "question_compositions_child_question_id_idx" ON "question_compositions"("child_question_id");
CREATE UNIQUE INDEX "scoring_rule_versions_question_id_version_key" ON "scoring_rule_versions"("question_id", "version");
CREATE INDEX "scoring_rule_versions_question_id_created_at_idx" ON "scoring_rule_versions"("question_id", "created_at");
CREATE UNIQUE INDEX "question_answers_current_rule_version_id_key" ON "question_answers"("current_rule_version_id");
CREATE UNIQUE INDEX "answer_records_current_evaluation_id_key" ON "answer_records"("current_evaluation_id");
CREATE INDEX "regrade_runs_exam_id_status_idx" ON "regrade_runs"("exam_id", "status");
CREATE INDEX "regrade_runs_requested_by_created_at_idx" ON "regrade_runs"("requested_by", "created_at");
CREATE INDEX "regrade_runs_expires_at_idx" ON "regrade_runs"("expires_at");
CREATE INDEX "scoring_evaluations_answer_record_id_created_at_idx" ON "scoring_evaluations"("answer_record_id", "created_at");
CREATE INDEX "scoring_evaluations_regrade_run_id_idx" ON "scoring_evaluations"("regrade_run_id");
CREATE INDEX "scoring_evaluations_scoring_rule_version_id_idx" ON "scoring_evaluations"("scoring_rule_version_id");
CREATE INDEX "scoring_evaluations_status_source_idx" ON "scoring_evaluations"("status", "source");

ALTER TABLE "question_compositions" ADD CONSTRAINT "question_compositions_parent_question_id_fkey" FOREIGN KEY ("parent_question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "question_compositions" ADD CONSTRAINT "question_compositions_child_question_id_fkey" FOREIGN KEY ("child_question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scoring_rule_versions" ADD CONSTRAINT "scoring_rule_versions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_current_rule_version_id_fkey" FOREIGN KEY ("current_rule_version_id") REFERENCES "scoring_rule_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scoring_evaluations" ADD CONSTRAINT "scoring_evaluations_answer_record_id_fkey" FOREIGN KEY ("answer_record_id") REFERENCES "answer_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scoring_evaluations" ADD CONSTRAINT "scoring_evaluations_scoring_rule_version_id_fkey" FOREIGN KEY ("scoring_rule_version_id") REFERENCES "scoring_rule_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scoring_evaluations" ADD CONSTRAINT "scoring_evaluations_regrade_run_id_fkey" FOREIGN KEY ("regrade_run_id") REFERENCES "regrade_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "answer_records" ADD CONSTRAINT "answer_records_current_evaluation_id_fkey" FOREIGN KEY ("current_evaluation_id") REFERENCES "scoring_evaluations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "scoring_rule_versions" ("id", "question_id", "version", "adapter_key", "adapter_version", "answer_json", "rule_json", "rubric_json", "checksum", "created_at")
SELECT gen_random_uuid(), qa."question_id", 1, lower(q."type"::text), 1, qa."answer_json", qa."scoring_rule_json",
       qa."scoring_rule_json"->'rubric', encode(digest(qa."answer_json"::text || COALESCE(qa."scoring_rule_json"::text, 'null'), 'sha256'), 'hex'), CURRENT_TIMESTAMP
FROM "question_answers" qa JOIN "questions" q ON q."id" = qa."question_id";

UPDATE "question_answers" qa SET "current_rule_version_id" = srv."id"
FROM "scoring_rule_versions" srv WHERE srv."question_id" = qa."question_id" AND srv."version" = 1;

INSERT INTO "scoring_evaluations" ("id", "answer_record_id", "scoring_rule_version_id", "source", "status", "adapter_key", "adapter_version", "score", "max_score", "is_correct", "detail_json", "rule_snapshot_json", "answer_fingerprint", "graded_by", "created_at")
SELECT gen_random_uuid(), ar."id", qa."current_rule_version_id",
  CASE WHEN ar."status" IN ('manual_needed', 'manual_graded') THEN 'manual'::"ScoringEvaluationSource"
       WHEN ar."status" IN ('judge_pending', 'judge_done') THEN 'judge'::"ScoringEvaluationSource"
       ELSE 'auto'::"ScoringEvaluationSource" END,
  'official'::"ScoringEvaluationStatus", lower(q."type"::text), 1, ar."score", q."default_score",
  ar."is_correct", COALESCE(ar."auto_result_json", '{}'::jsonb), qa."scoring_rule_json",
  encode(digest(ar."answer_json"::text || ar."updated_at"::text, 'sha256'), 'hex'), ar."graded_by", ar."updated_at"
FROM "answer_records" ar JOIN "questions" q ON q."id" = ar."question_id"
LEFT JOIN "question_answers" qa ON qa."question_id" = q."id";

UPDATE "answer_records" ar SET "current_evaluation_id" = se."id"
FROM "scoring_evaluations" se WHERE se."answer_record_id" = ar."id" AND se."status" = 'official';

WITH permission_values(code, name, sort_order) AS (
  VALUES
    ('grading:score:read', '查看成绩', 401), ('grading:score:update', '修改成绩', 402),
    ('grading:rubric:update', '按评分量表批改', 403), ('grading:regrade:preview', '试算重判', 404),
    ('grading:regrade:confirm', '确认重判', 405), ('exam:answer:read', '查看学生作答', 406),
    ('question:answer:read', '查看参考答案', 407), ('question:analysis:read', '查看题目解析', 408),
    ('student:identity:read', '查看学生身份信息', 409), ('export:task:create', '创建导出任务', 410),
    ('export:task:read', '查看导出任务', 411), ('export:file:download', '下载导出文件', 412),
    ('attachment:preview', '预览附件', 413), ('attachment:download', '下载附件', 414)
)
INSERT INTO "permissions" ("id", "name", "code", "type", "sort_order", "created_at", "updated_at")
SELECT gen_random_uuid(), name, code, 'API'::"PermissionType", sort_order, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM permission_values ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "sort_order" = EXCLUDED."sort_order", "updated_at" = CURRENT_TIMESTAMP;

UPDATE "permissions" SET "description" = CASE
  WHEN "code" IN ('question:read','grading:read','grading:update','exam:result:read','exam:result:export') THEN '兼容旧版总权限；建议自定义角色改用细分权限'
  ELSE COALESCE("description", "name") END;

UPDATE "permissions" SET "name" = CASE "code"
  WHEN 'course:read' THEN '查看课程' WHEN 'course:create' THEN '新增课程' WHEN 'course:update' THEN '修改课程'
  WHEN 'knowledge-point:read' THEN '查看知识点' WHEN 'knowledge-point:create' THEN '新增知识点' WHEN 'knowledge-point:update' THEN '修改知识点'
  WHEN 'tag:read' THEN '查看标签' WHEN 'tag:create' THEN '新增标签' WHEN 'tag:update' THEN '修改标签'
  WHEN 'question:read' THEN '题库管理（兼容总权限）' WHEN 'question:create' THEN '新增题目' WHEN 'question:update' THEN '修改题目'
  WHEN 'question:publish' THEN '发布题目' WHEN 'question:delete' THEN '删除题目'
  WHEN 'paper:read' THEN '查看试卷' WHEN 'paper:create' THEN '新增试卷' WHEN 'paper:update' THEN '修改试卷' WHEN 'paper:publish' THEN '发布试卷'
  WHEN 'exam:read' THEN '查看考试' WHEN 'exam:create' THEN '新增考试' WHEN 'exam:update' THEN '修改考试' WHEN 'exam:delete' THEN '删除考试' WHEN 'exam:publish' THEN '发布考试'
  WHEN 'exam:result:read' THEN '查看考试结果（兼容总权限）' WHEN 'exam:result:export' THEN '导出考试结果（兼容总权限）'
  WHEN 'class:read' THEN '查看班级' WHEN 'class:create' THEN '新增班级' WHEN 'class:update' THEN '修改班级'
  WHEN 'grading:read' THEN '查看批改任务（兼容总权限）' WHEN 'grading:update' THEN '执行批改（兼容总权限）'
  WHEN 'statistics:read' THEN '查看统计' WHEN 'audit-log:read' THEN '查看审计日志'
  WHEN 'hydro:platform:manage' THEN '管理 Hydro 平台' WHEN 'hydro:problem:bind' THEN '绑定 Hydro 题目'
  WHEN 'hydro:account:read' THEN '查看 Hydro 账号' WHEN 'hydro:account:update' THEN '修改 Hydro 账号' WHEN 'hydro:result:write' THEN '写入 Hydro 结果'
  ELSE "name" END;

UPDATE "roles" SET "name" = CASE "code" WHEN 'super_admin' THEN '超级管理员' WHEN 'teacher' THEN '教师' WHEN 'student' THEN '学生' ELSE "name" END
WHERE "code" IN ('super_admin', 'teacher', 'student');

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", CURRENT_TIMESTAMP FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" IN ('super_admin', 'teacher') AND p."code" IN (
  'grading:score:read','grading:score:update','grading:rubric:update','grading:regrade:preview','grading:regrade:confirm',
  'exam:answer:read','question:answer:read','question:analysis:read','student:identity:read',
  'export:task:create','export:task:read','export:file:download','attachment:preview','attachment:download'
) ON CONFLICT ("role_id", "permission_id") DO NOTHING;
