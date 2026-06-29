import { Injectable, NotFoundException } from '@nestjs/common';
import { AnswerRecordStatus, MasteryStatus, Prisma, WrongQuestionSourceType } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { toApiEnum } from '../../common/utils/enum-normalizer';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryStatisticsDto } from './dto/query-statistics.dto';

@Injectable()
export class StatisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  async overview(query: QueryStatisticsDto, user: RequestUser) {
    const attemptWhere = await this.attemptWhere(query, user);
    const examWhere = await this.examWhere(query, user);
    const classWhere = await this.dataScope.classWhere(user, query.classId);
    const [courses, questions, papers, exams, attempts, pendingManual, activeWrongQuestions, classes] = await this.prisma.$transaction([
      this.prisma.course.count({ where: { deletedAt: null } }),
      this.prisma.question.count({ where: { deletedAt: null, courseId: query.courseId } }),
      this.prisma.paper.count({ where: { deletedAt: null, courseId: query.courseId } }),
      this.prisma.exam.count({
        where: examWhere,
      }),
      this.prisma.examAttempt.findMany({ where: attemptWhere, select: { totalScore: true, status: true } }),
      this.prisma.answerRecord.count({
        where: {
          status: { in: [AnswerRecordStatus.MANUAL_NEEDED, AnswerRecordStatus.JUDGE_PENDING] },
          attempt: attemptWhere,
        },
      }),
      this.prisma.wrongQuestion.count({
        where: {
          masteryStatus: { in: [MasteryStatus.UNMASTERED, MasteryStatus.REVIEWING] },
          question: { deletedAt: null, courseId: query.courseId },
        },
      }),
      this.prisma.classGroup.count({
        where: { ...classWhere, deletedAt: null, courseId: query.courseId },
      }),
    ]);
    const scores = attempts.map((attempt) => Number(attempt.totalScore));
    return {
      courses,
      questions,
      papers,
      exams,
      classes,
      submittedAttempts: attempts.length,
      pendingManual,
      activeWrongQuestions,
      averageScore: this.average(scores),
      maxScore: scores.length ? Math.max(...scores) : 0,
      minScore: scores.length ? Math.min(...scores) : 0,
      gradedCount: attempts.filter((attempt) => toApiEnum(attempt.status) === 'graded').length,
    };
  }

  async exams(query: QueryStatisticsDto, user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where = await this.examWhere(query, user);
    const scopedWhere: Prisma.ExamWhereInput = {
      ...where,
      deletedAt: null,
      id: query.examId,
      courseId: query.courseId,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.exam.findMany({
        where: scopedWhere,
        include: {
          course: { select: { name: true } },
          paper: { select: { totalScore: true } },
          attempts: {
            where: { submittedAt: { not: null } },
            select: { totalScore: true, status: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.exam.count({ where: scopedWhere }),
    ]);
    const classMap = await this.loadClassMap(items.map((item) => item.classId).filter(Boolean) as string[]);

    return {
      items: items.map((exam) => {
        const scores = exam.attempts.map((attempt) => Number(attempt.totalScore));
        return {
          examId: exam.id,
          examName: exam.name,
          courseName: exam.course.name,
          className: exam.classId ? classMap.get(exam.classId)?.name ?? '' : '公开',
          fullScore: Number(exam.paper.totalScore),
          status: toApiEnum(exam.status),
          submitCount: exam.attempts.length,
          gradedCount: exam.attempts.filter((attempt) => toApiEnum(attempt.status) === 'graded').length,
          averageScore: this.average(scores),
          maxScore: scores.length ? Math.max(...scores) : 0,
          minScore: scores.length ? Math.min(...scores) : 0,
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  async scoreDistribution(query: QueryStatisticsDto, user: RequestUser) {
    const attemptWhere = await this.attemptWhere(query, user);
    const attempts = await this.prisma.examAttempt.findMany({
      where: attemptWhere,
      include: {
        exam: {
          include: {
            paper: { select: { totalScore: true } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });
    const buckets = [
      { label: '0-59%', min: 0, max: 59, count: 0 },
      { label: '60-69%', min: 60, max: 69, count: 0 },
      { label: '70-79%', min: 70, max: 79, count: 0 },
      { label: '80-89%', min: 80, max: 89, count: 0 },
      { label: '90-100%', min: 90, max: 100, count: 0 },
    ];
    const scores = attempts.map((attempt) => Number(attempt.totalScore));
    const percents = attempts.map((attempt) => {
      const fullScore = Number(attempt.exam.paper.totalScore) || 0;
      return fullScore > 0 ? Math.min(100, Math.max(0, (Number(attempt.totalScore) / fullScore) * 100)) : 0;
    });

    for (const percent of percents) {
      const rounded = Math.floor(percent);
      const bucket = buckets.find((item) => rounded >= item.min && rounded <= item.max) ?? buckets[buckets.length - 1];
      bucket.count += 1;
    }

    const total = attempts.length;
    return {
      total,
      averageScore: this.average(scores),
      averagePercent: this.average(percents),
      buckets: buckets.map((bucket) => ({
        ...bucket,
        percent: total ? Number((bucket.count / total).toFixed(4)) : 0,
      })),
    };
  }

  async classComparison(query: QueryStatisticsDto, user: RequestUser) {
    return this.classes(query, user);
  }

  async examDetail(examId: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, examId);
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, deletedAt: null },
      include: {
        course: true,
        paper: true,
        attempts: {
          where: { submittedAt: { not: null } },
          include: { answers: true },
        },
      },
    });
    if (!exam) throw new NotFoundException('考试不存在');
    const scores = exam.attempts.map((attempt) => Number(attempt.totalScore));
    const questionStats = new Map<string, { total: number; correct: number; score: number }>();
    for (const attempt of exam.attempts) {
      for (const answer of attempt.answers) {
        const current = questionStats.get(answer.questionId) ?? { total: 0, correct: 0, score: 0 };
        current.total += 1;
        current.correct += answer.isCorrect ? 1 : 0;
        current.score += Number(answer.score);
        questionStats.set(answer.questionId, current);
      }
    }
    const questions = await this.prisma.question.findMany({
      where: { id: { in: [...questionStats.keys()] } },
      select: { id: true, title: true, type: true, difficulty: true },
    });
    const questionMap = new Map(questions.map((question) => [question.id, question]));

    return {
      examId: exam.id,
      examName: exam.name,
      courseName: exam.course.name,
      fullScore: Number(exam.paper.totalScore),
      submitCount: exam.attempts.length,
      averageScore: this.average(scores),
      maxScore: scores.length ? Math.max(...scores) : 0,
      minScore: scores.length ? Math.min(...scores) : 0,
      questionStats: [...questionStats.entries()].map(([questionId, item]) => {
        const question = questionMap.get(questionId);
        return {
          questionId,
          title: question?.title ?? questionId,
          type: question ? toApiEnum(question.type) : '',
          difficulty: question?.difficulty ?? 0,
          answerCount: item.total,
          correctRate: item.total ? Number((item.correct / item.total).toFixed(4)) : 0,
          averageScore: item.total ? Number((item.score / item.total).toFixed(2)) : 0,
        };
      }),
    };
  }

  async knowledge(query: QueryStatisticsDto, user: RequestUser) {
    const attemptWhere = await this.attemptWhere(query, user);
    const answerRecords = await this.prisma.answerRecord.findMany({
      where: {
        attempt: attemptWhere,
      },
      include: {
        question: {
          include: {
            knowledgePoints: { include: { knowledgePoint: true } },
          },
        },
      },
    });
    const map = new Map<string, { name: string; total: number; correct: number; score: number }>();
    for (const record of answerRecords) {
      for (const relation of record.question.knowledgePoints) {
        const point = relation.knowledgePoint;
        const current = map.get(point.id) ?? { name: point.name, total: 0, correct: 0, score: 0 };
        current.total += 1;
        current.correct += record.isCorrect ? 1 : 0;
        current.score += Number(record.score);
        map.set(point.id, current);
      }
    }
    return [...map.entries()].map(([knowledgePointId, item]) => ({
      knowledgePointId,
      name: item.name,
      answerCount: item.total,
      correctRate: item.total ? Number((item.correct / item.total).toFixed(4)) : 0,
      averageScore: item.total ? Number((item.score / item.total).toFixed(2)) : 0,
    }));
  }

  async knowledgeTrend(query: QueryStatisticsDto, user: RequestUser) {
    const attemptWhere = await this.attemptWhere(query, user);
    const answerRecords = await this.prisma.answerRecord.findMany({
      where: {
        attempt: attemptWhere,
        question: { deletedAt: null, courseId: query.courseId },
      },
      include: {
        attempt: { select: { submittedAt: true } },
        question: {
          include: {
            knowledgePoints: { include: { knowledgePoint: true } },
          },
        },
      },
      orderBy: { updatedAt: 'asc' },
    });
    const groups = new Map<string, { date: string; knowledgePointId: string; name: string; total: number; correct: number; score: number }>();

    for (const record of answerRecords) {
      const date = (record.attempt.submittedAt ?? record.updatedAt).toISOString().slice(0, 10);
      for (const relation of record.question.knowledgePoints) {
        const point = relation.knowledgePoint;
        const key = `${date}:${point.id}`;
        const current = groups.get(key) ?? {
          date,
          knowledgePointId: point.id,
          name: point.name,
          total: 0,
          correct: 0,
          score: 0,
        };
        current.total += 1;
        current.correct += record.isCorrect ? 1 : 0;
        current.score += Number(record.score);
        groups.set(key, current);
      }
    }

    return [...groups.values()]
      .map((item) => ({
        date: item.date,
        knowledgePointId: item.knowledgePointId,
        name: item.name,
        answerCount: item.total,
        correctRate: item.total ? Number((item.correct / item.total).toFixed(4)) : 0,
        averageScore: item.total ? Number((item.score / item.total).toFixed(2)) : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  }

  async classes(query: QueryStatisticsDto, user: RequestUser) {
    const classWhere = await this.dataScope.classWhere(user, query.classId);
    const classGroups = await this.prisma.classGroup.findMany({
      where: { ...classWhere, deletedAt: null, courseId: query.courseId },
      include: { course: true, _count: { select: { students: true } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    const attempts = await this.prisma.examAttempt.findMany({
      where: {
        submittedAt: this.submittedAtFilter(query),
        exam: { classId: { in: classGroups.map((item) => item.id) }, courseId: query.courseId },
      },
      select: {
        exam: { select: { classId: true, paper: { select: { totalScore: true } } } },
        totalScore: true,
      },
    });
    const scoreMap = new Map<string, Array<{ score: number; fullScore: number }>>();
    for (const attempt of attempts) {
      const classId = attempt.exam.classId;
      if (!classId) continue;
      const scores = scoreMap.get(classId) ?? [];
      scores.push({
        score: Number(attempt.totalScore),
        fullScore: Number(attempt.exam.paper.totalScore) || 0,
      });
      scoreMap.set(classId, scores);
    }
    return classGroups.map((item) => {
      const attempts = scoreMap.get(item.id) ?? [];
      const scores = attempts.map((attempt) => attempt.score);
      const passCount = attempts.filter((attempt) => attempt.fullScore > 0 && attempt.score / attempt.fullScore >= 0.6).length;
      return {
        classId: item.id,
        className: item.name,
        courseName: item.course?.name ?? '',
        studentCount: item._count.students,
        submitCount: scores.length,
        averageScore: this.average(scores),
        maxScore: scores.length ? Math.max(...scores) : 0,
        minScore: scores.length ? Math.min(...scores) : 0,
        passRate: attempts.length ? Number((passCount / attempts.length).toFixed(4)) : 0,
        completionRate: item._count.students ? Number((attempts.length / item._count.students).toFixed(4)) : 0,
      };
    });
  }

  async questionDiagnostics(query: QueryStatisticsDto, user: RequestUser) {
    const attemptWhere = await this.attemptWhere(query, user);
    const answerRecords = await this.prisma.answerRecord.findMany({
      where: {
        attempt: attemptWhere,
        question: { deletedAt: null, courseId: query.courseId },
      },
      include: {
        attempt: { select: { id: true, totalScore: true, durationSeconds: true } },
        question: {
          include: {
            knowledgePoints: { include: { knowledgePoint: true } },
            tags: { include: { tag: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    });
    const attemptScores = new Map<string, number>();
    for (const record of answerRecords) {
      attemptScores.set(record.attempt.id, Number(record.attempt.totalScore));
    }
    const sortedAttempts = [...attemptScores.entries()].sort((a, b) => b[1] - a[1]);
    const groupSize = sortedAttempts.length >= 4 ? Math.max(1, Math.floor(sortedAttempts.length * 0.27)) : Math.max(1, Math.ceil(sortedAttempts.length / 2));
    const topAttemptIds = new Set(sortedAttempts.slice(0, groupSize).map(([id]) => id));
    const bottomAttemptIds = new Set(sortedAttempts.slice(-groupSize).map(([id]) => id));
    const groups = new Map<string, {
      title: string;
      type: string;
      difficulty: number;
      defaultScore: number;
      knowledgePointNames: Set<string>;
      tagNames: Set<string>;
      total: number;
      correct: number;
      score: number;
      topTotal: number;
      topCorrect: number;
      bottomTotal: number;
      bottomCorrect: number;
      anomalyCount: number;
    }>();

    for (const record of answerRecords) {
      const question = record.question;
      const current = groups.get(question.id) ?? {
        title: question.title,
        type: toApiEnum(question.type),
        difficulty: question.difficulty,
        defaultScore: Number(question.defaultScore),
        knowledgePointNames: new Set(question.knowledgePoints.map((item) => item.knowledgePoint.name)),
        tagNames: new Set(question.tags.map((item) => item.tag.name)),
        total: 0,
        correct: 0,
        score: 0,
        topTotal: 0,
        topCorrect: 0,
        bottomTotal: 0,
        bottomCorrect: 0,
        anomalyCount: 0,
      };
      const score = Number(record.score);
      const isCorrect = record.isCorrect === true;
      current.total += 1;
      current.correct += isCorrect ? 1 : 0;
      current.score += score;
      if (topAttemptIds.has(record.attempt.id)) {
        current.topTotal += 1;
        current.topCorrect += isCorrect ? 1 : 0;
      }
      if (bottomAttemptIds.has(record.attempt.id)) {
        current.bottomTotal += 1;
        current.bottomCorrect += isCorrect ? 1 : 0;
      }
      if ((isCorrect && score <= 0) || (record.isCorrect === false && score > 0) || score > current.defaultScore * 1.25) {
        current.anomalyCount += 1;
      }
      groups.set(question.id, current);
    }

    return [...groups.entries()]
      .map(([questionId, item]) => {
        const correctRate = item.total ? item.correct / item.total : 0;
        const topRate = item.topTotal ? item.topCorrect / item.topTotal : 0;
        const bottomRate = item.bottomTotal ? item.bottomCorrect / item.bottomTotal : 0;
        const discrimination = Number((topRate - bottomRate).toFixed(4));
        const actualDifficulty = Number((1 + (1 - correctRate) * 4).toFixed(2));
        const difficultyDelta = Number((actualDifficulty - item.difficulty).toFixed(2));
        return {
          questionId,
          title: item.title,
          type: item.type,
          difficulty: item.difficulty,
          actualDifficulty,
          difficultyDelta,
          answerCount: item.total,
          correctRate: Number(correctRate.toFixed(4)),
          averageScore: item.total ? Number((item.score / item.total).toFixed(2)) : 0,
          discrimination,
          anomalyCount: item.anomalyCount,
          knowledgePointNames: [...item.knowledgePointNames],
          tagNames: [...item.tagNames],
          suggestion: this.diagnosticSuggestion(discrimination, difficultyDelta, item.anomalyCount),
        };
      })
      .sort((a, b) => b.anomalyCount - a.anomalyCount || a.discrimination - b.discrimination || Math.abs(b.difficultyDelta) - Math.abs(a.difficultyDelta))
      .slice(0, 100);
  }

  async wrongQuestions(query: QueryStatisticsDto, user: RequestUser) {
    const classWhere = await this.dataScope.classWhere(user, query.classId);
    const classGroups = await this.prisma.classGroup.findMany({
      where: { ...classWhere, deletedAt: null, courseId: query.courseId },
      include: { students: { select: { studentId: true } } },
    });
    const scopedStudentIds = [...new Set(classGroups.flatMap((item) => item.students.map((student) => student.studentId)))];
    const studentIdFilter = query.classId || !this.dataScope.isUnrestricted(user)
      ? scopedStudentIds
      : undefined;
    const sourceType = this.normalizeWrongSourceType(query.sourceType);
    const timeRange = this.dateRange(query);
    const questionWhere: Prisma.QuestionWhereInput = {
      deletedAt: null,
      courseId: query.courseId,
    };

    const [wrongItems, events] = await this.prisma.$transaction([
      this.prisma.wrongQuestion.findMany({
        where: {
          studentId: studentIdFilter ? { in: studentIdFilter } : undefined,
          sourceType,
          lastWrongAt: timeRange,
          question: questionWhere,
        },
        include: {
          question: {
            include: {
              course: { select: { name: true } },
              knowledgePoints: { include: { knowledgePoint: { select: { name: true } } } },
            },
          },
        },
        orderBy: [{ wrongCount: 'desc' }, { lastWrongAt: 'desc' }],
        take: 1000,
      }),
      this.prisma.wrongQuestionEvent.findMany({
        where: {
          studentId: studentIdFilter ? { in: studentIdFilter } : undefined,
          sourceType,
          eventType: { in: ['exam_wrong', 'practice_wrong', 'manual_add'] },
          happenedAt: timeRange,
          question: questionWhere,
        },
        include: {
          question: {
            include: {
              course: { select: { name: true } },
              knowledgePoints: { include: { knowledgePoint: { select: { name: true } } } },
            },
          },
        },
        orderBy: { happenedAt: 'desc' },
        take: 2000,
      }),
    ]);

    type WrongGroup = {
      questionId: string;
      title: string;
      type: string;
      difficulty: number;
      courseName: string;
      knowledgePointNames: Set<string>;
      wrongCount: number;
      eventWrongCount: number;
      studentIds: Set<string>;
      sourceCounts: Map<string, number>;
      masteryCounts: Map<string, number>;
      latestAt: Date;
    };
    const groups = new Map<string, WrongGroup>();
    const ensureGroup = (
      question: (typeof wrongItems)[number]['question'] | (typeof events)[number]['question'],
      fallbackDate: Date,
    ) => {
      const existing = groups.get(question.id);
      if (existing) return existing;
      const group: WrongGroup = {
        questionId: question.id,
        title: question.title,
        type: toApiEnum(question.type),
        difficulty: question.difficulty,
        courseName: question.course.name,
        knowledgePointNames: new Set(question.knowledgePoints.map((item) => item.knowledgePoint.name)),
        wrongCount: 0,
        eventWrongCount: 0,
        studentIds: new Set(),
        sourceCounts: new Map(),
        masteryCounts: new Map(),
        latestAt: fallbackDate,
      };
      groups.set(question.id, group);
      return group;
    };

    for (const item of wrongItems) {
      const group = ensureGroup(item.question, item.lastWrongAt);
      const source = toApiEnum(item.sourceType);
      const mastery = toApiEnum(item.masteryStatus);
      const count = Math.max(item.wrongCount, source === 'manual' ? 1 : 0);
      group.wrongCount += count;
      group.studentIds.add(item.studentId);
      group.sourceCounts.set(source, (group.sourceCounts.get(source) ?? 0) + count);
      group.masteryCounts.set(mastery, (group.masteryCounts.get(mastery) ?? 0) + 1);
      if (item.lastWrongAt > group.latestAt) group.latestAt = item.lastWrongAt;
    }

    for (const event of events) {
      const group = ensureGroup(event.question, event.happenedAt);
      const source = toApiEnum(event.sourceType);
      group.eventWrongCount += 1;
      group.studentIds.add(event.studentId);
      group.sourceCounts.set(source, (group.sourceCounts.get(source) ?? 0) + 1);
      if (event.masteryStatus) {
        const mastery = toApiEnum(event.masteryStatus);
        group.masteryCounts.set(mastery, (group.masteryCounts.get(mastery) ?? 0) + 1);
      }
      if (event.happenedAt > group.latestAt) group.latestAt = event.happenedAt;
    }

    return [...groups.values()]
      .map((group) => ({
        questionId: group.questionId,
        title: group.title,
        type: group.type,
        difficulty: group.difficulty,
        courseName: group.courseName,
        knowledgePointNames: [...group.knowledgePointNames],
        wrongCount: Math.max(group.wrongCount, group.eventWrongCount),
        studentCount: group.studentIds.size,
        latestAt: group.latestAt,
        sourceSummary: [...group.sourceCounts.entries()].map(([source, count]) => ({ source, count })),
        masterySummary: [...group.masteryCounts.entries()].map(([masteryStatus, count]) => ({ masteryStatus, count })),
      }))
      .sort((a, b) => b.wrongCount - a.wrongCount || new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime())
      .slice(0, 50);
  }

  private async attemptWhere(query: QueryStatisticsDto, user: RequestUser): Promise<Prisma.ExamAttemptWhereInput> {
    const examWhere = await this.examWhere(query, user);
    return {
      submittedAt: this.submittedAtFilter(query),
      examId: query.examId,
      exam: {
        ...examWhere,
        courseId: query.courseId,
        deletedAt: null,
      },
    };
  }

  private async examWhere(query: QueryStatisticsDto, user: RequestUser): Promise<Prisma.ExamWhereInput> {
    const scopeWhere = await this.dataScope.examWhere(user, query.classId);
    return {
      ...scopeWhere,
      deletedAt: null,
      courseId: query.courseId,
      id: query.examId,
    };
  }

  private average(scores: number[]) {
    return scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)) : 0;
  }

  private dateRange(query: QueryStatisticsDto): Prisma.DateTimeFilter | undefined {
    if (!query.startDate && !query.endDate) return undefined;
    return {
      gte: query.startDate ? new Date(query.startDate) : undefined,
      lte: query.endDate ? new Date(query.endDate) : undefined,
    };
  }

  private submittedAtFilter(query: QueryStatisticsDto): Prisma.DateTimeNullableFilter {
    return { not: null, ...this.dateRange(query) };
  }

  private diagnosticSuggestion(discrimination: number, difficultyDelta: number, anomalyCount: number) {
    const suggestions: string[] = [];
    if (discrimination < 0.15) suggestions.push('区分度偏低，建议复核题干、答案或评分规则');
    if (difficultyDelta > 1) suggestions.push('实际难度高于配置，可考虑调低分值或补充讲解');
    if (difficultyDelta < -1) suggestions.push('实际难度低于配置，可调整难度标签');
    if (anomalyCount > 0) suggestions.push('存在异常判分记录，建议抽查答卷');
    return suggestions.length ? suggestions.join('；') : '表现正常';
  }

  private normalizeWrongSourceType(value?: string): WrongQuestionSourceType | undefined {
    const map: Record<string, WrongQuestionSourceType> = {
      exam: WrongQuestionSourceType.EXAM,
      practice: WrongQuestionSourceType.PRACTICE,
      manual: WrongQuestionSourceType.MANUAL,
      ai_recommendation: WrongQuestionSourceType.AI_RECOMMENDATION,
    };
    return value ? map[value] : undefined;
  }

  private async loadClassMap(classIds: string[]) {
    if (!classIds.length) return new Map<string, { id: string; name: string }>();
    const classes = await this.prisma.classGroup.findMany({
      where: { id: { in: [...new Set(classIds)] }, deletedAt: null },
      select: { id: true, name: true },
    });
    return new Map(classes.map((item) => [item.id, item]));
  }
}
