import { INestApplication } from '@nestjs/common';
import { PrismaClient, ScoringEvaluationSource, ScoringEvaluationStatus, UserStatus, UserType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request = require('supertest');
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestApp } from '../helpers/test-app';

jest.setTimeout(60_000);

const binaryParser = (
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body?: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', (error: Error) => callback(error));
};

describe('core API flows', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken = '';
  let studentToken = '';
  const assetFile = 'integration-secure-asset.png';
  const testUploadsRoot = process.env.UPLOADS_DIR || join(process.cwd(), 'runtime', 'test-uploads');
  const assetPath = join(testUploadsRoot, 'question-assets', assetFile);

  beforeAll(async () => {
    await rm(testUploadsRoot, { recursive: true, force: true });
    prisma = new PrismaClient();
    await resetDatabase(prisma);
    const passwordHash = await bcrypt.hash('123456', 4);
    const admin = await prisma.user.create({
      data: { username: 'test_admin', passwordHash, realName: 'Test Admin', userType: UserType.SUPER_ADMIN },
    });
    await prisma.user.create({
      data: { username: 'test_student', passwordHash, realName: 'Test Student', userType: UserType.STUDENT },
    });
    await prisma.user.create({
      data: { username: 'test_disabled', passwordHash, realName: 'Disabled', userType: UserType.STUDENT, status: UserStatus.DISABLED },
    });
    expect(admin.id).toBeTruthy();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await rm(testUploadsRoot, { recursive: true, force: true });
  });

  it('validates login, disabled accounts, refresh rotation, logout and permissions', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ username: 'test_admin', password: 'wrong' }).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ username: 'test_disabled', password: '123456' }).expect(401);

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'test_admin', password: '123456', rememberMe: false })
      .expect(201);
    adminToken = adminLogin.body.data.accessToken;
    const originalRefresh = adminLogin.body.data.refreshToken;
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: originalRefresh })
      .expect(201);
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: originalRefresh }).expect(401);

    const studentLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'test_student', password: '123456' })
      .expect(201);
    studentToken = studentLogin.body.data.accessToken;
    await request(app.getHttpServer()).get('/api/v1/questions').auth(studentToken, { type: 'bearer' }).expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .auth(rotated.body.data.accessToken, { type: 'bearer' })
      .send({ refreshToken: rotated.body.data.refreshToken })
      .expect(201);
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: rotated.body.data.refreshToken }).expect(401);

    const relogin = await login('test_admin');
    adminToken = relogin.accessToken;
  });

  it('runs question, paper, exam, autosave and objective grading lifecycle', async () => {
    const course = await api('post', '/api/v1/courses', adminToken, {
      name: 'Integration Course', code: 'integration_course', description: 'integration', sortOrder: 1,
    });
    const question = await api('post', '/api/v1/questions', adminToken, {
      courseId: course.id,
      type: 'single_choice',
      title: 'Integration objective question',
      content: 'Choose A',
      difficulty: 1,
      defaultScore: 5,
      options: [
        { optionKey: 'A', content: 'Correct', isCorrect: true, sortOrder: 1 },
        { optionKey: 'B', content: 'Wrong', isCorrect: false, sortOrder: 2 },
      ],
    });
    await api('post', `/api/v1/questions/${question.id}/publish`, adminToken);
    const correct = await prisma.questionOption.findFirstOrThrow({ where: { questionId: question.id, isCorrect: true } });

    const paper = await api('post', '/api/v1/papers', adminToken, {
      name: 'Integration Paper', courseId: course.id, durationMinutes: 30, type: 'fixed',
    });
    await api('post', `/api/v1/papers/${paper.id}/questions`, adminToken, { questionId: question.id, score: 5, sortOrder: 1 });
    await api('post', `/api/v1/papers/${paper.id}/publish`, adminToken);

    const exam = await api('post', '/api/v1/exams', adminToken, {
      paperId: paper.id,
      name: 'Integration Exam',
      courseId: course.id,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 30 * 60_000).toISOString(),
      durationMinutes: 30,
      attemptLimit: 1,
      showScoreMode: 'after_submit',
    });
    await api('post', `/api/v1/exams/${exam.id}/publish`, adminToken);
    await api('post', `/api/v1/exams/${exam.id}/start`, adminToken);

    const attempt = await api('post', `/api/v1/student/exams/${exam.id}/enter`, studentToken);
    const saved = await api('post', `/api/v1/student/attempts/${attempt.attemptId}/save-answers`, studentToken, {
      answers: [{ questionId: question.id, answer: { selectedOptionIds: [correct.id] } }],
    });
    expect(saved.saved).toBe(true);
    const submitted = await api('post', `/api/v1/student/attempts/${attempt.attemptId}/submit`, studentToken);
    expect(Number(submitted.totalScore)).toBe(5);
    await api('post', `/api/v1/exams/${exam.id}/end`, adminToken);
    await request(app.getHttpServer())
      .post(`/api/v1/student/attempts/${attempt.attemptId}/save-answers`)
      .auth(studentToken, { type: 'bearer' })
      .send({ answers: [{ questionId: question.id, answer: { selectedOptionIds: [] } }] })
      .expect(400);
  });

  it('runs material children, rubric history and preview-confirm regrading without AI score writes', async () => {
    const course = await prisma.course.findFirstOrThrow({ where: { code: 'integration_course' } });
    const choice = await api('post', '/api/v1/questions', adminToken, {
      courseId: course.id, type: 'single_choice', title: 'Material choice', content: 'Choose A', difficulty: 1, defaultScore: 3,
      options: [
        { optionKey: 'A', content: 'Correct', isCorrect: true, sortOrder: 1 },
        { optionKey: 'B', content: 'Wrong', isCorrect: false, sortOrder: 2 },
      ],
    });
    const subjective = await api('post', '/api/v1/questions', adminToken, {
      courseId: course.id, type: 'short_answer', title: 'Material explanation', content: 'Explain', difficulty: 2, defaultScore: 7,
      answer: { reference: 'reference' },
      scoringRule: { rubric: [{ id: 'accuracy', name: '准确性', maxScore: 5 }, { id: 'clarity', name: '表达', maxScore: 2 }] },
    });
    await api('post', `/api/v1/questions/${choice.id}/publish`, adminToken);
    await api('post', `/api/v1/questions/${subjective.id}/publish`, adminToken);
    const material = await api('post', '/api/v1/questions', adminToken, {
      courseId: course.id, type: 'material', title: 'Material container', content: 'Read this material', difficulty: 2, defaultScore: 1,
      children: [
        { questionId: choice.id, score: 3, sortOrder: 1 },
        { questionId: subjective.id, score: 7, sortOrder: 2 },
      ],
    });
    await api('post', `/api/v1/questions/${material.id}/publish`, adminToken);
    const materialDetail = await api('get', `/api/v1/questions/${material.id}`, adminToken);
    expect(materialDetail.children).toHaveLength(2);
    expect(Number(materialDetail.defaultScore)).toBe(10);

    const paper = await api('post', '/api/v1/papers', adminToken, {
      name: 'Material Paper', courseId: course.id, durationMinutes: 30, type: 'fixed',
    });
    await api('post', `/api/v1/papers/${paper.id}/questions`, adminToken, { questionId: material.id, score: 999, sortOrder: 1 });
    await api('post', `/api/v1/papers/${paper.id}/publish`, adminToken);
    const exam = await api('post', '/api/v1/exams', adminToken, {
      paperId: paper.id, name: 'Material Exam', courseId: course.id,
      startTime: new Date(Date.now() - 60_000).toISOString(), endTime: new Date(Date.now() + 30 * 60_000).toISOString(),
      durationMinutes: 30, attemptLimit: 1, showScoreMode: 'after_graded',
    });
    await api('post', `/api/v1/exams/${exam.id}/publish`, adminToken);
    await api('post', `/api/v1/exams/${exam.id}/start`, adminToken);
    const attempt = await api('post', `/api/v1/student/exams/${exam.id}/enter`, studentToken);
    expect(attempt.paper.sections[0].questions[0].children).toHaveLength(2);
    const correct = await prisma.questionOption.findFirstOrThrow({ where: { questionId: choice.id, isCorrect: true } });
    await api('post', `/api/v1/student/attempts/${attempt.attemptId}/save-answers`, studentToken, {
      answers: [
        { questionId: choice.id, answer: { selectedOptionIds: [correct.id] } },
        { questionId: subjective.id, answer: { text: 'clear explanation' } },
      ],
    });
    await api('post', `/api/v1/student/attempts/${attempt.attemptId}/submit`, studentToken);
    const subjectiveRecord = await prisma.answerRecord.findUniqueOrThrow({
      where: { attemptId_questionId: { attemptId: attempt.attemptId, questionId: subjective.id } },
    });
    await api('patch', `/api/v1/grading/answers/${subjectiveRecord.id}`, adminToken, {
      rubricScores: [
        { criterionId: 'accuracy', score: 5 },
        { criterionId: 'clarity', score: 2 },
      ],
      comment: 'rubric complete',
    });
    const gradedAttempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attempt.attemptId } });
    expect(Number(gradedAttempt.totalScore)).toBe(10);
    expect(await prisma.scoringEvaluation.count({ where: { answerRecord: { attemptId: attempt.attemptId }, status: ScoringEvaluationStatus.OFFICIAL } })).toBe(2);

    const preview = await api('post', '/api/v1/grading/regrade-runs/preview', adminToken, {
      examId: exam.id, attemptIds: [attempt.attemptId], questionIds: [choice.id], ruleSource: 'snapshot',
    });
    const choiceRecord = await prisma.answerRecord.findUniqueOrThrow({
      where: { attemptId_questionId: { attemptId: attempt.attemptId, questionId: choice.id } },
    });
    await prisma.answerRecord.update({ where: { id: choiceRecord.id }, data: { score: 1 } });
    await request(app.getHttpServer())
      .post(`/api/v1/grading/regrade-runs/${preview.id}/confirm`)
      .auth(adminToken, { type: 'bearer' })
      .expect(400);
    const retryPreview = await api('post', '/api/v1/grading/regrade-runs/preview', adminToken, {
      examId: exam.id, attemptIds: [attempt.attemptId], questionIds: [choice.id], ruleSource: 'snapshot',
    });
    const confirmed = await api('post', `/api/v1/grading/regrade-runs/${retryPreview.id}/confirm`, adminToken);
    expect(confirmed.appliedCount).toBe(1);
    expect(Number((await prisma.answerRecord.findUniqueOrThrow({ where: { id: choiceRecord.id } })).score)).toBe(3);

    await expect(prisma.scoringEvaluation.create({
      data: {
        answerRecordId: choiceRecord.id, source: ScoringEvaluationSource.AI_SUGGESTION,
        status: ScoringEvaluationStatus.OFFICIAL, adapterKey: 'single_choice', adapterVersion: 1,
        score: 3, maxScore: 3, isCorrect: true, detailJson: {}, answerFingerprint: '0'.repeat(64),
      },
    })).rejects.toThrow();
  });

  it('imports valid Excel rows, skips duplicates, and creates an authenticated export download', async () => {
    const templateRequest = request(app.getHttpServer())
      .get('/api/v1/questions/import-template')
      .auth(adminToken, { type: 'bearer' })
      .buffer(true);
    const template = await templateRequest
      .parse(binaryParser as unknown as Parameters<typeof templateRequest.parse>[0])
      .expect(200);
    if (template.status !== 200) throw new Error(`template failed: ${template.status} ${JSON.stringify(template.body)}`);
    const templateBuffer = template.body as Buffer;
    expect(templateBuffer.length).toBeGreaterThan(1000);

    const first = await request(app.getHttpServer())
      .post('/api/v1/questions/import')
      .auth(adminToken, { type: 'bearer' })
      .field('publish', 'false')
      .field('skipDuplicates', 'true')
      .attach('file', templateBuffer, { filename: 'template.xlsx' })
      .expect(201);
    expect(first.body.data.importedCount).toBe(3);
    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/questions/import')
      .auth(adminToken, { type: 'bearer' })
      .field('publish', 'false')
      .field('skipDuplicates', 'true')
      .attach('file', templateBuffer, { filename: 'template.xlsx' })
      .expect(201);
    expect(duplicate.body.data.skippedCount).toBe(3);
    await request(app.getHttpServer())
      .post('/api/v1/questions/import')
      .auth(adminToken, { type: 'bearer' })
      .attach('file', Buffer.from('not-an-excel-file'), { filename: 'invalid.xlsx' })
      .expect(400);

    const task = await api('post', '/api/v1/exports', adminToken, { type: 'question_bank', format: 'json' });
    let status = task.status;
    let completedTask: Record<string, unknown> | undefined;
    for (let index = 0; index < 30 && status !== 'success'; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const list = await api('get', '/api/v1/exports?pageSize=50', adminToken);
      completedTask = list.items.find((item: any) => item.id === task.id);
      status = completedTask?.status;
    }
    expect(status).toBe('success');
    expect(completedTask?.downloadReady).toBe(true);
    expect(completedTask?.fileUrl).toBeUndefined();
    const download = await request(app.getHttpServer())
      .get(`/api/v1/exports/${task.id}/download`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(download.headers['content-disposition']).toContain('attachment');
    await request(app.getHttpServer()).get(`/api/v1/exports/${task.id}/download`).expect(401);
  });

  it('serves public referenced assets with scoped tokens and protects private content', async () => {
    await mkdir(join(testUploadsRoot, 'question-assets'), { recursive: true });
    await writeFile(assetPath, Buffer.from('secure-asset'));
    const course = await prisma.course.findFirstOrThrow({ where: { code: 'integration_course' } });
    const question = await api('post', '/api/v1/questions', adminToken, {
      courseId: course.id,
      type: 'short_answer',
      title: 'Public asset question',
      content: `Asset ![image](/uploads/question-assets/${assetFile})`,
      difficulty: 1,
      defaultScore: 2,
      answer: { reference: 'ok' },
    });
    await prisma.fileAsset.create({
      data: {
        bucket: 'local', objectKey: `question-assets/${assetFile}`, fileName: assetFile,
        mimeType: 'image/png', fileSize: BigInt(12), url: `/uploads/question-assets/${assetFile}`,
      },
    });
    await request(app.getHttpServer()).get(`/api/v1/uploads/question-assets/${assetFile}/content`).expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/uploads/question-assets/${assetFile}/content`)
      .auth(studentToken, { type: 'bearer' })
      .expect(403);
    await api('post', `/api/v1/questions/${question.id}/publish`, adminToken);
    const detail = await request(app.getHttpServer()).get(`/api/v1/questions/public/${question.id}`).expect(200);
    const token = detail.body.data.assetAccessToken;
    await request(app.getHttpServer())
      .get(`/api/v1/uploads/public/questions/${question.id}/assets/${assetFile}`)
      .query({ token })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/uploads/public/questions/${question.id}/assets/${assetFile}`)
      .query({ token: `${token}tampered` })
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/uploads/public/questions/not-the-same-question/assets/${assetFile}`)
      .query({ token })
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/uploads/question-assets/missing-file.png/content')
      .auth(adminToken, { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/uploads/question-assets/..%2F.env/content')
      .auth(adminToken, { type: 'bearer' })
      .expect(400);
  });

  it('rate limits repeated login failures with request tracking headers', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '203.0.113.25')
        .set('X-Request-ID', `login-limit-${attempt}`)
        .send({ username: 'test_admin', password: 'wrong-password' })
        .expect(401)
        .expect('X-Request-ID', `login-limit-${attempt}`);
    }
    const limited = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '203.0.113.25')
      .send({ username: 'test_admin', password: 'wrong-password' })
      .expect(429);
    expect(limited.body.code).toBe(40029);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['x-request-id']).toBeTruthy();
  });

  async function login(username: string) {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ username, password: '123456' }).expect(201);
    return response.body.data;
  }

  async function api(method: 'get' | 'post' | 'patch' | 'delete', path: string, token: string, body?: any) {
    let call = request(app.getHttpServer())[method](path).auth(token, { type: 'bearer' });
    if (body !== undefined) call = call.send(body);
    const response = await call.expect((result) => {
      if (result.status >= 400) throw new Error(`${method.toUpperCase()} ${path}: ${result.status} ${JSON.stringify(result.body)}`);
    });
    return response.body.data;
  }
});

async function resetDatabase(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    DO $$ DECLARE item RECORD;
    BEGIN
      FOR item IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations') LOOP
        EXECUTE 'TRUNCATE TABLE "' || item.tablename || '" RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
}
