ALTER TABLE "ai_summaries"
  ADD CONSTRAINT "ai_summaries_reviewed_before_approval" CHECK (
    "review_status" NOT IN ('approved', 'published', 'revoked') OR "reviewed_by" IS NOT NULL
  ),
  ADD CONSTRAINT "ai_summaries_published_timestamp_required" CHECK (
    "review_status" NOT IN ('published', 'revoked') OR "published_at" IS NOT NULL
  ),
  ADD CONSTRAINT "ai_summaries_revoked_timestamp_required" CHECK (
    "review_status" <> 'revoked' OR "revoked_at" IS NOT NULL
  );
