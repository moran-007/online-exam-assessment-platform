INSERT INTO "ai_provider_capabilities" (
  "id", "provider", "model_pattern", "supports_json_object", "supports_json_schema",
  "supports_streaming", "supports_thinking", "max_context_tokens", "max_output_tokens",
  "enabled", "created_at", "updated_at"
)
VALUES (
  gen_random_uuid(), 'deepseek', 'deepseek-v4-*', true, false,
  false, true, 1000000, 384000, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("provider", "model_pattern") DO UPDATE SET
  "supports_json_object" = EXCLUDED."supports_json_object",
  "supports_json_schema" = EXCLUDED."supports_json_schema",
  "supports_thinking" = EXCLUDED."supports_thinking",
  "max_context_tokens" = EXCLUDED."max_context_tokens",
  "max_output_tokens" = EXCLUDED."max_output_tokens",
  "enabled" = true,
  "updated_at" = CURRENT_TIMESTAMP;

UPDATE "ai_summary_prompt_templates"
SET "enabled" = false, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'exam-summary';

INSERT INTO "ai_summary_prompt_templates" (
  "id", "code", "summary_type", "version", "system_prompt", "output_schema",
  "enabled", "reviewed_by", "change_reason", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  "code",
  "summary_type",
  2,
  '你是教学质量分析助手。只能使用用户提供的数据集，不得补充、推测或编造事实。只输出单个紧凑 JSON 对象，不得包含 Markdown。必须保留指定 schemaVersion 和全部顶层字段。每条结论必须同时包含 text 与 evidenceRefs，且 evidenceRefs 只能引用数据集中存在的 refId；具体数字必须与证据一致。数据不足时使用空数组或放入 needsReview。建议必须具体、可执行，不得包含学生个人身份信息。',
  "output_schema",
  (SELECT COUNT(*) > 0 FROM "users" WHERE "user_type" = 'SUPER_ADMIN'::"UserType"),
  (SELECT "id" FROM "users" WHERE "user_type" = 'SUPER_ADMIN'::"UserType" ORDER BY "created_at" ASC LIMIT 1),
  '真实 DeepSeek 验收后加强完整 JSON 骨架、精炼约束和 schemaVersion 容错',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "ai_summary_prompt_templates"
WHERE "code" = 'exam-summary' AND "version" = 1
ON CONFLICT ("code", "version") DO UPDATE SET
  "system_prompt" = EXCLUDED."system_prompt",
  "output_schema" = EXCLUDED."output_schema",
  "enabled" = EXCLUDED."enabled",
  "reviewed_by" = EXCLUDED."reviewed_by",
  "change_reason" = EXCLUDED."change_reason",
  "updated_at" = CURRENT_TIMESTAMP;
