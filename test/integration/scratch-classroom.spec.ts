import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import {
  ClassTeacherRole,
  PrismaClient,
  ScratchJudgeRunStatus,
  UserType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHmac } from 'node:crypto';
import { rm } from 'node:fs/promises';
import request = require('supertest');
import { ScratchCallbackStatus } from '../../src/modules/scratch/dto/scratch.dto';
import { ScratchJudgeService } from '../../src/modules/scratch/scratch-judge.service';
import { TokenService } from '../../src/modules/auth/token.service';
import { createScratchProjectBuffer } from '../helpers/scratch-project';
import { createTestApp } from '../helpers/test-app';

jest.setTimeout(90_000);

describe('Scratch classroom lifecycle', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let teacherToken = '';
  let studentToken = '';
  let parentToken = '';
  let unrelatedParentToken = '';
  let sessionId = '';
  let studentId = '';
  const callbackSecret = 'scratch-integration-callback-secret';

  beforeAll(async () => {
    process.env.SCRATCH_CALLBACK_SECRET = callbackSecret;
    await rm(process.env.UPLOADS_DIR!, { recursive: true, force: true });
    prisma = new PrismaClient();
    await resetDatabase(prisma);
    const passwordHash = await bcrypt.hash('123456', 4);
    const [teacher, student, parent, unrelatedParent] = await Promise.all([
      prisma.user.create({ data: { username: 'scratch_teacher', passwordHash, userType: UserType.TEACHER } }),
      prisma.user.create({ data: { username: 'scratch_student', passwordHash, userType: UserType.STUDENT } }),
      prisma.user.create({ data: { username: 'scratch_parent', passwordHash, userType: UserType.PARENT } }),
      prisma.user.create({ data: { username: 'scratch_unrelated_parent', passwordHash, userType: UserType.PARENT } }),
    ]);
    const teacherPermissions = [
      'scratch-template:read', 'scratch-template:manage', 'scratch-assignment:read',
      'scratch-assignment:manage', 'scratch-assignment:publish', 'scratch-work:read',
      'scratch-work:review', 'scratch-asset:download', 'scratch-judge:manage',
    ];
    const studentPermissions = [
      'scratch-assignment:read', 'scratch-work:read', 'scratch-work:save',
      'scratch-work:submit', 'scratch-asset:download',
    ];
    const parentPermissions = ['scratch-assignment:read', 'scratch-work:read', 'scratch-asset:download'];
    const permissionCodes = [...new Set([...teacherPermissions, ...studentPermissions, ...parentPermissions])];
    const permissions = await Promise.all(permissionCodes.map((code) => prisma.permission.create({
      data: { name: code, code, type: 'API' },
    })));
    const [teacherRole, studentRole, parentRole] = await Promise.all([
      prisma.role.create({ data: { name: 'Scratch Teacher', code: 'scratch_teacher' } }),
      prisma.role.create({ data: { name: 'Scratch Student', code: 'scratch_student' } }),
      prisma.role.create({ data: { name: 'Scratch Parent', code: 'scratch_parent' } }),
    ]);
    const rolePermissions = [
      ...teacherPermissions.map((code) => ({ roleId: teacherRole.id, permissionId: permissions.find((item) => item.code === code)!.id })),
      ...studentPermissions.map((code) => ({ roleId: studentRole.id, permissionId: permissions.find((item) => item.code === code)!.id })),
      ...parentPermissions.map((code) => ({ roleId: parentRole.id, permissionId: permissions.find((item) => item.code === code)!.id })),
    ];
    await prisma.rolePermission.createMany({ data: rolePermissions });
    await prisma.userRole.createMany({ data: [
      { userId: teacher.id, roleId: teacherRole.id },
      { userId: student.id, roleId: studentRole.id },
      { userId: parent.id, roleId: parentRole.id },
      { userId: unrelatedParent.id, roleId: parentRole.id },
    ] });
    studentId = student.id;
    const classGroup = await prisma.classGroup.create({ data: { name: 'Scratch Class', code: 'scratch_class' } });
    await prisma.classTeacher.create({ data: { classId: classGroup.id, teacherId: teacher.id, role: ClassTeacherRole.LEAD } });
    await prisma.classStudent.create({ data: { classId: classGroup.id, studentId } });
    await prisma.parentStudent.create({ data: { parentId: parent.id, studentId, relationship: '监护人', isPrimary: true } });
    const lessonType = await prisma.lessonType.create({
      data: { name: 'Scratch 测试课', defaultHours: 1, createdBy: teacher.id, updatedBy: teacher.id },
    });
    const session = await prisma.lessonSession.create({
      data: {
        classId: classGroup.id,
        teacherId: teacher.id,
        lessonTypeId: lessonType.id,
        generationKey: 'integration:scratch-classroom',
        title: 'Scratch 课堂闭环',
        startsAt: new Date('2026-07-18T10:00:00.000Z'),
        endsAt: new Date('2026-07-18T11:00:00.000Z'),
        createdBy: teacher.id,
        updatedBy: teacher.id,
      },
    });
    sessionId = session.id;

    app = await createTestApp();
    teacherToken = await token(teacher, [
      'scratch-template:read', 'scratch-template:manage', 'scratch-assignment:read',
      'scratch-assignment:manage', 'scratch-assignment:publish', 'scratch-work:read',
      'scratch-work:review', 'scratch-asset:download', 'scratch-judge:manage',
    ]);
    studentToken = await token(student, [
      'scratch-assignment:read', 'scratch-work:read', 'scratch-work:save',
      'scratch-work:submit', 'scratch-asset:download',
    ]);
    parentToken = await token(parent, ['scratch-assignment:read', 'scratch-work:read', 'scratch-asset:download']);
    unrelatedParentToken = await token(unrelatedParent, ['scratch-assignment:read', 'scratch-work:read', 'scratch-asset:download']);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await rm(process.env.UPLOADS_DIR!, { recursive: true, force: true });
    delete process.env.SCRATCH_CALLBACK_SECRET;
  });

  it('preserves versions, enforces learner scope and supports teacher review', async () => {
    const projectV1 = await createScratchProjectBuffer({ label: 'template-v1' });
    await request(app.getHttpServer())
      .post('/api/v1/scratch/templates')
      .auth(teacherToken, { type: 'bearer' })
      .field('title', '伪文件')
      .attach('project', Buffer.from('not-a-project'), { filename: 'fake.sb3', contentType: 'application/x.scratch.sb3' })
      .expect(400);

    const template = await uploadTemplate('课堂迷宫模板', projectV1);
    const assignment = await api('post', `/api/v1/scratch/sessions/${sessionId}/assignments`, teacherToken, {
      templateId: template.id,
      title: '完成迷宫挑战',
      statementMd: '保存作品后再提交。',
      maxScore: 100,
      judgeMode: 'MANUAL',
    });
    await api('post', `/api/v1/scratch/assignments/${assignment.id}/publish`, teacherToken, {});

    const studentAssignments = await api('get', `/api/v1/scratch/students/${studentId}/assignments`, studentToken);
    expect(studentAssignments).toHaveLength(1);
    const parentAssignments = await api('get', `/api/v1/scratch/students/${studentId}/assignments`, parentToken);
    expect(parentAssignments[0].bindNote).toBeUndefined();
    await expectStatus(`/api/v1/scratch/students/${studentId}/assignments`, unrelatedParentToken, 403);

    const created = await api('post', `/api/v1/scratch/assignments/${assignment.id}/work`, studentToken, {
      title: '我的迷宫作品',
    });
    expect(created).toMatchObject({ status: 'draft', currentVersion: 1 });
    expect(created.versions[0].source).toBe('template_copy');
    await request(app.getHttpServer())
      .post(`/api/v1/scratch/assignments/${assignment.id}/work`)
      .auth(parentToken, { type: 'bearer' })
      .send({ title: '家长代做' })
      .expect(403);

    const projectV2 = await createScratchProjectBuffer({ label: 'student-v2' });
    const savedResponse = await request(app.getHttpServer())
      .post(`/api/v1/scratch/works/${created.id}/versions`)
      .auth(studentToken, { type: 'bearer' })
      .field('note', '第一次独立保存')
      .attach('project', projectV2, { filename: 'maze-v2.sb3', contentType: 'application/x.scratch.sb3' })
      .expect(201);
    const saved = savedResponse.body.data;
    expect(saved).toMatchObject({ status: 'draft', currentVersion: 2 });
    expect(saved.versions.map((item: any) => item.version)).toEqual([2, 1]);

    const versionResponse = await request(app.getHttpServer())
      .get(`/api/v1/scratch/work-versions/${saved.versions[0].id}/project`)
      .auth(studentToken, { type: 'bearer' })
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(Buffer.from(versionResponse.body).equals(projectV2)).toBe(true);

    const submitted = await api('post', `/api/v1/scratch/works/${created.id}/submit`, studentToken, {
      submitNote: '请老师批阅',
    });
    expect(submitted).toMatchObject({ status: 'submitted', currentVersion: 3 });
    expect(submitted.versions[0].source).toBe('submission');
    expect(submitted.judgeRuns[0].status).toBe('awaiting_review');

    const reviewed = await api('post', `/api/v1/scratch/works/${created.id}/reviews`, teacherToken, {
      score: 92,
      comment: '结构清晰，继续完善角色动画。',
    });
    expect(reviewed).toMatchObject({ status: 'reviewed' });
    expect(reviewed.reviews[0]).toMatchObject({ score: 92, comment: '结构清晰，继续完善角色动画。' });
    expect(reviewed.judgeRuns[0]).toMatchObject({ status: 'succeeded', score: 92 });

    const parentWork = await api('get', `/api/v1/scratch/works/${created.id}`, parentToken);
    expect(parentWork.reviews[0].score).toBe(92);
    expect(parentWork.student).toBeUndefined();
    expect(await prisma.notification.count({ where: { userId: studentId, bizType: 'scratch-work' } })).toBe(1);

    await expect(prisma.scratchWorkVersion.update({
      where: { id: reviewed.versions[0].id },
      data: { note: 'illegal overwrite' },
    })).rejects.toThrow('append-only');
    await expect(prisma.scratchReview.update({
      where: { id: reviewed.reviews[0].id },
      data: { comment: 'illegal overwrite' },
    })).rejects.toThrow('append-only');
  });

  it('keeps local work intact when runtime is unavailable and deduplicates callbacks', async () => {
    const template = await uploadTemplate('外部判定模板', await createScratchProjectBuffer({ label: 'external' }));
    const assignment = await api('post', `/api/v1/scratch/sessions/${sessionId}/assignments`, teacherToken, {
      templateId: template.id,
      title: '外部判定降级任务',
      maxScore: 100,
      judgeMode: 'EXTERNAL',
    });
    await api('post', `/api/v1/scratch/assignments/${assignment.id}/publish`, teacherToken, {});
    const work = await api('post', `/api/v1/scratch/assignments/${assignment.id}/work`, studentToken, {});
    const submitted = await api('post', `/api/v1/scratch/works/${work.id}/submit`, studentToken, {});
    const runId = submitted.judgeRuns[0].id as string;
    await prisma.scratchJudgeRun.update({
      where: { id: runId },
      data: { status: ScratchJudgeRunStatus.PENDING, attemptCount: 0, maxAttempts: 1, nextAttemptAt: new Date() },
    });
    const judge = app.get(ScratchJudgeService);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await judge.tick();
      const run = await prisma.scratchJudgeRun.findUniqueOrThrow({ where: { id: runId } });
      if (run.status === ScratchJudgeRunStatus.FAILED) break;
    }
    const failed = await prisma.scratchJudgeRun.findUniqueOrThrow({ where: { id: runId } });
    expect(failed).toMatchObject({ status: ScratchJudgeRunStatus.FAILED, attemptCount: 1 });
    expect(failed.message).toContain('作品已安全保存在主平台');
    expect(await prisma.scratchWorkVersion.count({ where: { workId: work.id } })).toBe(2);
    expect((await api('get', `/api/v1/scratch/works/${work.id}`, studentToken)).status).toBe('submitted');

    const submissionVersion = await prisma.scratchWorkVersion.findFirstOrThrow({
      where: { workId: work.id },
      orderBy: { version: 'desc' },
    });
    const callbackRun = await prisma.scratchJudgeRun.create({
      data: {
        workId: work.id,
        workVersionId: submissionVersion.id,
        assignmentId: assignment.id,
        idempotencyKey: `callback-test:${work.id}`,
        status: ScratchJudgeRunStatus.PROCESSING,
        externalJobId: 'external-job-1',
      },
    });
    const callback = {
      callbackId: 'callback-once', externalJobId: 'external-job-1', status: ScratchCallbackStatus.SUCCEEDED,
      score: 88, passed: true, message: '自动判定完成',
    };
    const rawBody = Buffer.from(JSON.stringify(callback));
    const signature = createHmac('sha256', callbackSecret).update(rawBody).digest('hex');
    const first = await judge.callback(callbackRun.id, callback, rawBody, signature);
    const duplicate = await judge.callback(callbackRun.id, callback, rawBody, signature);
    expect(first.idempotent).toBe(false);
    expect(duplicate.idempotent).toBe(true);
    expect(await prisma.scratchJudgeCallback.count({ where: { callbackId: callback.callbackId } })).toBe(1);
    expect((await prisma.scratchJudgeRun.findUniqueOrThrow({ where: { id: callbackRun.id } })).score?.toNumber()).toBe(88);
  });

  async function uploadTemplate(title: string, project: Buffer) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/scratch/templates')
      .auth(teacherToken, { type: 'bearer' })
      .field('title', title)
      .attach('project', project, { filename: `${title}.sb3`, contentType: 'application/x.scratch.sb3' })
      .expect(201);
    return response.body.data;
  }

  async function token(
    user: { id: string; username: string; realName: string | null; userType: UserType },
    permissions: string[],
  ) {
    return (await app.get(TokenService).issueTokens({ ...user, roles: [], permissions }, {
      ip: '127.0.0.1', userAgent: 'scratch-integration-test',
    })).accessToken;
  }

  async function api(method: 'get' | 'post', path: string, tokenValue: string, body?: object) {
    let call = request(app.getHttpServer())[method](path).auth(tokenValue, { type: 'bearer' });
    if (body !== undefined) call = call.send(body);
    const response = await call.expect((result) => {
      if (result.status >= 400) throw new Error(`${method.toUpperCase()} ${path}: ${result.status} ${JSON.stringify(result.body)}`);
    });
    return response.body.data;
  }

  async function expectStatus(path: string, tokenValue: string, status: number) {
    await request(app.getHttpServer()).get(path).auth(tokenValue, { type: 'bearer' }).expect(status);
  }
});

const binaryParser = (response: unknown, callback: (error: Error | null, body: Buffer) => void) => {
  const stream = response as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
  stream.on('error', (error) => callback(error, Buffer.alloc(0)));
};

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
