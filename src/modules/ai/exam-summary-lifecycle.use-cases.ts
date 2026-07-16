import { ConflictException, Injectable } from '@nestjs/common';
import { AiSummaryReviewStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { evidenceIndex, presentSummary } from './ai-summary.presenter';
import { RegenerateAiSummaryDto, UpdateAiSummaryDraftDto } from './dto/ai-summary-lifecycle.dto';
import { ExamSummaryTaskUseCases } from './exam-summary-task.use-cases';
import { ExamSummaryAccessService } from './exam-summary-access.service';
import { SummaryOutputValidator } from './schemas/summary-output.validator';

const EDITABLE_STATUSES = [
  AiSummaryReviewStatus.DRAFT,
  AiSummaryReviewStatus.IN_REVIEW,
  AiSummaryReviewStatus.APPROVED,
  AiSummaryReviewStatus.REVOKED,
];

@Injectable()
export class ExamSummaryLifecycleUseCases {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: SummaryOutputValidator,
    private readonly audit: AuditService,
    private readonly tasks: ExamSummaryTaskUseCases,
    private readonly access: ExamSummaryAccessService,
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
    const task = await this.tasks.create({
      examId: current.subjectId,
      configId: dto.configId,
      maxTokens: dto.maxTokens,
    }, user, { generationKey: randomUUID(), sourceSummaryId: current.id });
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
    before: Awaited<ReturnType<ExamSummaryAccessService['find']>>,
    after: Awaited<ReturnType<ExamSummaryAccessService['find']>>,
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
