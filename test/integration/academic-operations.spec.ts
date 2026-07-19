import { INestApplication } from '@nestjs/common';
import {
  AttendanceStatus,
  ClassTeacherRole,
  LessonHourLedgerType,
  PrismaClient,
  UserType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request = require('supertest');
import { TokenService } from '../../src/modules/auth/token.service';
import { createTestApp } from '../helpers/test-app';

jest.setTimeout(90_000);

describe('academic operations', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken = '';
  let teacherToken = '';
  let studentToken = '';
  let parentToken = '';
  let classId = '';
  let studentId = '';
  let lessonTypeId = '';

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDatabase(prisma);
    const passwordHash = await bcrypt.hash('123456', 4);
    const [admin, teacher, student, parent] = await Promise.all([
      prisma.user.create({ data: { username: 'ops_admin', passwordHash, userType: UserType.SUPER_ADMIN } }),
      prisma.user.create({ data: { username: 'ops_teacher', passwordHash, userType: UserType.TEACHER } }),
      prisma.user.create({ data: { username: 'ops_student', passwordHash, userType: UserType.STUDENT } }),
      prisma.user.create({ data: { username: 'ops_parent', passwordHash, userType: UserType.PARENT } }),
    ]);
    studentId = student.id;
    const classGroup = await prisma.classGroup.create({ data: { name: 'Operations Class', code: 'ops_class' } });
    classId = classGroup.id;
    await prisma.classTeacher.create({ data: { classId, teacherId: teacher.id, role: ClassTeacherRole.LEAD } });
    await prisma.classStudent.create({ data: { classId, studentId } });
    await prisma.parentStudent.create({
      data: { parentId: parent.id, studentId, relationship: '监护人', isPrimary: true },
    });
    const permissionCodes = [
      'lesson-type:read', 'course-unit:read', 'schedule:read', 'schedule:manage',
      'attendance:read', 'attendance:confirm', 'attendance:correct', 'lesson-hour:read',
    ];
    const permissions = await Promise.all(permissionCodes.map((code) => prisma.permission.create({
      data: { name: code, code, type: 'API' },
    })));
    const [teacherRole, studentRole, parentRole] = await Promise.all([
      prisma.role.create({ data: { name: 'Teacher', code: 'teacher' } }),
      prisma.role.create({ data: { name: 'Student', code: 'student' } }),
      prisma.role.create({ data: { name: 'Parent', code: 'parent' } }),
    ]);
    await prisma.rolePermission.createMany({
      data: [
        ...permissions.map((permission) => ({ roleId: teacherRole.id, permissionId: permission.id })),
        ...permissions.filter((permission) => ['schedule:read', 'attendance:read', 'lesson-hour:read'].includes(permission.code))
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
      ],
    });

    app = await createTestApp();
    adminToken = await token(admin, []);
    teacherToken = await token(teacher, [
      'lesson-type:read', 'course-unit:read', 'schedule:read', 'schedule:manage',
      'attendance:read', 'attendance:confirm', 'attendance:correct', 'lesson-hour:read',
    ]);
    studentToken = await token(student, ['schedule:read', 'attendance:read', 'lesson-hour:read']);
    parentToken = await token(parent, ['schedule:read', 'attendance:read', 'lesson-hour:read']);

    const lessonType = await api('post', '/api/v1/lesson-types', adminToken, {
      name: '计费正课', defaultHours: 1, countInStatistics: true, active: true,
    });
    lessonTypeId = lessonType.id;
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('generates rule sessions idempotently with explicit timezone', async () => {
    const rule = await api('post', '/api/v1/schedule-rules', teacherToken, {
      classId,
      lessonTypeId,
      weekday: 1,
      startMinute: 1080,
      endMinute: 1200,
      effectiveFrom: '2026-07-20',
      effectiveTo: '2026-07-20',
      timezone: 'Asia/Shanghai',
      lessonHours: 1,
      classroom: 'A101',
    });
    const first = await api('post', '/api/v1/lesson-sessions/generate', teacherToken, {
      ruleId: rule.id, from: '2026-07-20', to: '2026-07-20',
    });
    const second = await api('post', '/api/v1/lesson-sessions/generate', teacherToken, {
      ruleId: rule.id, from: '2026-07-20', to: '2026-07-20',
    });
    expect(first).toMatchObject({ candidates: 1, created: 1, skipped: 0 });
    expect(second).toMatchObject({ candidates: 1, created: 0, skipped: 1 });
    const session = await prisma.lessonSession.findFirstOrThrow({ where: { scheduleRuleId: rule.id } });
    expect(session.startsAt.toISOString()).toBe('2026-07-20T10:00:00.000Z');
  });

  it('keeps reschedule, cancellation, and makeup history traceable', async () => {
    const source = await api('post', '/api/v1/lesson-sessions', teacherToken, {
      classId,
      lessonTypeId,
      title: '可变更课次',
      startsAt: '2026-07-22T10:00:00.000Z',
      endsAt: '2026-07-22T11:00:00.000Z',
      timezone: 'Asia/Shanghai',
      lessonHours: 1,
      classroom: 'A101',
    });
    const replacement = await api('post', `/api/v1/lesson-sessions/${source.id}/reschedule`, teacherToken, {
      startsAt: '2026-07-22T12:00:00.000Z',
      endsAt: '2026-07-22T13:00:00.000Z',
      classroom: 'B202',
      reason: '学生临时冲突',
    });
    expect(replacement).toMatchObject({ sourceSessionId: source.id, status: 'PLANNED', classroom: 'B202' });
    expect(await prisma.lessonSession.findUniqueOrThrow({ where: { id: source.id } }))
      .toMatchObject({ status: 'RESCHEDULED', cancelReason: '学生临时冲突' });

    const cancelled = await api('patch', `/api/v1/lesson-sessions/${replacement.id}/cancel`, teacherToken, {
      reason: '场地临时不可用',
    });
    expect(cancelled).toEqual({ id: replacement.id, status: 'CANCELLED' });
    const makeup = await api('post', `/api/v1/lesson-sessions/${replacement.id}/makeup`, teacherToken, {
      startsAt: '2026-07-29T12:00:00.000Z',
      endsAt: '2026-07-29T13:00:00.000Z',
      classroom: 'C303',
      reason: '补回取消课次',
    });
    expect(makeup).toMatchObject({ sourceSessionId: replacement.id, kind: 'MAKEUP', status: 'PLANNED', classroom: 'C303' });
    expect(await prisma.auditLog.count({
      where: { action: { in: ['lesson-session:reschedule', 'lesson-session:cancel', 'lesson-session:makeup'] } },
    })).toBe(3);
  });

  it('confirms attendance and hours in one transaction, then corrects through reversal', async () => {
    await api('post', '/api/v1/lesson-hours/adjustments', adminToken, {
      studentId,
      classId,
      type: LessonHourLedgerType.OPENING_BALANCE,
      amount: 10,
      idempotencyKey: 'integration-opening-balance',
    });
    const session = await api('post', '/api/v1/lesson-sessions', teacherToken, {
      classId,
      lessonTypeId,
      title: '事务考勤课次',
      startsAt: '2026-07-21T10:00:00.000Z',
      endsAt: '2026-07-21T11:00:00.000Z',
      timezone: 'Asia/Shanghai',
      lessonHours: 1,
    });
    const first = await api('post', `/api/v1/lesson-sessions/${session.id}/attendance/confirm`, teacherToken, {
      records: [{ studentId, status: AttendanceStatus.PRESENT }],
    });
    const repeated = await api('post', `/api/v1/lesson-sessions/${session.id}/attendance/confirm`, teacherToken, {
      records: [{ studentId, status: AttendanceStatus.PRESENT }],
    });
    expect(first).toEqual({ confirmed: 1, skipped: 0 });
    expect(repeated).toEqual({ confirmed: 0, skipped: 1 });
    expect(await balance()).toBe(9);

    const attendance = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId } },
    });
    await api('patch', `/api/v1/attendance-records/${attendance.id}/correct`, teacherToken, {
      status: AttendanceStatus.LEAVE,
      deductHours: 0,
      reason: '核实为已请假',
    });
    expect(await balance()).toBe(10);
    expect(await prisma.lessonHourLedger.count({ where: { attendanceId: attendance.id, type: LessonHourLedgerType.CONSUME } })).toBe(1);
    expect(await prisma.lessonHourLedger.count({ where: { attendanceId: attendance.id, type: LessonHourLedgerType.REVERSAL } })).toBe(1);
    expect(await prisma.attendanceRevision.count({ where: { attendanceId: attendance.id } })).toBe(1);

    const ledger = await prisma.lessonHourLedger.findFirstOrThrow({ where: { attendanceId: attendance.id } });
    await expect(prisma.lessonHourLedger.update({ where: { id: ledger.id }, data: { note: 'illegal mutation' } })).rejects.toThrow('append-only');
  });

  it('enforces student and parent scopes and produces a zero-difference reconciliation', async () => {
    const studentBalances = await api('get', '/api/v1/lesson-hours/balances', studentToken);
    const parentBalances = await api('get', '/api/v1/lesson-hours/balances', parentToken);
    expect(studentBalances).toHaveLength(1);
    expect(parentBalances).toEqual(studentBalances);
    expect(studentBalances[0]).toMatchObject({ studentId, balance: 10 });

    const report = await api('post', '/api/v1/lesson-hours/reconcile', adminToken, {
      studentId, expectedBalance: 10,
    });
    expect(report).toMatchObject({ passed: true, invalidReversalCount: 0 });
    expect(report.items[0]).toMatchObject({ studentId, difference: 0, passed: true });
  });

  async function balance() {
    const aggregate = await prisma.lessonHourLedger.aggregate({ where: { studentId }, _sum: { amount: true } });
    return Number(aggregate._sum.amount ?? 0);
  }

  async function token(
    user: { id: string; username: string; realName: string | null; userType: UserType },
    permissions: string[],
  ) {
    return (await app.get(TokenService).issueTokens({ ...user, roles: [], permissions }, {
      ip: '127.0.0.1', userAgent: 'academic-operations-test',
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
