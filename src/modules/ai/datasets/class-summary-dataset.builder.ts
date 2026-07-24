import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AiSummaryType,
  AttemptStatus,
  AttendanceStatus,
  LessonRecordStatus,
  LessonSessionStatus,
  Prisma,
  UserType,
} from '@prisma/client';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { DataScopeService } from '../../data-scope/data-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { average, ratio } from '../../statistics/statistics-math';
import { assertSummaryDataset } from './dataset-validator';
import { EvidenceCollector } from './evidence-collector';
import { aggregateKnowledgePoints, type StudentAnswerFact } from './student-summary-aggregates';
import type { ClassSummaryDataset } from './summary-dataset';
import { AiDataPermissionService } from '../ai-data-permission.service';
import {
  normalizeRecentExamCount,
  normalizeSummaryDomains,
  type SummaryDataDomain,
} from './summary-scope';

export type ClassSummaryScopeInput = {
  classId: string;
  from?: string;
  to?: string;
  summaryDomains?: SummaryDataDomain[];
  recentExamCount?: number;
};

@Injectable()
export class ClassSummaryDatasetBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly aiDataPermissions: AiDataPermissionService,
  ) {}

  async build(input: ClassSummaryScopeInput, user: RequestUser): Promise<ClassSummaryDataset> {
    this.assertStaff(user);
    const summaryDomains = normalizeSummaryDomains(input.summaryDomains);
    await this.aiDataPermissions.assertSummaryAllowed(AiSummaryType.CLASS, user, summaryDomains);
    await this.dataScope.assertAcademicClassAccessible(user, input.classId);
    const range = this.range(input);
    const recentExamCount = normalizeRecentExamCount(input.recentExamCount);
    const classGroup = await this.prisma.classGroup.findFirst({
      where: { id: input.classId, deletedAt: null, status: 'active' },
      select: {
        id: true,
        name: true,
        course: { select: { name: true } },
        _count: { select: { students: { where: { status: 'ACTIVE' } } } },
      },
    });
    if (!classGroup) throw new NotFoundException('班级不存在');

    const [exams, sessions] = await Promise.all([
      summaryDomains.includes('exams') ? this.prisma.exam.findMany({
        where: { classId: input.classId, deletedAt: null, ...(range.filter ? { endTime: range.filter } : {}) },
        orderBy: [{ endTime: 'desc' }, { id: 'desc' }],
        ...(recentExamCount ? { take: recentExamCount } : {}),
        select: {
          id: true,
          attempts: {
            where: { submittedAt: { not: null } },
            select: {
              status: true,
              totalScore: true,
              answers: {
                select: {
                  score: true,
                  isCorrect: true,
                  currentEvaluation: { select: { maxScore: true } },
                  question: {
                    select: {
                      type: true,
                      defaultScore: true,
                      knowledgePoints: { select: { knowledgePoint: { select: { id: true, name: true } } } },
                    },
                  },
                },
              },
            },
          },
        },
      }) : Promise.resolve([]),
      summaryDomains.includes('lessons') || summaryDomains.includes('homework') ? this.prisma.lessonSession.findMany({
        where: { classId: input.classId, ...(range.filter ? { startsAt: range.filter } : {}) },
        select: {
          id: true,
          status: true,
          lessonHours: true,
          lessonRecord: { select: { id: true, status: true, publicHomework: true } },
          attendance: {
            where: { confirmedAt: { not: null } },
            select: { status: true },
          },
        },
      }) : Promise.resolve([]),
    ]);
    return this.dataset(classGroup, exams, sessions, range, summaryDomains, recentExamCount);
  }

  private dataset(
    classGroup: ClassRow,
    exams: ExamRow[],
    sessions: SessionRow[],
    range: NormalizedRange,
    summaryDomains: SummaryDataDomain[],
    recentExamCount?: number,
  ): ClassSummaryDataset {
    const generatedAt = new Date().toISOString();
    const evidence = new EvidenceCollector(generatedAt);
    const gradedAttempts = exams.flatMap((exam) => exam.attempts)
      .filter((attempt) => attempt.status === AttemptStatus.GRADED);
    const answerFacts: StudentAnswerFact[] = gradedAttempts.flatMap((attempt) => attempt.answers.map((answer) => ({
      type: answer.question.type.toLowerCase(),
      score: Number(answer.score),
      maxScore: Number(answer.currentEvaluation?.maxScore ?? answer.question.defaultScore),
      isCorrect: answer.isCorrect,
      knowledgePoints: answer.question.knowledgePoints.map((item) => item.knowledgePoint),
    })));
    const knowledgePoints = aggregateKnowledgePoints(answerFacts);
    const attendance = sessions.flatMap((session) => session.attendance);
    const attendanceCount = (status: AttendanceStatus) => attendance.filter((item) => item.status === status).length;
    const attendedStatuses = new Set<AttendanceStatus>([
      AttendanceStatus.PRESENT,
      AttendanceStatus.LATE,
      AttendanceStatus.EARLY_LEAVE,
      AttendanceStatus.MAKEUP,
    ]);
    const publishedRecords = sessions.filter((session) => session.lessonRecord?.status === LessonRecordStatus.PUBLISHED);
    const completed = sessions.filter((session) => session.status === LessonSessionStatus.COMPLETED);
    const homeworkCount = publishedRecords.filter((session) => session.lessonRecord?.publicHomework?.trim()).length;
    const value = (metric: string, current: number, unit: string) => evidence.collect({
      sourceType: 'class', sourceId: classGroup.id, metric,
      path: `/classes/${classGroup.id}/summary/${metric}`, value: current, unit,
    });
    const dataset: ClassSummaryDataset = {
      type: 'class',
      datasetVersion: 'class-summary/v2',
      generatedAt,
      dataCoverage: {
        from: range.from?.toISOString() ?? null,
        to: range.to?.toISOString() ?? null,
        includes: [
          'class_aggregate_only',
          ...(summaryDomains.includes('exams') ? ['graded_exam_scores', 'knowledge_point_aggregate'] : []),
          ...(summaryDomains.includes('lessons') ? ['confirmed_attendance', 'lesson_sessions'] : []),
          ...(summaryDomains.includes('homework') ? ['published_homework_assignments'] : []),
        ],
        excludes: [
          'student_names', 'student_ids', 'individual_answers', 'ungraded_scores',
          'internal_teaching_notes', 'parent_data',
          ...(['exams', 'lessons', 'homework'] as SummaryDataDomain[])
            .filter((domain) => !summaryDomains.includes(domain))
            .map((domain) => `not_selected_${domain}`),
        ],
      },
      class: { id: classGroup.id, alias: classGroup.name, courseName: classGroup.course?.name ?? '未关联课程' },
      scope: { summaryDomains, recentExamCount: recentExamCount ?? null },
      coverage: {
        studentCount: value('studentCount', classGroup._count.students, 'student'),
        examCount: value('examCount', exams.length, 'exam'),
        gradedAttemptCount: value('gradedAttemptCount', gradedAttempts.length, 'attempt'),
        lessonCount: value('lessonCount', sessions.length, 'lesson'),
        publishedLessonRecordCount: value('publishedLessonRecordCount', publishedRecords.length, 'lesson_record'),
        homeworkAssignmentCount: value('homeworkAssignmentCount', homeworkCount, 'homework'),
      },
      assessment: {
        averageScore: value('assessment.averageScore', average(gradedAttempts.map((item) => Number(item.totalScore))), 'score'),
        knowledgePoints: knowledgePoints.map((item) => ({
          knowledgePointId: item.id,
          name: item.name,
          answerCount: this.knowledgeValue(evidence, item.id, classGroup.id, 'answerCount', item.answerCount, 'answer'),
          correctRate: this.knowledgeValue(evidence, item.id, classGroup.id, 'correctRate', item.correctRate, 'ratio'),
          scoreRate: this.knowledgeValue(evidence, item.id, classGroup.id, 'scoreRate', item.scoreRate, 'ratio'),
        })),
      },
      attendance: {
        confirmedCount: value('attendance.confirmedCount', attendance.length, 'attendance'),
        presentCount: value('attendance.presentCount', attendanceCount(AttendanceStatus.PRESENT), 'attendance'),
        lateCount: value('attendance.lateCount', attendanceCount(AttendanceStatus.LATE), 'attendance'),
        leaveCount: value('attendance.leaveCount', attendanceCount(AttendanceStatus.LEAVE), 'attendance'),
        absentCount: value('attendance.absentCount', attendanceCount(AttendanceStatus.ABSENT), 'attendance'),
        attendanceRate: value(
          'attendance.attendanceRate',
          ratio(attendance.filter((item) => attendedStatuses.has(item.status)).length, attendance.length),
          'ratio',
        ),
      },
      lessons: {
        completedCount: value('lessons.completedCount', completed.length, 'lesson'),
        completedHours: value(
          'lessons.completedHours',
          Number(completed.reduce((sum, item) => sum + Number(item.lessonHours), 0).toFixed(2)),
          'hour',
        ),
        publishedRecordCount: value('lessons.publishedRecordCount', publishedRecords.length, 'lesson_record'),
        homeworkAssignmentCount: value('lessons.homeworkAssignmentCount', homeworkCount, 'homework'),
      },
      evidenceIndex: evidence.index,
    };
    assertSummaryDataset(dataset);
    return dataset;
  }

  private knowledgeValue(
    evidence: EvidenceCollector,
    knowledgePointId: string,
    classId: string,
    metric: string,
    value: number,
    unit: string,
  ) {
    return evidence.collect({
      sourceType: 'knowledge_point', sourceId: knowledgePointId, metric: `class.${classId}.${metric}`,
      path: `/classes/${classId}/knowledge-points/${knowledgePointId}/${metric}`, value, unit,
    });
  }

  private range(input: Pick<ClassSummaryScopeInput, 'from' | 'to'>): NormalizedRange {
    const from = input.from ? new Date(input.from) : undefined;
    const to = input.to ? new Date(input.to) : undefined;
    if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))) {
      throw new BadRequestException('时间范围格式无效');
    }
    if (from && to && from > to) throw new BadRequestException('开始时间不能晚于结束时间');
    return {
      from,
      to,
      filter: from || to ? { gte: from, lte: to } : undefined,
    };
  }

  private assertStaff(user: RequestUser) {
    if (user.userType === UserType.STUDENT || user.userType === UserType.PARENT) {
      throw new ForbiddenException('无权限生成班级总结');
    }
  }
}

type NormalizedRange = { from?: Date; to?: Date; filter?: Prisma.DateTimeFilter };
type ClassRow = Prisma.ClassGroupGetPayload<{
  select: { id: true; name: true; course: { select: { name: true } }; _count: { select: { students: true } } };
}>;
type ExamRow = Prisma.ExamGetPayload<{
  select: {
    id: true;
    attempts: {
      select: {
        status: true;
        totalScore: true;
        answers: {
          select: {
            score: true;
            isCorrect: true;
            currentEvaluation: { select: { maxScore: true } };
            question: {
              select: {
                type: true;
                defaultScore: true;
                knowledgePoints: { select: { knowledgePoint: { select: { id: true; name: true } } } };
              };
            };
          };
        };
      };
    };
  };
}>;
type SessionRow = Prisma.LessonSessionGetPayload<{
  select: {
    id: true;
    status: true;
    lessonHours: true;
    lessonRecord: { select: { id: true; status: true; publicHomework: true } };
    attendance: { select: { status: true } };
  };
}>;
