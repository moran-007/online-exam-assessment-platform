import { join } from 'node:path';

const testDatabaseUrl = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/online_exam_test?schema=public';
const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!databaseName.endsWith('_test')) {
  throw new Error(`Refusing to run integration tests against non-test database: ${databaseName}`);
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;
process.env.JWT_ACCESS_SECRET = 'test_access_secret_that_is_longer_than_32_chars';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_that_is_longer_than_32_chars';
process.env.ASSET_URL_SECRET = 'test_asset_secret_that_is_unique_and_long_enough';
process.env.SWAGGER_ENABLED = 'false';
process.env.LOG_PRETTY = 'false';
process.env.LOG_LEVEL = 'silent';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.UPLOADS_DIR = process.env.TEST_UPLOADS_DIR || join(process.cwd(), 'runtime', 'test-uploads');
