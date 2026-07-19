import { INestApplication } from '@nestjs/common';
import { ClassTeacherRole, LessonAssetAudience, PrismaClient, UserType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request = require('supertest');
import { TokenService } from '../../src/modules/auth/token.service';
import { createTestApp } from '../helpers/test-app';

jest.setTimeout(90_000);

describe('lesson records and learning portal', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let teacherToken = '';
  let studentToken = '';
  let parentToken = '';
  let unrelatedParentToken = '';
  let sessionId = '';
  let studentId = '';

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDatabase(prisma);
    const passwordHash = await bcrypt.hash('123456', 4);
    const [teacher, student, parent, unrelatedParent] = await Promise.all([
      prisma.user.create({ data: { username: 'record_teacher', passwordHash, userType: UserType.TEACHER } }),
      prisma.user.create({ data: { username: 'record_student', passwordHash, userType: UserType.STUDENT } }),
      prisma.user.create({ data: { username: 'record_parent', passwordHash, userType: UserType.PARENT } }),
      prisma.user.create({ data: { username: 'record_unrelated_parent', passwordHash, userType: UserType.PARENT } }),
    ]);
    const permissionCodes = [
      'lesson-record:read', 'lesson-record:manage', 'lesson-record:publish',
      'lesson-asset:manage', 'lesson-asset:download',
    ];
    const permissions = await Promise.all(permissionCodes.map((code) => prisma.permission.create({
      data: { name: code, code, type: 'API' },
    })));
    const [teacherRole, studentRole, parentRole] = await Promise.all([
      prisma.role.create({ data: { name: 'Record Teacher', code: 'record_teacher' } }),
      prisma.role.create({ data: { name: 'Record Student', code: 'record_student' } }),
      prisma.role.create({ data: { name: 'Record Parent', code: 'record_parent' } }),
    ]);
    await prisma.rolePermission.createMany({
      data: [
        ...permissions.map((permission) => ({ roleId: teacherRole.id, permissionId: permission.id })),
        ...permissions.filter((permission) => ['lesson-record:read', 'lesson-asset:download'].includes(permission.code))
          .flatMap((permission) => [
            { roleId: studentRole.id, permissionId: permission.id },
            { roleId: parentRole.id, permissionId: permission.id },
          ]),
      ],
    });
    await prisma.userRole.createMany({
      data: [
        { userId: teacher.id, roleId: teacherRole.id },
        { userId: student.id, roleId: studentRole.id },
        { userId: parent.id, roleId: parentRole.id },
        { userId: unrelatedParent.id, roleId: parentRole.id },
      ],
    });
    studentId = student.id;
    const classGroup = await prisma.classGroup.create({ data: { name: 'Record Class', code: 'record_class' } });
    await prisma.classTeacher.create({ data: { classId: classGroup.id, teacherId: teacher.id, role: ClassTeacherRole.LEAD } });
    await prisma.classStudent.create({ data: { classId: classGroup.id, studentId } });
    await prisma.parentStudent.create({ data: { parentId: parent.id, studentId, relationship: '监护人', isPrimary: true } });
    const lessonType = await prisma.lessonType.create({
      data: { name: '记录测试课', defaultHours: 1, createdBy: teacher.id, updatedBy: teacher.id },
    });
    const session = await prisma.lessonSession.create({
      data: {
        classId: classGroup.id,
        teacherId: teacher.id,
        lessonTypeId: lessonType.id,
        generationKey: 'integration:lesson-record',
        title: '教学记录集成课',
        startsAt: new Date('2026-07-16T10:00:00.000Z'),
        endsAt: new Date('2026-07-16T11:00:00.000Z'),
        createdBy: teacher.id,
        updatedBy: teacher.id,
      },
    });
    sessionId = session.id;

    app = await createTestApp();
    teacherToken = await token(teacher, [
      'lesson-record:read', 'lesson-record:manage', 'lesson-record:publish',
      'lesson-asset:manage', 'lesson-asset:download',
    ]);
    studentToken = await token(student, ['lesson-record:read', 'lesson-asset:download']);
    parentToken = await token(parent, ['lesson-record:read', 'lesson-asset:download']);
    unrelatedParentToken = await token(unrelatedParent, ['lesson-record:read', 'lesson-asset:download']);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('keeps drafts private, publishes public fields, and appends immutable versions', async () => {
    await api('put', `/api/v1/lesson-records/${sessionId}/draft`, teacherToken, {
      internalTeachingNotes: '教师内部备忘，不得出现在门户',
      internalClassPerformance: '内部观察',
      publicTeachingContent: '学习循环与条件判断',
      publicLearningGoal: '能够完成基础循环练习',
      publicHomework: '完成两道练习',
    });
    await expectStatus('get', `/api/v1/lesson-records/${sessionId}`, studentToken, 404);
    await expectStatus('get', `/api/v1/lesson-records/${sessionId}?studentId=${studentId}`, parentToken, 404);

    const learnerAsset = await upload('公开课件.pdf', LessonAssetAudience.LEARNER);
    const internalAsset = await upload('内部讲义.pdf', LessonAssetAudience.INTERNAL);
    await api('post', `/api/v1/lesson-records/${sessionId}/submit`, teacherToken, {});
    const published = await api('post', `/api/v1/lesson-records/${sessionId}/publish`, teacherToken, {});
    expect(published.record).toMatchObject({ status: 'PUBLISHED', version: 5 });

    const studentDetail = await api('get', `/api/v1/lesson-records/${sessionId}`, studentToken);
    expect(studentDetail.record).toMatchObject({
      publicTeachingContent: '学习循环与条件判断',
      publicHomework: '完成两道练习',
    });
    expect(studentDetail.record).not.toHaveProperty('internalTeachingNotes');
    expect(studentDetail.record.assets.map((item: any) => item.id)).toEqual([learnerAsset.id]);

    const parentDetail = await api('get', `/api/v1/lesson-records/${sessionId}?studentId=${studentId}`, parentToken);
    expect(parentDetail.record.id).toBe(studentDetail.record.id);
    await expectStatus('get', `/api/v1/lesson-records/${sessionId}?studentId=${studentId}`, unrelatedParentToken, 403);

    await request(app.getHttpServer())
      .get(`/api/v1/lesson-records/${sessionId}/assets/${learnerAsset.id}/content?action=preview`)
      .auth(studentToken, { type: 'bearer' })
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    await expectStatus('get', `/api/v1/lesson-records/${sessionId}/assets/${internalAsset.id}/content`, studentToken, 403);

    const versions = await api('get', `/api/v1/lesson-records/${sessionId}/versions`, teacherToken);
    expect(versions.map((item: any) => item.action)).toEqual(['PUBLISH', 'SUBMIT', 'ASSET_ADD', 'ASSET_ADD', 'SAVE_DRAFT']);
    await expect(prisma.lessonRecordVersion.update({
      where: { id: versions[0].id },
      data: { reason: 'illegal mutation' },
    })).rejects.toThrow('append-only');

    expect(await prisma.notification.count({ where: { userId: { in: [studentId] } } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: { not: studentId } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { module: 'lesson-records' } })).toBeGreaterThanOrEqual(5);
  });

  it('serves only the linked learner through the portal and hides internal fields', async () => {
    const students = await api('get', '/api/v1/learning-portal/students', parentToken);
    expect(students).toHaveLength(1);
    expect(students[0].student.id).toBe(studentId);

    const overview = await api('get', `/api/v1/learning-portal/students/${studentId}`, parentToken);
    const lesson = overview.lessons.items.find((item: any) => item.id === sessionId);
    expect(lesson.record.publicTeachingContent).toBe('学习循环与条件判断');
    expect(lesson.record).not.toHaveProperty('internalTeachingNotes');
    await expectStatus('get', `/api/v1/learning-portal/students/${studentId}`, unrelatedParentToken, 403);
  });

  async function upload(filename: string, audience: LessonAssetAudience) {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/lesson-records/${sessionId}/assets`)
      .auth(teacherToken, { type: 'bearer' })
      .field('audience', audience)
      .field('title', filename)
      .attach('file', Buffer.from('%PDF-1.4\nlesson-record-test\n%%EOF'), { filename, contentType: 'application/pdf' })
      .expect(201);
    return response.body.data;
  }

  async function token(
    user: { id: string; username: string; realName: string | null; userType: UserType },
    permissions: string[],
  ) {
    return (await app.get(TokenService).issueTokens({ ...user, roles: [], permissions }, {
      ip: '127.0.0.1', userAgent: 'lesson-record-test',
    })).accessToken;
  }

  async function api(method: 'get' | 'post' | 'put', path: string, tokenValue: string, body?: object) {
    let call = request(app.getHttpServer())[method](path).auth(tokenValue, { type: 'bearer' });
    if (body !== undefined) call = call.send(body);
    const response = await call.expect((result) => {
      if (result.status >= 400) throw new Error(`${method.toUpperCase()} ${path}: ${result.status} ${JSON.stringify(result.body)}`);
    });
    return response.body.data;
  }

  async function expectStatus(method: 'get', path: string, tokenValue: string, status: number) {
    await request(app.getHttpServer())[method](path).auth(tokenValue, { type: 'bearer' }).expect(status);
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
