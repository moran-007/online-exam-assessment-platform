import { Injectable, NotFoundException } from '@nestjs/common';
import { FileAsset, ScratchTemplateStatus } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { hasPermission } from '../../common/security/permission-policy';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScratchTemplateDto, UpdateScratchTemplateDto } from './dto/scratch.dto';
import { ScratchAssetsService, ScratchUploadFile } from './scratch-assets.service';

@Injectable()
export class ScratchTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: ScratchAssetsService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: RequestUser) {
    const internal = hasPermission(actor, 'scratch-template:manage');
    const items = await this.prisma.scratchTemplate.findMany({
      where: internal ? {} : { status: ScratchTemplateStatus.ACTIVE },
      include: { projectAsset: true, thumbnailAsset: true, _count: { select: { assignments: true } } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    return items.map((item) => this.view(item));
  }

  async create(
    dto: CreateScratchTemplateDto,
    project: ScratchUploadFile,
    thumbnail: ScratchUploadFile | undefined,
    actor: RequestUser,
  ) {
    const storedProject = await this.assets.storeProject(project, actor.id, 'templates');
    let storedThumbnail: FileAsset | null = null;
    try {
      storedThumbnail = await this.assets.storeThumbnail(thumbnail, actor.id, 'template-thumbnails');
      const template = await this.prisma.scratchTemplate.create({
        data: {
          title: dto.title.trim(),
          description: this.clean(dto.description),
          projectAssetId: storedProject.asset.id,
          thumbnailAssetId: storedThumbnail?.id,
          runtimeProvider: this.clean(dto.runtimeProvider),
          runtimeProblemId: this.clean(dto.runtimeProblemId),
          runtimeProblemUrl: this.clean(dto.runtimeProblemUrl),
          validationJson: storedProject.summary,
          createdBy: actor.id,
        },
        include: { projectAsset: true, thumbnailAsset: true, _count: { select: { assignments: true } } },
      });
      await this.audit.log({
        userId: actor.id,
        action: 'scratch-template:create',
        module: 'scratch',
        targetType: 'scratch-template',
        targetId: template.id,
        afterData: { title: template.title, projectSha256: template.projectAsset.sha256 },
      });
      return this.view(template);
    } catch (error) {
      await this.assets.discard([storedProject.asset, storedThumbnail]);
      throw error;
    }
  }

  async update(id: string, dto: UpdateScratchTemplateDto, actor: RequestUser) {
    const existing = await this.prisma.scratchTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Scratch 模板不存在');
    const template = await this.prisma.scratchTemplate.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description === undefined ? undefined : this.clean(dto.description),
        status: dto.status,
        runtimeProvider: dto.runtimeProvider === undefined ? undefined : this.clean(dto.runtimeProvider),
        runtimeProblemId: dto.runtimeProblemId === undefined ? undefined : this.clean(dto.runtimeProblemId),
        runtimeProblemUrl: dto.runtimeProblemUrl === undefined ? undefined : this.clean(dto.runtimeProblemUrl),
      },
      include: { projectAsset: true, thumbnailAsset: true, _count: { select: { assignments: true } } },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'scratch-template:update',
      module: 'scratch',
      targetType: 'scratch-template',
      targetId: id,
      beforeData: { title: existing.title, status: existing.status },
      afterData: { title: template.title, status: template.status },
    });
    return this.view(template);
  }

  private view(item: any) {
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      status: item.status.toLowerCase(),
      runtimeProvider: item.runtimeProvider,
      runtimeProblemId: item.runtimeProblemId,
      runtimeProblemUrl: item.runtimeProblemUrl,
      validation: item.validationJson,
      project: this.file(item.projectAsset),
      thumbnail: this.file(item.thumbnailAsset),
      assignmentCount: item._count?.assignments ?? 0,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private file(asset: any) {
    return asset ? { id: asset.id, fileName: asset.fileName, fileSize: asset.fileSize.toString(), sha256: asset.sha256 } : null;
  }

  private clean(value?: string) {
    return value?.trim() || null;
  }
}
