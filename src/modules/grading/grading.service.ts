import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AnswerRecordStatus,
  AttemptStatus,
  Prisma,
  QuestionType,
  RegradeRuleSource,
  RegradeRunStatus,
  ScoringEvaluationSource,
  ScoringEvaluationStatus,
  ShowScoreMode,
} from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { toApiEnum } from '../../common/utils/enum-normalizer';
import { fieldAccess } from '../../common/security/permission-policy';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionTypeRegistry } from '../question-types/question-type-registry.service';
import { ScoringHistoryService } from '../question-types/scoring-history.service';
import { GradeAnswerDto } from './dto/grade-answer.dto';
import { BatchGradeAnswersDto } from './dto/batch-grade-answers.dto';
import { PublishGradesDto } from './dto/grade-visibility.dto';
import { QueryGradingDto } from './dto/query-grading.dto';
import { PreviewRegradeRunDto } from './dto/regrade-run.dto';

type SnapshotQuestion = {
  questionId: string;
  score: number;
  snapshot: {
    id: string;
    type: string;
    title: string;
    content: string;
    defaultScore?: number;
    analysis?: string | null;
    answer?: Prisma.JsonValue | null;
    scoringRule?: Prisma.JsonValue | null;
    scoringRuleVersionId?: string | null;
    engine?: { adapterKey?: string; adapterVersion?: number };
    options?: Array<{ id: string; optionKey: string; content: string; isCorrect?: boolean }>;
    children?: SnapshotQuestion[];
  };
};

type PaperSnapshot = {
  sections: Array<{ questions: SnapshotQuestion[] }>;
};

type ObjectiveGradingResult = {
  score: number;
  isCorrect: boolean;
  autoResult: Prisma.InputJsonObject;
};

@Injectable()
export class GradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService,
    private readonly questionTypes: QuestionTypeRegistry,
    private readonly scoringHistory: ScoringHistoryService,
  ) {}

  async list(query: QueryGradingDto, user: RequestUser) {
    const access = fieldAccess(user);
    const { page, pageSize, skip, take } = toPagination(query);
    const status = this.answerStatusWhere(query.status);
    const questionType = this.questionTypeWhere(query.questionType);
    const examScope = await this.dataScope.examWhere(user);
    const where: Prisma.AnswerRecordWhereInput = {
      status:
        status ?? {
          in: [
            AnswerRecordStatus.MANUAL_NEEDED,
            AnswerRecordStatus.MANUAL_GRADED,
            AnswerRecordStatus.JUDGE_PENDING,
            AnswerRecordStatus.JUDGE_DONE,
          ],
        },
      attempt: {
        examId: query.examId,
        userId: query.studentId,
        submittedAt: { not: null },
        exam: examScope,
      },
      question: questionType ? { type: questionType } : undefined,
      OR: query.keyword
        ? [
            { question: { title: { contains: query.keyword, mode: 'insensitive' } } },
            { attempt: { exam: { name: { contains: query.keyword, mode: 'insensitive' } } } },
          ]
        : undefined,
    };

    const [records, total] = await this.prisma.$transaction([
      this.prisma.answerRecord.findMany({
        where,
        include: {
          question: { select: { title: true, type: true } },
          attempt: {
            include: {
              exam: { include: { course: { select: { name: true } } } },
              paperInstance: true,
            },
          },
        },
        orderBy: this.orderBy(query),
        skip,
        take,
      }),
      this.prisma.answerRecord.count({ where }),
    ]);
    const userMap = await this.loadUserMap(records.map((item) => item.attempt.userId));

    return {
      items: records.map((record) => {
        const snapshot = this.findSnapshotQuestion(
          record.attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot,
          record.questionId,
        );
        const student = userMap.get(record.attempt.userId);
        return {
          id: record.id,
          attemptId: record.attemptId,
          examId: record.attempt.examId,
          examName: record.attempt.exam.name,
          courseName: record.attempt.exam.course.name,
          studentId: access.studentIdentity ? record.attempt.userId : null,
          studentName: access.studentIdentity ? student?.realName ?? student?.username ?? '学生' : '匿名学生',
          username: access.studentIdentity ? student?.username ?? '' : '',
          questionId: record.questionId,
          questionTitle: snapshot?.snapshot.title ?? record.question.title,
          questionType: this.toQuestionType(snapshot?.snapshot.type ?? record.question.type),
          maxScore: snapshot?.score ?? 0,
          score: access.score ? Number(record.score) : null,
          isCorrect: access.score ? record.isCorrect : null,
          studentAnswer: access.studentAnswer ? record.answerJson : {},
          referenceAnswer: access.referenceAnswer ? snapshot?.snapshot.answer ?? {} : {},
          options: snapshot?.snapshot.options ?? [],
          manualComment: record.manualComment ?? '',
          status: toApiEnum(record.status),
          submittedAt: record.attempt.submittedAt,
          gradedAt: record.gradedAt,
        };
      }),
      page,
      pageSize,
      total,
      _fieldAccess: access,
    };
  }

  async attemptDetail(attemptId: string, user: RequestUser) {
    const access = fieldAccess(user);
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId },
      include: {
        exam: { include: { course: true, paper: true } },
        paperInstance: true,
        answers: { orderBy: { createdAt: 'asc' }, include: { currentEvaluation: true } },
      },
    });
    if (!attempt) {
      throw new NotFoundException('答题记录不存在');
    }
    await this.dataScope.assertExamAccessible(user, attempt.examId);
    const student = await this.prisma.user.findFirst({
      where: { id: attempt.userId },
      select: { id: true, username: true, realName: true },
    });
    const answerMap = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    const paperSnapshot = attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot;

    return {
      attemptId: attempt.id,
      exam: {
        id: attempt.examId,
        name: attempt.exam.name,
        courseName: attempt.exam.course.name,
        paperName: attempt.exam.paper.name,
      },
      student: {
        id: access.studentIdentity ? attempt.userId : null,
        username: access.studentIdentity ? student?.username ?? '' : '',
        name: access.studentIdentity ? student?.realName ?? student?.username ?? '学生' : '匿名学生',
      },
      status: toApiEnum(attempt.status),
      totalScore: access.score ? Number(attempt.totalScore) : null,
      objectiveScore: access.score ? Number(attempt.objectiveScore) : null,
      subjectiveScore: access.score ? Number(attempt.subjectiveScore) : null,
      judgeScore: access.score ? Number(attempt.judgeScore) : null,
      submittedAt: attempt.submittedAt,
      questions: this.flattenSnapshot(paperSnapshot).map((paperQuestion) => {
        const answer = answerMap.get(paperQuestion.questionId);
        return {
          answerRecordId: answer?.id ?? null,
          questionId: paperQuestion.questionId,
          type: this.toQuestionType(paperQuestion.snapshot.type),
          title: paperQuestion.snapshot.title,
          content: paperQuestion.snapshot.content,
          options: paperQuestion.snapshot.options ?? [],
          referenceAnswer: access.referenceAnswer ? paperQuestion.snapshot.answer ?? {} : {},
          analysis: access.analysis ? paperQuestion.snapshot.analysis ?? '' : '',
          scoringRule: paperQuestion.snapshot.scoringRule ?? {},
          maxScore: paperQuestion.score,
          studentAnswer: access.studentAnswer ? answer?.answerJson ?? {} : {},
          score: access.score ? Number(answer?.score ?? 0) : null,
          isCorrect: access.score ? answer?.isCorrect : null,
          status: answer ? toApiEnum(answer.status) : 'missing',
          manualComment: answer?.manualComment ?? '',
          gradedAt: answer?.gradedAt,
          rubricScores: this.evaluationRubricScores(answer?.currentEvaluation?.detailJson),
        };
      }),
      _fieldAccess: access,
    };
  }

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
    if (!this.isGradableStatus(record.status)) {
      throw new BadRequestException('当前答案不是可批改题');
    }

    const snapshot = this.findSnapshotQuestion(
      record.attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot,
      record.questionId,
    );
    const maxScore = snapshot?.score ?? 0;
    const rubricResult = this.resolveRubricScore(snapshot, dto);
    const score = rubricResult?.score ?? dto.score;
    if (score === undefined) {
      throw new BadRequestException('请填写得分；配置 rubric 的题目应提交各维度评分');
    }
    if (score > maxScore) {
      throw new BadRequestException(`得分不能超过该题分值 ${maxScore}`);
    }
    const nextStatus = this.isJudgeQuestion(record.status, snapshot)
      ? AnswerRecordStatus.JUDGE_DONE
      : AnswerRecordStatus.MANUAL_GRADED;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.answerRecord.update({
        where: { id: answerRecordId },
        data: {
          score,
          isCorrect: score >= maxScore && maxScore > 0,
          status: nextStatus,
          manualComment: dto.comment?.trim() || null,
          gradedBy: user.id,
          gradedAt: new Date(),
        },
      });
      await this.scoringHistory.recordOfficial(tx, {
        answerRecordId,
        answerJson: updated.answerJson,
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
      await this.recalculateAttempt(tx, record.attemptId);
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
      if (!this.isGradableStatus(record.status)) {
        throw new BadRequestException('选中项中存在不可批改的答案，请刷新列表后重试');
      }
    }

    for (const record of records) {
      const snapshot = this.findSnapshotQuestion(
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
      await this.recalculateAttempt(tx, attemptId);
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

    return this.attemptScore(attemptId);
  }

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
      ...(await this.attemptScore(attemptId)),
      updatedCount: confirmed.appliedCount,
      regradeRunId: preview.id,
    };
  }

  async previewRegradeRun(dto: PreviewRegradeRunDto, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, dto.examId);
    const limit = Math.min(dto.limit ?? 5000, 5000);
    const ruleSource = this.toRegradeRuleSource(dto.ruleSource ?? 'snapshot');
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
        const paperQuestion = this.findSnapshotQuestion(paper, record.questionId);
        if (!paperQuestion) continue;
        const rule = await this.resolveRegradeRule(ruleSource, paperQuestion, record.questionId, specifiedRule);
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
      for (const attemptId of attemptIds) await this.recalculateAttempt(tx, attemptId);
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

  async publishGrades(examId: string, dto: PublishGradesDto, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, examId);
    const mode = this.normalizeShowScoreMode(dto.mode ?? 'after_graded');
    if (mode === ShowScoreMode.NEVER) {
      throw new BadRequestException('发布成绩不能使用 never 模式，请使用撤回接口');
    }

    const attempts = await this.prisma.examAttempt.findMany({
      where: {
        examId,
        id: dto.attemptIds?.length ? { in: [...new Set(dto.attemptIds)] } : undefined,
        userId: dto.studentIds?.length ? { in: [...new Set(dto.studentIds)] } : undefined,
        submittedAt: { not: null },
        status: { not: AttemptStatus.CANCELLED },
      },
      include: { answers: true },
    });
    if (!attempts.length) {
      throw new BadRequestException('没有可发布成绩的提交记录');
    }

    const blocked = attempts.filter((attempt) =>
      attempt.answers.some(
        (answer) =>
          answer.status === AnswerRecordStatus.MANUAL_NEEDED ||
          answer.status === AnswerRecordStatus.JUDGE_PENDING,
      ),
    );
    if (blocked.length && !dto.skipPending) {
      throw new BadRequestException({
        message: '仍有试卷存在未批改或未判题答案，不能发布成绩',
        data: {
          pendingAttemptCount: blocked.length,
          attemptIds: blocked.map((attempt) => attempt.id),
        },
      });
    }

    const publishable = attempts.filter((attempt) => !blocked.some((item) => item.id === attempt.id));
    const publishableIds = publishable.map((attempt) => attempt.id);
    await this.prisma.$transaction(async (tx) => {
      if (publishableIds.length) {
        await tx.examAttempt.updateMany({
          where: { id: { in: publishableIds } },
          data: { status: AttemptStatus.GRADED },
        });
      }
      await tx.exam.update({
        where: { id: examId },
        data: { showScoreMode: mode },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'grading:publish-grades',
      module: 'grading',
      targetType: 'exam',
      targetId: examId,
      afterData: {
        mode,
        publishableCount: publishableIds.length,
        skippedPendingCount: blocked.length,
      },
    });

    return {
      examId,
      showScoreMode: toApiEnum(mode),
      publishedAttemptCount: publishableIds.length,
      skippedPendingCount: blocked.length,
      skippedAttemptIds: blocked.map((attempt) => attempt.id),
    };
  }

  async withdrawGrades(examId: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, examId);
    await this.prisma.exam.update({
      where: { id: examId },
      data: { showScoreMode: ShowScoreMode.NEVER },
    });
    await this.audit.log({
      userId: user.id,
      action: 'grading:withdraw-grades',
      module: 'grading',
      targetType: 'exam',
      targetId: examId,
      afterData: { showScoreMode: ShowScoreMode.NEVER },
    });

    return {
      examId,
      showScoreMode: toApiEnum(ShowScoreMode.NEVER),
      withdrawn: true,
    };
  }

  private resolveRubricScore(snapshot: SnapshotQuestion | undefined, dto: GradeAnswerDto) {
    const scoringRule = this.jsonRecord(snapshot?.snapshot.scoringRule);
    const rubric = Array.isArray(scoringRule.rubric) ? scoringRule.rubric.map((item) => this.jsonRecord(item)) : [];
    if (!rubric.length) {
      if (dto.rubricScores?.length) throw new BadRequestException('该题未配置 rubric，不能提交维度评分');
      return null;
    }
    if (!dto.rubricScores?.length) throw new BadRequestException('该题已配置 rubric，必须提交各维度评分');

    const ids = rubric.map((item, index) => String(item.id ?? `criterion-${index + 1}`));
    const submitted = new Map(dto.rubricScores.map((item) => [item.criterionId, item]));
    if (new Set(dto.rubricScores.map((item) => item.criterionId)).size !== dto.rubricScores.length) {
      throw new BadRequestException('rubric 维度不能重复');
    }
    if (ids.some((id) => !submitted.has(id)) || [...submitted.keys()].some((id) => !ids.includes(id))) {
      throw new BadRequestException('rubric 维度与题目评分规则不一致');
    }

    const originalMaxima = rubric.map((item) => Math.max(0, Number(item.maxScore ?? 0)));
    const originalTotal = originalMaxima.reduce((sum, value) => sum + value, 0);
    if (originalTotal <= 0) throw new BadRequestException('rubric 维度总分必须大于 0');
    const maxScore = snapshot?.score ?? originalTotal;
    const adjustedMaxima = originalMaxima.map((value, index) =>
      index === originalMaxima.length - 1
        ? 0
        : Math.round(((value / originalTotal) * maxScore + Number.EPSILON) * 100) / 100,
    );
    adjustedMaxima[adjustedMaxima.length - 1] =
      Math.round((maxScore - adjustedMaxima.slice(0, -1).reduce((sum, value) => sum + value, 0) + Number.EPSILON) * 100) / 100;

    const dimensions = rubric.map((criterion, index) => {
      const id = ids[index];
      const item = submitted.get(id)!;
      const dimensionMax = adjustedMaxima[index];
      if (item.score > dimensionMax) {
        throw new BadRequestException(`rubric 维度“${String(criterion.name ?? id)}”得分不能超过 ${dimensionMax}`);
      }
      return {
        criterionId: id,
        name: String(criterion.name ?? id),
        score: item.score,
        maxScore: dimensionMax,
        comment: item.comment?.trim() || '',
      };
    });
    const score = Math.round((dimensions.reduce((sum, item) => sum + item.score, 0) + Number.EPSILON) * 100) / 100;
    if (dto.score !== undefined && Math.abs(dto.score - score) > 0.001) {
      throw new BadRequestException('总分必须由服务端根据 rubric 维度计算，不能手工覆盖');
    }
    return { score, details: { mode: 'rubric', dimensions } as Prisma.InputJsonObject };
  }

  private async recalculateAttempt(tx: Prisma.TransactionClient, attemptId: string) {
    const answers = await tx.answerRecord.findMany({ where: { attemptId } });
    let objectiveScore = 0;
    let subjectiveScore = 0;
    let judgeScore = 0;
    let hasManual = false;
    let hasJudge = false;

    for (const answer of answers) {
      const score = Number(answer.score);
      if (answer.status === AnswerRecordStatus.JUDGE_PENDING || answer.status === AnswerRecordStatus.JUDGE_DONE) {
        judgeScore += score;
        hasJudge ||= answer.status === AnswerRecordStatus.JUDGE_PENDING;
      } else if (answer.status === AnswerRecordStatus.MANUAL_NEEDED || answer.status === AnswerRecordStatus.MANUAL_GRADED) {
        subjectiveScore += score;
        hasManual ||= answer.status === AnswerRecordStatus.MANUAL_NEEDED;
      } else {
        objectiveScore += score;
      }
    }

    await tx.examAttempt.update({
      where: { id: attemptId },
      data: {
        objectiveScore,
        subjectiveScore,
        judgeScore,
        totalScore: objectiveScore + subjectiveScore + judgeScore,
        status: hasManual || hasJudge ? AttemptStatus.GRADING : AttemptStatus.GRADED,
      },
    });
  }

  private answerStatusWhere(value?: string): Prisma.AnswerRecordWhereInput['status'] {
    if (!value) return undefined;
    const normalized = value.replace(/-/g, '_').toLowerCase();
    if (normalized === 'all') return undefined;
    if (normalized === 'pending') {
      return { in: [AnswerRecordStatus.MANUAL_NEEDED, AnswerRecordStatus.JUDGE_PENDING] };
    }
    if (normalized === 'graded' || normalized === 'done') {
      return { in: [AnswerRecordStatus.MANUAL_GRADED, AnswerRecordStatus.JUDGE_DONE] };
    }

    const enumKey = normalized.toUpperCase() as keyof typeof AnswerRecordStatus;
    return AnswerRecordStatus[enumKey];
  }

  private questionTypeWhere(value?: string) {
    if (!value) return undefined;
    const enumKey = value.replace(/-/g, '_').toUpperCase() as keyof typeof QuestionType;
    const questionType = QuestionType[enumKey];
    if (!questionType) {
      throw new BadRequestException('题型筛选值不合法');
    }
    return questionType;
  }

  private normalizeShowScoreMode(value: string) {
    const enumKey = value.replace(/-/g, '_').toUpperCase() as keyof typeof ShowScoreMode;
    const mode = ShowScoreMode[enumKey];
    if (!mode) {
      throw new BadRequestException('成绩显示模式不合法');
    }
    return mode;
  }

  private isGradableStatus(status: AnswerRecordStatus) {
    return (
      status === AnswerRecordStatus.MANUAL_NEEDED ||
      status === AnswerRecordStatus.MANUAL_GRADED ||
      status === AnswerRecordStatus.JUDGE_PENDING ||
      status === AnswerRecordStatus.JUDGE_DONE
    );
  }

  private isJudgeQuestion(status: AnswerRecordStatus, snapshot?: SnapshotQuestion) {
    return (
      status === AnswerRecordStatus.JUDGE_PENDING ||
      status === AnswerRecordStatus.JUDGE_DONE ||
      String(snapshot?.snapshot.type ?? '').toUpperCase() === QuestionType.PROGRAMMING
    );
  }

  private orderBy(query: QueryGradingDto): Prisma.AnswerRecordOrderByWithRelationInput[] {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    if (query.sortBy === 'gradedAt') return [{ gradedAt: direction }, { updatedAt: 'desc' }];
    if (query.sortBy === 'score') return [{ score: direction }, { updatedAt: 'desc' }];
    if (query.sortBy === 'status') return [{ status: direction }, { updatedAt: 'desc' }];
    return [{ updatedAt: direction }];
  }

  private flattenSnapshot(snapshot: PaperSnapshot) {
    const flatten = (question: SnapshotQuestion): SnapshotQuestion[] => {
      const children = Array.isArray(question.snapshot.children) ? question.snapshot.children : [];
      return children.length ? children.flatMap(flatten) : [question];
    };
    return snapshot.sections.flatMap((section) => section.questions.flatMap(flatten));
  }

  private findSnapshotQuestion(snapshot: PaperSnapshot, questionId: string) {
    return this.flattenSnapshot(snapshot).find((question) => question.questionId === questionId);
  }

  private gradeObjectiveQuestion(
    paperQuestion: SnapshotQuestion,
    value: Prisma.JsonValue | undefined,
  ): ObjectiveGradingResult | null {
    const result = this.questionTypes.grade({
      snapshot: paperQuestion.snapshot,
      answer: value,
      maxScore: paperQuestion.score,
    });
    if (result.status !== AnswerRecordStatus.AUTO_GRADED || result.isCorrect === null) return null;
    return { score: result.score, isCorrect: result.isCorrect, autoResult: result.details };
  }

  private async resolveRegradeRule(
    source: RegradeRuleSource,
    paperQuestion: SnapshotQuestion,
    questionId: string,
    specified: { id: string; questionId: string; answerJson: Prisma.JsonValue; ruleJson: Prisma.JsonValue | null } | null,
  ) {
    if (source === RegradeRuleSource.SPECIFIED) return specified;
    if (source === RegradeRuleSource.LATEST) {
      return this.prisma.scoringRuleVersion.findFirst({
        where: { questionId },
        orderBy: { version: 'desc' },
      });
    }
    if (!paperQuestion.snapshot.scoringRuleVersionId) return null;
    return this.prisma.scoringRuleVersion.findUnique({
      where: { id: paperQuestion.snapshot.scoringRuleVersionId },
    });
  }

  private toRegradeRuleSource(value: string) {
    const key = value.replace(/-/g, '_').toUpperCase() as keyof typeof RegradeRuleSource;
    const source = RegradeRuleSource[key];
    if (!source) throw new BadRequestException('评分规则来源不合法');
    return source;
  }

  private async attemptScore(attemptId: string) {
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      select: {
        status: true,
        objectiveScore: true,
        subjectiveScore: true,
        judgeScore: true,
        totalScore: true,
      },
    });
    return {
      attemptId,
      status: attempt ? toApiEnum(attempt.status) : '',
      objectiveScore: Number(attempt?.objectiveScore ?? 0),
      subjectiveScore: Number(attempt?.subjectiveScore ?? 0),
      judgeScore: Number(attempt?.judgeScore ?? 0),
      totalScore: Number(attempt?.totalScore ?? 0),
    };
  }

  private async loadUserMap(userIds: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, username: true, realName: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

  private toQuestionType(value: QuestionType | string) {
    return String(value).toLowerCase();
  }

  private jsonRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
  }

  private evaluationRubricScores(value: unknown) {
    const dimensions = this.jsonRecord(value).dimensions;
    if (!Array.isArray(dimensions)) return [];
    return dimensions.map((item) => {
      const dimension = this.jsonRecord(item);
      return {
        criterionId: String(dimension.criterionId ?? ''),
        score: Number(dimension.score ?? 0),
        comment: String(dimension.comment ?? ''),
      };
    });
  }
}
