import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LessonPlanSource, Prisma } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { hasPermission } from '../../common/security/permission-policy';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryLessonPlanDto, SaveLessonPlanDto } from './dto/lesson-plan.dto';

const lessonPlanInclude = {
  author: { select: { id: true, username: true, realName: true } },
  knowledgePoint: { select: { name: true } },
} as const;

@Injectable()
export class LessonPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  courseOptions(actor: RequestUser) {
    const canReadCourseCatalog = hasPermission(actor, 'course:read');
    return this.prisma.course.findMany({
      where: {
        deletedAt: null,
        ...(!canReadCourseCatalog
          ? {
              lessonPlans: {
                some: {
                  deletedAt: null,
                  ...(!this.isAdmin(actor)
                    ? {
                        OR: [
                          { source: LessonPlanSource.SYSTEM },
                          { source: LessonPlanSource.PERSONAL, authorId: actor.id },
                        ],
                      }
                    : {}),
                },
              },
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    });
  }

  async list(query: QueryLessonPlanDto, actor: RequestUser) {
    const where: Prisma.LessonPlanWhereInput = {
      deletedAt: null,
      courseId: query.courseId,
      knowledgePointId: query.knowledgePointId,
      source: query.source,
      OR: this.isAdmin(actor)
        ? undefined
        : [
            { source: LessonPlanSource.SYSTEM },
            { source: LessonPlanSource.PERSONAL, authorId: actor.id },
          ],
    };
    const items = await this.prisma.lessonPlan.findMany({
      where,
      include: lessonPlanInclude,
      orderBy: [{ updatedAt: 'desc' }],
    });
    return items.map((item) => this.view(item));
  }

  async create(dto: SaveLessonPlanDto, actor: RequestUser) {
    this.assertSourcePermission(dto.source, actor);
    await this.assertReferences(dto);
    const item = await this.prisma.lessonPlan.create({
      data: {
        source: dto.source,
        courseId: dto.courseId,
        knowledgePointId: dto.knowledgePointId,
        authorId: actor.id,
        theme: dto.theme.trim(),
        content: this.content(dto),
      },
      include: lessonPlanInclude,
    });
    await this.audit.log({
      userId: actor.id,
      action: 'lesson-plan:create',
      module: 'lesson-records',
      targetType: 'lesson-plan',
      targetId: item.id,
      afterData: { source: item.source, courseId: item.courseId, theme: item.theme },
    });
    return this.view(item);
  }

  async update(id: string, dto: SaveLessonPlanDto, actor: RequestUser) {
    const existing = await this.assertManageable(id, actor);
    this.assertSourcePermission(dto.source, actor);
    await this.assertReferences(dto);
    const item = await this.prisma.lessonPlan.update({
      where: { id },
      data: {
        source: dto.source,
        courseId: dto.courseId,
        knowledgePointId: dto.knowledgePointId,
        theme: dto.theme.trim(),
        content: this.content(dto),
      },
      include: lessonPlanInclude,
    });
    await this.audit.log({
      userId: actor.id,
      action: 'lesson-plan:update',
      module: 'lesson-records',
      targetType: 'lesson-plan',
      targetId: item.id,
      beforeData: { source: existing.source, courseId: existing.courseId, theme: existing.theme },
      afterData: { source: item.source, courseId: item.courseId, theme: item.theme },
    });
    return this.view(item);
  }

  async remove(id: string, actor: RequestUser) {
    const existing = await this.assertManageable(id, actor);
    await this.prisma.lessonPlan.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: actor.id,
      action: 'lesson-plan:delete',
      module: 'lesson-records',
      targetType: 'lesson-plan',
      targetId: id,
      beforeData: { source: existing.source, courseId: existing.courseId, theme: existing.theme },
    });
    return true;
  }

  private content(dto: SaveLessonPlanDto): Prisma.InputJsonValue {
    return {
      scheduledAt: dto.scheduledAt,
      classroom: dto.classroom,
      instructorName: dto.instructorName,
      gradeLevel: dto.gradeLevel,
      durationMinutes: dto.durationMinutes,
      learnerAnalysis: dto.learnerAnalysis,
      knowledgeObjectives: dto.knowledgeObjectives,
      processObjectives: dto.processObjectives,
      valueObjectives: dto.valueObjectives,
      coreCompetencies: dto.coreCompetencies,
      teachingContent: dto.teachingContent,
      keyPoints: dto.keyPoints,
      difficultPoints: dto.difficultPoints,
      doubtfulPoints: dto.doubtfulPoints,
      teachingMethods: dto.teachingMethods,
      teachingMeans: dto.teachingMeans,
      preparation: dto.preparation,
      teachingProcess: dto.teachingProcess.map((stage) => ({
        id: stage.id,
        title: stage.title,
        duration: stage.duration,
        coreQuestion: stage.coreQuestion,
        teacherActivity: stage.teacherActivity,
        studentActivity: stage.studentActivity,
        assessment: stage.assessment,
        designIntent: stage.designIntent,
        resources: stage.resources,
      })),
      homework: dto.homework,
      assessment: dto.assessment,
      boardDesign: dto.boardDesign,
      reflection: dto.reflection,
    };
  }

  private view(item: Prisma.LessonPlanGetPayload<{ include: typeof lessonPlanInclude }>) {
    const content = item.content && typeof item.content === 'object' && !Array.isArray(item.content)
      ? item.content as Record<string, unknown>
      : {};
    return {
      id: item.id,
      source: item.source,
      authorId: item.authorId,
      authorName: item.author.realName || item.author.username,
      courseId: item.courseId,
      knowledgePointId: item.knowledgePointId || undefined,
      knowledgePointName: item.knowledgePoint?.name || undefined,
      theme: item.theme,
      ...content,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private async assertReferences(dto: SaveLessonPlanDto) {
    const [course, knowledgePoint] = await Promise.all([
      this.prisma.course.findFirst({ where: { id: dto.courseId, deletedAt: null }, select: { id: true } }),
      dto.knowledgePointId
        ? this.prisma.knowledgePoint.findFirst({
            where: { id: dto.knowledgePointId, courseId: dto.courseId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve({ id: 'none' }),
    ]);
    if (!course) throw new BadRequestException('课程不存在');
    if (!knowledgePoint) throw new BadRequestException('课程知识点不存在或不属于所选课程');
  }

  private async assertManageable(id: string, actor: RequestUser) {
    const item = await this.prisma.lessonPlan.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('教案不存在');
    if (!this.isAdmin(actor) && (item.source === LessonPlanSource.SYSTEM || item.authorId !== actor.id)) {
      throw new ForbiddenException('无权修改或删除该教案，请复制为个人教案后再编辑');
    }
    return item;
  }

  private assertSourcePermission(source: LessonPlanSource, actor: RequestUser) {
    if (source === LessonPlanSource.SYSTEM && !this.isAdmin(actor)) {
      throw new ForbiddenException('只有管理员可以创建或修改系统通用教案');
    }
  }

  private isAdmin(actor: RequestUser) {
    return actor.userType === 'SUPER_ADMIN' || actor.userType === 'ADMIN';
  }
}
