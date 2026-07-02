CREATE TABLE IF NOT EXISTS "external_oj_platforms" (
  "id" UUID NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "name" VARCHAR(64) NOT NULL,
  "base_url" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "external_oj_platforms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "external_oj_platforms_code_key" ON "external_oj_platforms"("code");
CREATE INDEX IF NOT EXISTS "external_oj_platforms_enabled_sort_order_idx" ON "external_oj_platforms"("enabled", "sort_order");
CREATE INDEX IF NOT EXISTS "external_oj_platforms_deleted_at_idx" ON "external_oj_platforms"("deleted_at");

INSERT INTO "external_oj_platforms" ("id", "code", "name", "base_url", "enabled", "sort_order")
VALUES ('00000000-0000-4000-8000-000000000701', 'hydro', 'Hydro', 'https://oj.example.com', true, 1)
ON CONFLICT ("code") DO NOTHING;
