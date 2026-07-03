ALTER TABLE "refresh_tokens"
  ADD COLUMN "session_id" VARCHAR(64),
  ADD COLUMN "remember_me" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "last_activity_at" TIMESTAMP(3);

UPDATE "refresh_tokens"
SET
  "session_id" = "jti",
  "last_activity_at" = "created_at";

ALTER TABLE "refresh_tokens"
  ALTER COLUMN "session_id" SET NOT NULL,
  ALTER COLUMN "last_activity_at" SET NOT NULL,
  ALTER COLUMN "last_activity_at" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");
