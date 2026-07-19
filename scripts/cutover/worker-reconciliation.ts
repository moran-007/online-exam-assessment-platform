import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import {
  REQUIRED_MIGRATION_VERSIONS,
  WorkerSourceSnapshot,
} from './worker-source';

type EntityDiff = {
  entityType: string;
  sourceCount: number;
  mappingCount: number;
  existingTargetCount: number;
  difference: number;
  missingTargets: number;
  signedDifferenceCount: number;
  disposition: 'MATCHED' | 'SIGNED_CONFLICT' | 'UNRESOLVED';
  passed: boolean;
};

type IntegrityCheck = {
  name: string;
  issueCount: number;
  passed: boolean;
};

const INTEGRITY_QUERIES = [
  ['class-student-orphans', `SELECT COUNT(*) AS count FROM class_students item LEFT JOIN classes parent ON parent.id=item.class_id LEFT JOIN users child ON child.id=item.student_id WHERE parent.id IS NULL OR child.id IS NULL`],
  ['class-teacher-orphans', `SELECT COUNT(*) AS count FROM class_teachers item LEFT JOIN classes parent ON parent.id=item.class_id LEFT JOIN users child ON child.id=item.teacher_id WHERE parent.id IS NULL OR child.id IS NULL`],
  ['attendance-orphans', `SELECT COUNT(*) AS count FROM attendance_records item LEFT JOIN lesson_sessions session ON session.id=item.session_id LEFT JOIN users student ON student.id=item.student_id WHERE session.id IS NULL OR student.id IS NULL`],
  ['lesson-hour-orphans', `SELECT COUNT(*) AS count FROM lesson_hour_ledger item LEFT JOIN users student ON student.id=item.student_id WHERE student.id IS NULL`],
  ['lesson-asset-orphans', `SELECT COUNT(*) AS count FROM lesson_assets item LEFT JOIN lesson_records record ON record.id=item.record_id LEFT JOIN files file ON file.id=item.file_asset_id WHERE record.id IS NULL OR file.id IS NULL`],
  ['scratch-version-orphans', `SELECT COUNT(*) AS count FROM scratch_work_versions item LEFT JOIN scratch_works work ON work.id=item.work_id LEFT JOIN files file ON file.id=item.project_asset_id WHERE work.id IS NULL OR file.id IS NULL`],
] as const;

export async function buildWorkerReconciliation(
  prisma: PrismaClient,
  source: WorkerSourceSnapshot,
  uploadsRoot: string,
) {
  const mappings = await prisma.legacyIdMapping.findMany({
    where: { sourceSystem: 'worker_01' },
    select: { entityType: true, legacyId: true, targetId: true },
    orderBy: [{ entityType: 'asc' }, { legacyId: 'asc' }],
  });
  const grouped = new Map<string, typeof mappings>();
  for (const mapping of mappings) {
    const current = grouped.get(mapping.entityType) ?? [];
    current.push(mapping);
    grouped.set(mapping.entityType, current);
  }

  const migrations = await Promise.all(REQUIRED_MIGRATION_VERSIONS.map(async (sourceVersion) => {
    const expectedFingerprint = source.migrationFingerprints[sourceVersion];
    const run = await prisma.migrationRun.findFirst({
      where: {
        sourceSystem: 'worker_01',
        sourceVersion,
        inputFingerprint: expectedFingerprint,
        status: 'COMPLETED',
      },
      select: {
        id: true,
        status: true,
        approvedAt: true,
        finishedAt: true,
        conflicts: { where: { status: 'OPEN' }, select: { id: true } },
      },
      orderBy: { finishedAt: 'desc' },
    });
    return {
      sourceVersion,
      expectedFingerprint,
      runId: run?.id ?? null,
      status: run?.status ?? 'MISSING',
      approvedAt: run?.approvedAt?.toISOString() ?? null,
      finishedAt: run?.finishedAt?.toISOString() ?? null,
      openConflictCount: run?.conflicts.length ?? 0,
      passed: run ? run.conflicts.length === 0 : false,
    };
  }));
  const completedRunIds = migrations.flatMap((item) => item.runId ? [item.runId] : []);
  const signedConflicts = await prisma.migrationConflict.groupBy({
    by: ['entityType'],
    where: {
      runId: { in: completedRunIds },
      status: { in: ['RESOLVED', 'WAIVED'] },
    },
    _count: { _all: true },
  });
  const signedByEntity = new Map(signedConflicts.map((item) => [item.entityType, item._count._all]));

  const entityDiffs: EntityDiff[] = [];
  for (const [entityType, sourceCount] of Object.entries(source.entityCounts)) {
    const entityMappings = grouped.get(entityType) ?? [];
    const existingTargetCount = await targetCount(prisma, entityType, entityMappings.map((item) => item.targetId));
    const difference = entityMappings.length - sourceCount;
    const missingTargets = entityMappings.length - existingTargetCount;
    const signedDifferenceCount = signedByEntity.get(entityType) ?? 0;
    const evaluation = evaluateEntityDifference(difference, missingTargets, signedDifferenceCount);
    entityDiffs.push({
      entityType,
      sourceCount,
      mappingCount: entityMappings.length,
      existingTargetCount,
      difference,
      missingTargets,
      signedDifferenceCount,
      disposition: evaluation.disposition,
      passed: evaluation.passed,
    });
  }

  const [targetAssets, integrityChecks] = await Promise.all([
    verifyTargetAssets(prisma, grouped, uploadsRoot),
    runIntegrityChecks(prisma),
  ]);
  const passed = entityDiffs.every((item) => item.passed)
    && migrations.every((item) => item.passed)
    && targetAssets.passed
    && integrityChecks.every((item) => item.passed);
  return {
    generatedAt: new Date().toISOString(),
    sourceSystem: 'worker_01',
    source: {
      databaseSize: source.databaseSize,
      databaseModifiedAt: source.databaseModifiedAt,
      databaseSha256: source.databaseSha256,
      sourceFingerprint: source.sourceFingerprint,
      verifiedAssetCount: source.assets.length,
    },
    entityDiffs,
    migrations,
    targetAssets,
    integrityChecks,
    passed,
  };
}

export function evaluateEntityDifference(
  difference: number,
  missingTargets: number,
  signedDifferenceCount: number,
) {
  const signed = difference < 0 && Math.abs(difference) <= signedDifferenceCount;
  return {
    disposition: (difference === 0 ? 'MATCHED' : signed ? 'SIGNED_CONFLICT' : 'UNRESOLVED') as EntityDiff['disposition'],
    passed: (difference === 0 || signed) && missingTargets === 0,
  };
}

async function verifyTargetAssets(
  prisma: PrismaClient,
  grouped: Map<string, Array<{ entityType: string; legacyId: string; targetId: string }>>,
  uploadsRoot: string,
) {
  const fileMappings = ['lesson_file_asset', 'scratch_file_asset']
    .flatMap((entityType) => grouped.get(entityType) ?? []);
  const targetIds = [...new Set(fileMappings.map((item) => item.targetId))];
  const files = await prisma.fileAsset.findMany({
    where: { id: { in: targetIds }, deletedAt: null },
    select: { id: true, objectKey: true, fileSize: true, sha256: true },
  });
  const root = resolve(uploadsRoot);
  let missingFiles = 0;
  let metadataMismatches = 0;
  for (const file of files) {
    const path = resolve(root, file.objectKey);
    const inside = relative(root, path);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`)) {
      metadataMismatches += 1;
      continue;
    }
    const buffer = await readFile(path).catch(() => null);
    if (!buffer) {
      missingFiles += 1;
      continue;
    }
    const actualHash = createHash('sha256').update(buffer).digest('hex');
    if (buffer.length !== Number(file.fileSize) || actualHash !== file.sha256) metadataMismatches += 1;
  }
  const missingRows = targetIds.length - files.length;
  return {
    mappingCount: fileMappings.length,
    uniqueTargetCount: targetIds.length,
    existingTargetCount: files.length,
    missingRows,
    missingFiles,
    metadataMismatches,
    passed: missingRows === 0 && missingFiles === 0 && metadataMismatches === 0,
  };
}

async function runIntegrityChecks(prisma: PrismaClient): Promise<IntegrityCheck[]> {
  const result: IntegrityCheck[] = [];
  for (const [name, query] of INTEGRITY_QUERIES) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(query);
    const issueCount = Number(rows[0]?.count ?? 0);
    result.push({ name, issueCount, passed: issueCount === 0 });
  }
  return result;
}

async function targetCount(prisma: PrismaClient, entityType: string, ids: string[]) {
  if (ids.length === 0) return 0;
  const where = { id: { in: [...new Set(ids)] } };
  switch (entityType) {
    case 'student':
    case 'teacher':
    case 'parent':
      return prisma.user.count({ where });
    case 'class': return prisma.classGroup.count({ where });
    case 'class_student': return prisma.classStudent.count({ where });
    case 'class_teacher': return prisma.classTeacher.count({ where });
    case 'lesson_type': return prisma.lessonType.count({ where });
    case 'course_unit': return prisma.courseUnitTemplate.count({ where });
    case 'lesson_session': return prisma.lessonSession.count({ where });
    case 'attendance': return prisma.attendanceRecord.count({ where });
    case 'lesson_hour_opening': return prisma.lessonHourLedger.count({ where });
    case 'lesson_record':
    case 'lesson_record_session':
      return prisma.lessonRecord.count({ where });
    case 'lesson_asset': return prisma.lessonAsset.count({ where });
    case 'lesson_file_asset':
    case 'scratch_file_asset':
      return prisma.fileAsset.count({ where });
    case 'scratch_template': return prisma.scratchTemplate.count({ where });
    case 'scratch_assignment': return prisma.lessonScratchAssignment.count({ where });
    case 'scratch_work': return prisma.scratchWork.count({ where });
    case 'scratch_work_version': return prisma.scratchWorkVersion.count({ where });
    case 'scratch_review': return prisma.scratchReview.count({ where });
    case 'scratch_judge_run': return prisma.scratchJudgeRun.count({ where });
    default: throw new Error(`未配置目标表的迁移实体：${entityType}`);
  }
}
