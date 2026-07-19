import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClassMemberStatus, FileAsset, FileVisibility, ScratchAssignmentStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { hasPermission } from '../../common/security/permission-policy';
import { OBJECT_STORAGE, type ObjectStorage } from '../../storage/object-storage.interface';
import { PrismaService } from '../prisma/prisma.service';
import { assertUploadFileContent, normalizeUploadFileName } from '../uploads/upload-file.validator';
import { ScratchAccessService } from './scratch-access.service';
import { validateScratchProject } from './scratch-project.validator';

export type ScratchUploadFile = {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
};

@Injectable()
export class ScratchAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ScratchAccessService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async storeProject(file: ScratchUploadFile, actorId: string, scope: string) {
    const fileName = this.fileName(file.originalname, '.sb3', 'Scratch作品.sb3');
    const summary = await validateScratchProject(file.buffer, fileName);
    const asset = await this.store(file, actorId, scope, fileName, 'application/x.scratch.sb3');
    return { asset, summary };
  }

  async storeThumbnail(file: ScratchUploadFile | undefined, actorId: string, scope: string) {
    if (!file) return null;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype ?? '')) {
      throw new BadRequestException('缩略图仅支持 JPG、PNG 或 WebP');
    }
    assertUploadFileContent(file);
    const extension = extname(file.originalname ?? '').toLowerCase();
    const fileName = this.fileName(file.originalname, extension, `Scratch缩略图${extension}`);
    return this.store(file, actorId, scope, fileName, file.mimetype ?? 'application/octet-stream');
  }

  async discard(assets: Array<FileAsset | null | undefined>) {
    for (const asset of assets) {
      if (!asset) continue;
      await this.prisma.fileAsset.deleteMany({ where: { id: asset.id } }).catch(() => undefined);
      await this.storage.delete(asset.objectKey).catch(() => undefined);
    }
  }

  async templateContent(templateId: string, kind: 'project' | 'thumbnail', actor: RequestUser, studentId?: string) {
    const template = await this.prisma.scratchTemplate.findUnique({
      where: { id: templateId },
      include: { projectAsset: true, thumbnailAsset: true },
    });
    if (!template) throw new NotFoundException('Scratch 模板不存在');
    if (!hasPermission(actor, 'scratch-template:read')) {
      const learnerId = await this.access.learnerId(actor, studentId);
      const visible = await this.prisma.lessonScratchAssignment.findFirst({
        where: {
          templateId,
          status: ScratchAssignmentStatus.PUBLISHED,
          session: { classGroup: { students: { some: { studentId: learnerId, status: ClassMemberStatus.ACTIVE } } } },
        },
        select: { id: true },
      });
      if (!visible) throw new ForbiddenException('无权访问该 Scratch 模板');
    }
    const asset = kind === 'project' ? template.projectAsset : template.thumbnailAsset;
    if (!asset) throw new NotFoundException('Scratch 模板文件不存在');
    return this.open(asset);
  }

  async versionContent(versionId: string, kind: 'project' | 'thumbnail', actor: RequestUser) {
    const version = await this.prisma.scratchWorkVersion.findUnique({
      where: { id: versionId },
      include: { projectAsset: true, thumbnailAsset: true },
    });
    if (!version) throw new NotFoundException('Scratch 作品版本不存在');
    await this.access.work(version.workId, actor);
    const asset = kind === 'project' ? version.projectAsset : version.thumbnailAsset;
    if (!asset) throw new NotFoundException('Scratch 作品文件不存在');
    return this.open(asset);
  }

  private async store(
    file: ScratchUploadFile,
    actorId: string,
    scope: string,
    fileName: string,
    mimeType: string,
  ) {
    if (!Buffer.isBuffer(file.buffer) || !file.buffer.length) throw new BadRequestException('上传文件内容为空');
    const extension = extname(fileName).toLowerCase();
    const objectKey = `scratch/${scope}/${randomUUID()}${extension}`;
    const stored = await this.storage.put({ key: objectKey, data: file.buffer, mimeType });
    try {
      return await this.prisma.fileAsset.create({
        data: {
          bucket: 'local',
          objectKey,
          fileName,
          fileExt: extension,
          mimeType: stored.mimeType,
          fileSize: BigInt(stored.size),
          sha256: stored.sha256,
          visibility: FileVisibility.PRIVATE,
          createdBy: actorId,
        },
      });
    } catch (error) {
      await this.storage.delete(objectKey).catch(() => undefined);
      throw error;
    }
  }

  private async open(asset: FileAsset) {
    const stored = await this.storage.stat(asset.objectKey).catch(() => null);
    if (!stored) throw new NotFoundException('Scratch 文件在对象存储中不存在');
    if (stored.size !== Number(asset.fileSize) || (asset.sha256 && stored.sha256 !== asset.sha256)) {
      throw new ConflictException('Scratch 文件完整性校验失败');
    }
    return {
      displayName: asset.fileName,
      mimeType: asset.mimeType || 'application/octet-stream',
      stream: await this.storage.open(asset.objectKey),
    };
  }

  private fileName(originalName: string | undefined, extension: string, fallback: string) {
    const normalized = normalizeUploadFileName(originalName);
    const clean = basename(normalized || fallback)
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\p{Cc}/gu, '-')
      .trim()
      .slice(0, 240);
    const value = clean || fallback;
    return extname(value).toLowerCase() === extension.toLowerCase() ? value : `${value}${extension}`;
  }
}
