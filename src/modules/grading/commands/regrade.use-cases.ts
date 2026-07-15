import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AnswerRecordStatus,
  Prisma,
  RegradeRuleSource,
  RegradeRunStatus,
  ScoringEvaluationSource,
  ScoringEvaluationStatus,
} from '@prisma/client';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { toApiEnum } from '../../../common/utils/enum-normalizer';
import { AuditService } from '../../audit/audit.service';
import { DataScopeService } from '../../data-scope/data-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QuestionTypeRegistry } from '../../question-types/question-type-registry.service';
import { ScoringHistoryService } from '../../question-types/scoring-history.service';
import { PreviewRegradeRunDto } from '../dto/regrade-run.dto';
import { GradingSupportOperations, PaperSnapshot } from '../grading-support.operations';

@Injectable()
export class RegradeUseCases {
  constructor(
    readonly prisma: PrismaService,
    readonly audit: AuditService,
    readonly dataScope: DataScopeService,
    readonly questionTypes: QuestionTypeRegistry,
    readonly scoringHistory: ScoringHistoryService,
    readonly support: GradingSupportOperations,
  ) {}

  async regradeAttempt(attemptId: string, user: RequestUser) {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId },
      select: { examId: true },
    });
    if (!attempt) {
      throw new NotFoundException('答题记录不存在');
    }
    const preview = await this.previewRegradeRun(
      { examId: attempt.examId, attemptIds: [attemptId], ruleSource: 'snapshot' },
      user,
    );
    const confirmed = await this.confirmRegradeRun(preview.id, user);
    return {
      ...(await this.support.attemptScore(attemptId)),
      updatedCount: confirmed.appliedCount,
      regradeRunId: preview.id,
    };
  }


  async previewRegradeRun(dto: PreviewRegradeRunDto, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, dto.examId);
    const limit = Math.min(dto.limit ?? 5000, 5000);
    const ruleSource = this.support.toRegradeRuleSource(dto.ruleSource ?? 'snapshot');
    if (ruleSource === RegradeRuleSource.SPECIFIED && !dto.scoringRuleVersionId) {
      throw new BadRequestException('指定规则版本重判时必须提供 scoringRuleVersionId');
    }
    const records = await this.prisma.answerRecord.findMany({
      where: {
        id: dto.answerRecordIds?.length ? { in: [...new Set(dto.answerRecordIds)] } : undefined,
        questionId: dto.questionIds?.length ? { in: [...new Set(dto.questionIds)] } : undefined,
        attempt: {
          examId: dto.examId,
          id: dto.attemptIds?.length ? { in: [...new Set(dto.attemptIds)] } : undefined,
          userId: dto.studentIds?.length ? { in: [...new Set(dto.studentIds)] } : undefined,
        },
      },
      include: { attempt: { include: { paperInstance: true } } },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    if (records.length > limit) throw new BadRequestException(`试算范围超过 ${limit} 条，请缩小筛选范围`);

    const run = await this.prisma.regradeRun.create({
      data: {
        examId: dto.examId,
        requestedBy: user.id,
        status: RegradeRunStatus.PROCESSING,
        ruleSource,
        scoringRuleVersionId: dto.scoringRuleVersionId ?? null,
        filtersJson: {
          attemptIds: dto.attemptIds ?? [],
          answerRecordIds: dto.answerRecordIds ?? [],
          studentIds: dto.studentIds ?? [],
          questionIds: dto.questionIds ?? [],
          limit,
        },
        reason: dto.reason?.trim() || null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    try {
      let changedCount = 0;
      let scoreDelta = 0;
      const specifiedRule = dto.scoringRuleVersionId
        ? await this.prisma.scoringRuleVersion.findUnique({ where: { id: dto.scoringRuleVersionId } })
        : null;
      if (dto.scoringRuleVersionId && !specifiedRule) throw new BadRequestException('指定的评分规则版本不存在');

      for (const record of records) {
        const paper = record.attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot;
        const paperQuestion = this.support.findSnapshotQuestion(paper, record.questionId);
        if (!paperQuestion) continue;
        const rule = await this.support.resolveRegradeRule(ruleSource, paperQuestion, record.questionId, specifiedRule);
        if (ruleSource === RegradeRuleSource.SPECIFIED && rule?.questionId !== record.questionId) continue;
        const snapshot = rule
          ? { ...paperQuestion.snapshot, answer: rule.answerJson, scoringRule: rule.ruleJson }
          : paperQuestion.snapshot;
        const result = this.questionTypes.grade({ snapshot, answer: record.answerJson, maxScore: paperQuestion.score });
        if (result.status !== AnswerRecordStatus.AUTO_GRADED) continue;
        changedCount += Math.abs(result.score - Number(record.score)) > 0.001 ? 1 : 0;
        scoreDelta += result.score - Number(record.score);
        await this.prisma.scoringEvaluation.create({
          data: {
            answerRecordId: record.id,
            scoringRuleVersionId: rule?.id ?? paperQuestion.snapshot.scoringRuleVersionId ?? null,
            regradeRunId: run.id,
            source: ScoringEvaluationSource.REGRADE,
            status: ScoringEvaluationStatus.TRIAL,
            adapterKey: result.engine.adapterKey,
            adapterVersion: result.engine.adapterVersion,
            score: result.score,
            maxScore: result.maxScore,
            isCorrect: result.isCorrect,
            detailJson: result.details,
            ruleSnapshotJson: (snapshot.scoringRule as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
            answerFingerprint: this.scoringHistory.answerFingerprint(record.id, record.answerJson),
            gradedBy: user.id,
          },
        });
      }
      const fingerprint = this.scoringHistory.runFingerprint(records);
      const summary = {
        scannedCount: records.length,
        gradableCount: await this.prisma.scoringEvaluation.count({ where: { regradeRunId: run.id } }),
        changedCount,
        scoreDelta: Math.round((scoreDelta + Number.EPSILON) * 100) / 100,
      };
      await this.prisma.regradeRun.update({
        where: { id: run.id },
        data: { status: RegradeRunStatus.PREVIEWED, fingerprint, summaryJson: summary },
      });
      await this.audit.log({
        userId: user.id,
        action: 'grading:regrade-preview',
        module: 'grading',
        targetType: 'regrade_run',
        targetId: run.id,
        afterData: summary,
      });
      return { id: run.id, status: 'previewed', summary, expiresAt: run.expiresAt };
    } catch (error) {
      await this.prisma.regradeRun.update({
        where: { id: run.id },
        data: { status: RegradeRunStatus.FAILED, errorMessage: error instanceof Error ? error.message : '试算失败' },
      });
      throw error;
    }
  }


  async getRegradeRun(id: string, user: RequestUser) {
    const run = await this.prisma.regradeRun.findUnique({
      where: { id },
      include: { evaluations: { orderBy: { createdAt: 'asc' }, include: { answerRecord: true } } },
    });
    if (!run) throw new NotFoundException('重判任务不存在');
    await this.dataScope.assertExamAccessible(user, run.examId);
    return {
      id: run.id,
      examId: run.examId,
      status: toApiEnum(run.status),
      ruleSource: toApiEnum(run.ruleSource),
      summary: run.summaryJson ?? {},
      reason: run.reason ?? '',
      expiresAt: run.expiresAt,
      createdAt: run.createdAt,
      items: run.evaluations.map((item) => ({
        answerRecordId: item.answerRecordId,
        oldScore: Number(item.answerRecord.score),
        previewScore: Number(item.score),
        maxScore: Number(item.maxScore),
        delta: Number(item.score) - Number(item.answerRecord.score),
        details: item.detailJson,
      })),
    };
  }


  async confirmRegradeRun(id: string, user: RequestUser) {
    const run = await this.prisma.regradeRun.findUnique({
      where: { id },
      include: { evaluations: { where: { status: ScoringEvaluationStatus.TRIAL }, include: { answerRecord: true } } },
    });
    if (!run) throw new NotFoundException('重判任务不存在');
    await this.dataScope.assertExamAccessible(user, run.examId);
    if (run.status !== RegradeRunStatus.PREVIEWED) throw new BadRequestException('只有已完成试算的任务可以确认');
    if (run.expiresAt <= new Date()) {
      await this.prisma.regradeRun.update({ where: { id }, data: { status: RegradeRunStatus.EXPIRED } });
      throw new BadRequestException('试算已过期，请重新发起');
    }
    const current = await this.prisma.answerRecord.findMany({
      where: { id: { in: run.evaluations.map((item) => item.answerRecordId) } },
      orderBy: { id: 'asc' },
    });
    if (this.scoringHistory.runFingerprint(current) !== run.fingerprint) {
      throw new BadRequestException('试算后答案或成绩已发生变化，拒绝覆盖，请重新试算');
    }
    const attemptIds = [...new Set(run.evaluations.map((item) => item.answerRecord.attemptId))];
    await this.prisma.$transaction(async (tx) => {
      await tx.regradeRun.update({ where: { id }, data: { status: RegradeRunStatus.APPLYING } });
      for (const evaluation of run.evaluations) {
        await tx.scoringEvaluation.updateMany({
          where: {
            answerRecordId: evaluation.answerRecordId,
            status: ScoringEvaluationStatus.OFFICIAL,
          },
          data: { status: ScoringEvaluationStatus.SUPERSEDED },
        });
        await tx.scoringEvaluation.update({
          where: { id: evaluation.id },
          data: { status: ScoringEvaluationStatus.OFFICIAL },
        });
        await tx.answerRecord.update({
          where: { id: evaluation.answerRecordId },
          data: {
            score: evaluation.score,
            isCorrect: evaluation.isCorrect,
            status: AnswerRecordStatus.AUTO_GRADED,
            autoResultJson: evaluation.detailJson as Prisma.InputJsonValue,
            currentEvaluationId: evaluation.id,
            gradedBy: user.id,
            gradedAt: new Date(),
          },
        });
      }
      for (const attemptId of attemptIds) await this.support.recalculateAttempt(tx, attemptId);
      await tx.regradeRun.update({
        where: { id },
        data: { status: RegradeRunStatus.APPLIED, confirmedBy: user.id, confirmedAt: new Date() },
      });
    });
    await this.audit.log({
      userId: user.id,
      action: 'grading:regrade-confirm',
      module: 'grading',
      targetType: 'regrade_run',
      targetId: id,
      afterData: { appliedCount: run.evaluations.length, attemptIds },
    });
    return { id, status: 'applied', appliedCount: run.evaluations.length };
  }


  async cancelRegradeRun(id: string, user: RequestUser) {
    const run = await this.prisma.regradeRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('重判任务不存在');
    await this.dataScope.assertExamAccessible(user, run.examId);
    if (run.status !== RegradeRunStatus.PROCESSING && run.status !== RegradeRunStatus.PREVIEWED) {
      throw new BadRequestException('当前任务状态不能取消');
    }
    await this.prisma.regradeRun.update({ where: { id }, data: { status: RegradeRunStatus.CANCELLED } });
    return { id, status: 'cancelled' };
  }

}
