import { INestApplication } from '@nestjs/common';
import { ExportStatus, PermissionType, Prisma, PrismaClient, ScoringEvaluationSource, ScoringEvaluationStatus, UserStatus, UserType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request = require('supertest');
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestApp } from '../helpers/test-app';
import { TokenService } from '../../src/modules/auth/token.service';
import { AiProviderGateway } from '../../src/modules/ai/ai-provider.gateway';
import { EXAM_SUMMARY_OUTPUT_SCHEMA } from '../../src/modules/ai/schemas/summary-output.schema';

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
  let teacherToken = '';
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
    const student = await prisma.user.create({
      data: { username: 'test_student', passwordHash, realName: 'Test Student', userType: UserType.STUDENT },
    });
    const teacher = await prisma.user.create({
      data: { username: 'test_teacher', passwordHash, realName: 'Test Teacher', userType: UserType.TEACHER },
    });
    await prisma.user.create({
      data: { username: 'test_disabled', passwordHash, realName: 'Disabled', userType: UserType.STUDENT, status: UserStatus.DISABLED },
    });
    const viewOwnPermission = await prisma.permission.create({
      data: { name: 'View own AI summaries', code: 'ai.summary.view-own', type: PermissionType.API },
    });
    const studentRole = await prisma.role.create({ data: { name: 'Test student role', code: 'student' } });
    await prisma.rolePermission.create({
      data: { roleId: studentRole.id, permissionId: viewOwnPermission.id },
    });
    await prisma.userRole.create({ data: { userId: student.id, roleId: studentRole.id } });
    expect(admin.id).toBeTruthy();
    app = await createTestApp();
    teacherToken = (await app.get(TokenService).issueTokens({
      id: teacher.id,
      username: teacher.username,
      realName: teacher.realName,
      userType: teacher.userType,
      roles: [],
      permissions: [],
    }, { ip: '127.0.0.1', userAgent: 'integration-test' })).accessToken;
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

  it('isolates system and personal AI configurations and encrypts API keys at rest', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ai/presets')
      .auth(studentToken, { type: 'bearer' })
      .expect(403);
    const presets = await api('get', '/api/v1/ai/presets', adminToken);
    expect(presets.length).toBeGreaterThanOrEqual(8);

    const plainKey = 'integration-only-key-never-send';
    const created = await api('post', '/api/v1/ai/configurations', adminToken, {
      name: 'Integration DeepSeek',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      apiKey: plainKey,
      enabled: false,
      isDefault: false,
      maxTokens: 4,
      monthlyTokenBudget: 5000,
    });
    expect(created).not.toHaveProperty('apiKey');
    expect(created).toMatchObject({ scope: 'system', canManage: true });
    expect(created.apiKeyMasked).toBe('••••••••');
    expect(created.tokenQuota).toMatchObject({ usedTokens: 0, remainingTokens: 5000 });
    const stored = await prisma.aiProviderConfig.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.apiKeyCiphertext).not.toContain(plainKey);
    expect(stored.apiKeyIv).toBeTruthy();
    expect(stored.apiKeyAuthTag).toBeTruthy();
    expect(stored.monthlyTokenBudget).toBe(5000);

    const personal = await api('post', '/api/v1/ai/configurations', teacherToken, {
      scope: 'personal',
      name: 'Teacher Personal Model',
      provider: 'custom',
      baseUrl: 'https://teacher-ai.example.com/v1',
      model: 'teacher-model',
      apiKey: 'teacher-personal-key',
      enabled: true,
      isDefault: true,
      maxTokens: 1000,
    });
    expect(personal).toMatchObject({ scope: 'personal', canManage: true, isDefault: true });
    const teacherConfigs = await api('get', '/api/v1/ai/configurations', teacherToken);
    expect(teacherConfigs.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([created.id, personal.id]));
    expect(teacherConfigs.find((item: { id: string }) => item.id === created.id)).toMatchObject({
      scope: 'system', canManage: false,
    });
    const adminConfigs = await api('get', '/api/v1/ai/configurations', adminToken);
    expect(adminConfigs.some((item: { id: string }) => item.id === personal.id)).toBe(false);
    await request(app.getHttpServer())
      .patch(`/api/v1/ai/configurations/${created.id}`)
      .auth(teacherToken, { type: 'bearer' })
      .send({ name: 'Forbidden edit' })
      .expect(404);
    await api('delete', `/api/v1/ai/configurations/${personal.id}`, teacherToken);

    await api('delete', `/api/v1/ai/configurations/${created.id}`, adminToken);
    expect(await prisma.aiProviderConfig.count({ where: { id: created.id } })).toBe(0);
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

  it('reports deterministic statistics from the completed exam lifecycle', async () => {
    const course = await prisma.course.findFirstOrThrow({ where: { code: 'integration_course' } });
    const exam = await prisma.exam.findFirstOrThrow({ where: { name: 'Integration Exam' } });
    const query = `courseId=${course.id}&examId=${exam.id}`;

    const overview = await api('get', `/api/v1/statistics/overview?${query}`, adminToken);
    expect(overview).toMatchObject({
      questions: 1,
      exams: 1,
      submittedAttempts: 1,
      averageScore: 5,
      medianScore: 5,
      maxScore: 5,
      minScore: 5,
      gradedCount: 1,
    });

    const exams = await api('get', `/api/v1/statistics/exams?${query}`, adminToken);
    expect(exams).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(exams.items[0]).toMatchObject({
      examId: exam.id,
      examName: 'Integration Exam',
      fullScore: 5,
      submitCount: 1,
      averageScore: 5,
      medianScore: 5,
    });

    const distribution = await api('get', `/api/v1/statistics/score-distribution?${query}`, adminToken);
    expect(distribution).toMatchObject({ total: 1, averageScore: 5, averagePercent: 100 });
    expect(distribution.buckets.find((bucket: { label: string }) => bucket.label === '90-100%'))
      .toMatchObject({ count: 1, percent: 1 });

    const detail = await api('get', `/api/v1/statistics/exams/${exam.id}`, adminToken);
    expect(detail).toMatchObject({
      examId: exam.id, fullScore: 5, submitCount: 1, gradedCount: 1,
      averageScore: 5, medianScore: 5,
    });
    expect(detail.questionStats).toHaveLength(1);
    expect(detail.questionStats[0]).toMatchObject({ answerCount: 1, correctRate: 1, averageScore: 5 });

    const diagnostics = await api('get', `/api/v1/statistics/question-diagnostics?${query}`, adminToken);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ answerCount: 1, correctRate: 1, anomalyCount: 0 });

    const preview = await api('get', `/api/v1/ai-summaries/exams/${exam.id}/preview`, adminToken);
    expect(preview).toMatchObject({
      datasetVersion: 'exam-summary/v1',
      exam: { id: exam.id, classId: null },
      participation: {
        eligible: { value: null }, submitted: { value: 1 }, graded: { value: 1 },
        submissionRate: { value: null },
      },
      scores: { average: { value: 5 }, median: { value: 5 } },
    });
    expect(preview.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.evidence.length).toBeGreaterThan(10);
    expect(preview.evidence.every((item: { refId: string }) => item.refId)).toBe(true);

    const modelConfig = await api('post', '/api/v1/ai/configurations', adminToken, {
      name: 'Integration Summary Model', provider: 'custom', baseUrl: 'https://summary.example.com/v1',
      model: 'integration-model', apiKey: 'integration-summary-key', enabled: true, isDefault: true,
      maxTokens: 1000, monthlyTokenBudget: 5000,
    });
    const reviewer = await prisma.user.findUniqueOrThrow({ where: { username: 'test_admin' } });
    await prisma.aiSummaryPromptTemplate.create({
      data: {
        code: 'exam-summary', summaryType: 'EXAM', version: 1,
        systemPrompt: 'Only return schema-valid JSON grounded in evidence.',
        outputSchema: EXAM_SUMMARY_OUTPUT_SCHEMA as unknown as Prisma.InputJsonValue,
        enabled: true, reviewedBy: reviewer.id, changeReason: 'integration test', createdBy: reviewer.id,
      },
    });
    const claim = { text: '本次考试已完成评分', evidenceRefs: [preview.evidence[0].refId] };
    const complete = jest.spyOn(app.get(AiProviderGateway), 'complete').mockResolvedValue({
      content: JSON.stringify({
        schemaVersion: 'exam-summary-output/v1', headline: claim,
        overview: [], strengths: [], risks: [], actions: [], needsReview: [],
      }),
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, reported: true },
      durationMs: 5,
    });
    const generated = await api('post', '/api/v1/ai-summaries/exams', adminToken, {
      examId: exam.id, configId: modelConfig.id, maxTokens: 1000,
    });
    const cached = await api('post', '/api/v1/ai-summaries/exams', adminToken, {
      examId: exam.id, configId: modelConfig.id, maxTokens: 1000,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    complete.mockRestore();
    expect(generated).toMatchObject({
      status: 'succeeded', cacheHit: false,
      usage: { inputTokens: 10, outputTokens: 20, tokenQuota: { usedTokens: 30, remainingTokens: 4970 } },
      summary: { reviewStatus: 'draft', draftVersion: 1 },
    });
    expect(cached).toMatchObject({ id: generated.id, status: 'succeeded', cacheHit: true });
    expect(await prisma.aiUsageEvent.count({ where: { providerConfigId: modelConfig.id } })).toBe(1);

    await request(app.getHttpServer())
      .post(`/api/v1/ai-summaries/${generated.summary.id}/publish`)
      .auth(adminToken, { type: 'bearer' })
      .expect(409);
    const editedContent = {
      schemaVersion: 'exam-summary-output/v1',
      headline: { ...claim, text: '教师已复核本次考试完成评分' },
      overview: [], strengths: [], risks: [], actions: [], needsReview: [],
    };
    const edited = await api('patch', `/api/v1/ai-summaries/${generated.summary.id}`, adminToken, {
      content: editedContent,
    });
    expect(edited).toMatchObject({ reviewStatus: 'draft', draftVersion: 2, content: editedContent });
    const reviewed = await api('post', `/api/v1/ai-summaries/${generated.summary.id}/review`, adminToken);
    expect(reviewed).toMatchObject({ reviewStatus: 'approved', reviewedBy: expect.any(String) });
    const published = await api('post', `/api/v1/ai-summaries/${generated.summary.id}/publish`, adminToken);
    expect(published).toMatchObject({ reviewStatus: 'published', publishedAt: expect.any(String) });
    const studentPublished = await api('get', '/api/v1/me/ai-summaries', studentToken);
    expect(studentPublished).toHaveLength(1);
    expect(studentPublished[0]).toMatchObject({ id: generated.summary.id, examId: exam.id, content: editedContent });
    await request(app.getHttpServer())
      .get(`/api/v1/ai-summaries/${generated.summary.id}`)
      .auth(studentToken, { type: 'bearer' })
      .expect(403);
    const history = await api('get', `/api/v1/exams/${exam.id}/ai-summaries`, adminToken);
    expect(history[0]).toMatchObject({ id: generated.summary.id, reviewStatus: 'published' });
    const revoked = await api('post', `/api/v1/ai-summaries/${generated.summary.id}/revoke`, adminToken);
    expect(revoked).toMatchObject({ reviewStatus: 'revoked', revokedAt: expect.any(String) });
    expect(await api('get', '/api/v1/me/ai-summaries', studentToken)).toEqual([]);
    const regenerateCall = jest.spyOn(app.get(AiProviderGateway), 'complete').mockResolvedValue({
      content: JSON.stringify({
        schemaVersion: 'exam-summary-output/v1', headline: claim,
        overview: [], strengths: [], risks: [], actions: [], needsReview: [],
      }),
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, reported: true },
      durationMs: 5,
    });
    const regenerated = await api(
      'post', `/api/v1/ai-summaries/${generated.summary.id}/regenerate`, adminToken,
      { configId: modelConfig.id, maxTokens: 1000 },
    );
    expect(regenerateCall).toHaveBeenCalledTimes(1);
    regenerateCall.mockRestore();
    expect(regenerated).toMatchObject({ status: 'succeeded', cacheHit: false });
    expect(regenerated.id).not.toBe(generated.id);
    expect(regenerated.summary.id).not.toBe(generated.summary.id);
    const regenerationTask = await prisma.aiSummaryTask.findUniqueOrThrow({ where: { id: regenerated.id } });
    expect(regenerationTask.generationKey).not.toBe('initial');
    expect(regenerationTask.scopeJson).toMatchObject({ sourceSummaryId: generated.summary.id });
    expect(await prisma.auditLog.count({
      where: { targetId: generated.summary.id, action: { startsWith: 'ai:summary-' } },
    })).toBe(5);

    await request(app.getHttpServer())
      .get(`/api/v1/ai-summaries/exams/${exam.id}/preview`)
      .auth(studentToken, { type: 'bearer' })
      .expect(403);

    await request(app.getHttpServer())
      .get(`/api/v1/statistics/overview?${query}`)
      .auth(studentToken, { type: 'bearer' })
      .expect(403);
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

  it('imports valid Excel rows, skips duplicates, and renders authenticated exports in every P1 format', async () => {
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

    const formats = ['csv', 'xlsx', 'docx', 'pdf', 'zip'] as const;
    const formatTasks = await Promise.all(formats.map((format) => api('post', '/api/v1/exports', adminToken, {
      type: 'question_bank',
      format,
      includeAnswers: true,
      includeAnalysis: true,
    })));
    const pendingIds = new Set(formatTasks.map((item) => item.id));
    const completedById = new Map<string, any>();
    for (let index = 0; index < 100 && pendingIds.size; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const list = await api('get', '/api/v1/exports?pageSize=100', adminToken);
      for (const item of list.items) {
        if (!pendingIds.has(item.id) || item.status !== 'success') continue;
        completedById.set(item.id, item);
        pendingIds.delete(item.id);
      }
    }
    expect([...pendingIds]).toEqual([]);

    for (const [index, formatTask] of formatTasks.entries()) {
      expect(completedById.get(formatTask.id)?.downloadReady).toBe(true);
      const response = await request(app.getHttpServer())
        .get(`/api/v1/exports/${formatTask.id}/download`)
        .auth(adminToken, { type: 'bearer' })
        .buffer(true)
        .parse(binaryParser as unknown as Parameters<typeof templateRequest.parse>[0])
        .expect(200);
      expect(response.headers['content-disposition']).toContain(`.${formats[index]}`);
      expect((response.body as Buffer).length).toBeGreaterThan(20);
    }
  });

  it('cancels, retries, and cleans up export tasks without losing ownership', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'test_admin' } });
    const permissionSnapshot = {
      userId: admin.id,
      username: admin.username,
      realName: admin.realName,
      userType: admin.userType,
      roles: [],
      permissions: [],
      capturedAt: new Date().toISOString(),
    };
    const pending = await prisma.exportTask.create({
      data: {
        type: 'question_bank',
        paramsJson: { type: 'question_bank', format: 'csv', permissionSnapshot },
        status: ExportStatus.PENDING,
        createdBy: admin.id,
      },
    });
    const canceled = await api('post', `/api/v1/exports/${pending.id}/cancel`, adminToken);
    expect(canceled.status).toBe('canceled');
    const retried = await api('post', `/api/v1/exports/${pending.id}/retry`, adminToken);
    expect(retried.status).toBe('pending');
    let retriedStatus = 'pending';
    for (let index = 0; index < 50 && retriedStatus !== 'success'; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      retriedStatus = (await prisma.exportTask.findUniqueOrThrow({ where: { id: pending.id } })).status.toLowerCase();
    }
    expect(retriedStatus).toBe('success');

    const expired = await prisma.exportTask.create({
      data: {
        type: 'question_bank',
        paramsJson: { type: 'question_bank', format: 'csv', permissionSnapshot },
        status: ExportStatus.SUCCESS,
        progress: 100,
        createdBy: admin.id,
        finishedAt: new Date(Date.now() - 10_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    const cleanup = await api('post', '/api/v1/exports/maintenance/cleanup-expired', adminToken);
    expect(cleanup.cleaned).toBeGreaterThanOrEqual(1);
    expect((await prisma.exportTask.findUniqueOrThrow({ where: { id: expired.id } })).status).toBe(ExportStatus.EXPIRED);
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
