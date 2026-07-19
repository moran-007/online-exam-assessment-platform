import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClassMemberStatus, Prisma, ScratchAssignmentStatus, ScratchTemplateStatus } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScratchAssignmentDto, UpdateScratchAssignmentDto } from './dto/scratch.dto';
import { ScratchAccessService } from './scratch-access.service';

@Injectable()
export class ScratchAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ScratchAccessService,
    private readonly audit: AuditService,
  ) {}

  async listSession(sessionId: string, actor: RequestUser, requestedStudentId?: string) {
    let learnerId: string | null = null;
    if (this.access.isInternal(actor)) {
      await this.access.session(sessionId, actor);
    } else {
      const session = await this.prisma.lessonSession.findUnique({ where: { id: sessionId }, select: { classId: true } });
      if (!session) throw new NotFoundException('课次不存在');
      learnerId = await this.access.learnerId(actor, requestedStudentId);
      await this.access.assertStudentInClass(session.classId, learnerId);
    }
    const items = await this.prisma.lessonScratchAssignment.findMany({
      where: {
        sessionId,
        ...(learnerId ? { status: ScratchAssignmentStatus.PUBLISHED } : {}),
      },
      include: {
        template: { include: { projectAsset: true, thumbnailAsset: true } },
        works: {
          where: learnerId ? { studentId: learnerId } : {},
          include: { student: { select: { id: true, username: true, realName: true } } },
          orderBy: { updatedAt: 'desc' },
        },
        _count: { select: { works: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    return items.map((item) => this.view(item, learnerId !== null));
  }

  async studentOverview(studentId: string, actor: RequestUser) {
    const learnerId = await this.access.learnerId(actor, studentId);
    const memberships = await this.prisma.classStudent.findMany({
      where: { studentId: learnerId, status: ClassMemberStatus.ACTIVE },
      select: { classId: true },
    });
    const classIds = memberships.map((item) => item.classId);
    if (!classIds.length) return [];
    const items = await this.prisma.lessonScratchAssignment.findMany({
      where: { status: ScratchAssignmentStatus.PUBLISHED, session: { classId: { in: classIds } } },
      include: {
        session: { include: { classGroup: { select: { id: true, name: true } } } },
        template: { include: { projectAsset: true, thumbnailAsset: true } },
        works: {
          where: { studentId: learnerId },
          include: {
            student: { select: { id: true, username: true, realName: true } },
            reviews: { orderBy: { createdAt: 'desc' }, take: 1 },
            judgeRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
        _count: { select: { works: true } },
      },
      orderBy: [{ dueAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return items.map((item) => ({
      ...this.view(item, true),
      session: {
        id: item.session.id,
        title: item.session.title,
        startsAt: item.session.startsAt,
        classId: item.session.classGroup.id,
        className: item.session.classGroup.name,
      },
    }));
  }

  async create(sessionId: string, dto: CreateScratchAssignmentDto, actor: RequestUser) {
    await this.access.session(sessionId, actor);
    const template = await this.prisma.scratchTemplate.findUnique({ where: { id: dto.templateId } });
    if (!template || template.status !== ScratchTemplateStatus.ACTIVE) throw new BadRequestException('Scratch 模板不存在或已归档');
    const duplicate = await this.prisma.lessonScratchAssignment.findUnique({
      where: { sessionId_templateId: { sessionId, templateId: dto.templateId } },
    });
    if (duplicate) throw new ConflictException('该模板已经绑定到当前课次');
    const assignment = await this.prisma.lessonScratchAssignment.create({
      data: {
        sessionId,
        templateId: dto.templateId,
        title: dto.title.trim(),
        statementMd: this.clean(dto.statementMd),
        bindNote: this.clean(dto.bindNote),
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        maxScore: dto.maxScore ?? 100,
        judgeMode: dto.judgeMode,
        runtimeConfigJson: dto.runtimeConfig as Prisma.InputJsonValue | undefined,
        createdBy: actor.id,
      },
      include: this.include(),
    });
    await this.log(actor, 'create', assignment.id, null, { sessionId, templateId: dto.templateId });
    return this.view(assignment, false);
  }

  async update(id: string, dto: UpdateScratchAssignmentDto, actor: RequestUser) {
    const { assignment } = await this.access.assignment(id, actor);
    if (assignment.status === ScratchAssignmentStatus.ARCHIVED) throw new ConflictException('已归档任务不可编辑');
    const resetToDraft = assignment.status === ScratchAssignmentStatus.PUBLISHED;
    const updated = await this.prisma.lessonScratchAssignment.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        statementMd: dto.statementMd === undefined ? undefined : this.clean(dto.statementMd),
        bindNote: dto.bindNote === undefined ? undefined : this.clean(dto.bindNote),
        dueAt: dto.dueAt === undefined ? undefined : new Date(dto.dueAt),
        maxScore: dto.maxScore,
        judgeMode: dto.judgeMode,
        runtimeConfigJson: dto.runtimeConfig as Prisma.InputJsonValue | undefined,
        ...(resetToDraft ? { status: ScratchAssignmentStatus.DRAFT, publishedAt: null } : {}),
      },
      include: this.include(),
    });
    await this.log(actor, 'update', id, { status: assignment.status }, { status: updated.status });
    return this.view(updated, false);
  }

  async publish(id: string, actor: RequestUser) {
    const { assignment } = await this.access.assignment(id, actor);
    if (assignment.template.status !== ScratchTemplateStatus.ACTIVE) throw new ConflictException('模板已归档，不能发布任务');
    const updated = await this.prisma.lessonScratchAssignment.update({
      where: { id },
      data: { status: ScratchAssignmentStatus.PUBLISHED, publishedAt: new Date() },
      include: this.include(),
    });
    await this.log(actor, 'publish', id, { status: assignment.status }, { status: updated.status });
    return this.view(updated, false);
  }

  async archive(id: string, actor: RequestUser) {
    const { assignment } = await this.access.assignment(id, actor);
    const updated = await this.prisma.lessonScratchAssignment.update({
      where: { id },
      data: { status: ScratchAssignmentStatus.ARCHIVED, publishedAt: null },
      include: this.include(),
    });
    await this.log(actor, 'archive', id, { status: assignment.status }, { status: updated.status });
    return this.view(updated, false);
  }

  private include() {
    return {
      template: { include: { projectAsset: true, thumbnailAsset: true } },
      works: { include: { student: { select: { id: true, username: true, realName: true } } }, orderBy: { updatedAt: 'desc' as const } },
      _count: { select: { works: true } },
    };
  }

  private view(item: any, learner: boolean) {
    const works = item.works.map((work: any) => ({
      id: work.id,
      student: learner ? undefined : work.student,
      title: work.title,
      status: work.status.toLowerCase(),
      currentVersion: work.currentVersion,
      submittedAt: work.submittedAt,
      reviewedAt: work.reviewedAt,
      latestReview: work.reviews?.[0] ? this.review(work.reviews[0]) : null,
      latestJudgeRun: work.judgeRuns?.[0] ? this.judge(work.judgeRuns[0]) : null,
      updatedAt: work.updatedAt,
    }));
    return {
      id: item.id,
      sessionId: item.sessionId,
      title: item.title,
      statementMd: item.statementMd,
      bindNote: learner ? undefined : item.bindNote,
      dueAt: item.dueAt,
      maxScore: Number(item.maxScore),
      status: item.status.toLowerCase(),
      judgeMode: item.judgeMode.toLowerCase(),
      publishedAt: item.publishedAt,
      template: {
        id: item.template.id,
        title: item.template.title,
        description: item.template.description,
        runtimeProblemUrl: item.template.runtimeProblemUrl,
        projectFileName: item.template.projectAsset.fileName,
        thumbnailAvailable: Boolean(item.template.thumbnailAsset),
      },
      workCount: learner ? undefined : item._count.works,
      works,
    };
  }

  private review(item: any) {
    return { score: item.score === null ? null : Number(item.score), comment: item.comment, createdAt: item.createdAt };
  }

  private judge(item: any) {
    return { id: item.id, status: item.status.toLowerCase(), score: item.score === null ? null : Number(item.score), message: item.message };
  }

  private log(actor: RequestUser, action: string, targetId: string, beforeData: any, afterData: any) {
    return this.audit.log({ userId: actor.id, action: `scratch-assignment:${action}`, module: 'scratch', targetType: 'scratch-assignment', targetId, beforeData, afterData });
  }

  private clean(value?: string) {
    return value?.trim() || null;
  }
}
