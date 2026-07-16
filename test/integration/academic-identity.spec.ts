import { INestApplication } from '@nestjs/common';
import { ClassMemberStatus, ClassTeacherRole, PrismaClient, UserStatus, UserType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request = require('supertest');
import { TokenService } from '../../src/modules/auth/token.service';
import { createTestApp } from '../helpers/test-app';

jest.setTimeout(90_000);

describe('academic identity and legacy migration', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken = '';
  let teacherToken = '';
  let parentToken = '';
  let studentAId = '';
  let studentBId = '';
  let parentId = '';
  let classId = '';

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDatabase(prisma);
    const passwordHash = await bcrypt.hash('123456', 4);
    const [admin, teacher, parent, studentA, studentB] = await Promise.all([
      prisma.user.create({ data: { username: 'identity_admin', realName: 'Admin', passwordHash, userType: UserType.SUPER_ADMIN } }),
      prisma.user.create({ data: { username: 'identity_teacher', realName: 'Teacher', passwordHash, userType: UserType.TEACHER, teacherProfile: { create: {} } } }),
      prisma.user.create({ data: { username: 'identity_parent', realName: 'Parent', passwordHash, userType: UserType.PARENT } }),
      prisma.user.create({ data: { username: 'identity_student_a', realName: 'Student A', passwordHash, userType: UserType.STUDENT, studentProfile: { create: {} } } }),
      prisma.user.create({ data: { username: 'identity_student_b', realName: 'Student B', passwordHash, userType: UserType.STUDENT, studentProfile: { create: {} } } }),
    ]);
    studentAId = studentA.id;
    studentBId = studentB.id;
    parentId = parent.id;
    const classGroup = await prisma.classGroup.create({ data: { name: 'Identity Class', code: 'identity_class' } });
    classId = classGroup.id;
    await prisma.classTeacher.create({ data: { classId, teacherId: teacher.id, role: ClassTeacherRole.LEAD } });
    await prisma.classStudent.create({ data: { classId, studentId: studentA.id } });
    const profileRead = await prisma.permission.create({
      data: { name: 'Read academic profile', code: 'academic-profile:read', type: 'API' },
    });
    const [studentRole, teacherRole, parentRole] = await Promise.all([
      prisma.role.create({ data: { name: 'Student', code: 'student' } }),
      prisma.role.create({ data: { name: 'Teacher', code: 'teacher' } }),
      prisma.role.create({ data: { name: 'Parent', code: 'parent' } }),
    ]);
    await prisma.rolePermission.createMany({
      data: [studentRole, teacherRole, parentRole].map((role) => ({ roleId: role.id, permissionId: profileRead.id })),
    });
    await prisma.userRole.createMany({
      data: [
        { userId: studentA.id, roleId: studentRole.id },
        { userId: studentB.id, roleId: studentRole.id },
        { userId: teacher.id, roleId: teacherRole.id },
        { userId: parent.id, roleId: parentRole.id },
      ],
    });
    app = await createTestApp();
    adminToken = await token(admin);
    teacherToken = await token(teacher);
    parentToken = await token(parent);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('enforces teacher and parent scopes and keeps roster history', async () => {
    const teacherStudents = await api('get', '/api/v1/academic-profiles/students', teacherToken);
    expect(teacherStudents.map((item: { id: string }) => item.id)).toEqual([studentAId]);
    await request(app.getHttpServer())
      .get(`/api/v1/academic-profiles/students/${studentBId}`)
      .auth(teacherToken, { type: 'bearer' })
      .expect(403);

    await api('patch', `/api/v1/academic-profiles/students/${studentAId}`, adminToken, {
      studentNo: 'S-001', school: 'Test School', grade: 'Grade 6', enrollmentStatus: 'active',
    });
    await api('post', '/api/v1/academic-profiles/parent-students', adminToken, {
      parentId, studentId: studentAId, relationship: '监护人', isPrimary: true,
    });
    const children = await api('get', '/api/v1/academic-profiles/parents/me/students', parentToken);
    expect(children).toHaveLength(1);
    expect(children[0].student).toMatchObject({ id: studentAId });

    await api('delete', `/api/v1/classes/${classId}/students/${studentAId}`, adminToken);
    const left = await prisma.classStudent.findUniqueOrThrow({
      where: { classId_studentId: { classId, studentId: studentAId } },
    });
    expect(left.status).toBe(ClassMemberStatus.LEFT);
    expect(left.leftAt).toBeTruthy();
    await api('post', `/api/v1/classes/${classId}/students`, adminToken, { userIds: [studentAId] });
    const active = await prisma.classStudent.findUniqueOrThrow({
      where: { classId_studentId: { classId, studentId: studentAId } },
    });
    expect(active.id).toBe(left.id);
    expect(active.status).toBe(ClassMemberStatus.ACTIVE);
    expect(active.leftAt).toBeNull();
  });

  it('preflights, approves, applies and safely reruns a password-free profile migration', async () => {
    const snapshot = cleanSnapshot();
    const run = await api('post', '/api/v1/legacy-migrations/preflight', adminToken, snapshot);
    expect(run).toMatchObject({ status: 'READY', conflictCount: 0 });
    expect(run.summary.passwordFieldsRead).toBe(0);
    await api('post', `/api/v1/legacy-migrations/${run.id}/approve`, adminToken);
    const completed = await api('post', `/api/v1/legacy-migrations/${run.id}/apply`, adminToken, snapshot);
    expect(completed.status).toBe('COMPLETED');
    const migrated = await prisma.user.findUniqueOrThrow({ where: { username: 'legacy_student_unique' } });
    expect(migrated).toMatchObject({ status: UserStatus.PENDING_ACTIVATION, mustChangePassword: true });
    expect(await bcrypt.compare('legacy-password-must-not-exist', migrated.passwordHash)).toBe(false);
    const beforeCount = await prisma.user.count({ where: { username: 'legacy_student_unique' } });
    await api('post', `/api/v1/legacy-migrations/${run.id}/apply`, adminToken, snapshot);
    expect(await prisma.user.count({ where: { username: 'legacy_student_unique' } })).toBe(beforeCount);
    expect(await prisma.legacyIdMapping.count({ where: { sourceSystem: 'integration-worker' } })).toBeGreaterThan(0);
  });

  it('requires a signed conflict disposition before approval', async () => {
    const snapshot = cleanSnapshot();
    snapshot.sourceVersion = 'v2-conflict';
    snapshot.students[0].legacyId = 'student-conflict';
    snapshot.students[0].phone = '13900000003';
    snapshot.accounts[0] = { legacyId: 'account-conflict', username: 'identity_student_b', studentLegacyId: 'student-conflict' };
    const run = await api('post', '/api/v1/legacy-migrations/preflight', adminToken, snapshot);
    expect(run.status).toBe('PREFLIGHT_BLOCKED');
    await request(app.getHttpServer())
      .post(`/api/v1/legacy-migrations/${run.id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .expect(400);
    const resolved = await api('patch', `/api/v1/legacy-migrations/conflicts/${run.conflicts[0].id}`, adminToken, {
      resolutionCode: 'SKIP', note: '集成测试确认保留现有账号，跳过冲突记录', waive: false,
    });
    expect(resolved.status).toBe('READY');
    const approved = await api('post', `/api/v1/legacy-migrations/${run.id}/approve`, adminToken);
    expect(approved.status).toBe('APPROVED');
  });

  async function token(user: { id: string; username: string; realName: string | null; userType: UserType }) {
    return (await app.get(TokenService).issueTokens({
      ...user, roles: [], permissions: [],
    }, { ip: '127.0.0.1', userAgent: 'academic-identity-test' })).accessToken;
  }

  async function api(method: 'get' | 'post' | 'patch' | 'delete', path: string, tokenValue: string, body?: object) {
    let call = request(app.getHttpServer())[method](path).auth(tokenValue, { type: 'bearer' });
    if (body !== undefined) call = call.send(body);
    const response = await call.expect((result) => {
      if (result.status >= 400) throw new Error(`${method.toUpperCase()} ${path}: ${result.status} ${JSON.stringify(result.body)}`);
    });
    return response.body.data;
  }
});

function cleanSnapshot() {
  return {
    sourceSystem: 'integration-worker', sourceVersion: 'v1',
    students: [{ legacyId: 'student-1', name: 'Migrated Student', phone: '13900000001', school: 'Legacy School', status: 'active' }],
    teachers: [{ legacyId: 'teacher-1', name: 'Migrated Teacher', phone: '13900000002', subject: 'Programming', status: 'active' }],
    classes: [{ legacyId: 'class-1', name: 'Migrated Class', teacherLegacyId: 'teacher-1', status: 'active' }],
    classStudents: [{ legacyId: 'member-1', classLegacyId: 'class-1', studentLegacyId: 'student-1', status: 'active' }],
    accounts: [
      { legacyId: 'account-1', username: 'legacy_student_unique', studentLegacyId: 'student-1' },
      { legacyId: 'account-2', username: 'legacy_teacher_unique', teacherLegacyId: 'teacher-1' },
    ],
  };
}

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
