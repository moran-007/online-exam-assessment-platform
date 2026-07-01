import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FileVisibility } from '@prisma/client';
import { mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const MIME_EXTENSIONS = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['text/markdown', '.md'],
  ['text/csv', '.csv'],
  ['application/zip', '.zip'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
  ['application/msword', '.doc'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.ms-powerpoint', '.ppt'],
]);

const BLOCKED_EXTENSIONS = new Set([
  '.bat',
  '.cmd',
  '.com',
  '.exe',
  '.js',
  '.jse',
  '.msi',
  '.ps1',
  '.scr',
  '.sh',
  '.vbs',
]);

@Injectable()
export class UploadsService {
  constructor(private readonly prisma: PrismaService) {}

  async saveImage(file: { originalname?: string; mimetype?: string; buffer: Buffer }, userId?: string) {
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('请上传图片文件');
    }

    return this.saveToFolder(file, 'question-assets', userId);
  }

  async saveQuestionAsset(file: { originalname?: string; mimetype?: string; size?: number; buffer: Buffer }, userId?: string) {
    return this.saveToFolder(file, 'question-assets', userId);
  }

  async renameQuestionAsset(filename: string, displayName: string) {
    const safeCurrentName = this.safeExistingFilename(filename);
    const cleanDisplayName = this.cleanDisplayName(displayName);
    const extension = extname(safeCurrentName).toLowerCase();
    const dir = this.uploadDir('question-assets');
    const nextFilename = `${cleanDisplayName}-${randomUUID().slice(0, 8)}${extension}`;

    try {
      await rename(join(dir, safeCurrentName), join(dir, nextFilename));
    } catch {
      throw new NotFoundException('附件不存在或已被删除');
    }

    await this.prisma.fileAsset.updateMany({
      where: {
        deletedAt: null,
        OR: [
          { objectKey: `question-assets/${safeCurrentName}` },
          { url: `/uploads/question-assets/${safeCurrentName}` },
        ],
      },
      data: {
        objectKey: `question-assets/${nextFilename}`,
        url: `/uploads/question-assets/${nextFilename}`,
        fileName: nextFilename,
        fileExt: extension,
      },
    });

    return this.fileResponse(nextFilename, 'question-assets', cleanDisplayName);
  }

  async removeQuestionAsset(filename: string) {
    const safeFilename = this.safeExistingFilename(filename);
    const references = await this.questionAssetReferences(safeFilename);
    if (references.referenceCount > 0) {
      const locations = references.locations.slice(0, 3).join('；');
      throw new BadRequestException(
        `附件仍被 ${references.referenceCount} 处内容引用，暂不能删除。请先移除引用后再删除。${locations ? `引用位置：${locations}` : ''}`,
      );
    }

    try {
      await unlink(join(this.uploadDir('question-assets'), safeFilename));
    } catch {
      throw new NotFoundException('附件不存在或已被删除');
    }
    await this.prisma.fileAsset.updateMany({
      where: {
        deletedAt: null,
        OR: [
          { objectKey: `question-assets/${safeFilename}` },
          { url: `/uploads/question-assets/${safeFilename}` },
        ],
      },
      data: { deletedAt: new Date() },
    });

    return true;
  }

  async questionAssetReport() {
    const [files, referencedMap] = await Promise.all([this.listQuestionAssetFiles(), this.collectReferencedQuestionAssetRefs()]);
    const items = files
      .map((file) => {
        const url = `/uploads/question-assets/${file.filename}`;
        const references = referencedMap.get(url) ?? { count: 0, locations: [] };
        return {
          ...file,
          url,
          kind: this.resourceKind(file.filename),
          referenced: references.count > 0,
          referenceCount: references.count,
          locations: references.locations.slice(0, 8),
        };
      })
      .sort((a, b) => a.referenceCount - b.referenceCount || b.updatedAt.getTime() - a.updatedAt.getTime());

    return {
      total: items.length,
      referencedCount: items.filter((item) => item.referenced).length,
      referenceCount: items.reduce((sum, item) => sum + item.referenceCount, 0),
      orphanCount: items.filter((item) => !item.referenced).length,
      items,
    };
  }

  async questionAssetReferences(filename: string) {
    const safeFilename = this.safeExistingFilename(filename);
    const url = `/uploads/question-assets/${safeFilename}`;
    const references = (await this.collectReferencedQuestionAssetRefs()).get(url) ?? { count: 0, locations: [] };
    return {
      filename: safeFilename,
      url,
      referenceCount: references.count,
      locations: references.locations,
    };
  }

  async cleanupOrphanQuestionAssets() {
    const report = await this.questionAssetReport();
    const deleted: Array<{ filename: string; url: string }> = [];
    const failed: Array<{ filename: string; message: string }> = [];

    for (const item of report.items.filter((asset) => !asset.referenced)) {
      try {
        await unlink(join(this.uploadDir('question-assets'), this.safeExistingFilename(item.filename)));
        await this.prisma.fileAsset.updateMany({
          where: {
            deletedAt: null,
            OR: [
              { objectKey: `question-assets/${item.filename}` },
              { url: item.url },
            ],
          },
          data: { deletedAt: new Date() },
        });
        deleted.push({ filename: item.filename, url: item.url });
      } catch (error) {
        failed.push({ filename: item.filename, message: error instanceof Error ? error.message : '删除失败' });
      }
    }

    return {
      scanned: report.total,
      deletedCount: deleted.length,
      failedCount: failed.length,
      deleted,
      failed,
    };
  }

  private async saveToFolder(file: { originalname?: string; mimetype?: string; size?: number; buffer: Buffer }, folder: 'question-assets', userId?: string) {
    const extension = this.resolveExtension(file);
    const displayName = this.resolveDisplayName(file.originalname);
    const filename = `${new Date().toISOString().slice(0, 10)}-${displayName}-${randomUUID().slice(0, 8)}${extension}`;
    const dir = this.uploadDir(folder);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), file.buffer);
    await this.prisma.fileAsset.create({
      data: {
        bucket: 'local',
        objectKey: `${folder}/${filename}`,
        fileName: filename,
        fileExt: extension,
        mimeType: file.mimetype,
        fileSize: BigInt(file.size ?? file.buffer.length ?? 0),
        url: `/uploads/${folder}/${filename}`,
        visibility: FileVisibility.PRIVATE,
        createdBy: userId,
      },
    });

    return this.fileResponse(filename, folder, displayName, file);
  }

  private fileResponse(
    filename: string,
    folder: 'question-assets',
    displayName: string,
    file?: { originalname?: string; mimetype?: string; size?: number },
  ) {
    const url = `/uploads/${folder}/${filename}`;
    const isImage = Boolean(file?.mimetype?.startsWith('image/')) || this.isImageExtension(filename);
    return {
      url,
      filename,
      displayName,
      originalName: file?.originalname || filename,
      mimeType: file?.mimetype || '',
      size: file?.size ?? 0,
      isImage,
      markdown: isImage ? `![${displayName}](${url})` : `[${displayName}](${url})`,
    };
  }

  private resolveExtension(file: { originalname?: string; mimetype?: string }) {
    const mapped = file.mimetype ? MIME_EXTENSIONS.get(file.mimetype) : '';
    if (mapped) return mapped;

    const originalExt = extname(file.originalname || '').toLowerCase();
    if (!originalExt) {
      throw new BadRequestException('无法识别文件类型，请上传带扩展名的文件');
    }
    if (BLOCKED_EXTENSIONS.has(originalExt)) {
      throw new BadRequestException('该文件类型不允许上传');
    }
    return originalExt;
  }

  private resolveDisplayName(originalName?: string) {
    return this.cleanDisplayName((originalName || '题目附件').replace(/\.[^.]+$/, ''));
  }

  private cleanDisplayName(value: string) {
    const cleaned = String(value || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/[\[\]\(\)]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48);
    return cleaned || '题目附件';
  }

  private safeExistingFilename(value: string) {
    let decoded = String(value || '');
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // Existing local filenames may contain a literal percent sign.
    }
    const safeName = basename(decoded);
    if (!safeName || safeName !== decoded || safeName.includes('..')) {
      throw new BadRequestException('文件名不合法');
    }

    const extension = extname(safeName).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(extension)) {
      throw new BadRequestException('该文件类型不允许操作');
    }
    return safeName;
  }

  private uploadDir(folder: 'question-assets') {
    return join(process.cwd(), 'uploads', folder);
  }

  private isImageExtension(filename: string) {
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(extname(filename).toLowerCase());
  }

  private async listQuestionAssetFiles() {
    const dir = this.uploadDir('question-assets');
    await mkdir(dir, { recursive: true });
    const entries = await readdir(dir, { withFileTypes: true });
    const files: Array<{ filename: string; displayName: string; size: number; updatedAt: Date }> = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filename = this.safeExistingFilename(entry.name);
      const fileStat = await stat(join(dir, filename));
      files.push({
        filename,
        displayName: filename.replace(/\.[^.]+$/, ''),
        size: fileStat.size,
        updatedAt: fileStat.mtime,
      });
    }

    return files;
  }

  private async collectReferencedQuestionAssetUrls() {
    return new Set((await this.collectReferencedQuestionAssetRefs()).keys());
  }

  private async collectReferencedQuestionAssetRefs() {
    const references = new Map<string, { count: number; locations: string[] }>();
    const addReferences = (location: string, ...values: unknown[]) => {
      for (const url of this.extractResourceReferences(...values)) {
        const normalized = this.normalizeQuestionAssetUrl(url);
        if (!normalized) continue;
        const current = references.get(normalized) ?? { count: 0, locations: [] };
        current.count += 1;
        if (current.locations.length < 30) current.locations.push(location);
        references.set(normalized, current);
      }
    };

    const [questions, questionVersions, paperQuestions, paperInstances] = await Promise.all([
      this.prisma.question.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          title: true,
          content: true,
          analysis: true,
          options: { select: { content: true } },
          answer: { select: { answerJson: true, scoringRuleJson: true } },
        },
      }),
      this.prisma.questionVersion.findMany({ select: { snapshotJson: true } }),
      this.prisma.paperQuestion.findMany({ select: { questionSnapshotJson: true } }),
      this.prisma.paperInstance.findMany({ select: { paperSnapshotJson: true } }),
    ]);

    for (const question of questions) {
      addReferences(
        `题目：${question.title ?? question.id}`,
        question.content,
        question.analysis,
        question.options.map((option) => option.content),
        question.answer?.answerJson,
        question.answer?.scoringRuleJson,
      );
    }
    for (const version of questionVersions) addReferences('题目版本快照', version.snapshotJson);
    for (const paperQuestion of paperQuestions) addReferences('试卷题目快照', paperQuestion.questionSnapshotJson);
    for (const instance of paperInstances) addReferences('考试试卷实例快照', instance.paperSnapshotJson);

    return references;
  }

  private extractResourceReferences(...values: unknown[]) {
    const references = new Set<string>();
    const visit = (value: unknown) => {
      if (typeof value === 'string') {
        const markdownLinkRegex = /!?\[[^\]]*]\(([^)]+)\)/g;
        const uploadRegex = /(?:^|["'\s(])((?:https?:\/\/[^"'\s)]+\/uploads\/|\/uploads\/|uploads\/)[^"'\s)]+)/g;
        let match: RegExpExecArray | null;
        while ((match = markdownLinkRegex.exec(value))) {
          const url = this.cleanResourceUrl(match[1]);
          if (url) references.add(url);
        }
        while ((match = uploadRegex.exec(value))) {
          const url = this.cleanResourceUrl(match[1]);
          if (url) references.add(url);
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value && typeof value === 'object') {
        Object.values(value as Record<string, unknown>).forEach(visit);
      }
    };

    values.forEach(visit);
    return [...references];
  }

  private cleanResourceUrl(value: unknown) {
    const raw = String(value ?? '')
      .trim()
      .replace(/^<|>$/g, '')
      .split('#')[0]
      .split('?')[0];
    if (!raw || /^(data:|javascript:|mailto:)/i.test(raw)) return '';
    if (/^https?:\/\//i.test(raw)) {
      try {
        return new URL(raw).pathname;
      } catch {
        return '';
      }
    }
    return raw.startsWith('uploads/') ? `/${raw}` : raw;
  }

  private normalizeQuestionAssetUrl(value: string) {
    let clean = this.cleanResourceUrl(value);
    try {
      clean = decodeURI(clean);
    } catch {
      // Keep the original value when decoding fails.
    }
    if (!clean.startsWith('/uploads/question-assets/')) return '';
    return clean;
  }

  private resourceKind(filename: string) {
    const extension = extname(filename).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(extension)) return 'image';
    if (extension === '.pdf') return 'pdf';
    if (['.doc', '.docx'].includes(extension)) return 'word';
    if (['.xls', '.xlsx', '.csv'].includes(extension)) return 'sheet';
    if (['.zip'].includes(extension)) return 'archive';
    return 'file';
  }
}
