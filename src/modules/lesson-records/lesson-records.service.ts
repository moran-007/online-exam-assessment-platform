import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ClassMemberStatus,
  LessonAssetAudience,
  LessonRecordStatus,
  LessonRecordVersionAction,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../data-scope/data-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { LessonRecordTransitionDto, QueryLessonRecordDto, SaveLessonRecordDto } from './dto/lesson-record.dto';
import { LessonRecordAccessService } from './lesson-record-access.service';
import { LessonRecordVersionService } from './lesson-record-version.service';

const sessionSummary = {
  classGroup: { select: { id: true, name: true, course: { select: { id: true, name: true } } } },
  teacher: { select: { id: true, realName: true, username: true } },
  lessonType: { select: { id: true, name: true } },
  unitTemplate: { select: { id: true, name: true } },
  knowledgePoint: { select: { id: true, name: true } },
} as const;

const recordAssets = {
  orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
  include: { fileAsset: true as const },
};

@Injectable()
export class LessonRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly access: LessonRecordAccessService,
    private readonly versions: LessonRecordVersionService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async list(query: QueryLessonRecordDto, actor: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const internal = this.access.isInternal(actor);
    const classIds = internal
      ? await this.dataScope.academicClassIdsFor(actor)
      : await this.learnerClassIds(actor, query.studentId);
    if (query.classId && classIds !== null && !classIds.includes(query.classId)) {
      throw new BadRequestException('班级不在当前数据范围内');
    }
    const where: Prisma.LessonSessionWhereInput = {
      classId: query.classId ?? (classIds === null ? undefined : { in: classIds }),
      startsAt: query.from || query.to
        ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
        : undefined,
      lessonRecord: query.status
        ? { is: { status: internal ? query.status : LessonRecordStatus.PUBLISHED } }
        : undefined,
    };
    const recordWhere = internal ? undefined : { status: LessonRecordStatus.PUBLISHED };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.lessonSession.findMany({
        where,
        include: {
          ...sessionSummary,
          lessonRecord: {
            where: recordWhere,
            include: { assets: recordAssets },
          },
        },
        orderBy: { startsAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.lessonSession.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...this.sessionView(item),
        record: item.lessonRecord ? this.recordView(item.lessonRecord, internal) : null,
      })),
      page,
      pageSize,
      total,
    };
  }

  async detail(sessionId: string, actor: RequestUser, studentId?: string) {
    const scoped = await this.access.session(sessionId, actor, studentId);
    const record = await this.prisma.lessonRecord.findUnique({
      where: { sessionId },
      include: { assets: recordAssets },
    });
    if (!record) {
      if (scoped.internal) return { session: this.sessionView(scoped.session), record: null };
      throw new NotFoundException('该课次暂无已发布教学记录');
    }
    if (!scoped.internal && record.status !== LessonRecordStatus.PUBLISHED) {
      throw new NotFoundException('该课次暂无已发布教学记录');
    }
    return { session: this.sessionView(scoped.session), record: this.recordView(record, scoped.internal) };
  }

  async saveDraft(sessionId: string, dto: SaveLessonRecordDto, actor: RequestUser) {
    const { session } = await this.access.session(sessionId, actor);
    const record = await this.prisma.$transaction(async (tx) => {
      const current = await tx.lessonRecord.findUnique({ where: { sessionId } });
      const data = this.recordFields(dto);
      if (!current) {
        const created = await tx.lessonRecord.create({
          data: { sessionId, ...data, createdBy: actor.id, updatedBy: actor.id },
        });
        await this.versions.append(tx, created.id, LessonRecordVersionAction.SAVE_DRAFT, actor.id);
        return created;
      }
      const result = await tx.lessonRecord.updateMany({
        where: { id: current.id, version: current.version },
        data: {
          ...data,
          status: LessonRecordStatus.DRAFT,
          version: { increment: 1 },
          submittedBy: null,
          submittedAt: null,
          publishedBy: null,
          publishedAt: null,
          updatedBy: actor.id,
        },
      });
      if (!result.count) throw new ConflictException('教学记录已被其他操作更新，请刷新后重试');
      const updated = await tx.lessonRecord.findUniqueOrThrow({ where: { id: current.id } });
      await this.versions.append(tx, updated.id, LessonRecordVersionAction.SAVE_DRAFT, actor.id);
      return updated;
    });
    await this.log(actor, 'lesson-record:save-draft', record.id, session.classId, record.version);
    return this.detail(sessionId, actor);
  }

  async submit(sessionId: string, dto: LessonRecordTransitionDto, actor: RequestUser) {
    const { session } = await this.access.session(sessionId, actor);
    const record = await this.prisma.$transaction(async (tx) => {
      const current = await tx.lessonRecord.findUnique({ where: { sessionId } });
      if (!current) throw new NotFoundException('请先保存教学记录草稿');
      if (current.status !== LessonRecordStatus.DRAFT) throw new ConflictException('只有草稿可以提交');
      if (!current.publicTeachingContent?.trim()) throw new BadRequestException('提交前请填写学生/家长可见的本节课内容');
      const result = await tx.lessonRecord.updateMany({
        where: { id: current.id, version: current.version, status: LessonRecordStatus.DRAFT },
        data: {
          status: LessonRecordStatus.SUBMITTED,
          version: { increment: 1 },
          submittedBy: actor.id,
          submittedAt: new Date(),
          updatedBy: actor.id,
        },
      });
      if (!result.count) throw new ConflictException('教学记录已被其他操作更新，请刷新后重试');
      const updated = await tx.lessonRecord.findUniqueOrThrow({ where: { id: current.id } });
      await this.versions.append(tx, updated.id, LessonRecordVersionAction.SUBMIT, actor.id, dto.reason);
      return updated;
    });
    await this.log(actor, 'lesson-record:submit', record.id, session.classId, record.version);
    return this.detail(sessionId, actor);
  }

  async publish(sessionId: string, dto: LessonRecordTransitionDto, actor: RequestUser) {
    const { session } = await this.access.session(sessionId, actor);
    const record = await this.prisma.$transaction(async (tx) => {
      const current = await tx.lessonRecord.findUnique({ where: { sessionId } });
      if (!current) throw new NotFoundException('教学记录不存在');
      if (current.status !== LessonRecordStatus.SUBMITTED) throw new ConflictException('只有已提交记录可以发布');
      const result = await tx.lessonRecord.updateMany({
        where: { id: current.id, version: current.version, status: LessonRecordStatus.SUBMITTED },
        data: {
          status: LessonRecordStatus.PUBLISHED,
          version: { increment: 1 },
          publishedBy: actor.id,
          publishedAt: new Date(),
          updatedBy: actor.id,
        },
      });
      if (!result.count) throw new ConflictException('教学记录已被其他操作更新，请刷新后重试');
      const updated = await tx.lessonRecord.findUniqueOrThrow({ where: { id: current.id } });
      await this.versions.append(tx, updated.id, LessonRecordVersionAction.PUBLISH, actor.id, dto.reason);
      return updated;
    });
    await Promise.all([
      this.notifyPublished(session.classId, session.title, record.id),
      this.log(actor, 'lesson-record:publish', record.id, session.classId, record.version),
    ]);
    return this.detail(sessionId, actor);
  }

  async versionHistory(sessionId: string, actor: RequestUser) {
    await this.access.session(sessionId, actor);
    const record = await this.prisma.lessonRecord.findUnique({ where: { sessionId }, select: { id: true } });
    if (!record) return [];
    return this.prisma.lessonRecordVersion.findMany({
      where: { recordId: record.id },
      orderBy: { version: 'desc' },
    });
  }

  private async learnerClassIds(actor: RequestUser, studentId?: string) {
    const learnerId = await this.access.learnerId(actor, studentId);
    const memberships = await this.prisma.classStudent.findMany({
      where: {
        studentId: learnerId,
        status: ClassMemberStatus.ACTIVE,
        classGroup: { deletedAt: null, status: 'active' },
      },
      select: { classId: true },
    });
    return memberships.map((item) => item.classId);
  }

  private async notifyPublished(classId: string, title: string, recordId: string) {
    const memberships = await this.prisma.classStudent.findMany({
      where: {
        classId,
        status: ClassMemberStatus.ACTIVE,
        student: { deletedAt: null, status: UserStatus.ACTIVE },
      },
      select: {
        studentId: true,
        student: {
          select: {
            childParents: {
              where: {
                status: ClassMemberStatus.ACTIVE,
                parent: { deletedAt: null, status: UserStatus.ACTIVE },
              },
              select: { parentId: true },
            },
          },
        },
      },
    });
    const recipients = memberships.flatMap((item) => [
      item.studentId,
      ...item.student.childParents.map((relation) => relation.parentId),
    ]);
    return this.notifications.notifyMany({
      userIds: recipients,
      title: '新的课次学习记录已发布',
      content: `“${title}”的学习内容已发布，可在学习门户查看。`,
      type: 'lesson_record_published',
      bizType: 'lesson_record',
      bizId: recordId,
    });
  }

  private recordFields(dto: SaveLessonRecordDto) {
    return {
      internalTeachingNotes: this.clean(dto.internalTeachingNotes),
      internalClassPerformance: this.clean(dto.internalClassPerformance),
      publicTeachingContent: this.clean(dto.publicTeachingContent),
      publicLearningGoal: this.clean(dto.publicLearningGoal),
      publicClassPerformance: this.clean(dto.publicClassPerformance),
      publicHomework: this.clean(dto.publicHomework),
      publicNextPlan: this.clean(dto.publicNextPlan),
      publicMaterials: this.clean(dto.publicMaterials),
    };
  }

  private recordView(record: any, internal: boolean) {
    const publicFields = {
      id: record.id,
      status: record.status,
      version: record.version,
      publicTeachingContent: record.publicTeachingContent,
      publicLearningGoal: record.publicLearningGoal,
      publicClassPerformance: record.publicClassPerformance,
      publicHomework: record.publicHomework,
      publicNextPlan: record.publicNextPlan,
      publicMaterials: record.publicMaterials,
      publishedAt: record.publishedAt,
      assets: (record.assets ?? [])
        .filter((asset: any) => internal || asset.audience === LessonAssetAudience.LEARNER)
        .map((asset: any) => this.assetView(asset)),
    };
    if (!internal) return publicFields;
    return {
      ...publicFields,
      internalTeachingNotes: record.internalTeachingNotes,
      internalClassPerformance: record.internalClassPerformance,
      submittedAt: record.submittedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private assetView(asset: any) {
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

  private sessionView(session: any) {
    return {
      id: session.id,
      title: session.title,
      status: session.status,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      timezone: session.timezone,
      lessonHours: Number(session.lessonHours),
      classroom: session.classroom,
      classGroup: session.classGroup,
      teacher: session.teacher,
      lessonType: session.lessonType,
      unitTemplate: session.unitTemplate,
      knowledgePoint: session.knowledgePoint,
    };
  }

  private clean(value?: string) {
    const result = value?.trim();
    return result || null;
  }

  private log(actor: RequestUser, action: string, recordId: string, classId: string, version: number) {
    return this.audit.log({
      userId: actor.id,
      action,
      module: 'lesson-records',
      targetType: 'lesson-record',
      targetId: recordId,
      afterData: { classId, version },
    });
  }
}
