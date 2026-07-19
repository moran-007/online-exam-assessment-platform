import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LegacyProfileSnapshotDto } from '../../src/modules/legacy-migration/dto/legacy-profile-snapshot.dto';
import {
  fingerprintSnapshot,
  normalizePhone,
} from '../../src/modules/legacy-migration/legacy-migration.helpers';

type Row = Record<string, unknown>;

export const REQUIRED_MIGRATION_VERSIONS = [
  'sqlite-profile-v1',
  'sqlite-academic-operations-v1',
  'sqlite-lesson-records-v1',
  'sqlite-scratch-v1',
] as const;

export type RequiredMigrationVersion = typeof REQUIRED_MIGRATION_VERSIONS[number];

export type SourceAsset = {
  category: 'lesson' | 'scratch';
  legacyId: string;
  fileAssetLegacyId: string;
  path: string;
  size: number;
  sha256: string;
};

export type WorkerSourceSnapshot = {
  databasePath: string;
  databaseSize: number;
  databaseModifiedAt: string;
  databaseSha256: string;
  sourceFingerprint: string;
  migrationFingerprints: Record<RequiredMigrationVersion, string>;
  entityCounts: Record<string, number>;
  assets: SourceAsset[];
};

export async function inspectWorkerSource(filename: string): Promise<WorkerSourceSnapshot> {
  const databasePath = resolve(filename);
  const [databaseBuffer, databaseInfo] = await Promise.all([readFile(databasePath), stat(databasePath)]);
  if (!databaseInfo.isFile()) throw new Error(`worker 源库不是文件：${databasePath}`);
  const databaseSha256 = sha256(databaseBuffer);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const entityCounts = readEntityCounts(db);
    const profileFingerprint = fingerprintSnapshot(readProfileSnapshot(db));
    const lessonAssets = await readLessonAssets(db, databasePath);
    const scratchAssets = await readScratchAssets(db, databasePath);
    const lessonManifest = manifestHash(lessonAssets);
    const scratchManifest = manifestHash(scratchAssets);
    const assets = [...lessonAssets, ...scratchAssets];
    const sourceFingerprint = sha256([
      databaseSha256,
      ...assets
        .map((item) => `${item.category}:${item.legacyId}:${item.sha256}:${item.size}`)
        .sort(),
    ].join('\n'));
    return {
      databasePath,
      databaseSize: databaseInfo.size,
      databaseModifiedAt: databaseInfo.mtime.toISOString(),
      databaseSha256,
      sourceFingerprint,
      migrationFingerprints: {
        'sqlite-profile-v1': profileFingerprint,
        'sqlite-academic-operations-v1': databaseSha256,
        'sqlite-lesson-records-v1': sha256(`${databaseSha256}:${lessonManifest}`),
        'sqlite-scratch-v1': sha256(`${databaseSha256}:${scratchManifest}`),
      },
      entityCounts,
      assets,
    };
  } finally {
    db.close();
  }
}

function readEntityCounts(db: DatabaseSync) {
  const scratchAssetIds = referencedScratchAssetIds(db);
  const parentPhones = new Set(
    rows(db, 'SELECT parent_phone FROM students')
      .map((row) => normalizePhone(optional(row.parent_phone)))
      .filter((item): item is string => Boolean(item)),
  );
  return {
    student: count(db, 'SELECT COUNT(*) AS count FROM students'),
    teacher: count(db, 'SELECT COUNT(*) AS count FROM teachers'),
    parent: parentPhones.size,
    class: count(db, 'SELECT COUNT(*) AS count FROM classes'),
    class_student: count(db, 'SELECT COUNT(*) AS count FROM class_students'),
    class_teacher: count(db, "SELECT COUNT(*) AS count FROM classes WHERE TRIM(COALESCE(teacher_id, '')) <> ''"),
    lesson_type: count(db, 'SELECT COUNT(*) AS count FROM lesson_types'),
    course_unit: count(db, 'SELECT COUNT(*) AS count FROM course_presets'),
    lesson_session: count(db, 'SELECT COUNT(*) AS count FROM lessons'),
    attendance: count(db, 'SELECT COUNT(*) AS count FROM attendance'),
    lesson_hour_opening: count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT student.id
        FROM students student
        LEFT JOIN attendance ON attendance.student_id = student.id
        GROUP BY student.id, student.purchased_hours, student.gift_hours
        HAVING COALESCE(student.purchased_hours, 0) + COALESCE(student.gift_hours, 0)
          - COALESCE(SUM(attendance.deduct_hours), 0) <> 0
      ) balance
    `),
    lesson_record: count(db, 'SELECT COUNT(*) AS count FROM lesson_details'),
    lesson_record_session: count(db, `
      SELECT COUNT(DISTINCT lesson_id) AS count FROM (
        SELECT lesson_id FROM lesson_details
        UNION ALL
        SELECT la.lesson_id FROM lesson_assets la
        JOIN uploaded_assets ua ON ua.id = la.asset_id
        WHERE la.status = 'active' AND ua.status = 'uploaded'
      ) records
    `),
    lesson_asset: count(db, `
      SELECT COUNT(*) AS count FROM lesson_assets la
      JOIN uploaded_assets ua ON ua.id = la.asset_id
      WHERE la.status = 'active' AND ua.status = 'uploaded'
    `),
    lesson_file_asset: count(db, `
      SELECT COUNT(DISTINCT la.asset_id) AS count FROM lesson_assets la
      JOIN uploaded_assets ua ON ua.id = la.asset_id
      WHERE la.status = 'active' AND ua.status = 'uploaded'
    `),
    scratch_template: count(db, 'SELECT COUNT(*) AS count FROM scratch_templates'),
    scratch_assignment: count(db, 'SELECT COUNT(*) AS count FROM lesson_scratch_templates'),
    scratch_work: count(db, 'SELECT COUNT(*) AS count FROM scratch_works'),
    scratch_work_version: count(db, 'SELECT COUNT(*) AS count FROM scratch_works'),
    scratch_review: count(db, `
      SELECT COUNT(*) AS count FROM scratch_works
      WHERE score IS NOT NULL OR TRIM(COALESCE(review_comment, '')) <> '' OR reviewed_at IS NOT NULL
    `),
    scratch_judge_run: count(db, 'SELECT COUNT(*) AS count FROM scratch_judge_runs'),
    scratch_file_asset: scratchAssetIds.size,
  };
}

function readProfileSnapshot(db: DatabaseSync): LegacyProfileSnapshotDto {
  const hasStudentAccount = columns(db, 'users').has('student_id');
  const students = rows(db, `
    SELECT id, name, gender, phone, parent_name, parent_phone, school, status
    FROM students ORDER BY id
  `).map((row) => compact({
    legacyId: text(row.id), name: text(row.name), gender: optional(row.gender),
    phone: optional(row.phone), parentName: optional(row.parent_name),
    parentPhone: optional(row.parent_phone), school: optional(row.school), status: optional(row.status),
  }));
  const teachers = rows(db, `
    SELECT id, name, phone, subject, status FROM teachers ORDER BY id
  `).map((row) => compact({
    legacyId: text(row.id), name: text(row.name), phone: optional(row.phone),
    subject: optional(row.subject), status: optional(row.status),
  }));
  const classes = rows(db, `
    SELECT id, class_name, teacher_id, status FROM classes ORDER BY id
  `).map((row) => compact({
    legacyId: text(row.id), name: text(row.class_name),
    teacherLegacyId: optional(row.teacher_id), status: optional(row.status),
  }));
  const classStudents = rows(db, `
    SELECT id, class_id, student_id, status, join_date, leave_date
    FROM class_students ORDER BY id
  `).map((row) => compact({
    legacyId: text(row.id), classLegacyId: text(row.class_id), studentLegacyId: text(row.student_id),
    status: optional(row.status), joinDate: optional(row.join_date), leaveDate: optional(row.leave_date),
  }));
  const studentColumn = hasStudentAccount ? ', student_id' : '';
  const accounts = rows(db, `
    SELECT id, username, teacher_id ${studentColumn} FROM users ORDER BY id
  `).map((row) => compact({
    legacyId: text(row.id), username: text(row.username),
    teacherLegacyId: optional(row.teacher_id), studentLegacyId: optional(row.student_id),
  }));
  return {
    sourceSystem: 'worker_01',
    sourceVersion: 'sqlite-profile-v1',
    students,
    teachers,
    classes,
    classStudents,
    accounts,
  };
}

async function readLessonAssets(db: DatabaseSync, databasePath: string) {
  const sourceRows = rows(db, `
    SELECT la.id, la.asset_id, ua.storage_path, ua.file_size
    FROM lesson_assets la
    JOIN uploaded_assets ua ON ua.id = la.asset_id
    WHERE la.status = 'active' AND ua.status = 'uploaded'
    ORDER BY la.id
  `);
  return readAssets(databasePath, 'lesson', sourceRows);
}

async function readScratchAssets(db: DatabaseSync, databasePath: string) {
  const ids = referencedScratchAssetIds(db);
  const sourceRows = rows(db, `
    SELECT id, id AS asset_id, storage_path, file_size
    FROM uploaded_assets WHERE status = 'uploaded' ORDER BY id
  `).filter((row) => ids.has(text(row.id)));
  return readAssets(databasePath, 'scratch', sourceRows);
}

async function readAssets(databasePath: string, category: SourceAsset['category'], sourceRows: Row[]) {
  const uploadRoot = resolve(dirname(databasePath), 'uploads');
  const result: SourceAsset[] = [];
  for (const row of sourceRows) {
    const path = resolve(text(row.storage_path));
    const inside = relative(uploadRoot, path);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`)) {
      throw new Error(`${category} 附件 ${text(row.id)} 路径超出 worker 上传目录`);
    }
    const [buffer, info] = await Promise.all([readFile(path), stat(path)]);
    const declaredSize = number(row.file_size);
    if (!info.isFile() || info.size !== declaredSize) {
      throw new Error(`${category} 附件 ${text(row.id)} 大小或类型校验失败`);
    }
    result.push({
      category,
      legacyId: text(row.id),
      fileAssetLegacyId: text(row.asset_id),
      path,
      size: info.size,
      sha256: sha256(buffer),
    });
  }
  return result;
}

function referencedScratchAssetIds(db: DatabaseSync) {
  const values = rows(db, `
    SELECT asset_id, thumbnail_asset_id FROM scratch_templates
    UNION ALL
    SELECT asset_id, thumbnail_asset_id FROM scratch_works
  `);
  return new Set(values.flatMap((row) => [optional(row.asset_id), optional(row.thumbnail_asset_id)])
    .filter((item): item is string => Boolean(item)));
}

function manifestHash(assets: SourceAsset[]) {
  return sha256(assets.map((item) => `${item.legacyId}:${item.sha256}:${item.size}`).join('\n'));
}

function columns(db: DatabaseSync, table: string) {
  return new Set(rows(db, `PRAGMA table_info(${table})`).map((row) => text(row.name)));
}

function count(db: DatabaseSync, sql: string) {
  return number(rows(db, sql)[0]?.count);
}

function rows(db: DatabaseSync, sql: string) {
  return db.prepare(sql).all() as Row[];
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function optional(value: unknown) {
  const result = text(value);
  return result || undefined;
}

function number(value: unknown) {
  const result = Number(value ?? 0);
  if (!Number.isFinite(result)) throw new Error(`无效数字：${String(value)}`);
  return result;
}

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}
