import {
  FileVisibility,
  LessonAssetAudience,
  LessonRecordStatus,
  LessonRecordVersionAction,
  MigrationRunStatus,
  Prisma,
  PrismaClient,
  UserType,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LocalObjectStorage } from '../src/storage/local-object-storage';

type Row = Record<string, unknown>;
type DetailSource = ReturnType<typeof readSource>['details'][number];
type AssetSource = ReturnType<typeof readSource>['assets'][number] & {
  buffer: Buffer;
  sha256: string;
  detectedMimeType: string;
};

const SOURCE_SYSTEM = 'worker_01';
const SOURCE_VERSION = 'sqlite-lesson-records-v1';

async function main() {
  const filename = argument('source');
  if (!filename) throw new Error('请通过 --source=<attendance.db> 指定旧库');
  const snapshot = readSource(filename);
  const validatedAssets = await validateAssets(filename, snapshot.assets);
  const databaseHash = createHash('sha256').update(await readFile(filename)).digest('hex');
  const manifestHash = createHash('sha256')
    .update(validatedAssets.map((item) => `${item.id}:${item.sha256}:${item.fileSize}`).join('\n'))
    .digest('hex');
  const fingerprint = createHash('sha256').update(`${databaseHash}:${manifestHash}`).digest('hex');
  const report = sourceReport(snapshot, validatedAssets, fingerprint, manifestHash);
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'dry-run', ...report }, null, 2));
    return;
  }
  const signoff = argument('signoff');
  if (!signoff || signoff.trim().length < 8) throw new Error('正式写入必须提供不少于 8 个字符的 --signoff=审批说明');

  const prisma = new PrismaClient();
  const storage = new LocalObjectStorage(new ConfigService({ uploadsDir: process.env.UPLOADS_DIR ?? 'uploads' }));
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
        (tx) => applySnapshot(tx, snapshot.details, validatedAssets, run.id, actor.id, storage),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 },
      );
      const reconciliation = await reconcile(prisma, snapshot.details, validatedAssets, storage);
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
      await prisma.auditLog.create({
        data: {
          userId: actor.id,
          action: 'legacy-migration:lesson-records',
          module: 'legacy-migration',
          targetType: 'migration-run',
          targetId: completed.id,
          afterData: { signoff, applied, reconciliation },
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

async function applySnapshot(
  tx: Prisma.TransactionClient,
  details: DetailSource[],
  assets: AssetSource[],
  runId: string,
  actorId: string,
  storage: LocalObjectStorage,
) {
  const mappings = await loadMappings(tx);
  const detailsByLesson = new Map(details.map((item) => [item.lessonId, item]));
  const lessonIds = [...new Set([...details.map((item) => item.lessonId), ...assets.map((item) => item.lessonId)])]
    .sort((left, right) => Number(left) - Number(right));
  let records = 0;
  let contentRecords = 0;
  let carrierRecords = 0;
  let fileAssets = 0;
  let lessonAssets = 0;

  for (const lessonId of lessonIds) {
    const sessionId = requiredMapping(mappings, 'lesson_session', lessonId);
    const detail = detailsByLesson.get(lessonId);
    const current = await tx.lessonRecord.findUnique({ where: { sessionId } });
    if (current && current.sourceSystem !== SOURCE_SYSTEM) {
      throw new Error(`课次 ${lessonId} 已有非迁移教学记录，已停止以避免覆盖`);
    }
    const timestamp = safeDate(detail?.updatedAt ?? detail?.createdAt ?? assets.find((item) => item.lessonId === lessonId)?.createdAt);
    const record = current ?? await tx.lessonRecord.create({
      data: {
        sessionId,
        status: LessonRecordStatus.PUBLISHED,
        version: 1,
        internalTeachingNotes: null,
        internalClassPerformance: null,
        publicTeachingContent: detail?.teachingContent,
        publicLearningGoal: detail?.learningGoal,
        publicClassPerformance: detail?.classPerformance,
        publicHomework: detail?.homework,
        publicNextPlan: detail?.nextPlan,
        publicMaterials: detail?.materials,
        submittedBy: actorId,
        submittedAt: timestamp,
        publishedBy: actorId,
        publishedAt: timestamp,
        sourceSystem: SOURCE_SYSTEM,
        legacyId: `lesson:${lessonId}`,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: safeDate(detail?.createdAt ?? timestamp.toISOString()),
        updatedAt: timestamp,
      },
    });
    await mapTarget(tx, mappings, runId, 'lesson_record_session', lessonId, record.id);
    if (detail) {
      await mapTarget(tx, mappings, runId, 'lesson_record', detail.id, record.id);
      contentRecords += 1;
    } else {
      carrierRecords += 1;
    }
    records += 1;
  }

  for (const source of assets) {
    const recordId = requiredMapping(mappings, 'lesson_record_session', source.lessonId);
    const extension = extname(source.originalFilename).toLowerCase() || extname(source.storagePath).toLowerCase();
    const objectKey = `lesson-assets/${recordId}/legacy-worker01-${source.assetId}${extension}`;
    const stored = await storage.put({ key: objectKey, data: source.buffer, mimeType: source.detectedMimeType });
    if (stored.size !== source.fileSize || stored.sha256 !== source.sha256) {
      throw new Error(`附件 ${source.assetId} 写入后校验失败`);
    }
    let fileAsset = await tx.fileAsset.findFirst({ where: { objectKey, deletedAt: null } });
    if (!fileAsset) {
      fileAsset = await tx.fileAsset.create({
        data: {
          bucket: 'local',
          objectKey,
          fileName: source.originalFilename,
          fileExt: extension || null,
          mimeType: source.detectedMimeType,
          fileSize: BigInt(source.fileSize),
          sha256: source.sha256,
          visibility: FileVisibility.PRIVATE,
          createdBy: actorId,
          createdAt: safeDate(source.createdAt),
        },
      });
      fileAssets += 1;
    } else if (fileAsset.sha256 !== source.sha256 || Number(fileAsset.fileSize) !== source.fileSize) {
      throw new Error(`附件 ${source.assetId} 的目标文件元数据冲突`);
    }
    const existingLink = await tx.lessonAsset.findUnique({
      where: { sourceSystem_legacyId: { sourceSystem: SOURCE_SYSTEM, legacyId: source.id } },
    });
    const lessonAsset = existingLink ?? await tx.lessonAsset.create({
      data: {
        recordId,
        fileAssetId: fileAsset.id,
        audience: LessonAssetAudience.LEARNER,
        title: source.title ?? source.originalFilename,
        note: source.note,
        sourceSystem: SOURCE_SYSTEM,
        legacyId: source.id,
        createdBy: actorId,
        createdAt: safeDate(source.createdAt),
      },
    });
    await mapTarget(tx, mappings, runId, 'lesson_asset', source.id, lessonAsset.id);
    await mapTarget(tx, mappings, runId, 'lesson_file_asset', source.assetId, fileAsset.id);
    lessonAssets += 1;
  }

  for (const lessonId of lessonIds) {
    const recordId = requiredMapping(mappings, 'lesson_record_session', lessonId);
    const existing = await tx.lessonRecordVersion.findUnique({ where: { recordId_version: { recordId, version: 1 } } });
    if (existing) continue;
    const record = await tx.lessonRecord.findUniqueOrThrow({
      where: { id: recordId },
      include: { assets: { include: { fileAsset: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    });
    await tx.lessonRecordVersion.create({
      data: {
        recordId,
        version: 1,
        status: record.status,
        action: LessonRecordVersionAction.IMPORT,
        snapshotJson: recordSnapshot(record),
        reason: 'worker_01 历史教学记录与课件迁移',
        createdBy: actorId,
        createdAt: record.updatedAt,
      },
    });
  }
  return { records, contentRecords, carrierRecords, fileAssets, lessonAssets, versions: lessonIds.length };
}

async function reconcile(
  prisma: PrismaClient,
  details: DetailSource[],
  assets: AssetSource[],
  storage: LocalObjectStorage,
) {
  const mappings = await loadMappings(prisma);
  let assetMismatchCount = 0;
  for (const source of assets) {
    const targetId = requiredMapping(mappings, 'lesson_asset', source.id);
    const target = await prisma.lessonAsset.findUnique({ where: { id: targetId }, include: { fileAsset: true } });
    if (!target || target.fileAsset.sha256 !== source.sha256 || Number(target.fileAsset.fileSize) !== source.fileSize) {
      assetMismatchCount += 1;
      continue;
    }
    const stored = await storage.stat(target.fileAsset.objectKey).catch(() => null);
    if (!stored || stored.size !== source.fileSize) assetMismatchCount += 1;
  }
  const mappedRecords = await prisma.legacyIdMapping.count({
    where: { sourceSystem: SOURCE_SYSTEM, entityType: 'lesson_record', legacyId: { in: details.map((item) => item.id) } },
  });
  const mappedAssets = await prisma.legacyIdMapping.count({
    where: { sourceSystem: SOURCE_SYSTEM, entityType: 'lesson_asset', legacyId: { in: assets.map((item) => item.id) } },
  });
  const versionCount = await prisma.lessonRecordVersion.count({
    where: { record: { sourceSystem: SOURCE_SYSTEM }, action: LessonRecordVersionAction.IMPORT },
  });
  return {
    sourceRecords: details.length,
    mappedRecords,
    sourceAssets: assets.length,
    mappedAssets,
    assetMismatchCount,
    importedVersionCount: versionCount,
    passed: mappedRecords === details.length && mappedAssets === assets.length && assetMismatchCount === 0,
  };
}

function readSource(filename: string) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const details = rows(db, `
      SELECT id, lesson_id, teaching_content, learning_goal, class_performance, homework,
             next_plan, materials, created_at, updated_at
      FROM lesson_details ORDER BY id
    `).map((row) => ({
      id: text(row.id),
      lessonId: text(row.lesson_id),
      teachingContent: optional(row.teaching_content),
      learningGoal: optional(row.learning_goal),
      classPerformance: optional(row.class_performance),
      homework: optional(row.homework),
      nextPlan: optional(row.next_plan),
      materials: optional(row.materials),
      createdAt: optional(row.created_at),
      updatedAt: optional(row.updated_at),
    }));
    const assets = rows(db, `
      SELECT la.id, la.lesson_id, la.asset_id, la.title, la.note, la.created_at,
             ua.original_filename, ua.storage_path, ua.mime_type, ua.file_size
      FROM lesson_assets la
      JOIN uploaded_assets ua ON ua.id = la.asset_id
      WHERE la.status = 'active' AND ua.status = 'uploaded'
      ORDER BY la.id
    `).map((row) => ({
      id: text(row.id),
      lessonId: text(row.lesson_id),
      assetId: text(row.asset_id),
      title: optional(row.title),
      note: optional(row.note),
      createdAt: optional(row.created_at),
      originalFilename: text(row.original_filename),
      storagePath: text(row.storage_path),
      declaredMimeType: optional(row.mime_type),
      fileSize: number(row.file_size),
    }));
    const excludedUnlinkedAssets = number(rows(db, `
      SELECT COUNT(*) AS count
      FROM uploaded_assets ua
      WHERE ua.status = 'uploaded'
        AND NOT EXISTS (
          SELECT 1 FROM lesson_assets la
          WHERE la.asset_id = ua.id AND la.status = 'active'
        )
    `)[0]?.count);
    return { details, assets, excludedUnlinkedAssets };
  } finally {
    db.close();
  }
}

async function validateAssets(filename: string, assets: ReturnType<typeof readSource>['assets']): Promise<AssetSource[]> {
  const uploadRoot = resolve(dirname(filename), 'uploads');
  const validated: AssetSource[] = [];
  for (const source of assets) {
    const path = resolve(source.storagePath);
    const inside = relative(uploadRoot, path);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`)) throw new Error(`附件 ${source.assetId} 路径超出旧库上传目录`);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new Error(`附件 ${source.assetId} 不存在`);
    if (info.size !== source.fileSize) throw new Error(`附件 ${source.assetId} 大小与旧库声明不一致`);
    const buffer = await readFile(path);
    const detectedMimeType = detectMimeType(buffer, source.originalFilename);
    if (!mimeCompatible(source.declaredMimeType, detectedMimeType)) throw new Error(`附件 ${source.assetId} MIME 校验失败`);
    validated.push({
      ...source,
      buffer,
      detectedMimeType,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    });
  }
  return validated;
}

function sourceReport(
  snapshot: ReturnType<typeof readSource>,
  assets: AssetSource[],
  fingerprint: string,
  manifestSha256: string,
) {
  return {
    sourceSystem: SOURCE_SYSTEM,
    sourceVersion: SOURCE_VERSION,
    fingerprint,
    counts: {
      lessonDetails: snapshot.details.length,
      lessonAssets: assets.length,
      linkedLessons: new Set([...snapshot.details.map((item) => item.lessonId), ...assets.map((item) => item.lessonId)]).size,
      assetBytes: assets.reduce((sum, item) => sum + item.fileSize, 0),
    },
    validation: { existence: 'passed', size: 'passed', mime: 'passed', sha256: 'passed', manifestSha256 },
    excludedUnlinkedAssets: snapshot.excludedUnlinkedAssets,
    passwordFieldsRead: 0,
  };
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
  if (!value) throw new Error(`缺少前置映射：${type}:${legacyId}`);
  return value;
}

function recordSnapshot(record: any): Prisma.InputJsonObject {
  return {
    sessionId: record.sessionId,
    status: record.status,
    version: record.version,
    internalTeachingNotes: record.internalTeachingNotes,
    internalClassPerformance: record.internalClassPerformance,
    publicTeachingContent: record.publicTeachingContent,
    publicLearningGoal: record.publicLearningGoal,
    publicClassPerformance: record.publicClassPerformance,
    publicHomework: record.publicHomework,
    publicNextPlan: record.publicNextPlan,
    publicMaterials: record.publicMaterials,
    submittedAt: record.submittedAt?.toISOString() ?? null,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    assets: record.assets.map((asset: any) => ({
      id: asset.id,
      audience: asset.audience,
      title: asset.title,
      note: asset.note,
      file: {
        id: asset.fileAsset.id,
        fileName: asset.fileAsset.fileName,
        mimeType: asset.fileAsset.mimeType,
        fileSize: asset.fileAsset.fileSize.toString(),
        sha256: asset.fileAsset.sha256,
      },
    })),
  };
}

function detectMimeType(buffer: Buffer, filename: string) {
  const startsWith = (...signature: number[]) => signature.every((value, index) => buffer[index] === value);
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  const zip = startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0x50, 0x4b, 0x05, 0x06);
  if (zip) {
    const extension = extname(filename).toLowerCase();
    if (extension === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (extension === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (extension === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (extension === '.sb3') return 'application/x.scratch.sb3';
    return 'application/zip';
  }
  return 'application/octet-stream';
}

function mimeCompatible(declared: string | undefined, detected: string) {
  if (!declared || declared === 'application/octet-stream') return true;
  return declared === detected;
}

function mappingKey(type: string, legacyId: string) {
  return `${type}:${legacyId}`;
}

function rows(db: DatabaseSync, sql: string) {
  return db.prepare(sql).all() as Row[];
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

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
