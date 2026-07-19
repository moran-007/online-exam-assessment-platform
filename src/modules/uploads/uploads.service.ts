import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { FileVisibility, QuestionStatus, UserType } from '@prisma/client';
import { basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { hasPermission } from '../../common/security/permission-policy';
import { OBJECT_STORAGE, type ObjectStorage } from '../../storage/object-storage.interface';
import {
  assertUploadFileContent,
  isBlockedUploadExtension,
  normalizeUploadFileName,
  resolveUploadExtension,
} from './upload-file.validator';

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async saveQuestionAsset(file: { originalname?: string; mimetype?: string; size?: number; buffer: Buffer }, userId?: string) {
    assertUploadFileContent(file);
    return this.saveToFolder(file, 'question-assets', userId);
  }

  async authenticatedQuestionAsset(filename: string, user: RequestUser, action: 'preview' | 'download' = 'preview') {
    const descriptor = await this.questionAssetDescriptor(filename);
    const privileged =
      user.userType !== UserType.STUDENT &&
      hasPermission(user, action === 'download' ? 'attachment:download' : 'attachment:preview');
    if (privileged || descriptor.asset.createdBy === user.id) return this.openDescriptor(descriptor);

    const logicalUrl = `/uploads/question-assets/${descriptor.filename}`;
    if (user.userType === UserType.STUDENT) {
      const instances = await this.prisma.paperInstance.findMany({
        where: { studentId: user.id },
        select: { paperSnapshotJson: true },
      });
      if (instances.some((instance) => JSON.stringify(instance.paperSnapshotJson).includes(logicalUrl))) {
        return this.openDescriptor(descriptor);
      }
    }

    throw new ForbiddenException('无权限读取该附件');
  }

  async publicQuestionAsset(questionId: string, filename: string) {
    const descriptor = await this.questionAssetDescriptor(filename);
    const logicalUrl = `/uploads/question-assets/${descriptor.filename}`;
    const question = await this.prisma.question.findFirst({
      where: {
        id: questionId,
        deletedAt: null,
        status: QuestionStatus.PUBLISHED,
        OR: [
          { content: { contains: logicalUrl } },
          { options: { some: { content: { contains: logicalUrl } } } },
        ],
      },
      select: { id: true },
    });
    if (!question) throw new ForbiddenException('资源不属于该公开题目');
    return this.openDescriptor(descriptor);
  }

  async renameQuestionAsset(filename: string, displayName: string) {
    const safeCurrentName = this.safeExistingFilename(filename);
    const cleanDisplayName = this.cleanDisplayName(displayName);
    const extension = extname(safeCurrentName).toLowerCase();
    const nextFilename = `${cleanDisplayName}-${randomUUID().slice(0, 8)}${extension}`;

    try {
      await this.storage.move(`question-assets/${safeCurrentName}`, `question-assets/${nextFilename}`);
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
      await this.storage.delete(`question-assets/${safeFilename}`);
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
        await this.storage.delete(`question-assets/${this.safeExistingFilename(item.filename)}`);
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
    const extension = resolveUploadExtension(file);
    const displayName = this.resolveDisplayName(file.originalname);
    const filename = `${new Date().toISOString().slice(0, 10)}-${displayName}-${randomUUID().slice(0, 8)}${extension}`;
    const stored = await this.storage.put({
      key: `${folder}/${filename}`,
      data: file.buffer,
      mimeType: file.mimetype,
    });
    await this.prisma.fileAsset.create({
      data: {
        bucket: 'local',
        objectKey: `${folder}/${filename}`,
        fileName: filename,
        fileExt: extension,
        mimeType: file.mimetype,
        fileSize: BigInt(stored.size),
        url: `/uploads/${folder}/${filename}`,
        visibility: FileVisibility.PRIVATE,
        sha256: stored.sha256,
        version: 1,
        createdBy: userId,
      },
    });

    return this.fileResponse(filename, folder, displayName, file);
  }

  private async questionAssetDescriptor(filename: string) {
    const safeFilename = this.safeExistingFilename(filename);
    const asset = await this.prisma.fileAsset.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { objectKey: `question-assets/${safeFilename}` },
          { url: `/uploads/question-assets/${safeFilename}` },
        ],
      },
    });
    if (!asset) throw new NotFoundException('附件不存在或已被删除');
    try {
      await this.storage.stat(`question-assets/${safeFilename}`);
    } catch {
      throw new NotFoundException('附件文件不存在');
    }
    return {
      asset,
      filename: safeFilename,
      objectKey: `question-assets/${safeFilename}`,
      mimeType: asset.mimeType || 'application/octet-stream',
      displayName: asset.fileName || safeFilename,
    };
  }

  private async openDescriptor<T extends { objectKey: string }>(descriptor: T) {
    return { ...descriptor, stream: await this.storage.open(descriptor.objectKey) };
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
      originalName: normalizeUploadFileName(file?.originalname) || filename,
      mimeType: file?.mimetype || '',
      size: file?.size ?? 0,
      isImage,
      markdown: isImage ? `![${displayName}](${url})` : `[${displayName}](${url})`,
    };
  }

  private resolveDisplayName(originalName?: string) {
    return this.cleanDisplayName((normalizeUploadFileName(originalName) || '题目附件').replace(/\.[^.]+$/, ''));
  }

  private cleanDisplayName(value: string) {
    const withoutControlCharacters = [...String(value || '')]
      .map((character) => character.charCodeAt(0) < 32 ? '-' : character)
      .join('');
    const cleaned = withoutControlCharacters
      .replace(/\.[^.]+$/, '')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replaceAll('[', '')
      .replaceAll(']', '')
      .replaceAll('(', '')
      .replaceAll(')', '')
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
    if (isBlockedUploadExtension(extension)) {
      throw new BadRequestException('该文件类型不允许操作');
    }
    return safeName;
  }

  private isImageExtension(filename: string) {
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extname(filename).toLowerCase());
  }

  private async listQuestionAssetFiles() {
    const entries = await this.storage.list('question-assets');
    const files: Array<{ filename: string; displayName: string; size: number; updatedAt: Date }> = [];

    for (const entry of entries) {
      const filename = this.safeExistingFilename(entry.key.split('/').pop() || '');
      files.push({
        filename,
        displayName: filename.replace(/\.[^.]+$/, ''),
        size: entry.size,
        updatedAt: entry.updatedAt,
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
