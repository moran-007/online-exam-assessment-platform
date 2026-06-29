-- AlterTable
ALTER TABLE "export_tasks"
ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "max_retries" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "expires_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "wrong_question_events" (
    "id" UUID NOT NULL,
    "wrong_question_id" UUID,
    "student_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "source_type" "WrongQuestionSourceType" NOT NULL,
    "source_id" UUID,
    "event_type" VARCHAR(32) NOT NULL,
    "is_correct" BOOLEAN,
    "score" DECIMAL(8,2),
    "mastery_status" "MasteryStatus",
    "event_json" JSONB,
    "happened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wrong_question_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_tasks_expires_at_idx" ON "export_tasks"("expires_at");

-- CreateIndex
CREATE INDEX "wrong_question_events_wrong_question_id_idx" ON "wrong_question_events"("wrong_question_id");

-- CreateIndex
CREATE INDEX "wrong_question_events_student_id_happened_at_idx" ON "wrong_question_events"("student_id", "happened_at");

-- CreateIndex
CREATE INDEX "wrong_question_events_question_id_happened_at_idx" ON "wrong_question_events"("question_id", "happened_at");

-- CreateIndex
CREATE INDEX "wrong_question_events_source_type_idx" ON "wrong_question_events"("source_type");

-- CreateIndex
CREATE INDEX "wrong_question_events_event_type_idx" ON "wrong_question_events"("event_type");

-- AddForeignKey
ALTER TABLE "wrong_question_events" ADD CONSTRAINT "wrong_question_events_wrong_question_id_fkey" FOREIGN KEY ("wrong_question_id") REFERENCES "wrong_questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wrong_question_events" ADD CONSTRAINT "wrong_question_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wrong_question_events" ADD CONSTRAINT "wrong_question_events_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
