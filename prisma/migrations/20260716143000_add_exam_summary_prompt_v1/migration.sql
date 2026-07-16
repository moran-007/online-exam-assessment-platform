ALTER TABLE "ai_summary_tasks"
  ADD COLUMN "input_snapshot_json" JSONB,
  ADD COLUMN "requested_output_tokens" INTEGER NOT NULL DEFAULT 1000;

UPDATE "ai_summary_tasks"
SET "input_snapshot_json" = '{}'::jsonb
WHERE "input_snapshot_json" IS NULL;

ALTER TABLE "ai_summary_tasks"
  ALTER COLUMN "input_snapshot_json" SET NOT NULL;

INSERT INTO "ai_summary_prompt_templates" (
  "id", "code", "summary_type", "version", "system_prompt", "output_schema",
  "enabled", "reviewed_by", "change_reason", "created_at", "updated_at"
)
VALUES (
  gen_random_uuid(),
  'exam-summary',
  'exam'::"AiSummaryType",
  1,
  '你是教学质量分析助手。只能使用用户提供的数据集，不得补充、推测或编造事实。输出必须是符合指定 JSON Schema 的单个 JSON 对象，不得包含 Markdown。每条结论必须引用数据集中存在的 evidenceRef；具体数字必须与证据一致。数据覆盖不足或需要人工判断的内容放入 needsReview。建议必须具体、可执行，且不得包含学生个人身份信息。',
  $schema${
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "exam-summary-output/v1",
    "type": "object",
    "additionalProperties": false,
    "required": ["schemaVersion", "headline", "overview", "strengths", "risks", "actions", "needsReview"],
    "properties": {
      "schemaVersion": { "const": "exam-summary-output/v1" },
      "headline": { "$ref": "#/$defs/claim" },
      "overview": { "$ref": "#/$defs/claims" },
      "strengths": { "$ref": "#/$defs/claims" },
      "risks": { "$ref": "#/$defs/claims" },
      "actions": { "$ref": "#/$defs/claims" },
      "needsReview": { "$ref": "#/$defs/claims" }
    },
    "$defs": {
      "claim": {
        "type": "object",
        "additionalProperties": false,
        "required": ["text", "evidenceRefs"],
        "properties": {
          "text": { "type": "string", "minLength": 1, "maxLength": 500 },
          "evidenceRefs": {
            "type": "array", "minItems": 1, "uniqueItems": true,
            "items": { "type": "string", "minLength": 1, "maxLength": 160 }
          }
        }
      },
      "claims": {
        "type": "array", "maxItems": 20,
        "items": { "$ref": "#/$defs/claim" }
      }
    }
  }$schema$::jsonb,
  (SELECT COUNT(*) > 0 FROM "users" WHERE "user_type" = 'SUPER_ADMIN'::"UserType"),
  (SELECT "id" FROM "users" WHERE "user_type" = 'SUPER_ADMIN'::"UserType" ORDER BY "created_at" ASC LIMIT 1),
  '阶段 2 考试总结 MVP 初始受审版本',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code", "version") DO NOTHING;
