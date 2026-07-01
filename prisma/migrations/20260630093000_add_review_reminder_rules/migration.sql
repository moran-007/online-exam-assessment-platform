CREATE TABLE "review_reminder_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID,
    "class_id" UUID,
    "knowledge_point_id" UUID,
    "intervals_json" JSONB NOT NULL,
    "mastery_rule_json" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_reminder_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "review_reminder_rules_course_id_idx" ON "review_reminder_rules"("course_id");
CREATE INDEX "review_reminder_rules_class_id_idx" ON "review_reminder_rules"("class_id");
CREATE INDEX "review_reminder_rules_knowledge_point_id_idx" ON "review_reminder_rules"("knowledge_point_id");
CREATE INDEX "review_reminder_rules_enabled_idx" ON "review_reminder_rules"("enabled");
