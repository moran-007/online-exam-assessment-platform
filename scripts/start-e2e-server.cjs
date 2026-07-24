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

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module.js');
const { configureApplication } = require('../dist/app.setup.js');
const { AiProviderGateway } = require('../dist/modules/ai/ai-provider.gateway.js');

function e2eCompletion(request) {
  const prompt = `${request.systemPrompt || ''}\n${request.userPrompt || ''}`;
  const explicitSchemaVersion = [
    'exam-summary-output/v1',
    'student-summary-output/v1',
    'class-summary-output/v1',
    'parent-report-output/v1',
    'lesson-assistant-output/v1',
  ].find((candidate) => prompt.includes(candidate));
  const datasetType = prompt.match(/"type"\s*:\s*"(exam|student|class|parent_report|lesson)"/)?.[1];
  const schemaVersion = explicitSchemaVersion || ({
    exam: 'exam-summary-output/v1',
    student: 'student-summary-output/v1',
    class: 'class-summary-output/v1',
    parent_report: 'parent-report-output/v1',
    lesson: 'lesson-assistant-output/v1',
  })[datasetType];
  const evidenceRef = [...prompt.matchAll(/"(?:refId|evidenceRef)"\s*:\s*"([^"]+)"/g)][0]?.[1];
  const content = schemaVersion && evidenceRef
    ? JSON.stringify({
        schemaVersion,
        headline: { text: 'E2E 模型生成的可审核结论', evidenceRefs: [evidenceRef] },
        overview: [{ text: 'E2E 确定性数据概览', evidenceRefs: [evidenceRef] }],
        strengths: [{ text: 'E2E 已验证优势', evidenceRefs: [evidenceRef] }],
        risks: [],
        actions: [{ text: 'E2E 后续行动建议', evidenceRefs: [evidenceRef] }],
        needsReview: [],
      })
    : 'E2E AI 连接与通用总结响应';
  return Promise.resolve({
    content,
    usage: { promptTokens: 120, completionTokens: 80, totalTokens: 200, reported: true },
    durationMs: 1,
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
  configureApplication(app);
  app.get(AiProviderGateway).complete = e2eCompletion;
  await app.listen(Number(backendPort));
}

void bootstrap();
