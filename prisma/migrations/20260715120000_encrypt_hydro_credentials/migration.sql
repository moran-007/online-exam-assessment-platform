ALTER TABLE "hydro_accounts"
  ADD COLUMN "login_password_ciphertext" TEXT,
  ADD COLUMN "login_password_iv" VARCHAR(64),
  ADD COLUMN "login_password_auth_tag" VARCHAR(64),
  ADD COLUMN "login_password_key_version" INTEGER;

ALTER TABLE "hydro_accounts"
  ADD CONSTRAINT "hydro_accounts_password_envelope_complete" CHECK (
    (
      "login_password_ciphertext" IS NULL AND
      "login_password_iv" IS NULL AND
      "login_password_auth_tag" IS NULL AND
      "login_password_key_version" IS NULL
    ) OR (
      "login_password_ciphertext" IS NOT NULL AND
      "login_password_iv" IS NOT NULL AND
      "login_password_auth_tag" IS NOT NULL AND
      "login_password_key_version" IS NOT NULL
    )
  );
