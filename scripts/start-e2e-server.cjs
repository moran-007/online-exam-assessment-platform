const testDatabaseUrl = process.env.TEST_DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5432/online_exam_test?schema=public';
const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
const backendPort = process.env.E2E_BACKEND_PORT || '3100';
const frontendPort = process.env.E2E_FRONTEND_PORT || '5183';

if (!databaseName.endsWith('_test')) {
  throw new Error(`Refusing to start browser tests against non-test database: ${databaseName}`);
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: backendPort,
  DATABASE_URL: testDatabaseUrl,
  JWT_ACCESS_SECRET: 'test_access_secret_that_is_longer_than_32_chars',
  JWT_REFRESH_SECRET: 'test_refresh_secret_that_is_longer_than_32_chars',
  ASSET_URL_SECRET: 'test_asset_secret_that_is_unique_and_long_enough',
  CORS_ORIGINS: `http://127.0.0.1:${frontendPort}`,
  SWAGGER_ENABLED: 'false',
  LOG_PRETTY: 'false',
  LOG_LEVEL: 'silent',
  LOGIN_RATE_LIMIT_MAX: '50',
  UPLOADS_DIR: process.env.TEST_UPLOADS_DIR || require('node:path').join(process.cwd(), 'runtime', 'test-uploads'),
});

require('../dist/main.js');
