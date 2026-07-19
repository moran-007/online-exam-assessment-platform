import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildWorkerReconciliation } from './cutover/worker-reconciliation';
import { inspectWorkerSource, WorkerSourceSnapshot } from './cutover/worker-source';

type CutoverPhase = 'FROZEN' | 'ACTIVE_MAIN' | 'ENTRY_ROLLED_BACK' | 'ARCHIVED';

type CutoverState = {
  version: 1;
  sourceSystem: 'worker_01';
  phase: CutoverPhase;
  activeEntry: 'main' | 'worker-read-only';
  sourcePath: string;
  sourceFingerprint: string;
  mainPlatformUrl: string;
  markerPath: string;
  frozenAt: string;
  activatedAt?: string;
  archivedAt?: string;
  updatedAt: string;
  signoffDigest: string;
};

const command = process.argv[2] || 'report';
loadEnvFile(join(process.cwd(), '.env'));
const workerRoot = resolve(option('worker-root') || join(process.cwd(), '..', 'worker_01'));
const sourcePath = resolve(option('source') || join(workerRoot, 'app', 'data', 'attendance.db'));
const markerPath = resolve(option('marker') || join(workerRoot, 'app', 'data', '.maintenance-mode.json'));
const statePath = resolve(option('state') || join(process.cwd(), 'runtime', 'cutover', 'worker-01-state.json'));
const reportRoot = resolve(option('report-dir') || join(process.cwd(), 'output', 'cutover'));
const mainPlatformUrl = option('main-url') || 'http://127.0.0.1:5173/';
const healthUrl = option('health-url') || 'http://127.0.0.1:3000/api/v1/health';
const uploadsRoot = resolve(process.env.UPLOADS_DIR || join(process.cwd(), 'uploads'));

async function main() {
  if (command === 'report' || command === 'rehearse') {
    const result = await createReport(command);
    if (!result.report.passed) process.exitCode = 2;
    return;
  }
  if (command === 'freeze') {
    await freezeWorker();
    return;
  }
  if (command === 'activate') {
    await activateMainEntry();
    return;
  }
  if (command === 'verify') {
    await verifyCutover();
    return;
  }
  if (command === 'rollback-entry') {
    await rollbackEntryOnly();
    return;
  }
  if (command === 'close') {
    await closeWorker();
    return;
  }
  throw new Error('Usage: worker-cutover.ts report | rehearse | freeze | activate | verify | rollback-entry | close');
}

async function createReport(label: string) {
  const source = await inspectWorkerSource(sourcePath);
  const prisma = new PrismaClient();
  try {
    const report = await buildWorkerReconciliation(prisma, source, uploadsRoot);
    const output = await writeReport(label, report);
    const result = { command: label, output, report };
    console.log(JSON.stringify(result, null, 2));
    return { source, report, output };
  } finally {
    await prisma.$disconnect();
  }
}

async function freezeWorker() {
  const signoff = requiredSignoff();
  const frozenAt = new Date().toISOString();
  await writeMarker({
    version: 1,
    mode: 'read-only',
    mainPlatformUrl,
    sealedAt: frozenAt,
    sourceFingerprint: null,
  });
  const source = await waitForStableSource();
  await writeMarker({
    version: 1,
    mode: 'read-only',
    mainPlatformUrl,
    sealedAt: frozenAt,
    sourceFingerprint: source.sourceFingerprint,
  });
  const state: CutoverState = {
    version: 1,
    sourceSystem: 'worker_01',
    phase: 'FROZEN',
    activeEntry: 'main',
    sourcePath,
    sourceFingerprint: source.sourceFingerprint,
    mainPlatformUrl,
    markerPath,
    frozenAt,
    updatedAt: new Date().toISOString(),
    signoffDigest: digest(signoff),
  };
  await atomicJson(statePath, state);
  await writeAudit('cutover:worker-freeze', state);
  console.log(JSON.stringify({ command: 'freeze', statePath, markerPath, state }, null, 2));
}

async function activateMainEntry() {
  const state = await readState();
  if (!['FROZEN', 'ENTRY_ROLLED_BACK'].includes(state.phase)) {
    throw new Error(`当前阶段 ${state.phase} 不允许切换主入口`);
  }
  const { source, report, output } = await createReport('activation');
  assertFrozenSource(state, source);
  if (!report.passed) throw new Error(`最终对账未通过，不能切换主入口：${output}`);
  const health = await checkHealth();
  const now = new Date().toISOString();
  const next: CutoverState = {
    ...state,
    phase: 'ACTIVE_MAIN',
    activeEntry: 'main',
    activatedAt: state.activatedAt || now,
    updatedAt: now,
  };
  await atomicJson(statePath, next);
  await writeAudit('cutover:main-activated', next, { health, report: output });
  console.log(JSON.stringify({ command: 'activate', statePath, health, report: output, state: next }, null, 2));
}

async function verifyCutover() {
  const state = await readState();
  const { source, report, output } = await createReport('observation');
  assertFrozenSource(state, source);
  if (!report.passed) throw new Error(`观察期对账未通过：${output}`);
  const health = state.phase === 'ARCHIVED' ? { skipped: true, reason: 'worker archived' } : await checkHealth();
  const marker = await readJson<Record<string, unknown>>(markerPath);
  const expectedMode = state.phase === 'ARCHIVED' ? 'closed' : 'read-only';
  if (marker.mode !== expectedMode) throw new Error(`worker 维护状态应为 ${expectedMode}，实际为 ${String(marker.mode)}`);
  await writeAudit('cutover:observation-verified', state, { health, report: output });
  console.log(JSON.stringify({ command: 'verify', statePath, health, report: output, state }, null, 2));
}

async function rollbackEntryOnly() {
  const state = await readState();
  if (state.phase !== 'ACTIVE_MAIN') throw new Error('只有主入口激活后才允许执行入口回滚');
  const marker = await readJson<Record<string, unknown>>(markerPath);
  if (marker.mode !== 'read-only') throw new Error('拒绝回滚：worker 必须保持只读，不能恢复旧写入');
  const next: CutoverState = {
    ...state,
    phase: 'ENTRY_ROLLED_BACK',
    activeEntry: 'worker-read-only',
    updatedAt: new Date().toISOString(),
  };
  await atomicJson(statePath, next);
  await writeAudit('cutover:entry-rollback-only', next);
  console.log(JSON.stringify({ command: 'rollback-entry', statePath, state: next }, null, 2));
}

async function closeWorker() {
  const signoff = requiredSignoff();
  const state = await readState();
  if (state.phase !== 'ACTIVE_MAIN') throw new Error('只有观察期通过且主入口激活时才允许归档 worker');
  const { source, report, output } = await createReport('archive');
  assertFrozenSource(state, source);
  if (!report.passed) throw new Error(`归档前对账未通过：${output}`);
  await checkHealth();
  const now = new Date().toISOString();
  await writeMarker({
    version: 1,
    mode: 'closed',
    mainPlatformUrl: state.mainPlatformUrl,
    sealedAt: state.frozenAt,
    sourceFingerprint: state.sourceFingerprint,
    archivedAt: now,
  });
  const next: CutoverState = {
    ...state,
    phase: 'ARCHIVED',
    activeEntry: 'main',
    archivedAt: now,
    updatedAt: now,
    signoffDigest: digest(`${state.signoffDigest}:${signoff}`),
  };
  await atomicJson(statePath, next);
  await writeAudit('cutover:worker-archived', next, { report: output });
  console.log(JSON.stringify({ command: 'close', statePath, markerPath, report: output, state: next }, null, 2));
}

async function waitForStableSource() {
  let previous: WorkerSourceSnapshot | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await inspectWorkerSource(sourcePath);
    if (previous?.sourceFingerprint === current.sourceFingerprint) return current;
    previous = current;
    await delay(750);
  }
  throw new Error('worker 源数据在冻结后仍发生变化，已保持只读并停止切换');
}

function assertFrozenSource(state: CutoverState, source: WorkerSourceSnapshot) {
  if (resolve(state.sourcePath) !== source.databasePath) throw new Error('当前 worker 源库与冻结时路径不一致');
  if (state.sourceFingerprint !== source.sourceFingerprint) {
    throw new Error('worker 在冻结后仍产生或修改了业务数据，已停止切换');
  }
}

async function checkHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`主平台健康检查返回 HTTP ${response.status}`);
    return { ok: true, url: healthUrl, status: response.status };
  } catch (error) {
    throw new Error(
      `主平台健康检查失败：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }
}

async function writeAudit(action: string, state: CutoverState, extra: Record<string, unknown> = {}) {
  const prisma = new PrismaClient();
  try {
    const actor = await prisma.user.findFirst({
      where: { userType: { in: ['SUPER_ADMIN', 'ADMIN'] }, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    await prisma.auditLog.create({
      data: {
        userId: actor?.id,
        action,
        module: 'cutover',
        targetType: 'worker_01',
        afterData: {
          phase: state.phase,
          activeEntry: state.activeEntry,
          sourceFingerprint: state.sourceFingerprint,
          signoffDigest: state.signoffDigest,
          ...extra,
        },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function writeReport(label: string, report: unknown) {
  await mkdir(reportRoot, { recursive: true });
  const filename = `${timestamp()}-${safeName(option('label') || label)}.json`;
  const path = join(reportRoot, filename);
  await atomicJson(path, report);
  return path;
}

async function writeMarker(payload: Record<string, unknown>) {
  await atomicJson(markerPath, payload);
}

async function readState() {
  const state = await readJson<CutoverState>(statePath);
  if (state.version !== 1 || state.sourceSystem !== 'worker_01') throw new Error('切换状态文件格式无效');
  return state;
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

async function readJson<T>(path: string) {
  await access(path).catch(() => { throw new Error(`缺少文件：${path}`); });
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function requiredSignoff() {
  const signoff = option('signoff').trim();
  if (signoff.length < 8) throw new Error('该操作必须提供不少于 8 个字符的 --signoff=业务签字说明');
  return signoff;
}

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? '';
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'report';
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function delay(milliseconds: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function loadEnvFile(path: string) {
  try {
    const content = require('node:fs').readFileSync(path, 'utf8') as string;
    for (const line of content.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    // Environment-only deployments do not require a local .env file.
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
