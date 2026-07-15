import { validateEnv } from '../../src/config/env.validation';

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@db.example.com:5432/exam',
  JWT_ACCESS_SECRET: 'access_secret_that_is_longer_than_32_characters',
  JWT_REFRESH_SECRET: 'refresh_secret_that_is_longer_than_32_characters',
  ASSET_URL_SECRET: 'asset_secret_that_is_unique_and_longer_than_32_chars',
  CREDENTIAL_ENCRYPTION_ACTIVE_VERSION: '1',
  CREDENTIAL_ENCRYPTION_KEYS: '{"1":"Zmlyc3RfY3JlZGVudGlhbF9lbmNyeXB0aW9uX2tleTE="}',
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

  it('rejects a missing or malformed production credential encryption key', () => {
    expect(() => validateEnv({
      ...productionEnv,
      CREDENTIAL_ENCRYPTION_KEYS: '',
    })).toThrow(/CREDENTIAL_ENCRYPTION_KEYS/);
    expect(() => validateEnv({
      ...productionEnv,
      CREDENTIAL_ENCRYPTION_KEYS: '{"1":"too-short"}',
    })).toThrow(/32-byte/);
  });
});
