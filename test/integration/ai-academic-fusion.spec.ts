import { INestApplication } from '@nestjs/common';
import {
  AiSummaryReviewStatus,
  AiSummaryTaskStatus,
  AiSummaryType,
  AttendanceStatus,
  ClassTeacherRole,
  LessonRecordStatus,
  LessonSessionStatus,
  PrismaClient,
  UserType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request = require('supertest');
import { TokenService } from '../../src/modules/auth/token.service';
import { AiProviderCallException, AiProviderGateway } from '../../src/modules/ai/ai-provider.gateway';
import { CredentialCipherService } from '../../src/security/credential-cipher.service';
import { createTestApp } from '../helpers/test-app';

jest.setTimeout(90_000);

describe('AI and academic fusion', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let teacherToken = '';
  let studentToken = '';
  let adminToken = '';
  let classId = '';
  let studentId = '';
  let sessionId = '';
  let summaryId = '';
  let configId = '';

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDatabase(prisma);
    const passwordHash = await bcrypt.hash('123456', 4);
    const [admin, teacher, student] = await Promise.all([
      prisma.user.create({ data: { username: 'fusion_admin', passwordHash, userType: UserType.SUPER_ADMIN } }),
      prisma.user.create({ data: { username: 'fusion_teacher', passwordHash, userType: UserType.TEACHER } }),
      prisma.user.create({ data: { username: 'fusion_student', passwordHash, userType: UserType.STUDENT } }),
    ]);
    const teacherPermissions = [
      'ai.summary.class.generate', 'ai.summary.parent-report.generate', 'ai.summary.lesson.generate',
      'dashboard:read', 'ai.quality.read', 'ai.quality.manage',
      'grading:score:read', 'attendance:read', 'schedule:read', 'lesson-record:read',
      'ai.data.grade-history', 'ai.data.attendance', 'ai.data.schedule',
      'ai.data.student-identity', 'ai.data.teacher-identity', 'ai.data.teacher-materials',
    ];
    const studentPermissions = ['dashboard:read', 'ai.feedback.create'];
    const permissions = await Promise.all([...new Set([...teacherPermissions, ...studentPermissions])].map((code) =>
      prisma.permission.create({ data: { name: code, code, type: 'API' } })));
    const [teacherRole, studentRole] = await Promise.all([
      prisma.role.create({ data: { name: 'Fusion Teacher', code: 'fusion_teacher_role' } }),
      prisma.role.create({ data: { name: 'Fusion Student', code: 'fusion_student_role' } }),
    ]);
    await prisma.rolePermission.createMany({
      data: [
        ...permissions.filter((item) => teacherPermissions.includes(item.code))
          .map((item) => ({ roleId: teacherRole.id, permissionId: item.id })),
        ...permissions.filter((item) => studentPermissions.includes(item.code))
          .map((item) => ({ roleId: studentRole.id, permissionId: item.id })),
      ],
    });
    await prisma.userRole.createMany({
      data: [
        { userId: teacher.id, roleId: teacherRole.id },
        { userId: student.id, roleId: studentRole.id },
      ],
    });
    studentId = student.id;
    const course = await prisma.course.create({ data: { name: 'AI 融合课程', code: 'ai_fusion_course' } });
    const group = await prisma.classGroup.create({
      data: { name: 'AI 融合班', code: 'ai_fusion_class', courseId: course.id },
    });
    classId = group.id;
    await prisma.classTeacher.create({ data: { classId, teacherId: teacher.id, role: ClassTeacherRole.LEAD } });
    await prisma.classStudent.create({ data: { classId, studentId } });
    const lessonType = await prisma.lessonType.create({
      data: { name: 'AI 融合课型', defaultHours: 2, createdBy: teacher.id, updatedBy: teacher.id },
    });
    const session = await prisma.lessonSession.create({
      data: {
        classId,
        teacherId: teacher.id,
        lessonTypeId: lessonType.id,
        generationKey: 'fusion:lesson',
        title: '循环与函数',
        status: LessonSessionStatus.COMPLETED,
        startsAt: new Date('2026-07-18T08:00:00Z'),
        endsAt: new Date('2026-07-18T10:00:00Z'),
        lessonHours: 2,
        createdBy: teacher.id,
        updatedBy: teacher.id,
      },
    });
    sessionId = session.id;
    await prisma.lessonRecord.create({
      data: {
        sessionId,
        status: LessonRecordStatus.PUBLISHED,
        internalTeachingNotes: '仅教师可见：下节课调整节奏',
        internalClassPerformance: '仅教师可见：个别学生需关注',
        publicTeachingContent: '循环与函数练习',
        publicLearningGoal: '掌握函数封装',
        publicHomework: '完成公开练习',
        publishedBy: teacher.id,
        publishedAt: new Date('2026-07-18T10:00:00Z'),
        createdBy: teacher.id,
        updatedBy: teacher.id,
      },
    });
    await prisma.attendanceRecord.create({
      data: {
        sessionId,
        studentId,
        status: AttendanceStatus.PRESENT,
        confirmedBy: teacher.id,
        confirmedAt: new Date('2026-07-18T10:00:00Z'),
      },
    });

    const config = await prisma.aiProviderConfig.create({
      data: {
        name: '融合质量模型',
        provider: 'custom',
        baseUrl: 'https://example.com/v1',
        model: 'quality-model',
        apiKeyCiphertext: 'cipher',
        apiKeyIv: '000000000000000000000000',
        apiKeyAuthTag: '00000000000000000000000000000000',
        apiKeyKeyVersion: 1,
        isDefault: true,
        maxTokens: 100,
        createdBy: admin.id,
        updatedBy: admin.id,
      },
    });
    configId = config.id;
    await prisma.aiSummaryPromptTemplate.create({
      data: {
        code: 'lesson-assistant',
        summaryType: AiSummaryType.LESSON,
        version: 1,
        systemPrompt: 'integration retry confirmation',
        outputSchema: {},
        enabled: true,
        reviewedBy: admin.id,
        createdBy: admin.id,
      },
    });
    const template = await prisma.aiSummaryPromptTemplate.create({
      data: {
        code: 'fusion-student-summary',
        summaryType: AiSummaryType.STUDENT,
        version: 1,
        systemPrompt: 'integration',
        outputSchema: {},
        enabled: false,
        createdBy: admin.id,
      },
    });
    const task = await prisma.aiSummaryTask.create({
      data: {
        type: AiSummaryType.STUDENT,
        subjectId: studentId,
        scopeJson: {},
        inputSnapshotJson: {},
        inputHash: 'a'.repeat(64),
        datasetVersion: 'student-summary/v2',
        promptTemplateId: template.id,
        promptVersion: 1,
        schemaVersion: 'student-summary-output/v1',
        providerConfigId: config.id,
        modelSnapshot: config.model,
        requestedOutputTokens: 1000,
        reservationOutputTokens: 1000,
        outputLimitKey: 1000,
        status: AiSummaryTaskStatus.SUCCEEDED,
        correlationId: 'fusion-quality-task',
        inputTokens: 80,
        outputTokens: 20,
        estimatedCost: 0.01,
        createdBy: teacher.id,
      },
    });
    const summary = await prisma.aiSummary.create({
      data: {
        taskId: task.id,
        type: AiSummaryType.STUDENT,
        subjectId: studentId,
        summaryJson: {
          schemaVersion: 'student-summary-output/v1',
          headline: { text: '已发布事实', evidenceRefs: ['ref1'] },
          overview: [], strengths: [], risks: [], actions: [], needsReview: [],
        },
        sourceSnapshotJson: {},
        evidenceIndexJson: {
          ref1: {
            refId: 'ref1', sourceType: 'student', sourceId: studentId,
            metric: 'fact', path: '/fact', value: 1, capturedAt: '2026-07-18T10:00:00Z',
          },
        },
        reviewStatus: AiSummaryReviewStatus.PUBLISHED,
        reviewedBy: teacher.id,
        publishedAt: new Date(),
      },
    });
    summaryId = summary.id;

    app = await createTestApp();
    const encrypted = app.get(CredentialCipherService).encrypt(
      'integration-retry-key',
      `ai-provider:${configId}`,
    );
    await prisma.aiProviderConfig.update({
      where: { id: configId },
      data: {
        apiKeyCiphertext: encrypted.ciphertext,
        apiKeyIv: encrypted.iv,
        apiKeyAuthTag: encrypted.authTag,
        apiKeyKeyVersion: encrypted.keyVersion,
      },
    });
    teacherToken = await token(teacher, [
      'ai.summary.class.generate', 'ai.summary.parent-report.generate', 'ai.summary.lesson.generate',
      'dashboard:read', 'ai.quality.read', 'ai.quality.manage',
      'grading:score:read', 'attendance:read', 'schedule:read', 'lesson-record:read',
      'ai.data.grade-history', 'ai.data.attendance', 'ai.data.schedule',
      'ai.data.student-identity', 'ai.data.teacher-identity', 'ai.data.teacher-materials',
    ]);
    studentToken = await token(student, ['dashboard:read', 'ai.feedback.create']);
    adminToken = await token(admin, ['ai.quality.read', 'ai.quality.manage']);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('exposes role-scoped integrated previews with explicit privacy boundaries', async () => {
    const classPreview = await api('get', `/api/v1/ai-summaries/classes/${classId}/preview`, teacherToken);
    expect(classPreview).toMatchObject({ datasetVersion: 'class-summary/v2', dataset: { type: 'class' } });
    expect(classPreview.dataset.dataCoverage.excludes).toEqual(expect.arrayContaining(['student_names', 'student_ids']));

    const parentPreview = await api('get', `/api/v1/ai-summaries/parent-reports/${studentId}/preview`, teacherToken);
    expect(parentPreview.dataset.publishedLessons[0]).toMatchObject({ homework: { value: '完成公开练习' } });
    expect(JSON.stringify(parentPreview)).not.toContain('下节课调整节奏');

    const lessonPreview = await api('get', `/api/v1/ai-summaries/lessons/${sessionId}/preview`, teacherToken);
    expect(lessonPreview.dataset.currentRecord.internalTeachingNotes.value).toContain('调整节奏');
    await request(app.getHttpServer())
      .get(`/api/v1/ai-summaries/classes/${classId}/preview`)
      .auth(studentToken, { type: 'bearer' })
      .expect(403);
  });

  it('serves a fused assessment and academic dashboard within the teacher class scope', async () => {
    const dashboard = await api(
      'get',
      '/api/v1/statistics/fusion-dashboard?startDate=2026-07-18T00:00:00Z&endDate=2026-07-19T00:00:00Z',
      teacherToken,
    );
    expect(dashboard).toMatchObject({
      role: 'teacher',
      academic: {
        scheduledLessons: 1,
        completedLessons: 1,
        publishedLessonRecords: 1,
        confirmedAttendance: 1,
        attendanceRate: 1,
      },
    });
    expect(dashboard.teacherPerformance[0]).toMatchObject({ teacherName: 'fusion_teacher', completedLessons: 1 });
  });

  it('accepts evidence-bound learner feedback and exposes audited quality aggregates', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/ai-summaries/${summaryId}/feedback`)
      .auth(studentToken, { type: 'bearer' })
      .send({ verdict: 'partial', rating: 3, evidenceRef: 'missing' })
      .expect(400);
    const feedback = await api('post', `/api/v1/ai-summaries/${summaryId}/feedback`, studentToken, {
      verdict: 'incorrect', rating: 2, evidenceRef: 'ref1', comment: '该结论需修正',
    });
    expect(feedback).toMatchObject({ status: 'open', verdict: 'incorrect', rating: 2 });

    const quality = await api('get', '/api/v1/ai-quality/dashboard', adminToken);
    expect(quality.totals).toMatchObject({ calls: 1, succeeded: 1, published: 1, feedbackCount: 1, averageRating: 2 });
    const feedbackPage = await api('get', '/api/v1/ai-quality/feedback', adminToken);
    expect(feedbackPage.items[0]).toMatchObject({ id: feedback.id, reporterName: 'fusion_student' });
    const resolved = await api('patch', `/api/v1/ai-quality/feedback/${feedback.id}`, adminToken, {
      status: 'resolved', resolutionNote: '已核对并记录修正建议',
    });
    expect(resolved).toMatchObject({ status: 'resolved', resolutionNote: '已核对并记录修正建议' });
    expect(await prisma.auditLog.count({ where: { targetId: feedback.id } })).toBe(2);
  });

  it('requires a fresh retry confirmation after a failed task when the dialog is reopened', async () => {
    const gateway = app.get(AiProviderGateway);
    const completion = jest.spyOn(gateway, 'complete').mockRejectedValue(
      new AiProviderCallException('integration timeout', true),
    );
    const body = { sessionId, configId };
    try {
      const first = await api('post', '/api/v1/ai-summaries/lessons', teacherToken, body);
      expect(first).toMatchObject({ status: 'failed', attemptCount: 1 });
      expect(completion).toHaveBeenCalledTimes(1);

      const blocked = await request(app.getHttpServer())
        .post('/api/v1/ai-summaries/lessons')
        .auth(teacherToken, { type: 'bearer' })
        .send(body)
        .expect(409);
      expect(blocked.body).toMatchObject({ code: 40910 });
      expect(completion).toHaveBeenCalledTimes(1);

      const confirmed = await api('post', '/api/v1/ai-summaries/lessons', teacherToken, {
        ...body,
        confirmRetry: true,
      });
      expect(confirmed).toMatchObject({ id: first.id, status: 'failed', attemptCount: 2 });
      expect(completion).toHaveBeenCalledTimes(2);
    } finally {
      completion.mockRestore();
    }
  });

  async function token(
    user: { id: string; username: string; realName: string | null; userType: UserType },
    permissions: string[],
  ) {
    return (await app.get(TokenService).issueTokens({ ...user, roles: [], permissions }, {
      ip: '127.0.0.1', userAgent: 'ai-fusion-test',
    })).accessToken;
  }

  async function api(method: 'get' | 'post' | 'patch', path: string, tokenValue: string, body?: object) {
    let call = request(app.getHttpServer())[method](path).auth(tokenValue, { type: 'bearer' });
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
