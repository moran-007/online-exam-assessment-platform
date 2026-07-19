-- Existing worker imports did not have a reliable course mapping. Preserve those
-- rows explicitly, while requiring every normal new unit to belong to a course.
ALTER TABLE "course_unit_templates"
  ADD COLUMN "legacy_unscoped" BOOLEAN NOT NULL DEFAULT false;

UPDATE "course_unit_templates"
SET "legacy_unscoped" = true
WHERE "course_id" IS NULL;

ALTER TABLE "course_unit_templates"
  ADD CONSTRAINT "course_unit_templates_course_scope_check"
  CHECK ("course_id" IS NOT NULL OR "legacy_unscoped" = true);
