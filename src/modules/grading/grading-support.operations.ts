import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AnswerRecordStatus,
  AttemptStatus,
  Prisma,
  QuestionType,
  RegradeRuleSource,
  ShowScoreMode,
} from '@prisma/client';
import { toApiEnum } from '../../common/utils/enum-normalizer';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionTypeRegistry } from '../question-types/question-type-registry.service';
import { GradeAnswerDto } from './dto/grade-answer.dto';
import { QueryGradingDto } from './dto/query-grading.dto';


export type SnapshotQuestion = {
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

export type PaperSnapshot = {
  sections: Array<{ questions: SnapshotQuestion[] }>;
};


@Injectable()
export class GradingSupportOperations {
  constructor(
    readonly prisma: PrismaService,
    readonly questionTypes: QuestionTypeRegistry,
  ) {}

  resolveRubricScore(snapshot: SnapshotQuestion | undefined, dto: GradeAnswerDto) {
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


  async recalculateAttempt(tx: Prisma.TransactionClient, attemptId: string) {
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


  answerStatusWhere(value?: string): Prisma.AnswerRecordWhereInput['status'] {
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


  questionTypeWhere(value?: string) {
    if (!value) return undefined;
    const enumKey = value.replace(/-/g, '_').toUpperCase() as keyof typeof QuestionType;
    const questionType = QuestionType[enumKey];
    if (!questionType) {
      throw new BadRequestException('题型筛选值不合法');
    }
    return questionType;
  }


  normalizeShowScoreMode(value: string) {
    const enumKey = value.replace(/-/g, '_').toUpperCase() as keyof typeof ShowScoreMode;
    const mode = ShowScoreMode[enumKey];
    if (!mode) {
      throw new BadRequestException('成绩显示模式不合法');
    }
    return mode;
  }


  isGradableStatus(status: AnswerRecordStatus) {
    return (
      status === AnswerRecordStatus.MANUAL_NEEDED ||
      status === AnswerRecordStatus.MANUAL_GRADED ||
      status === AnswerRecordStatus.JUDGE_PENDING ||
      status === AnswerRecordStatus.JUDGE_DONE
    );
  }


  isJudgeQuestion(status: AnswerRecordStatus, snapshot?: SnapshotQuestion) {
    return (
      status === AnswerRecordStatus.JUDGE_PENDING ||
      status === AnswerRecordStatus.JUDGE_DONE ||
      String(snapshot?.snapshot.type ?? '').toUpperCase() === QuestionType.PROGRAMMING
    );
  }


  orderBy(query: QueryGradingDto): Prisma.AnswerRecordOrderByWithRelationInput[] {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    if (query.sortBy === 'gradedAt') return [{ gradedAt: direction }, { updatedAt: 'desc' }];
    if (query.sortBy === 'score') return [{ score: direction }, { updatedAt: 'desc' }];
    if (query.sortBy === 'status') return [{ status: direction }, { updatedAt: 'desc' }];
    return [{ updatedAt: direction }];
  }


  flattenSnapshot(snapshot: PaperSnapshot) {
    const flatten = (question: SnapshotQuestion): SnapshotQuestion[] => {
      const children = Array.isArray(question.snapshot.children) ? question.snapshot.children : [];
      return children.length ? children.flatMap(flatten) : [question];
    };
    return snapshot.sections.flatMap((section) => section.questions.flatMap(flatten));
  }


  findSnapshotQuestion(snapshot: PaperSnapshot, questionId: string) {
    return this.flattenSnapshot(snapshot).find((question) => question.questionId === questionId);
  }


  async resolveRegradeRule(
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


  toRegradeRuleSource(value: string) {
    const key = value.replace(/-/g, '_').toUpperCase() as keyof typeof RegradeRuleSource;
    const source = RegradeRuleSource[key];
    if (!source) throw new BadRequestException('评分规则来源不合法');
    return source;
  }


  async attemptScore(attemptId: string) {
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


  async loadUserMap(userIds: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, username: true, realName: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }


  toQuestionType(value: QuestionType | string) {
    return String(value).toLowerCase();
  }


  jsonRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }


  evaluationRubricScores(value: unknown) {
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
