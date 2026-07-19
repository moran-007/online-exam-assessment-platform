import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { AiSummaryReviewStatus, AiSummaryType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { hasPermission } from '../../common/security/permission-policy';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiSummaryAccessService } from './ai-summary-access.service';
import { evidenceIndex, presentSummary } from './ai-summary.presenter';
import { RegenerateAiSummaryDto, UpdateAiSummaryDraftDto } from './dto/ai-summary-lifecycle.dto';
import { ExamSummaryTaskUseCases } from './exam-summary-task.use-cases';
import { SummaryOutputValidator } from './schemas/summary-output.validator';
import { StudentSummaryTaskUseCases } from './student-summary-task.use-cases';
import { IntegratedSummaryUseCases } from './integrated-summary.use-cases';

const EDITABLE_STATUSES = [
  AiSummaryReviewStatus.DRAFT,
  AiSummaryReviewStatus.IN_REVIEW,
  AiSummaryReviewStatus.APPROVED,
  AiSummaryReviewStatus.REVOKED,
];

@Injectable()
export class AiSummaryLifecycleUseCases {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: SummaryOutputValidator,
    private readonly audit: AuditService,
    private readonly examTasks: ExamSummaryTaskUseCases,
    private readonly studentTasks: StudentSummaryTaskUseCases,
    private readonly access: AiSummaryAccessService,
    private readonly integratedTasks: IntegratedSummaryUseCases,
  ) {}

  async update(id: string, dto: UpdateAiSummaryDraftDto, user: RequestUser) {
    const current = await this.access.require(id, user);
    const content = this.validator.validate(dto.content, evidenceIndex(current.evidenceIndexJson));
    const result = await this.prisma.aiSummary.updateMany({
      where: { id, draftVersion: current.draftVersion, reviewStatus: { in: EDITABLE_STATUSES } },
      data: {
        summaryJson: content as unknown as Prisma.InputJsonValue,
        reviewStatus: AiSummaryReviewStatus.DRAFT,
        draftVersion: { increment: 1 },
        editedBy: user.id,
        reviewedBy: null,
        publishedAt: null,
        revokedAt: null,
      },
    });
    if (!result.count) throw new ConflictException('已发布总结必须先撤回才能编辑');
    const updated = await this.access.find(id);
    await this.auditChange('ai:summary-edit', current, updated, user.id);
    return presentSummary(updated);
  }

  async review(id: string, user: RequestUser) {
    const current = await this.access.require(id, user);
    this.validator.validate(current.summaryJson, evidenceIndex(current.evidenceIndexJson));
    const updated = await this.transition(
      id,
      [AiSummaryReviewStatus.DRAFT, AiSummaryReviewStatus.IN_REVIEW],
      current.draftVersion,
      { reviewStatus: AiSummaryReviewStatus.APPROVED, reviewedBy: user.id },
      '只有草稿或待审核总结可以审核通过',
    );
    await this.auditChange('ai:summary-review', current, updated, user.id);
    return presentSummary(updated);
  }

  async publish(id: string, user: RequestUser) {
    const current = await this.access.require(id, user);
    if (current.type === AiSummaryType.LESSON) {
      throw new ForbiddenException('课堂助手只生成教师草稿，请应用到教学记录后再走教学记录发布流程');
    }
    this.validator.validate(current.summaryJson, evidenceIndex(current.evidenceIndexJson));
    const updated = await this.transition(
      id,
      [AiSummaryReviewStatus.APPROVED],
      current.draftVersion,
      { reviewStatus: AiSummaryReviewStatus.PUBLISHED, publishedAt: new Date(), revokedAt: null },
      '总结必须先完成人工审核才能发布',
    );
    await this.auditChange('ai:summary-publish', current, updated, user.id);
    return presentSummary(updated);
  }

  async revoke(id: string, user: RequestUser) {
    const current = await this.access.require(id, user);
    const updated = await this.transition(
      id,
      [AiSummaryReviewStatus.PUBLISHED],
      current.draftVersion,
      { reviewStatus: AiSummaryReviewStatus.REVOKED, revokedAt: new Date() },
      '只有已发布总结可以撤回',
    );
    await this.auditChange('ai:summary-revoke', current, updated, user.id);
    return presentSummary(updated);
  }

  async regenerate(id: string, dto: RegenerateAiSummaryDto, user: RequestUser) {
    const current = await this.access.require(id, user);
    this.assertGenerationPermission(current.type, user);
    const options = { generationKey: randomUUID(), sourceSummaryId: current.id };
    const task = await this.regenerateTask(current, dto, user, options);
    await this.audit.log({
      userId: user.id,
      action: 'ai:summary-regenerate',
      module: 'ai',
      targetType: 'ai_summary',
      targetId: current.id,
      afterData: { taskId: task.id, status: task.status },
    });
    return task;
  }

  private assertGenerationPermission(type: AiSummaryType, user: RequestUser) {
    const required = {
      [AiSummaryType.EXAM]: 'ai.summary.exam.generate',
      [AiSummaryType.STUDENT]: 'ai.summary.student.generate',
      [AiSummaryType.CLASS]: 'ai.summary.class.generate',
      [AiSummaryType.PARENT_REPORT]: 'ai.summary.parent-report.generate',
      [AiSummaryType.LESSON]: 'ai.summary.lesson.generate',
    }[type];
    if (!hasPermission(user, required)) throw new ForbiddenException('无权限重新生成该总结');
  }

  private regenerateTask(
    current: Awaited<ReturnType<AiSummaryAccessService['require']>>,
    dto: RegenerateAiSummaryDto,
    user: RequestUser,
    options: { generationKey: string; sourceSummaryId: string },
  ) {
    const generation = { configId: dto.configId, maxTokens: dto.maxTokens };
    if (current.type === AiSummaryType.EXAM) {
      return this.examTasks.create({ examId: current.subjectId, ...generation }, user, options);
    }
    if (current.type === AiSummaryType.STUDENT) {
      return this.studentTasks.create({
        ...studentScope(current.task.scopeJson, current.subjectId),
        ...generation,
      }, user, options);
    }
    const range = integratedRange(current.task.scopeJson);
    if (current.type === AiSummaryType.CLASS) {
      return this.integratedTasks.createClass({ classId: current.subjectId, ...range, ...generation }, user, options);
    }
    if (current.type === AiSummaryType.PARENT_REPORT) {
      return this.integratedTasks.createParent({ studentId: current.subjectId, ...range, ...generation }, user, options);
    }
    return this.integratedTasks.createLesson({ sessionId: current.subjectId, ...generation }, user, options);
  }

  private async transition(
    id: string,
    from: AiSummaryReviewStatus[],
    draftVersion: number,
    data: Prisma.AiSummaryUpdateManyMutationInput,
    conflictMessage: string,
  ) {
    const result = await this.prisma.aiSummary.updateMany({
      where: { id, draftVersion, reviewStatus: { in: from } },
      data,
    });
    if (!result.count) throw new ConflictException(conflictMessage);
    return this.access.find(id);
  }

  private auditChange(
    action: string,
    before: Awaited<ReturnType<AiSummaryAccessService['find']>>,
    after: Awaited<ReturnType<AiSummaryAccessService['find']>>,
    userId: string,
  ) {
    return this.audit.log({
      userId,
      action,
      module: 'ai',
      targetType: 'ai_summary',
      targetId: after.id,
      beforeData: { reviewStatus: before.reviewStatus, draftVersion: before.draftVersion },
      afterData: { reviewStatus: after.reviewStatus, draftVersion: after.draftVersion },
    });
  }
}

function studentScope(value: Prisma.JsonValue, studentId: string) {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
  return {
    studentId,
    ...(typeof record.courseId === 'string' ? { courseId: record.courseId } : {}),
    ...(Array.isArray(record.examIds)
      ? { examIds: record.examIds.filter((item): item is string => typeof item === 'string') }
      : {}),
    ...(typeof record.from === 'string' ? { from: record.from } : {}),
    ...(typeof record.to === 'string' ? { to: record.to } : {}),
  };
}

function integratedRange(value: Prisma.JsonValue) {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
  return {
    ...(typeof record.from === 'string' ? { from: record.from } : {}),
    ...(typeof record.to === 'string' ? { to: record.to } : {}),
  };
}
