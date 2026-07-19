import {
  FileVisibility,
  MigrationRunStatus,
  Prisma,
  PrismaClient,
  ScratchAssignmentStatus,
  ScratchJudgeMode,
  ScratchJudgeRunStatus,
  ScratchTemplateStatus,
  ScratchWorkStatus,
  ScratchWorkVersionSource,
  UserType,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LocalObjectStorage } from '../src/storage/local-object-storage';
import { validateScratchProject } from '../src/modules/scratch/scratch-project.validator';

type Row = Record<string, unknown>;
type Snapshot = ReturnType<typeof readSource>;
type AssetSource = Snapshot['assets'][number] & {
  buffer: Buffer;
  sha256: string;
  mimeType: string;
  validation: Record<string, unknown>;
};

const SOURCE_SYSTEM = 'worker_01';
const SOURCE_VERSION = 'sqlite-scratch-v1';

async function main() {
  const filename = argument('source');
  if (!filename) throw new Error('请通过 --source=<attendance.db> 指定旧库');
  const snapshot = readSource(filename);
  const assets = await validateAssets(filename, snapshot);
  const databaseHash = createHash('sha256').update(await readFile(filename)).digest('hex');
  const manifestHash = createHash('sha256')
    .update(assets.map((item) => `${item.id}:${item.sha256}:${item.fileSize}`).join('\n'))
    .digest('hex');
  const fingerprint = createHash('sha256').update(`${databaseHash}:${manifestHash}`).digest('hex');
  const report = sourceReport(snapshot, assets, fingerprint, manifestHash);
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'dry-run', ...report }, null, 2));
    return;
  }
  const signoff = argument('signoff');
  if (!signoff || signoff.trim().length < 8) throw new Error('正式写入必须提供不少于 8 个字符的 --signoff=审批说明');

  const prisma = new PrismaClient();
  const storage = new LocalObjectStorage(new ConfigService({ uploadsDir: process.env.UPLOADS_DIR ?? 'uploads' }));
  const writtenKeys: string[] = [];
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
        (tx) => applySnapshot(tx, snapshot, assets, run.id, actor.id, storage, writtenKeys),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 },
      );
      const reconciliation = await reconcile(prisma, snapshot, assets, storage);
      if (!reconciliation.passed) throw new Error('Scratch 迁移对账未通过，已停止完成迁移');
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
          action: 'legacy-migration:scratch',
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
      await Promise.all(writtenKeys.map((key) => storage.delete(key).catch(() => undefined)));
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
  snapshot: Snapshot,
  assets: AssetSource[],
  runId: string,
  actorId: string,
  storage: LocalObjectStorage,
  writtenKeys: string[],
) {
  const mappings = await loadMappings(tx);
  let fileAssets = 0;
  for (const source of assets) {
    const key = mappingKey('scratch_file_asset', source.id);
    if (mappings.has(key)) continue;
    const extension = extname(source.originalFilename).toLowerCase() || extname(source.storagePath).toLowerCase();
    const objectKey = `scratch/legacy-worker01/assets/${source.id}${extension}`;
    const stored = await storage.put({ key: objectKey, data: source.buffer, mimeType: source.mimeType });
    writtenKeys.push(objectKey);
    if (stored.size !== source.fileSize || stored.sha256 !== source.sha256) throw new Error(`Scratch 附件 ${source.id} 写入校验失败`);
    const file = await tx.fileAsset.create({
      data: {
        bucket: 'local', objectKey, fileName: source.originalFilename, fileExt: extension || null,
        mimeType: source.mimeType, fileSize: BigInt(source.fileSize), sha256: source.sha256,
        visibility: FileVisibility.PRIVATE, createdBy: actorId, createdAt: safeDate(source.createdAt),
      },
    });
    await mapTarget(tx, mappings, runId, 'scratch_file_asset', source.id, file.id);
    fileAssets += 1;
  }

  for (const source of snapshot.templates) {
    const existingId = mappings.get(mappingKey('scratch_template', source.id));
    if (existingId) continue;
    const projectAssetId = requiredMapping(mappings, 'scratch_file_asset', source.assetId);
    const validation = assets.find((item) => item.id === source.assetId)?.validation ?? { status: 'unknown' };
    const template = await tx.scratchTemplate.create({
      data: {
        title: source.title,
        description: source.description,
        status: source.status === 'active' ? ScratchTemplateStatus.ACTIVE : ScratchTemplateStatus.ARCHIVED,
        projectAssetId,
        thumbnailAssetId: source.thumbnailAssetId
          ? requiredMapping(mappings, 'scratch_file_asset', source.thumbnailAssetId)
          : null,
        runtimeProvider: source.editorUrl ? 'worker_01' : null,
        runtimeProblemUrl: source.editorUrl,
        validationJson: validation as Prisma.InputJsonValue,
        sourceSystem: SOURCE_SYSTEM,
        legacyId: source.id,
        createdBy: actorId,
        createdAt: safeDate(source.createdAt),
        updatedAt: safeDate(source.updatedAt),
      },
    });
    await mapTarget(tx, mappings, runId, 'scratch_template', source.id, template.id);
  }

  const workKeys = new Set(snapshot.works.map((work) => `${work.lessonId}:${work.templateId}`));
  for (const source of snapshot.assignments) {
    const existingId = mappings.get(mappingKey('scratch_assignment', source.id));
    if (existingId) continue;
    const published = Boolean(source.publishedAt) || workKeys.has(`${source.lessonId}:${source.templateId}`);
    const assignment = await tx.lessonScratchAssignment.create({
      data: {
        sessionId: requiredMapping(mappings, 'lesson_session', source.lessonId),
        templateId: requiredMapping(mappings, 'scratch_template', source.templateId),
        title: source.assignmentTitle || snapshot.templates.find((item) => item.id === source.templateId)?.title || 'Scratch 课堂任务',
        statementMd: source.statementMd,
        bindNote: source.bindNote,
        dueAt: source.dueAt ? safeDate(source.dueAt) : null,
        maxScore: source.maxScore,
        status: published ? ScratchAssignmentStatus.PUBLISHED : ScratchAssignmentStatus.DRAFT,
        judgeMode: source.autoJudge ? ScratchJudgeMode.EXTERNAL : ScratchJudgeMode.MANUAL,
        runtimeConfigJson: mergeJson(source.judgeConfig, source.testPointSpec),
        publishedAt: published ? safeDate(source.publishedAt ?? source.createdAt) : null,
        sourceSystem: SOURCE_SYSTEM,
        legacyId: source.id,
        createdBy: actorId,
        createdAt: safeDate(source.createdAt),
      },
    });
    await mapTarget(tx, mappings, runId, 'scratch_assignment', source.id, assignment.id);
  }

  for (const source of snapshot.works) {
    const existingId = mappings.get(mappingKey('scratch_work', source.id));
    if (existingId) continue;
    const assignmentSource = snapshot.assignments.find(
      (item) => item.lessonId === source.lessonId && item.templateId === source.templateId,
    );
    if (!assignmentSource) throw new Error(`作品 ${source.id} 缺少课次任务绑定`);
    const assignmentId = requiredMapping(mappings, 'scratch_assignment', assignmentSource.id);
    const projectSourceId = source.assetId
      ?? snapshot.templates.find((item) => item.id === source.templateId)?.assetId;
    if (!projectSourceId) throw new Error(`作品 ${source.id} 缺少项目文件`);
    const work = await tx.scratchWork.create({
      data: {
        assignmentId,
        studentId: requiredMapping(mappings, 'student', source.studentId),
        title: source.title,
        status: workStatus(source.status),
        currentVersion: 1,
        submitNote: source.submitNote,
        submittedAt: source.submittedAt ? safeDate(source.submittedAt) : null,
        reviewedAt: source.reviewedAt ? safeDate(source.reviewedAt) : null,
        sourceSystem: SOURCE_SYSTEM,
        legacyId: source.id,
        createdAt: safeDate(source.createdAt),
        updatedAt: safeDate(source.updatedAt),
      },
    });
    await mapTarget(tx, mappings, runId, 'scratch_work', source.id, work.id);
    const version = await tx.scratchWorkVersion.create({
      data: {
        workId: work.id,
        version: 1,
        source: ScratchWorkVersionSource.IMPORT,
        projectAssetId: requiredMapping(mappings, 'scratch_file_asset', projectSourceId),
        thumbnailAssetId: source.thumbnailAssetId
          ? requiredMapping(mappings, 'scratch_file_asset', source.thumbnailAssetId)
          : null,
        note: 'worker_01 历史作品导入',
        sourceSystem: SOURCE_SYSTEM,
        legacyId: source.id,
        createdBy: actorId,
        createdAt: safeDate(source.updatedAt),
      },
    });
    await mapTarget(tx, mappings, runId, 'scratch_work_version', source.id, version.id);
    if (source.score !== null || source.reviewComment || source.reviewedAt) {
      const reviewerId = source.reviewerTeacherId
        ? mappings.get(mappingKey('teacher', source.reviewerTeacherId)) ?? actorId
        : actorId;
      const review = await tx.scratchReview.create({
        data: {
          workId: work.id,
          workVersionId: version.id,
          reviewerId,
          score: source.score,
          comment: source.reviewComment,
          sourceSystem: SOURCE_SYSTEM,
          legacyId: source.id,
          createdAt: safeDate(source.reviewedAt ?? source.updatedAt),
        },
      });
      await mapTarget(tx, mappings, runId, 'scratch_review', source.id, review.id);
    }
  }

  for (const source of snapshot.judgeRuns) {
    const existingId = mappings.get(mappingKey('scratch_judge_run', source.id));
    if (existingId) continue;
    const workId = requiredMapping(mappings, 'scratch_work', source.workId);
    const workVersionId = requiredMapping(mappings, 'scratch_work_version', source.workId);
    const work = await tx.scratchWork.findUniqueOrThrow({ where: { id: workId } });
    const run = await tx.scratchJudgeRun.create({
      data: {
        workId,
        workVersionId,
        assignmentId: work.assignmentId,
        idempotencyKey: `worker_01:scratch-judge:${source.id}`,
        status: judgeStatus(source.status),
        attemptCount: 1,
        maxAttempts: 3,
        externalResultJson: source.detail as Prisma.InputJsonValue | undefined,
        score: source.totalScore,
        passed: source.passed,
        message: 'worker_01 历史判定导入',
        requestedAt: safeDate(source.createdAt),
        finishedAt: safeDate(source.createdAt),
        sourceSystem: SOURCE_SYSTEM,
        legacyId: source.id,
        createdAt: safeDate(source.createdAt),
      },
    });
    await mapTarget(tx, mappings, runId, 'scratch_judge_run', source.id, run.id);
  }

  return {
    fileAssets,
    templates: snapshot.templates.length,
    assignments: snapshot.assignments.length,
    works: snapshot.works.length,
    versions: snapshot.works.length,
    reviews: snapshot.works.filter((item) => item.score !== null || item.reviewComment || item.reviewedAt).length,
    judgeRuns: snapshot.judgeRuns.length,
  };
}

function readSource(filename: string) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const templates = rows(db, `
      SELECT id,title,description,asset_id,thumbnail_asset_id,source_type,editor_url,status,created_at,updated_at
      FROM scratch_templates ORDER BY id
    `).map((row) => ({
      id: text(row.id), title: text(row.title), description: optional(row.description),
      assetId: text(row.asset_id), thumbnailAssetId: optional(row.thumbnail_asset_id),
      sourceType: text(row.source_type), editorUrl: optional(row.editor_url), status: text(row.status),
      createdAt: optional(row.created_at), updatedAt: optional(row.updated_at),
    }));
    const assignments = rows(db, `
      SELECT id,lesson_id,template_id,bind_note,status,assignment_title,statement_md,due_at,
             judge_config_json,test_point_spec_json,auto_judge,max_score,published_at,created_at
      FROM lesson_scratch_templates ORDER BY id
    `).map((row) => ({
      id: text(row.id), lessonId: text(row.lesson_id), templateId: text(row.template_id),
      bindNote: optional(row.bind_note), status: text(row.status), assignmentTitle: optional(row.assignment_title),
      statementMd: optional(row.statement_md), dueAt: optional(row.due_at),
      judgeConfig: json(row.judge_config_json), testPointSpec: json(row.test_point_spec_json),
      autoJudge: number(row.auto_judge) === 1, maxScore: number(row.max_score),
      publishedAt: optional(row.published_at), createdAt: optional(row.created_at),
    }));
    const works = rows(db, `
      SELECT w.id,w.lesson_id,w.template_id,w.student_id,w.title,w.status,w.asset_id,w.thumbnail_asset_id,
             w.submit_note,w.review_comment,w.score,w.submitted_at,w.reviewed_at,w.created_at,w.updated_at,
             reviewer.teacher_id AS reviewer_teacher_id
      FROM scratch_works w
      LEFT JOIN users reviewer ON reviewer.id=w.reviewed_by
      ORDER BY w.id
    `).map((row) => ({
      id: text(row.id), lessonId: text(row.lesson_id), templateId: text(row.template_id), studentId: text(row.student_id),
      title: text(row.title), status: text(row.status), assetId: optional(row.asset_id),
      thumbnailAssetId: optional(row.thumbnail_asset_id), submitNote: optional(row.submit_note),
      reviewComment: optional(row.review_comment), score: nullableNumber(row.score),
      submittedAt: optional(row.submitted_at), reviewedAt: optional(row.reviewed_at),
      reviewerTeacherId: optional(row.reviewer_teacher_id), createdAt: optional(row.created_at), updatedAt: optional(row.updated_at),
    }));
    const judgeRuns = rows(db, `
      SELECT id,work_id,status,total_score,passed,detail_json,created_at FROM scratch_judge_runs ORDER BY id
    `).map((row) => ({
      id: text(row.id), workId: text(row.work_id), status: text(row.status), totalScore: nullableNumber(row.total_score),
      passed: number(row.passed) === 1, detail: json(row.detail_json), createdAt: optional(row.created_at),
    }));
    const assetIds = new Set([
      ...templates.flatMap((item) => [item.assetId, item.thumbnailAssetId]),
      ...works.flatMap((item) => [item.assetId, item.thumbnailAssetId]),
    ].filter(Boolean) as string[]);
    const assets = rows(db, `
      SELECT id,original_filename,storage_path,mime_type,file_size,created_at
      FROM uploaded_assets WHERE status='uploaded' ORDER BY id
    `).filter((row) => assetIds.has(text(row.id))).map((row) => ({
      id: text(row.id), originalFilename: text(row.original_filename), storagePath: text(row.storage_path),
      declaredMimeType: optional(row.mime_type), fileSize: number(row.file_size), createdAt: optional(row.created_at),
    }));
    return { templates, assignments, works, judgeRuns, assets };
  } finally {
    db.close();
  }
}

async function validateAssets(filename: string, snapshot: Snapshot): Promise<AssetSource[]> {
  const uploadRoot = resolve(dirname(filename), 'uploads');
  const projectIds = new Set([
    ...snapshot.templates.map((item) => item.assetId),
    ...snapshot.works.map((item) => item.assetId).filter(Boolean),
  ]);
  const validated: AssetSource[] = [];
  for (const source of snapshot.assets) {
    const path = resolve(source.storagePath);
    const inside = relative(uploadRoot, path);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`)) throw new Error(`Scratch 附件 ${source.id} 路径超出旧库上传目录`);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new Error(`Scratch 附件 ${source.id} 不存在`);
    if (info.size !== source.fileSize) throw new Error(`Scratch 附件 ${source.id} 大小与旧库声明不一致`);
    const buffer = await readFile(path);
    const mimeType = detectMimeType(buffer, source.originalFilename);
    let validation: Record<string, unknown> = { status: 'not_applicable' };
    if (projectIds.has(source.id)) {
      try {
        validation = { status: 'valid', ...(await validateScratchProject(buffer, source.originalFilename)) };
      } catch (error) {
        validation = { status: 'legacy_invalid', reason: error instanceof Error ? error.message : String(error) };
      }
    }
    validated.push({
      ...source,
      buffer,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      mimeType,
      validation,
    });
  }
  return validated;
}

async function reconcile(prisma: PrismaClient, snapshot: Snapshot, assets: AssetSource[], storage: LocalObjectStorage) {
  const mappings = await loadMappings(prisma);
  let fileMismatchCount = 0;
  for (const source of assets) {
    const id = mappings.get(mappingKey('scratch_file_asset', source.id));
    const file = id ? await prisma.fileAsset.findUnique({ where: { id } }) : null;
    const stored = file ? await storage.stat(file.objectKey).catch(() => null) : null;
    const storedHash = file && stored ? await hashStoredObject(storage, file.objectKey).catch(() => null) : null;
    if (
      !file || !stored || file.sha256 !== source.sha256 || stored.size !== source.fileSize ||
      storedHash !== source.sha256
    ) fileMismatchCount += 1;
  }
  const counts = await Promise.all([
    countMappings(prisma, 'scratch_template', snapshot.templates.length),
    countMappings(prisma, 'scratch_assignment', snapshot.assignments.length),
    countMappings(prisma, 'scratch_work', snapshot.works.length),
    countMappings(prisma, 'scratch_work_version', snapshot.works.length),
    countMappings(prisma, 'scratch_judge_run', snapshot.judgeRuns.length),
  ]);
  return {
    templates: counts[0], assignments: counts[1], works: counts[2], versions: counts[3], judgeRuns: counts[4],
    fileMismatchCount,
    passed: counts.every((item) => item.passed) && fileMismatchCount === 0,
  };
}

async function hashStoredObject(storage: LocalObjectStorage, key: string) {
  const hash = createHash('sha256');
  const stream = await storage.open(key);
  for await (const chunk of stream) hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return hash.digest('hex');
}

function sourceReport(snapshot: Snapshot, assets: AssetSource[], fingerprint: string, manifestSha256: string) {
  const invalidProjects = assets.filter((item) => item.validation.status === 'legacy_invalid');
  return {
    sourceSystem: SOURCE_SYSTEM,
    sourceVersion: SOURCE_VERSION,
    fingerprint,
    counts: {
      templates: snapshot.templates.length,
      assignments: snapshot.assignments.length,
      works: snapshot.works.length,
      reviews: snapshot.works.filter((item) => item.score !== null || item.reviewComment || item.reviewedAt).length,
      judgeRuns: snapshot.judgeRuns.length,
      assets: assets.length,
      assetBytes: assets.reduce((sum, item) => sum + item.fileSize, 0),
    },
    validation: {
      existence: 'passed', size: 'passed', sha256: 'passed', manifestSha256,
      validProjects: assets.filter((item) => item.validation.status === 'valid').length,
      legacyInvalidProjects: invalidProjects.map((item) => ({ assetId: item.id, reason: item.validation.reason })),
      legacyInvalidPolicy: '原始字节保留到统一对象存储，标记 legacy_invalid；新上传仍严格拒绝',
    },
    passwordFieldsRead: 0,
  };
}

async function findOrCreateRun(prisma: PrismaClient, fingerprint: string, actorId: string, report: any, signoff: string) {
  const existing = await prisma.migrationRun.findFirst({
    where: { sourceSystem: SOURCE_SYSTEM, sourceVersion: SOURCE_VERSION, inputFingerprint: fingerprint },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;
  return prisma.migrationRun.create({
    data: {
      sourceSystem: SOURCE_SYSTEM, sourceVersion: SOURCE_VERSION, inputFingerprint: fingerprint,
      status: MigrationRunStatus.APPROVED, summary: { ...report, signoff }, createdBy: actorId,
      approvedBy: actorId, approvedAt: new Date(),
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
  if (existing && existing !== targetId) throw new Error(`映射冲突：${entityType}:${legacyId}`);
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

async function countMappings(prisma: PrismaClient, entityType: string, expected: number) {
  const actual = await prisma.legacyIdMapping.count({ where: { sourceSystem: SOURCE_SYSTEM, entityType } });
  return { expected, actual, passed: actual >= expected };
}

function workStatus(status: string) {
  if (status === 'reviewed') return ScratchWorkStatus.REVIEWED;
  if (status === 'submitted') return ScratchWorkStatus.SUBMITTED;
  return ScratchWorkStatus.DRAFT;
}

function judgeStatus(status: string) {
  if (status === 'passed' || status === 'accepted' || status === 'succeeded') return ScratchJudgeRunStatus.SUCCEEDED;
  if (status === 'failed' || status === 'rejected') return ScratchJudgeRunStatus.FAILED;
  return ScratchJudgeRunStatus.AWAITING_REVIEW;
}

function detectMimeType(buffer: Buffer, filename: string) {
  const starts = (...bytes: number[]) => bytes.every((value, index) => buffer[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (extname(filename).toLowerCase() === '.sb3' && (starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06))) {
    return 'application/x.scratch.sb3';
  }
  return 'application/octet-stream';
}

function mergeJson(judge: Prisma.JsonValue | undefined, testPoints: Prisma.JsonValue | undefined) {
  if (judge === undefined && testPoints === undefined) return undefined;
  return { judge: judge ?? null, testPoints: testPoints ?? null } as Prisma.InputJsonObject;
}

function json(value: unknown) {
  const raw = optional(value);
  if (!raw) return undefined;
  try { return JSON.parse(raw) as Prisma.JsonValue; } catch { return { legacyRaw: raw } as Prisma.JsonObject; }
}

function rows(db: DatabaseSync, sql: string) {
  return db.prepare(sql).all() as Row[];
}

function safeDate(value?: string) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function mappingKey(type: string, legacyId: string) {
  return `${type}:${legacyId}`;
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

function nullableNumber(value: unknown) {
  return value === null || value === undefined || value === '' ? null : number(value);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
