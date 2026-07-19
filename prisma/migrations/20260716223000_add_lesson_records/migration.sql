-- CreateEnum
CREATE TYPE "LessonRecordStatus" AS ENUM ('draft', 'submitted', 'published');

-- CreateEnum
CREATE TYPE "LessonRecordVersionAction" AS ENUM ('save_draft', 'submit', 'publish', 'asset_add', 'asset_remove', 'import');

-- CreateEnum
CREATE TYPE "LessonAssetAudience" AS ENUM ('internal', 'learner');

-- CreateTable
CREATE TABLE "lesson_records" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "status" "LessonRecordStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "internal_teaching_notes" TEXT,
    "internal_class_performance" TEXT,
    "public_teaching_content" TEXT,
    "public_learning_goal" TEXT,
    "public_class_performance" TEXT,
    "public_homework" TEXT,
    "public_next_plan" TEXT,
    "public_materials" TEXT,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "published_by" UUID,
    "published_at" TIMESTAMPTZ(3),
    "source_system" VARCHAR(64),
    "legacy_id" VARCHAR(128),
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lesson_records_version_check" CHECK ("version" >= 1)
);

-- CreateTable
CREATE TABLE "lesson_record_versions" (
    "id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "LessonRecordStatus" NOT NULL,
    "action" "LessonRecordVersionAction" NOT NULL,
    "snapshot_json" JSONB NOT NULL,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_record_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lesson_record_versions_version_check" CHECK ("version" >= 1)
);

-- CreateTable
CREATE TABLE "lesson_assets" (
    "id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "file_asset_id" UUID NOT NULL,
    "audience" "LessonAssetAudience" NOT NULL DEFAULT 'internal',
    "title" VARCHAR(180),
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "source_system" VARCHAR(64),
    "legacy_id" VARCHAR(128),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lesson_records_session_id_key" ON "lesson_records"("session_id");
CREATE UNIQUE INDEX "lesson_records_source_system_legacy_id_key" ON "lesson_records"("source_system", "legacy_id");
CREATE INDEX "lesson_records_status_published_at_idx" ON "lesson_records"("status", "published_at");
CREATE UNIQUE INDEX "lesson_record_versions_record_id_version_key" ON "lesson_record_versions"("record_id", "version");
CREATE INDEX "lesson_record_versions_created_by_created_at_idx" ON "lesson_record_versions"("created_by", "created_at");
CREATE UNIQUE INDEX "lesson_assets_record_id_file_asset_id_key" ON "lesson_assets"("record_id", "file_asset_id");
CREATE UNIQUE INDEX "lesson_assets_source_system_legacy_id_key" ON "lesson_assets"("source_system", "legacy_id");
CREATE INDEX "lesson_assets_record_id_audience_sort_order_idx" ON "lesson_assets"("record_id", "audience", "sort_order");
CREATE INDEX "lesson_assets_file_asset_id_idx" ON "lesson_assets"("file_asset_id");

-- AddForeignKey
ALTER TABLE "lesson_records" ADD CONSTRAINT "lesson_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "lesson_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_record_versions" ADD CONSTRAINT "lesson_record_versions_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "lesson_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lesson_assets" ADD CONSTRAINT "lesson_assets_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "lesson_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_assets" ADD CONSTRAINT "lesson_assets_file_asset_id_fkey" FOREIGN KEY ("file_asset_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Version snapshots are append-only and form the audit-grade history.
CREATE OR REPLACE FUNCTION prevent_lesson_record_version_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'lesson_record_versions is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "lesson_record_versions_no_update"
BEFORE UPDATE ON "lesson_record_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_lesson_record_version_mutation();

CREATE TRIGGER "lesson_record_versions_no_delete"
BEFORE DELETE ON "lesson_record_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_lesson_record_version_mutation();

-- Permissions are installed with the schema for non-seeded environments.
INSERT INTO "permissions" (
  "id", "name", "description", "code", "type", "sort_order", "created_at", "updated_at"
)
VALUES
  (gen_random_uuid(), '查看教学记录', '按数据范围查看教学记录和已发布学习内容', 'lesson-record:read', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '维护教学记录', '保存草稿、提交教学记录和维护附件', 'lesson-record:manage', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '发布教学记录', '审核并发布教学记录', 'lesson-record:publish', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '维护课次附件', '上传和移除课次附件', 'lesson-asset:manage', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '读取课次附件', '在教学记录数据范围内预览和下载附件', 'lesson-asset:download', 'API', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON (
  (role."code" IN ('super_admin', 'academic_admin') AND permission."code" IN (
    'lesson-record:read', 'lesson-record:manage', 'lesson-record:publish', 'lesson-asset:manage', 'lesson-asset:download'
  ))
  OR (role."code" = 'teacher' AND permission."code" IN (
    'lesson-record:read', 'lesson-record:manage', 'lesson-record:publish', 'lesson-asset:manage', 'lesson-asset:download'
  ))
  OR (role."code" IN ('student', 'parent') AND permission."code" IN (
    'lesson-record:read', 'lesson-asset:download'
  ))
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
