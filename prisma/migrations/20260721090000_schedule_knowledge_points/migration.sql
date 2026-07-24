ALTER TABLE "lesson_sessions"
ADD COLUMN "knowledge_point_id" UUID;

CREATE INDEX "lesson_sessions_knowledge_point_id_idx"
ON "lesson_sessions"("knowledge_point_id");

ALTER TABLE "lesson_sessions"
ADD CONSTRAINT "lesson_sessions_knowledge_point_id_fkey"
FOREIGN KEY ("knowledge_point_id") REFERENCES "knowledge_points"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
