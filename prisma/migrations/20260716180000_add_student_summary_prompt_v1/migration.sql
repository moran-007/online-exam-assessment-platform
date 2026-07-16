UPDATE "ai_summary_prompt_templates"
SET "enabled" = false, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'student-summary';

INSERT INTO "ai_summary_prompt_templates" (
  "id", "code", "summary_type", "version", "system_prompt", "output_schema",
  "enabled", "reviewed_by", "change_reason", "created_at", "updated_at"
)
VALUES (
  gen_random_uuid(),
  'student-summary',
  'student'::"AiSummaryType",
  1,
  '你是学习分析助手。只能使用用户提供的已评分学习数据，不得补充、推测或编造事实。只输出单个紧凑 JSON 对象，不得包含 Markdown。必须保留指定 schemaVersion 和全部顶层字段。每条结论必须同时包含 text 与 evidenceRefs，且 evidenceRefs 只能引用数据集中存在的 refId；具体数字必须与证据一致。必须说明数据覆盖范围；未提交和未评分不是零分。不得将无数据解释为缺勤、课堂表现、学习态度、家庭情况、心理状态、人格、健康或纪律问题。数据不足时使用空数组或放入 needsReview。建议必须具体、可执行。',
  $schema${
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "student-summary-output/v1",
    "type": "object",
    "additionalProperties": false,
    "required": ["schemaVersion", "headline", "overview", "strengths", "risks", "actions", "needsReview"],
    "properties": {
      "schemaVersion": { "const": "student-summary-output/v1" },
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
  '阶段 3 学生总结 MVP 初始受审版本',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code", "version") DO UPDATE SET
  "system_prompt" = EXCLUDED."system_prompt",
  "output_schema" = EXCLUDED."output_schema",
  "enabled" = EXCLUDED."enabled",
  "reviewed_by" = EXCLUDED."reviewed_by",
  "change_reason" = EXCLUDED."change_reason",
  "updated_at" = CURRENT_TIMESTAMP;
