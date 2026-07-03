import { Prisma, PrismaClient } from '@prisma/client';
import { copyFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();
const root = process.cwd();
const uploads = join(root, 'uploads');
const targetDir = join(uploads, 'question-assets');
const dryRun = process.argv.includes('--dry-run');

const mimeTypes: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

async function main() {
  await mkdir(targetDir, { recursive: true });
  const replacements = new Map<string, string>();

  for (const folder of ['images', 'files']) {
    const sourceDir = join(uploads, folder);
    const entries = await readdir(sourceDir).catch(() => null);
    if (!entries) continue;

    for (const name of entries) {
      const source = join(sourceDir, name);
      const sourceStat = await stat(source).catch(() => null);
      if (!sourceStat?.isFile()) continue;
      let targetName = name;
      const target = () => join(targetDir, targetName);
      const existing = await stat(target()).catch(() => null);
      if (existing && existing.size !== sourceStat.size) {
        targetName = `legacy-${folder}-${randomUUID().slice(0, 8)}-${name}`;
      }
      replacements.set(`/uploads/${folder}/${name}`, `/uploads/question-assets/${targetName}`);

      if (!dryRun) {
        if (!(await stat(target()).catch(() => null))) await copyFile(source, target());
        await unlink(source);
      }
      await ensureFileAsset(targetName, sourceStat.size);
    }
  }

  if (!dryRun) await rewriteDatabaseReferences(replacements);
  console.log(JSON.stringify({ dryRun, migratedFiles: replacements.size, replacements: Object.fromEntries(replacements) }, null, 2));
}

async function ensureFileAsset(fileName: string, fileSize: number) {
  if (dryRun) return;
  const objectKey = `question-assets/${fileName}`;
  const existing = await prisma.fileAsset.findFirst({ where: { objectKey, deletedAt: null } });
  if (existing) return;
  const extension = extname(fileName).toLowerCase();
  await prisma.fileAsset.create({
    data: {
      bucket: 'local',
      objectKey,
      fileName,
      fileExt: extension || null,
      mimeType: mimeTypes[extension] || 'application/octet-stream',
      fileSize: BigInt(fileSize),
      url: `/uploads/${objectKey}`,
      visibility: 'PRIVATE',
    },
  });
}

function replaceValue(value: unknown, replacements: Map<string, string>): unknown {
  if (typeof value === 'string') {
    let result = value;
    replacements.forEach((next, previous) => { result = result.split(previous).join(next); });
    return result;
  }
  if (Array.isArray(value)) return value.map((item) => replaceValue(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceValue(item, replacements)]));
  }
  return value;
}

async function rewriteDatabaseReferences(replacements: Map<string, string>) {
  if (!replacements.size) return;
  const [questions, options, versions, paperQuestions, paperInstances] = await Promise.all([
    prisma.question.findMany({ select: { id: true, content: true, analysis: true } }),
    prisma.questionOption.findMany({ select: { id: true, content: true } }),
    prisma.questionVersion.findMany({ select: { id: true, snapshotJson: true } }),
    prisma.paperQuestion.findMany({ select: { id: true, questionSnapshotJson: true } }),
    prisma.paperInstance.findMany({ select: { id: true, paperSnapshotJson: true } }),
  ]);

  for (const item of questions) {
    const content = replaceValue(item.content, replacements) as string;
    const analysis = replaceValue(item.analysis, replacements) as string | null;
    if (content !== item.content || analysis !== item.analysis) {
      await prisma.question.update({ where: { id: item.id }, data: { content, analysis } });
    }
  }
  for (const item of options) {
    const content = replaceValue(item.content, replacements) as string;
    if (content !== item.content) await prisma.questionOption.update({ where: { id: item.id }, data: { content } });
  }
  for (const item of versions) {
    const value = replaceValue(item.snapshotJson, replacements) as Prisma.InputJsonValue;
    if (JSON.stringify(value) !== JSON.stringify(item.snapshotJson)) {
      await prisma.questionVersion.update({ where: { id: item.id }, data: { snapshotJson: value } });
    }
  }
  for (const item of paperQuestions) {
    const value = replaceValue(item.questionSnapshotJson, replacements) as Prisma.InputJsonValue;
    if (JSON.stringify(value) !== JSON.stringify(item.questionSnapshotJson)) {
      await prisma.paperQuestion.update({ where: { id: item.id }, data: { questionSnapshotJson: value } });
    }
  }
  for (const item of paperInstances) {
    const value = replaceValue(item.paperSnapshotJson, replacements) as Prisma.InputJsonValue;
    if (JSON.stringify(value) !== JSON.stringify(item.paperSnapshotJson)) {
      await prisma.paperInstance.update({ where: { id: item.id }, data: { paperSnapshotJson: value } });
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
