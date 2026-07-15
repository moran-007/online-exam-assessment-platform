import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AnswerRecordStatus, AttemptStatus, ScoringEvaluationSource } from '@prisma/client';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { AuditService } from '../../audit/audit.service';
import { DataScopeService } from '../../data-scope/data-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScoringHistoryService } from '../../question-types/scoring-history.service';
import { BatchGradeAnswersDto } from '../dto/batch-grade-answers.dto';
import { GradeAnswerDto } from '../dto/grade-answer.dto';
import { GradingSupportOperations, PaperSnapshot } from '../grading-support.operations';
import { MetricsService } from '../../../observability/metrics.service';

@Injectable()
export class GradeAnswerUseCases {
  constructor(
    readonly prisma: PrismaService,
    readonly audit: AuditService,
    readonly dataScope: DataScopeService,
    readonly scoringHistory: ScoringHistoryService,
    readonly support: GradingSupportOperations,
    readonly metrics: MetricsService,
  ) {}

  async gradeAnswer(answerRecordId: string, dto: GradeAnswerDto, user: RequestUser) {
    const record = await this.prisma.answerRecord.findFirst({
      where: { id: answerRecordId },
      include: {
        attempt: { include: { paperInstance: true } },
      },
    });
    if (!record) {
      throw new NotFoundException('待批改答案不存在');
    }
    await this.dataScope.assertExamAccessible(user, record.attempt.examId);
    if (!this.support.isGradableStatus(record.status)) {
      throw new BadRequestException('当前答案不是可批改题');
    }

    const snapshot = this.support.findSnapshotQuestion(
      record.attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot,
      record.questionId,
    );
    const maxScore = snapshot?.score ?? 0;
    const rubricResult = this.support.resolveRubricScore(snapshot, dto);
    const score = rubricResult?.score ?? dto.score;
    if (score === undefined) {
      throw new BadRequestException('请填写得分；配置 rubric 的题目应提交各维度评分');
    }
    if (score > maxScore) {
      throw new BadRequestException(`得分不能超过该题分值 ${maxScore}`);
    }
    const nextStatus = this.support.isJudgeQuestion(record.status, snapshot)
      ? AnswerRecordStatus.JUDGE_DONE
      : AnswerRecordStatus.MANUAL_GRADED;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.answerRecord.updateMany({
        where: {
          id: answerRecordId,
          updatedAt: dto.expectedUpdatedAt ? new Date(dto.expectedUpdatedAt) : undefined,
        },
        data: {
          score,
          isCorrect: score >= maxScore && maxScore > 0,
          status: nextStatus,
          manualComment: dto.comment?.trim() || null,
          gradedBy: user.id,
          gradedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        this.metrics.recordExamOperation('conflict', 'rejected');
        throw new ConflictException('该答案已被其他阅卷人更新，请刷新后重试');
      }
      await this.scoringHistory.recordOfficial(tx, {
        answerRecordId,
        answerJson: record.answerJson,
        score,
        maxScore,
        isCorrect: score >= maxScore && maxScore > 0,
        status: nextStatus,
        details: rubricResult?.details ?? {
          comment: dto.comment?.trim() || null,
          mode: 'manual',
        },
        adapterKey: snapshot?.snapshot.engine?.adapterKey ?? snapshot?.snapshot.type ?? 'manual',
        adapterVersion: snapshot?.snapshot.engine?.adapterVersion ?? 1,
        source: ScoringEvaluationSource.MANUAL,
        gradedBy: user.id,
        scoringRuleVersionId: snapshot?.snapshot.scoringRuleVersionId ?? null,
        ruleSnapshot: snapshot?.snapshot.scoringRule ?? null,
      });
      await this.support.recalculateAttempt(tx, record.attemptId);
    });

    await this.audit.log({
      userId: user.id,
      action: 'grading:grade-answer',
      module: 'grading',
      targetType: 'answer_record',
      targetId: answerRecordId,
      afterData: {
        score,
        comment: dto.comment,
        rubricScores: dto.rubricScores?.map((item) => ({
          criterionId: item.criterionId,
          score: item.score,
          comment: item.comment ?? '',
        })),
      },
    });

    return { id: answerRecordId };
  }


  async batchGradeAnswers(dto: BatchGradeAnswersDto, user: RequestUser) {
    const ids = [...new Set(dto.answerRecordIds)];
    const records = await this.prisma.answerRecord.findMany({
      where: { id: { in: ids } },
      include: { attempt: { include: { paperInstance: true } } },
    });
    if (records.length !== ids.length) {
      throw new NotFoundException('部分待批改答案不存在，请刷新列表后重试');
    }

    for (const record of records) {
      await this.dataScope.assertExamAccessible(user, record.attempt.examId);
      if (!this.support.isGradableStatus(record.status)) {
        throw new BadRequestException('选中项中存在不可批改的答案，请刷新列表后重试');
      }
    }

    for (const record of records) {
      const snapshot = this.support.findSnapshotQuestion(
        record.attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot,
        record.questionId,
      );
      await this.gradeAnswer(
        record.id,
        {
          score: dto.mode === 'full' ? (snapshot?.score ?? 0) : 0,
          comment: dto.comment,
        },
        user,
      );
    }

    return { updatedCount: records.length, mode: dto.mode };
  }


  async finishAttempt(attemptId: string, user: RequestUser) {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId },
      include: { answers: true },
    });
    if (!attempt) {
      throw new NotFoundException('答题记录不存在');
    }
    await this.dataScope.assertExamAccessible(user, attempt.examId);

    const pending = attempt.answers.filter(
      (answer) =>
        answer.status === AnswerRecordStatus.MANUAL_NEEDED ||
        answer.status === AnswerRecordStatus.JUDGE_PENDING,
    );
    if (pending.length) {
      throw new BadRequestException({
        message: '仍有题目未完成批改或判题，不能完成整卷批改',
        data: {
          pendingCount: pending.length,
          manualPendingCount: pending.filter((answer) => answer.status === AnswerRecordStatus.MANUAL_NEEDED).length,
          judgePendingCount: pending.filter((answer) => answer.status === AnswerRecordStatus.JUDGE_PENDING).length,
        },
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await this.support.recalculateAttempt(tx, attemptId);
      await tx.examAttempt.update({
        where: { id: attemptId },
        data: { status: AttemptStatus.GRADED },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'grading:finish-attempt',
      module: 'grading',
      targetType: 'attempt',
      targetId: attemptId,
    });

    return this.support.attemptScore(attemptId);
  }

}
