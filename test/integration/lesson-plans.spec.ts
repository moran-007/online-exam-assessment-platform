import { INestApplication } from '@nestjs/common';
import { LessonPlanSource, PrismaClient, UserType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request = require('supertest');
import { TokenService } from '../../src/modules/auth/token.service';
import { createTestApp } from '../helpers/test-app';

jest.setTimeout(90_000);

describe('lesson plan library', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken = '';
  let teacherAToken = '';
  let teacherBToken = '';
  let studentToken = '';
  let parentToken = '';
  let courseId = '';

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDatabase(prisma);
    const passwordHash = await bcrypt.hash('123456', 4);
    const [admin, teacherA, teacherB, student, parent] = await Promise.all([
      prisma.user.create({
        data: {
          username: 'lesson_plan_admin',
          realName: '教务管理员',
          passwordHash,
          userType: UserType.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          username: 'lesson_plan_teacher_a',
          realName: '张老师',
          passwordHash,
          userType: UserType.TEACHER,
        },
      }),
      prisma.user.create({
        data: {
          username: 'lesson_plan_teacher_b',
          realName: '李老师',
          passwordHash,
          userType: UserType.TEACHER,
        },
      }),
      prisma.user.create({
        data: {
          username: 'lesson_plan_student',
          realName: '学生用户',
          passwordHash,
          userType: UserType.STUDENT,
        },
      }),
      prisma.user.create({
        data: {
          username: 'lesson_plan_parent',
          realName: '家长用户',
          passwordHash,
          userType: UserType.PARENT,
        },
      }),
    ]);
    const permissionCodes = ['lesson-plan:read', 'lesson-plan:manage'];
    const permissions = await Promise.all(permissionCodes.map((code) => prisma.permission.create({
      data: { name: code, code, type: 'API' },
    })));
    const planManagerRole = await prisma.role.create({
      data: { name: 'Lesson Plan Manager', code: 'lesson_plan_manager' },
    });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({
        roleId: planManagerRole.id,
        permissionId: permission.id,
      })),
    });
    await prisma.userRole.createMany({
      data: [admin, teacherA, teacherB].map((user) => ({
        userId: user.id,
        roleId: planManagerRole.id,
      })),
    });
    const course = await prisma.course.create({
      data: { name: '教案测试课程', code: 'lesson_plan_course' },
    });
    courseId = course.id;

    app = await createTestApp();
    [adminToken, teacherAToken, teacherBToken, studentToken, parentToken] = await Promise.all([
      token(admin),
      token(teacherA, ['lesson-record:read', 'lesson-record:manage']),
      token(teacherB),
      token(student, ['lesson-record:read']),
      token(parent, ['lesson-record:read']),
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('keeps personal plans private and exposes system plans as the shared fallback', async () => {
    const systemPlan = await createPlan(adminToken, LessonPlanSource.SYSTEM, '系统通用教案');
    const personalA = await createPlan(teacherAToken, LessonPlanSource.PERSONAL, '张老师个人教案');
    await createPlan(teacherBToken, LessonPlanSource.PERSONAL, '李老师个人教案');

    const courseOptions = await api(
      'get',
      '/api/v1/lesson-plans/course-options',
      teacherAToken,
    );
    expect(courseOptions).toContainEqual({
      id: courseId,
      name: '教案测试课程',
    });

    const teacherAPlans = await api('get', '/api/v1/lesson-plans', teacherAToken);
    expect(teacherAPlans.map((item: any) => item.theme)).toEqual([
      '张老师个人教案',
      '系统通用教案',
    ]);
    expect(teacherAPlans.find((item: any) => item.id === personalA.id)).toMatchObject({
      authorName: '张老师',
      source: LessonPlanSource.PERSONAL,
    });

    await request(app.getHttpServer())
      .post('/api/v1/lesson-plans')
      .auth(teacherAToken, { type: 'bearer' })
      .send(planPayload(LessonPlanSource.SYSTEM, '越权系统教案'))
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/lesson-plans/${systemPlan.id}`)
      .auth(teacherAToken, { type: 'bearer' })
      .send(planPayload(LessonPlanSource.PERSONAL, '越权修改'))
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/lesson-plans/${personalA.id}`)
      .auth(teacherBToken, { type: 'bearer' })
      .send(planPayload(LessonPlanSource.PERSONAL, '越权修改'))
      .expect(403);

    const updated = await api(
      'patch',
      `/api/v1/lesson-plans/${personalA.id}`,
      teacherAToken,
      planPayload(LessonPlanSource.PERSONAL, '张老师二次修改教案'),
    );
    expect(updated).toMatchObject({ theme: '张老师二次修改教案', authorName: '张老师' });

    await api('delete', `/api/v1/lesson-plans/${personalA.id}`, teacherAToken);
    const remaining = await api('get', '/api/v1/lesson-plans', teacherAToken);
    expect(remaining.map((item: any) => item.theme)).toEqual(['系统通用教案']);
  });

  it.each([
    ['student', () => studentToken],
    ['parent', () => parentToken],
  ])('does not expose the lesson plan library to a %s with lesson-record:read', async (_label, accessToken) => {
    for (const path of [
      '/api/v1/lesson-plans',
      '/api/v1/lesson-plan-prompt-templates',
      '/api/v1/lesson-plan-process-presets',
    ]) {
      await request(app.getHttpServer())
        .get(path)
        .auth(accessToken(), { type: 'bearer' })
        .expect(403);
    }
  });

  async function createPlan(
    accessToken: string,
    source: LessonPlanSource,
    theme: string,
  ) {
    return api('post', '/api/v1/lesson-plans', accessToken, planPayload(source, theme));
  }

  function planPayload(source: LessonPlanSource, theme: string) {
    return {
      source,
      courseId,
      theme,
      scheduledAt: '',
      classroom: 'A101',
      instructorName: '',
      gradeLevel: '七年级',
      durationMinutes: 45,
      learnerAnalysis: '',
      knowledgeObjectives: '掌握本课知识点',
      processObjectives: '',
      valueObjectives: '',
      coreCompetencies: '',
      teachingContent: '本课教学内容',
      keyPoints: '',
      difficultPoints: '',
      doubtfulPoints: '',
      teachingMethods: '讲授与练习',
      teachingMeans: '多媒体课件',
      preparation: '',
      teachingProcess: [{
        id: 'stage-1',
        title: '导入新课',
        duration: 45,
        coreQuestion: '',
        teacherActivity: '创设情境并提问',
        studentActivity: '观察并回答',
        assessment: '',
        designIntent: '',
        resources: '',
      }],
      homework: '',
      assessment: '',
      boardDesign: '',
      reflection: '',
    };
  }

  async function token(user: {
    id: string;
    username: string;
    realName: string | null;
    userType: UserType;
  }, permissions = ['lesson-plan:read', 'lesson-plan:manage']) {
    return (await app.get(TokenService).issueTokens({ ...user, roles: [], permissions }, {
      ip: '127.0.0.1',
      userAgent: 'lesson-plan-test',
    })).accessToken;
  }

  async function api(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    accessToken: string,
    body?: object,
  ) {
    let call = request(app.getHttpServer())[method](path).auth(accessToken, { type: 'bearer' });
    if (body !== undefined) call = call.send(body);
    const response = await call.expect((result) => {
      if (result.status >= 400) {
        throw new Error(`${method.toUpperCase()} ${path}: ${result.status} ${JSON.stringify(result.body)}`);
      }
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
