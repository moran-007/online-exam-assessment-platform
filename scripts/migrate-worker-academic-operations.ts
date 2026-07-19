import {
  AttendanceStatus,
  CourseUnitStatus,
  LessonHourLedgerType,
  LessonSessionStatus,
  MigrationRunStatus,
  Prisma,
  PrismaClient,
  UserType,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { zonedDateTime } from '../src/modules/academic-operations/academic-time';

type Row = Record<string, unknown>;
type SourceSnapshot = ReturnType<typeof readSource>;

const SOURCE_SYSTEM = 'worker_01';
const SOURCE_VERSION = 'sqlite-academic-operations-v1';

async function main() {
  const filename = argument('source');
  if (!filename) throw new Error('请通过 --source=<attendance.db> 指定旧库');
  const snapshot = readSource(filename);
  const fingerprint = createHash('sha256').update(readFileSync(filename)).digest('hex');
  const dryRun = !process.argv.includes('--apply');
  const report = sourceReport(snapshot, fingerprint);
  if (dryRun) {
    console.log(JSON.stringify({ mode: 'dry-run', ...report }, null, 2));
    return;
  }
  const signoff = argument('signoff');
  if (!signoff || signoff.trim().length < 8) throw new Error('正式写入必须提供不少于 8 个字符的 --signoff=审批说明');

  const prisma = new PrismaClient();
  try {
    const actor = await prisma.user.findFirst({
      where: { userType: { in: [UserType.SUPER_ADMIN, UserType.ADMIN] }, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!actor) throw new Error('目标库缺少可记录审批责任人的管理员账号');
    const run = await findOrCreateRun(prisma, fingerprint, actor.id, report, signoff);
    await prisma.migrationRun.update({
      where: { id: run.id },
      data: { status: MigrationRunStatus.APPLYING, startedAt: new Date(), failureMessage: null },
    });
    try {
      const applied = await prisma.$transaction(
        (tx) => applySnapshot(tx, snapshot, run.id, actor.id),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 },
      );
      const reconciliation = await reconcile(prisma, snapshot);
      const mappingCount = await prisma.legacyIdMapping.count({ where: { runId: run.id } });
      const completed = await prisma.migrationRun.update({
        where: { id: run.id },
        data: {
          status: MigrationRunStatus.COMPLETED,
          mappingCount,
          finishedAt: new Date(),
          summary: { ...report, signoff, applied, reconciliation },
        },
      });
      console.log(JSON.stringify({
        mode: 'apply', runId: completed.id, status: completed.status, mappingCount, applied, reconciliation,
      }, null, 2));
    } catch (error) {
      await prisma.migrationRun.update({
        where: { id: run.id },
        data: {
          status: MigrationRunStatus.FAILED,
          finishedAt: new Date(),
          failureMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function findOrCreateRun(
  prisma: PrismaClient,
  fingerprint: string,
  actorId: string,
  report: ReturnType<typeof sourceReport>,
  signoff: string,
) {
  const existing = await prisma.migrationRun.findFirst({
    where: { sourceSystem: SOURCE_SYSTEM, sourceVersion: SOURCE_VERSION, inputFingerprint: fingerprint },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;
  return prisma.migrationRun.create({
    data: {
      sourceSystem: SOURCE_SYSTEM,
      sourceVersion: SOURCE_VERSION,
      inputFingerprint: fingerprint,
      status: MigrationRunStatus.APPROVED,
      summary: { ...report, signoff },
      createdBy: actorId,
      approvedBy: actorId,
      approvedAt: new Date(),
    },
  });
}

async function applySnapshot(tx: Prisma.TransactionClient, snapshot: SourceSnapshot, runId: string, actorId: string) {
  const mappings = await loadMappings(tx);
  const defaultLessonTypeLegacyId = snapshot.lessonTypes.find((item) => item.countInStatistics)?.id
    ?? snapshot.lessonTypes[0]?.id;
  if (!defaultLessonTypeLegacyId) throw new Error('旧库没有可用课型');
  let lessonTypes = 0;
  let units = 0;
  let sessions = 0;
  let attendance = 0;
  let openingBalances = 0;

  for (const source of snapshot.lessonTypes) {
    const item = await tx.lessonType.upsert({
      where: { name: source.name },
      update: {},
      create: {
        name: source.name,
        defaultHours: source.defaultHours,
        countInStatistics: source.countInStatistics,
        description: source.remark,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    await mapTarget(tx, mappings, runId, 'lesson_type', source.id, item.id);
    lessonTypes += 1;
  }

  for (const source of snapshot.units) {
    const lessonTypeId = requiredMapping(mappings, 'lesson_type', source.lessonTypeId);
    const item = await tx.courseUnitTemplate.upsert({
      where: { code: `worker01-unit-${source.id}` },
      update: {},
      create: {
        code: `worker01-unit-${source.id}`,
        legacyUnscoped: true,
        lessonTypeId,
        category: source.category,
        stage: source.stage,
        unitNo: source.unitNo,
        name: source.name,
        defaultHours: source.defaultHours,
        teachingContent: source.remark,
        status: source.active ? CourseUnitStatus.ACTIVE : CourseUnitStatus.DISABLED,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    await mapTarget(tx, mappings, runId, 'course_unit', source.id, item.id);
    units += 1;
  }

  for (const source of snapshot.sessions) {
    const classId = requiredMapping(mappings, 'class', source.classId);
    const item = await tx.lessonSession.upsert({
      where: { generationKey: `legacy:${SOURCE_SYSTEM}:lesson:${source.id}` },
      update: {},
      create: {
        classId,
        teacherId: optionalMapping(mappings, 'teacher', source.teacherId),
        lessonTypeId: requiredMapping(mappings, 'lesson_type', source.lessonTypeId ?? defaultLessonTypeLegacyId),
        unitTemplateId: optionalMapping(mappings, 'course_unit', source.unitId),
        generationKey: `legacy:${SOURCE_SYSTEM}:lesson:${source.id}`,
        title: source.title,
        status: source.completed ? LessonSessionStatus.COMPLETED : LessonSessionStatus.PLANNED,
        startsAt: zonedDateTime(source.date, source.startMinute, 'Asia/Shanghai'),
        endsAt: zonedDateTime(source.date, source.endMinute, 'Asia/Shanghai'),
        timezone: 'Asia/Shanghai',
        lessonHours: source.hours,
        classroom: source.classroom,
        sourceSystem: SOURCE_SYSTEM,
        legacyId: source.id,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    await mapTarget(tx, mappings, runId, 'lesson_session', source.id, item.id);
    sessions += 1;
  }

  for (const source of snapshot.attendance) {
    const item = await tx.attendanceRecord.upsert({
      where: { sourceSystem_legacyId: { sourceSystem: SOURCE_SYSTEM, legacyId: source.id } },
      update: {},
      create: {
        sessionId: requiredMapping(mappings, 'lesson_session', source.lessonId),
        studentId: requiredMapping(mappings, 'student', source.studentId),
        status: source.status,
        deductHours: source.deductHours,
        confirmedBy: actorId,
        confirmedAt: source.confirmedAt,
        correctionReason: source.remark,
        legacyBaseline: true,
        sourceSystem: SOURCE_SYSTEM,
        legacyId: source.id,
      },
    });
    await mapTarget(tx, mappings, runId, 'attendance', source.id, item.id);
    attendance += 1;
  }

  for (const source of snapshot.balances) {
    const studentId = requiredMapping(mappings, 'student', source.studentId);
    if (source.balance === 0) continue;
    const item = await tx.lessonHourLedger.upsert({
      where: { idempotencyKey: `legacy:${SOURCE_SYSTEM}:student:${source.studentId}:opening-balance:v1` },
      update: {},
      create: {
        studentId,
        type: LessonHourLedgerType.OPENING_BALANCE,
        amount: source.balance,
        idempotencyKey: `legacy:${SOURCE_SYSTEM}:student:${source.studentId}:opening-balance:v1`,
        sourceSystem: SOURCE_SYSTEM,
        legacyId: `opening:${source.studentId}`,
        note: 'worker_01 切换时当前余额',
        createdBy: actorId,
      },
    });
    await mapTarget(tx, mappings, runId, 'lesson_hour_opening', source.studentId, item.id);
    openingBalances += 1;
  }
  return { lessonTypes, units, sessions, attendance, openingBalances };
}

async function reconcile(prisma: PrismaClient, snapshot: SourceSnapshot) {
  const mappings = await loadMappings(prisma);
  let mismatchCount = 0;
  let maxAbsDifference = 0;
  for (const source of snapshot.balances) {
    const studentId = requiredMapping(mappings, 'student', source.studentId);
    const result = await prisma.lessonHourLedger.aggregate({ where: { studentId }, _sum: { amount: true } });
    const actual = Number(result._sum.amount ?? 0);
    const difference = Number(new Prisma.Decimal(actual).minus(source.balance));
    if (difference !== 0) mismatchCount += 1;
    maxAbsDifference = Math.max(maxAbsDifference, Math.abs(difference));
  }
  return {
    students: snapshot.balances.length,
    mismatchCount,
    maxAbsDifference,
    passed: mismatchCount === 0,
  };
}

function readSource(filename: string) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const lessonTypes = rows(db, `SELECT id, type_name, default_hours, count_in_statistics, remark FROM lesson_types ORDER BY id`)
      .map((row) => ({
        id: text(row.id), name: text(row.type_name), defaultHours: number(row.default_hours),
        countInStatistics: Boolean(row.count_in_statistics), remark: optional(row.remark),
      }));
    const units = rows(db, `SELECT id, category, stage, lesson_no, course_name, lesson_type_id, default_hours, status, remark FROM course_presets ORDER BY id`)
      .map((row) => ({
        id: text(row.id), category: optional(row.category), stage: optional(row.stage), unitNo: integer(row.lesson_no),
        name: text(row.course_name), lessonTypeId: text(row.lesson_type_id), defaultHours: number(row.default_hours),
        active: !['停用', 'disabled', 'archived'].includes(text(row.status).toLowerCase()), remark: optional(row.remark),
      }));
    const classTimes = new Map(rows(db, `SELECT id, default_start_time FROM classes`).map((row) => [
      text(row.id), optionalTimeMinute(row.default_start_time),
    ]));
    const sessions = rows(db, `SELECT id, class_id, lesson_date, start_time, end_time, teacher_id, lesson_type_id, lesson_topic, lesson_hours, classroom, status, course_preset_id FROM lessons ORDER BY id`)
      .map((row) => {
        const classId = text(row.class_id);
        const hours = number(row.lesson_hours);
        const explicitStart = optionalTimeMinute(row.start_time);
        const explicitEnd = optionalTimeMinute(row.end_time);
        const startMinute = explicitStart ?? classTimes.get(classId) ?? 9 * 60;
        const derivedEnd = Math.min(1440, startMinute + Math.max(1, hours) * 60);
        return {
          id: text(row.id), classId, date: text(row.lesson_date), startMinute,
          endMinute: explicitEnd && explicitEnd > startMinute ? explicitEnd : derivedEnd,
          timeInferred: explicitStart === undefined || explicitEnd === undefined,
          teacherId: optional(row.teacher_id), lessonTypeId: optional(row.lesson_type_id), unitId: optional(row.course_preset_id),
          title: optional(row.lesson_topic) ?? '历史课次', hours, classroom: optional(row.classroom),
          completed: ['已完成', 'completed'].includes(text(row.status).toLowerCase()),
        };
      });
    const attendance = rows(db, `SELECT id, lesson_id, student_id, status, checkin_time, deduct_hours, remark, created_at, updated_at FROM attendance ORDER BY id`)
      .map((row) => ({
        id: text(row.id), lessonId: text(row.lesson_id), studentId: text(row.student_id),
        status: attendanceStatus(text(row.status)), deductHours: number(row.deduct_hours), remark: optional(row.remark),
        confirmedAt: safeDate(optional(row.checkin_time) ?? optional(row.updated_at) ?? optional(row.created_at)),
      }));
    const balances = rows(db, `
      SELECT student.id AS student_id,
             COALESCE(student.purchased_hours, 0) + COALESCE(student.gift_hours, 0)
               - COALESCE(SUM(attendance.deduct_hours), 0) AS balance
      FROM students student
      LEFT JOIN attendance ON attendance.student_id = student.id
      GROUP BY student.id, student.purchased_hours, student.gift_hours
      ORDER BY student.id
    `).map((row) => ({ studentId: text(row.student_id), balance: number(row.balance) }));
    return { lessonTypes, units, sessions, attendance, balances };
  } finally {
    db.close();
  }
}

function sourceReport(snapshot: SourceSnapshot, fingerprint: string) {
  const slots = new Map<string, number>();
  for (const item of snapshot.sessions) {
    const key = `${item.classId}:${item.date}:${item.startMinute}:${item.endMinute}`;
    slots.set(key, (slots.get(key) ?? 0) + 1);
  }
  return {
    sourceSystem: SOURCE_SYSTEM,
    sourceVersion: SOURCE_VERSION,
    fingerprint,
    counts: {
      lessonTypes: snapshot.lessonTypes.length,
      units: snapshot.units.length,
      sessions: snapshot.sessions.length,
      attendance: snapshot.attendance.length,
      balances: snapshot.balances.length,
    },
    duplicateLegacySlots: [...slots.values()].filter((count) => count > 1).length,
    inferredTimeCount: snapshot.sessions.filter((item) => item.timeInferred).length,
    inferredLessonTypeCount: snapshot.sessions.filter((item) => !item.lessonTypeId).length,
    passwordFieldsRead: 0,
  };
}

async function loadMappings(client: Pick<PrismaClient, 'legacyIdMapping'> | Prisma.TransactionClient) {
  const items = await client.legacyIdMapping.findMany({ where: { sourceSystem: SOURCE_SYSTEM } });
  return new Map(items.map((item) => [mappingKey(item.entityType, item.legacyId), item.targetId]));
}

async function mapTarget(
  tx: Prisma.TransactionClient,
  mappings: Map<string, string>,
  runId: string,
  entityType: string,
  legacyId: string,
  targetId: string,
) {
  const key = mappingKey(entityType, legacyId);
  const existing = mappings.get(key);
  if (existing && existing !== targetId) throw new Error(`映射冲突：${entityType}`);
  if (!existing) {
    await tx.legacyIdMapping.create({ data: { runId, sourceSystem: SOURCE_SYSTEM, entityType, legacyId, targetId } });
    mappings.set(key, targetId);
  }
}

function requiredMapping(mappings: Map<string, string>, type: string, legacyId: string) {
  const value = mappings.get(mappingKey(type, legacyId));
  if (!value) throw new Error(`缺少前置映射：${type}`);
  return value;
}

function optionalMapping(mappings: Map<string, string>, type: string, legacyId?: string) {
  return legacyId ? requiredMapping(mappings, type, legacyId) : undefined;
}

function mappingKey(type: string, legacyId: string) {
  return `${type}:${legacyId}`;
}

function attendanceStatus(value: string) {
  const map: Record<string, AttendanceStatus> = {
    '已到': AttendanceStatus.PRESENT,
    '迟到': AttendanceStatus.LATE,
    '早退': AttendanceStatus.EARLY_LEAVE,
    '请假': AttendanceStatus.LEAVE,
    '缺勤': AttendanceStatus.ABSENT,
    '未到': AttendanceStatus.ABSENT,
    '补签': AttendanceStatus.MAKEUP,
  };
  return map[value] ?? AttendanceStatus.UNCONFIRMED;
}

function rows(db: DatabaseSync, sql: string) {
  return db.prepare(sql).all() as Row[];
}

function timeMinute(value: unknown) {
  const match = /^(\d{1,2}):(\d{2})/.exec(text(value));
  if (!match) throw new Error('旧库存在无效上课时间');
  return Number(match[1]) * 60 + Number(match[2]);
}

function optionalTimeMinute(value: unknown) {
  return optional(value) ? timeMinute(value) : undefined;
}

function safeDate(value?: string) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function optional(value: unknown) {
  return text(value) || undefined;
}

function number(value: unknown) {
  const result = Number(value ?? 0);
  if (!Number.isFinite(result)) throw new Error('旧库存在无效数值');
  return result;
}

function integer(value: unknown) {
  const result = number(value);
  return Number.isInteger(result) ? result : undefined;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
