import { UserType } from '@prisma/client';
import { DatabaseSync } from 'node:sqlite';
import { RequestUser } from '../src/common/interfaces/request-user.interface';
import {
  LegacyAccountDto,
  LegacyClassDto,
  LegacyClassStudentDto,
  LegacyProfileSnapshotDto,
  LegacyStudentDto,
  LegacyTeacherDto,
} from '../src/modules/legacy-migration/dto/legacy-profile-snapshot.dto';
import { LegacyMigrationService } from '../src/modules/legacy-migration/legacy-migration.service';
import { LegacyMigrationPlanner } from '../src/modules/legacy-migration/legacy-migration.planner';
import { LegacyProfileImporter } from '../src/modules/legacy-migration/legacy-profile.importer';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { MetricsService } from '../src/observability/metrics.service';

type SqliteRow = Record<string, unknown>;

async function main() {
  const source = argument('source');
  if (!source) throw new Error('请通过 --source=<attendance.db> 指定旧库');
  const snapshot = readSnapshot(source);
  const prisma = new PrismaService(new MetricsService());
  await prisma.$connect();
  try {
    const planner = new LegacyMigrationPlanner();
    const importer = new LegacyProfileImporter(prisma);
    const migrations = new LegacyMigrationService(prisma, planner, importer, new AuditService(prisma));
    const admin = await prisma.user.findFirst({
      where: { userType: { in: [UserType.SUPER_ADMIN, UserType.ADMIN] }, deletedAt: null },
      select: { id: true, username: true, realName: true, userType: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) throw new Error('目标库缺少可记录审批责任人的管理员账号');
    const actor: RequestUser = { ...admin, roles: [], permissions: [] };
    const runId = argument('apply-run');
    const signoffId = argument('signoff-test-run');
    let run: Awaited<ReturnType<LegacyMigrationService['detail']>>;
    if (signoffId) {
      run = await migrations.detail(signoffId);
      if (run.sourceSystem !== 'worker_01') throw new Error('测试数据处置策略仅允许用于 worker_01 演练');
      for (const conflict of run.conflicts.filter((item) => item.status === 'OPEN')) {
        const phoneConflict = conflict.conflictType.includes('PHONE');
        run = await migrations.resolveConflict(conflict.id, {
          resolutionCode: phoneConflict ? 'CREATE_WITHOUT_PHONE' : 'SKIP',
          note: phoneConflict
            ? '测试数据迁移策略：保持独立身份，不迁移重复手机号，禁止按姓名合并'
            : '测试数据迁移策略：跳过存在姓名歧义的家长关系，保留人工核对记录',
          waive: false,
        }, actor);
      }
      run = await migrations.approve(signoffId, actor);
    } else {
      run = runId
        ? await migrations.apply(runId, snapshot, actor)
        : await migrations.preflight(snapshot, actor);
    }
    const conflictTypes = run.conflicts.reduce<Record<string, number>>((counts, item) => {
      counts[item.conflictType] = (counts[item.conflictType] ?? 0) + 1;
      return counts;
    }, {});
    console.log(JSON.stringify({
      runId: run.id,
      status: run.status,
      summary: run.summary,
      conflictCount: run.conflictCount,
      conflictTypes,
      mappingCount: run.mappingCount,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function readSnapshot(filename: string): LegacyProfileSnapshotDto {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const hasStudentAccount = columns(db, 'users').has('student_id');
    const students = rows(db, `
      SELECT id, name, gender, phone, parent_name, parent_phone, school, status
      FROM students ORDER BY id
    `).map((row) => compact({
      legacyId: text(row.id), name: text(row.name), gender: optional(row.gender),
      phone: optional(row.phone), parentName: optional(row.parent_name),
      parentPhone: optional(row.parent_phone), school: optional(row.school), status: optional(row.status),
    })) as LegacyStudentDto[];
    const teachers = rows(db, `
      SELECT id, name, phone, subject, status FROM teachers ORDER BY id
    `).map((row) => compact({
      legacyId: text(row.id), name: text(row.name), phone: optional(row.phone),
      subject: optional(row.subject), status: optional(row.status),
    })) as LegacyTeacherDto[];
    const classes = rows(db, `
      SELECT id, class_name, teacher_id, status FROM classes ORDER BY id
    `).map((row) => compact({
      legacyId: text(row.id), name: text(row.class_name),
      teacherLegacyId: optional(row.teacher_id), status: optional(row.status),
    })) as LegacyClassDto[];
    const classStudents = rows(db, `
      SELECT id, class_id, student_id, status, join_date, leave_date
      FROM class_students ORDER BY id
    `).map((row) => compact({
      legacyId: text(row.id), classLegacyId: text(row.class_id), studentLegacyId: text(row.student_id),
      status: optional(row.status), joinDate: optional(row.join_date), leaveDate: optional(row.leave_date),
    })) as LegacyClassStudentDto[];
    const studentColumn = hasStudentAccount ? ', student_id' : '';
    const accounts = rows(db, `
      SELECT id, username, teacher_id ${studentColumn} FROM users ORDER BY id
    `).map((row) => compact({
      legacyId: text(row.id), username: text(row.username),
      teacherLegacyId: optional(row.teacher_id), studentLegacyId: optional(row.student_id),
    })) as LegacyAccountDto[];
    return {
      sourceSystem: 'worker_01',
      sourceVersion: 'sqlite-profile-v1',
      students,
      teachers,
      classes,
      classStudents,
      accounts,
    };
  } finally {
    db.close();
  }
}

function columns(db: DatabaseSync, table: string) {
  return new Set(rows(db, `PRAGMA table_info(${table})`).map((row) => text(row.name)));
}

function rows(db: DatabaseSync, sql: string) {
  return db.prepare(sql).all() as SqliteRow[];
}

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function optional(value: unknown) {
  const result = text(value);
  return result || undefined;
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
