DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "hydro_accounts" WHERE "login_password" IS NOT NULL) THEN
    RAISE EXCEPTION 'Refusing to drop hydro_accounts.login_password: plaintext rows remain';
  END IF;
END $$;

ALTER TABLE "hydro_accounts" DROP COLUMN "login_password";
