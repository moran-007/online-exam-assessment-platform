import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

type Manifest = {
  version: 1;
  id: string;
  createdAt: string;
  databaseName: string;
  migrationCount: number;
  tableCounts: Record<string, number>;
  uploadsFiles: Array<{ path: string; size: number; sha256: string }>;
  artifacts: {
    database: { file: string; size: number; sha256: string };
    uploads: { file: string; size: number; sha256: string };
  };
};

const args = process.argv.slice(2);
const command = args[0];
loadEnvFile(join(process.cwd(), '.env'));
const databaseUrl = requiredEnv('DATABASE_URL');
const sourceDatabase = new URL(databaseUrl);
const sourceDatabaseName = decodeURIComponent(sourceDatabase.pathname.slice(1));
const backupRoot = resolve(process.env.BACKUP_DIR || join(process.cwd(), 'output', 'backups'));
const uploadsRoot = resolve(process.env.UPLOADS_DIR || join(process.cwd(), 'uploads'));

async function main() {
  if (command === 'create') {
    console.log(await createBackup());
    return;
  }
  const backup = resolve(option('--backup') || (await latestBackup()));
  if (command === 'verify') {
    console.log(JSON.stringify(await verifyBackup(backup), null, 2));
    return;
  }
  if (command === 'restore') {
    const targetDatabase = option('--target-database');
    const targetUploads = option('--target-uploads');
    if (!targetDatabase || !targetUploads) throw new Error('restore requires --target-database and --target-uploads');
    console.log(JSON.stringify(await restoreBackup(backup, targetDatabase, resolve(targetUploads), false), null, 2));
    return;
  }
  throw new Error('Usage: backup.ts create | verify [--backup path] | restore --backup path --target-database name --target-uploads path');
}

async function createBackup() {
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const lockPath = join(backupRoot, '.backup.lock');
  const lock = await acquireLock(lockPath);
  const now = new Date();
  const id = `backup-${formatTimestamp(now)}`;
  const temporaryDir = join(backupRoot, `.tmp-${id}`);
  const finalDir = join(backupRoot, id);
  try {
    await mkdir(temporaryDir, { recursive: true, mode: 0o700 });
    await mkdir(uploadsRoot, { recursive: true });
    const dumpFile = join(temporaryDir, 'database.dump');
    const uploadsFile = join(temporaryDir, 'uploads.tar.gz');
    runPostgres('pg_dump', ['-Fc', '--no-owner', '--no-privileges', '--file', dumpFile, postgresToolUrl(sourceDatabase)]);
    run('tar', ['-czf', uploadsFile, '-C', dirname(uploadsRoot), basename(uploadsRoot)]);

    const prisma = new PrismaClient();
    const [migrationCount, tableCounts] = await Promise.all([migrationCountFor(prisma), tableCountsFor(prisma)]);
    await prisma.$disconnect();
    const uploadsFiles = await fileManifest(uploadsRoot, uploadsRoot);
    const manifest: Manifest = {
      version: 1,
      id,
      createdAt: now.toISOString(),
      databaseName: sourceDatabaseName,
      migrationCount,
      tableCounts,
      uploadsFiles,
      artifacts: {
        database: await artifact(dumpFile),
        uploads: await artifact(uploadsFile),
      },
    };
    const manifestFile = join(temporaryDir, 'manifest.json');
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await Promise.all([chmod(dumpFile, 0o600), chmod(uploadsFile, 0o600), chmod(manifestFile, 0o600)]);
    await rename(temporaryDir, finalDir);
    await enforceRetention();
    await copyRemote(finalDir);
    return finalDir;
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true });
    throw error;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

async function verifyBackup(backupDir: string) {
  const suffix = formatTimestamp(new Date()).replace(/-/g, '').toLowerCase();
  const targetDatabase = `${sourceDatabaseName}_restore_verify_${suffix}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const targetUploads = resolve(join(process.cwd(), 'runtime', targetDatabase, 'uploads'));
  return restoreBackup(backupDir, targetDatabase, targetUploads, true);
}

async function restoreBackup(backupDir: string, targetDatabase: string, targetUploads: string, cleanup: boolean) {
  if (!targetDatabase.endsWith('_restore') && !targetDatabase.includes('_restore_verify_')) {
    throw new Error('Target database must end with _restore or contain _restore_verify_');
  }
  if (targetDatabase === sourceDatabaseName) throw new Error('Refusing to overwrite the source database');
  if (resolve(targetUploads) === uploadsRoot) throw new Error('Refusing to overwrite the source uploads directory');

  const manifest = await readManifest(backupDir);
  await verifyArtifacts(backupDir, manifest);
  const targetUrl = databaseWithName(sourceDatabase, targetDatabase);
  runPostgres('dropdb', ['--if-exists', targetDatabase]);
  runPostgres('createdb', [targetDatabase]);
  await rm(targetUploads, { recursive: true, force: true });
  await mkdir(dirname(targetUploads), { recursive: true });

  try {
    runPostgres('pg_restore', ['--no-owner', '--no-privileges', '--dbname', postgresToolUrl(new URL(targetUrl)), join(backupDir, manifest.artifacts.database.file)]);
    run('tar', ['-xzf', join(backupDir, manifest.artifacts.uploads.file), '-C', dirname(targetUploads)]);
    const restoredPrisma = new PrismaClient({ datasourceUrl: targetUrl });
    const [migrationCount, tableCounts] = await Promise.all([
      migrationCountFor(restoredPrisma),
      tableCountsFor(restoredPrisma),
    ]);
    await restoredPrisma.$disconnect();
    const restoredFiles = await fileManifest(targetUploads, targetUploads);
    assertEqual(manifest.migrationCount, migrationCount, 'migration count');
    assertRecord(manifest.tableCounts, tableCounts, 'table counts');
    assertFiles(manifest.uploadsFiles, restoredFiles);
    return {
      ok: true,
      backup: backupDir,
      targetDatabase,
      targetUploads,
      migrationCount,
      tableCounts,
      uploadsFileCount: restoredFiles.length,
      cleanedUp: cleanup,
    };
  } finally {
    if (cleanup) {
      runPostgres('dropdb', ['--if-exists', targetDatabase]);
      await rm(dirname(targetUploads), { recursive: true, force: true });
    }
  }
}

async function tableCountsFor(prisma: PrismaClient) {
  const [
    users, classes, classStudents, classTeachers, lessonTypes, courseUnits, lessonSessions,
    attendanceRecords, lessonHourLedger, lessonRecords, lessonRecordVersions, lessonAssets,
    scratchTemplates, scratchAssignments, scratchWorks, scratchWorkVersions, scratchReviews,
    scratchJudgeRuns, questions, papers, exams, examAttempts, answerRecords, fileAssets,
    migrationRuns, legacyIdMappings, migrationConflicts, auditLogs,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.classGroup.count(),
    prisma.classStudent.count(),
    prisma.classTeacher.count(),
    prisma.lessonType.count(),
    prisma.courseUnitTemplate.count(),
    prisma.lessonSession.count(),
    prisma.attendanceRecord.count(),
    prisma.lessonHourLedger.count(),
    prisma.lessonRecord.count(),
    prisma.lessonRecordVersion.count(),
    prisma.lessonAsset.count(),
    prisma.scratchTemplate.count(),
    prisma.lessonScratchAssignment.count(),
    prisma.scratchWork.count(),
    prisma.scratchWorkVersion.count(),
    prisma.scratchReview.count(),
    prisma.scratchJudgeRun.count(),
    prisma.question.count(),
    prisma.paper.count(),
    prisma.exam.count(),
    prisma.examAttempt.count(),
    prisma.answerRecord.count(),
    prisma.fileAsset.count(),
    prisma.migrationRun.count(),
    prisma.legacyIdMapping.count(),
    prisma.migrationConflict.count(),
    prisma.auditLog.count(),
  ]);
  return {
    users, classes, classStudents, classTeachers, lessonTypes, courseUnits, lessonSessions,
    attendanceRecords, lessonHourLedger, lessonRecords, lessonRecordVersions, lessonAssets,
    scratchTemplates, scratchAssignments, scratchWorks, scratchWorkVersions, scratchReviews,
    scratchJudgeRuns, questions, papers, exams, examAttempts, answerRecords, fileAssets,
    migrationRuns, legacyIdMappings, migrationConflicts, auditLogs,
  };
}

async function migrationCountFor(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  return Number(rows[0]?.count ?? 0);
}

async function readManifest(backupDir: string) {
  return JSON.parse(await readFile(join(backupDir, 'manifest.json'), 'utf8')) as Manifest;
}

async function verifyArtifacts(backupDir: string, manifest: Manifest) {
  for (const item of [manifest.artifacts.database, manifest.artifacts.uploads]) {
    const actual = await artifact(join(backupDir, item.file));
    assertEqual(item.size, actual.size, `${item.file} size`);
    assertEqual(item.sha256, actual.sha256, `${item.file} checksum`);
  }
}

async function artifact(path: string) {
  const data = await readFile(path);
  return { file: basename(path), size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}

async function fileManifest(root: string, current: string): Promise<Array<{ path: string; size: number; sha256: string }>> {
  const result: Array<{ path: string; size: number; sha256: string }> = [];
  const entries = await readdir(current, { withFileTypes: true }).catch(() => null);
  if (!entries) return result;
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) result.push(...await fileManifest(root, path));
    if (entry.isFile()) {
      const data = await readFile(path);
      result.push({
        path: path.slice(root.length + 1).replace(/\\/g, '/'),
        size: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
      });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

async function acquireLock(path: string) {
  try {
    return await open(path, 'wx', 0o600);
  } catch {
    const info = await stat(path).catch(() => null);
    if (info && Date.now() - info.mtimeMs > 6 * 60 * 60 * 1000) {
      await rm(path, { force: true });
      return open(path, 'wx', 0o600);
    }
    throw new Error(`Backup is already running: ${path}`);
  }
}

async function enforceRetention() {
  const dailyRetention = Number(process.env.BACKUP_DAILY_RETENTION ?? 14);
  const weeklyRetention = Number(process.env.BACKUP_WEEKLY_RETENTION ?? 8);
  const entries = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('backup-'))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const keep = new Set(entries.slice(0, dailyRetention));
  const weekly = entries.filter((name) => {
    const match = /^backup-(\d{4})-(\d{2})-(\d{2})/.exec(name);
    return match && new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`).getDay() === 0;
  });
  weekly.slice(0, weeklyRetention).forEach((name) => keep.add(name));
  await Promise.all(entries.filter((name) => !keep.has(name)).map((name) => rm(join(backupRoot, name), { recursive: true, force: true })));
}

async function copyRemote(finalDir: string) {
  const remote = process.env.BACKUP_REMOTE?.trim();
  if (!remote) {
    console.warn('BACKUP_REMOTE is not configured; backup remains on this host only.');
    return;
  }
  run('rclone', ['copy', finalDir, `${remote.replace(/\/$/, '')}/${basename(finalDir)}`]);
}

function runPostgres(name: string, commandArgs: string[]) {
  const env = {
    ...process.env,
    PGHOST: sourceDatabase.hostname,
    PGPORT: sourceDatabase.port || '5432',
    PGUSER: decodeURIComponent(sourceDatabase.username),
    PGPASSWORD: decodeURIComponent(sourceDatabase.password),
    PGDATABASE: 'postgres',
  };
  execFileSync(postgresBinary(name), commandArgs, { stdio: 'inherit', env });
}

function postgresBinary(name: string) {
  const extension = process.platform === 'win32' ? '.exe' : '';
  const configured = process.env.POSTGRES_BIN_DIR;
  if (configured) return join(configured, `${name}${extension}`);
  if (process.platform === 'win32') return join('D:\\PostgreSQL\\pgsql\\bin', `${name}.exe`);
  const pg16 = join('/usr/lib/postgresql/16/bin', name);
  if (existsSync(pg16)) return pg16;
  return name;
}

function run(file: string, commandArgs: string[]) {
  execFileSync(file, commandArgs, { stdio: 'inherit', env: process.env });
}

function databaseWithName(source: URL, name: string) {
  const next = new URL(source.toString());
  next.pathname = `/${encodeURIComponent(name)}`;
  return next.toString();
}

function postgresToolUrl(source: URL) {
  const next = new URL(source.toString());
  next.searchParams.delete('schema');
  return next.toString();
}

function assertRecord(expected: Record<string, number>, actual: Record<string, number>, label: string) {
  for (const [key, value] of Object.entries(expected)) assertEqual(value, actual[key], `${label}.${key}`);
}

function assertFiles(expected: Manifest['uploadsFiles'], actual: Manifest['uploadsFiles']) {
  assertEqual(JSON.stringify(expected), JSON.stringify(actual), 'uploads files');
}

function assertEqual(expected: unknown, actual: unknown, label: string) {
  if (expected !== actual) throw new Error(`${label} mismatch: expected ${String(expected)}, got ${String(actual)}`);
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function option(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

async function latestBackup() {
  const entries = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('backup-'))
    .map((entry) => entry.name)
    .sort();
  const latest = entries.at(-1);
  if (!latest) throw new Error(`No backups found in ${backupRoot}`);
  return join(backupRoot, latest);
}

function formatTimestamp(date: Date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date).replace(' ', '-').replace(/:/g, '');
}

function loadEnvFile(path: string) {
  try {
    const content = require('node:fs').readFileSync(path, 'utf8') as string;
    for (const line of content.split(/\r?\n/)) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // Environment variables may be provided by the process or systemd.
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
