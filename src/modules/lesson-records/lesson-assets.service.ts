import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  FileVisibility,
  LessonAssetAudience,
  LessonRecordStatus,
  LessonRecordVersionAction,
} from '@prisma/client';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { OBJECT_STORAGE, type ObjectStorage } from '../../storage/object-storage.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertUploadFileContent,
  normalizeUploadFileName,
  resolveUploadExtension,
} from '../uploads/upload-file.validator';
import { LessonAssetMetadataDto } from './dto/lesson-record.dto';
import { LessonRecordAccessService } from './lesson-record-access.service';
import { LessonRecordVersionService } from './lesson-record-version.service';

type UploadedLessonFile = {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
};

@Injectable()
export class LessonAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LessonRecordAccessService,
    private readonly versions: LessonRecordVersionService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async upload(sessionId: string, file: UploadedLessonFile, dto: LessonAssetMetadataDto, actor: RequestUser) {
    const { session } = await this.access.session(sessionId, actor);
    const record = await this.prisma.lessonRecord.findUnique({ where: { sessionId } });
    if (!record) throw new NotFoundException('请先保存教学记录草稿，再上传附件');
    assertUploadFileContent(file);
    const extension = resolveUploadExtension(file);
    const displayName = this.displayName(file.originalname, extension);
    const objectKey = `lesson-assets/${record.id}/${randomUUID()}${extension}`;
    const stored = await this.storage.put({ key: objectKey, data: file.buffer, mimeType: file.mimetype });

    try {
      const asset = await this.prisma.$transaction(async (tx) => {
        const fileAsset = await tx.fileAsset.create({
          data: {
            bucket: 'local',
            objectKey,
            fileName: displayName,
            fileExt: extension,
            mimeType: stored.mimeType,
            fileSize: BigInt(stored.size),
            sha256: stored.sha256,
            visibility: FileVisibility.PRIVATE,
            createdBy: actor.id,
          },
        });
        const created = await tx.lessonAsset.create({
          data: {
            recordId: record.id,
            fileAssetId: fileAsset.id,
            audience: dto.audience ?? LessonAssetAudience.INTERNAL,
            title: this.clean(dto.title) ?? displayName,
            note: this.clean(dto.note),
            sortOrder: dto.sortOrder ?? 0,
            createdBy: actor.id,
          },
          include: { fileAsset: true },
        });
        const updated = await tx.lessonRecord.update({
          where: { id: record.id },
          data: {
            status: LessonRecordStatus.DRAFT,
            version: { increment: 1 },
            submittedBy: null,
            submittedAt: null,
            publishedBy: null,
            publishedAt: null,
            updatedBy: actor.id,
          },
        });
        await this.versions.append(tx, updated.id, LessonRecordVersionAction.ASSET_ADD, actor.id, displayName);
        return created;
      });
      await this.audit.log({
        userId: actor.id,
        action: 'lesson-asset:add',
        module: 'lesson-records',
        targetType: 'lesson-asset',
        targetId: asset.id,
        afterData: { sessionId, classId: session.classId, audience: asset.audience, sha256: stored.sha256 },
      });
      return this.view(asset);
    } catch (error) {
      await this.storage.delete(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async remove(sessionId: string, assetId: string, actor: RequestUser) {
    const { session } = await this.access.session(sessionId, actor);
    const asset = await this.prisma.lessonAsset.findFirst({
      where: { id: assetId, record: { sessionId } },
      include: { fileAsset: true, record: true },
    });
    if (!asset) throw new NotFoundException('课次附件不存在');
    await this.prisma.$transaction(async (tx) => {
      await tx.lessonAsset.delete({ where: { id: asset.id } });
      await tx.fileAsset.update({ where: { id: asset.fileAssetId }, data: { deletedAt: new Date() } });
      const updated = await tx.lessonRecord.update({
        where: { id: asset.recordId },
        data: {
          status: LessonRecordStatus.DRAFT,
          version: { increment: 1 },
          submittedBy: null,
          submittedAt: null,
          publishedBy: null,
          publishedAt: null,
          updatedBy: actor.id,
        },
      });
      await this.versions.append(tx, updated.id, LessonRecordVersionAction.ASSET_REMOVE, actor.id, asset.fileAsset.fileName);
    });
    await this.storage.delete(asset.fileAsset.objectKey).catch(() => undefined);
    await this.audit.log({
      userId: actor.id,
      action: 'lesson-asset:remove',
      module: 'lesson-records',
      targetType: 'lesson-asset',
      targetId: asset.id,
      beforeData: { sessionId, classId: session.classId, fileName: asset.fileAsset.fileName },
    });
    return true;
  }

  async content(sessionId: string, assetId: string, actor: RequestUser, studentId?: string) {
    const scoped = await this.access.session(sessionId, actor, studentId);
    const asset = await this.prisma.lessonAsset.findFirst({
      where: { id: assetId, record: { sessionId }, fileAsset: { deletedAt: null } },
      include: { fileAsset: true, record: true },
    });
    if (!asset) throw new NotFoundException('课次附件不存在');
    if (!scoped.internal) {
      if (asset.record.status !== LessonRecordStatus.PUBLISHED) {
        throw new ForbiddenException('教学记录尚未发布');
      }
      if (asset.audience !== LessonAssetAudience.LEARNER) {
        throw new ForbiddenException('该附件仅供教师内部使用');
      }
    }
    const stored = await this.storage.stat(asset.fileAsset.objectKey).catch(() => null);
    if (!stored) throw new NotFoundException('附件文件不存在');
    if (stored.size !== Number(asset.fileAsset.fileSize)) throw new ConflictException('附件大小校验失败');
    return {
      mimeType: asset.fileAsset.mimeType || 'application/octet-stream',
      displayName: asset.fileAsset.fileName,
      stream: await this.storage.open(asset.fileAsset.objectKey),
    };
  }

  private view(asset: any) {
    return {
      id: asset.id,
      audience: asset.audience,
      title: asset.title,
      note: asset.note,
      sortOrder: asset.sortOrder,
      fileName: asset.fileAsset.fileName,
      mimeType: asset.fileAsset.mimeType,
      fileSize: asset.fileAsset.fileSize.toString(),
      sha256: asset.fileAsset.sha256,
    };
  }

  private displayName(originalName: string | undefined, extension: string) {
    const normalizedName = normalizeUploadFileName(originalName);
    const withoutControlCharacters = [...basename(normalizedName || `课次附件${extension}`)]
      .map((character) => character.charCodeAt(0) < 32 ? '-' : character)
      .join('');
    const name = withoutControlCharacters
      .replace(/[<>:"/\\|?*]/g, '-')
      .trim()
      .slice(0, 240);
    return name || `课次附件${extension}`;
  }

  private clean(value?: string) {
    const result = value?.trim();
    return result || null;
  }
}
