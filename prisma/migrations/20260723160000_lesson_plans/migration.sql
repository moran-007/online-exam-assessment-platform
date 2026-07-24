CREATE TYPE "LessonPlanSource" AS ENUM ('system', 'personal');

CREATE TABLE "lesson_plans" (
    "id" UUID NOT NULL,
    "source" "LessonPlanSource" NOT NULL,
    "course_id" UUID NOT NULL,
    "knowledge_point_id" UUID,
    "author_id" UUID NOT NULL,
    "theme" VARCHAR(200) NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lesson_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lesson_plans_course_id_knowledge_point_id_idx"
    ON "lesson_plans"("course_id", "knowledge_point_id");
CREATE INDEX "lesson_plans_source_author_id_idx"
    ON "lesson_plans"("source", "author_id");
CREATE INDEX "lesson_plans_updated_at_idx"
    ON "lesson_plans"("updated_at");

ALTER TABLE "lesson_plans"
    ADD CONSTRAINT "lesson_plans_course_id_fkey"
    FOREIGN KEY ("course_id") REFERENCES "courses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lesson_plans"
    ADD CONSTRAINT "lesson_plans_knowledge_point_id_fkey"
    FOREIGN KEY ("knowledge_point_id") REFERENCES "knowledge_points"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lesson_plans"
    ADD CONSTRAINT "lesson_plans_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
