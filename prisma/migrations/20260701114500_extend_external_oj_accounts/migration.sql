DROP INDEX IF EXISTS "hydro_accounts_student_id_key";
DROP INDEX IF EXISTS "hydro_accounts_hydro_user_id_key";

ALTER TABLE "hydro_accounts"
  ADD COLUMN IF NOT EXISTS "platform_code" VARCHAR(32) NOT NULL DEFAULT 'hydro',
  ADD COLUMN IF NOT EXISTS "platform_name" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "platform_base_url" TEXT NOT NULL DEFAULT 'https://oj.example.com',
  ADD COLUMN IF NOT EXISTS "login_username" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "login_password" TEXT,
  ADD COLUMN IF NOT EXISTS "last_login_status" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "last_login_message" TEXT,
  ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMP(3);

UPDATE "hydro_accounts"
SET
  "platform_user_id" = COALESCE("platform_user_id", "student_id"),
  "login_username" = COALESCE("login_username", "hydro_username")
WHERE TRUE;

CREATE INDEX IF NOT EXISTS "hydro_accounts_student_id_idx" ON "hydro_accounts"("student_id");
CREATE INDEX IF NOT EXISTS "hydro_accounts_student_id_platform_code_idx" ON "hydro_accounts"("student_id", "platform_code");
CREATE INDEX IF NOT EXISTS "hydro_accounts_platform_code_platform_base_url_idx" ON "hydro_accounts"("platform_code", "platform_base_url");
