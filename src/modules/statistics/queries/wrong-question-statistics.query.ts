import { Injectable } from '@nestjs/common';
import { Prisma, WrongQuestionSourceType } from '@prisma/client';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { toApiEnum } from '../../../common/utils/enum-normalizer';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryStatisticsDto } from '../dto/query-statistics.dto';
import { WrongQuestionStatisticDto } from '../dto/statistics-response.dto';
import { StatisticsScopeService } from '../statistics-scope.service';

type QuestionDetails = {
  id: string;
  title: string;
  type: string;
  difficulty: number;
  course: { name: string };
  knowledgePoints: Array<{ knowledgePoint: { name: string } }>;
};

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

@Injectable()
export class WrongQuestionStatisticsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: StatisticsScopeService,
  ) {}

  async execute(query: QueryStatisticsDto, user: RequestUser): Promise<WrongQuestionStatisticDto[]> {
    const classWhere = await this.scope.classWhere(user, query.classId);
    const classGroups = await this.prisma.classGroup.findMany({
      where: { ...classWhere, deletedAt: null, courseId: query.courseId },
      include: { students: { select: { studentId: true } } },
    });
    const scopedStudentIds = [...new Set(
      classGroups.flatMap((item) => item.students.map((student) => student.studentId)),
    )];
    const studentIds = query.classId || !this.scope.isUnrestricted(user) ? scopedStudentIds : undefined;
    const questionWhere: Prisma.QuestionWhereInput = { deletedAt: null, courseId: query.courseId };
    const sourceType = this.normalizeSourceType(query.sourceType);
    const timeRange = this.scope.dateRange(query);

    const [wrongItems, events] = await this.prisma.$transaction([
      this.prisma.wrongQuestion.findMany({
        where: {
          studentId: studentIds ? { in: studentIds } : undefined,
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
          studentId: studentIds ? { in: studentIds } : undefined,
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
    const groups = new Map<string, WrongGroup>();

    for (const item of wrongItems) {
      const group = this.ensureGroup(groups, item.question, item.lastWrongAt);
      const source = toApiEnum(item.sourceType);
      const mastery = toApiEnum(item.masteryStatus);
      const count = Math.max(item.wrongCount, source === 'manual' ? 1 : 0);
      group.wrongCount += count;
      group.studentIds.add(item.studentId);
      this.increment(group.sourceCounts, source, count);
      this.increment(group.masteryCounts, mastery);
      if (item.lastWrongAt > group.latestAt) group.latestAt = item.lastWrongAt;
    }

    for (const event of events) {
      const group = this.ensureGroup(groups, event.question, event.happenedAt);
      const source = toApiEnum(event.sourceType);
      group.eventWrongCount += 1;
      group.studentIds.add(event.studentId);
      this.increment(group.sourceCounts, source);
      if (event.masteryStatus) this.increment(group.masteryCounts, toApiEnum(event.masteryStatus));
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
      .sort((left, right) =>
        right.wrongCount - left.wrongCount || right.latestAt.getTime() - left.latestAt.getTime())
      .slice(0, 50);
  }

  private ensureGroup(groups: Map<string, WrongGroup>, question: QuestionDetails, fallbackDate: Date) {
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
  }

  private increment(counts: Map<string, number>, key: string, value = 1) {
    counts.set(key, (counts.get(key) ?? 0) + value);
  }

  private normalizeSourceType(value?: string): WrongQuestionSourceType | undefined {
    const values: Record<string, WrongQuestionSourceType> = {
      exam: WrongQuestionSourceType.EXAM,
      practice: WrongQuestionSourceType.PRACTICE,
      manual: WrongQuestionSourceType.MANUAL,
      ai_recommendation: WrongQuestionSourceType.AI_RECOMMENDATION,
    };
    return value ? values[value] : undefined;
  }
}
