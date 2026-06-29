-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "course_id" UUID,
    "description" TEXT,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_students" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_teachers" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_announcements" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_announcement_reads" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_announcement_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "classes_code_key" ON "classes"("code");

-- CreateIndex
CREATE INDEX "classes_course_id_idx" ON "classes"("course_id");

-- CreateIndex
CREATE INDEX "classes_status_idx" ON "classes"("status");

-- CreateIndex
CREATE INDEX "classes_sort_order_idx" ON "classes"("sort_order");

-- CreateIndex
CREATE INDEX "class_students_class_id_idx" ON "class_students"("class_id");

-- CreateIndex
CREATE INDEX "class_students_student_id_idx" ON "class_students"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_students_class_id_student_id_key" ON "class_students"("class_id", "student_id");

-- CreateIndex
CREATE INDEX "class_teachers_class_id_idx" ON "class_teachers"("class_id");

-- CreateIndex
CREATE INDEX "class_teachers_teacher_id_idx" ON "class_teachers"("teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_teachers_class_id_teacher_id_key" ON "class_teachers"("class_id", "teacher_id");

-- CreateIndex
CREATE INDEX "exam_announcements_exam_id_is_active_idx" ON "exam_announcements"("exam_id", "is_active");

-- CreateIndex
CREATE INDEX "exam_announcements_created_by_idx" ON "exam_announcements"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "exam_announcements_exam_id_version_key" ON "exam_announcements"("exam_id", "version");

-- CreateIndex
CREATE INDEX "exam_announcement_reads_exam_id_user_id_idx" ON "exam_announcement_reads"("exam_id", "user_id");

-- CreateIndex
CREATE INDEX "exam_announcement_reads_user_id_read_at_idx" ON "exam_announcement_reads"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "exam_announcement_reads_announcement_id_user_id_key" ON "exam_announcement_reads"("announcement_id", "user_id");

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_students" ADD CONSTRAINT "class_students_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_students" ADD CONSTRAINT "class_students_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_announcements" ADD CONSTRAINT "exam_announcements_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_announcements" ADD CONSTRAINT "exam_announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_announcement_reads" ADD CONSTRAINT "exam_announcement_reads_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_announcement_reads" ADD CONSTRAINT "exam_announcement_reads_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "exam_announcements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_announcement_reads" ADD CONSTRAINT "exam_announcement_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
