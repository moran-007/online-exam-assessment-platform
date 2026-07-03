import { validateEnv } from '../../src/config/env.validation';

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@db.example.com:5432/exam',
  JWT_ACCESS_SECRET: 'access_secret_that_is_longer_than_32_characters',
  JWT_REFRESH_SECRET: 'refresh_secret_that_is_longer_than_32_characters',
  ASSET_URL_SECRET: 'asset_secret_that_is_unique_and_longer_than_32_chars',
  CORS_ORIGINS: 'https://exam.example.com',
};

describe('validateEnv', () => {
  it('accepts explicit production origins and unique secrets', () => {
    expect(validateEnv({ ...productionEnv })).toMatchObject(productionEnv);
  });

  it.each(['', '*', 'http://localhost:5173', 'https://exam.example.com/path'])(
    'rejects unsafe production CORS_ORIGINS: %s',
    (corsOrigins) => {
      expect(() => validateEnv({ ...productionEnv, CORS_ORIGINS: corsOrigins })).toThrow();
    },
  );

  it('rejects an asset signing secret reused from JWT secrets', () => {
    expect(() => validateEnv({
      ...productionEnv,
      ASSET_URL_SECRET: productionEnv.JWT_ACCESS_SECRET,
    })).toThrow(/ASSET_URL_SECRET/);
  });
});
