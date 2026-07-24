import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AiSummaryType,
  AttendanceStatus,
  ClassMemberStatus,
  LessonRecordStatus,
  Prisma,
  UserStatus,
  UserType,
} from '@prisma/client';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { DataScopeService } from '../../data-scope/data-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { assertSummaryDataset } from './dataset-validator';
import { EvidenceCollector } from './evidence-collector';
import { isLearnerScoreVisible } from './learner-visibility';
import type { ParentReportDataset } from './summary-dataset';
import { AiDataPermissionService } from '../ai-data-permission.service';
import {
  normalizeRecentExamCount,
  normalizeSummaryDomains,
  type SummaryDataDomain,
} from './summary-scope';

export type ParentReportScopeInput = {
  studentId: string;
  from?: string;
  to?: string;
  summaryDomains?: SummaryDataDomain[];
  recentExamCount?: number;
};

@Injectable()
export class ParentReportDatasetBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly aiDataPermissions: AiDataPermissionService,
  ) {}

  async build(input: ParentReportScopeInput, user: RequestUser): Promise<ParentReportDataset> {
    this.assertStaff(user);
    const summaryDomains = normalizeSummaryDomains(input.summaryDomains);
    const recentExamCount = normalizeRecentExamCount(input.recentExamCount);
    await this.aiDataPermissions.assertSummaryAllowed(AiSummaryType.PARENT_REPORT, user, summaryDomains);
    await this.dataScope.assertStudentSummaryAccessible(user, input.studentId);
    const range = this.range(input);
    const student = await this.prisma.user.findFirst({
      where: {
        id: input.studentId,
        userType: UserType.STUDENT,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: { id: true, realName: true, username: true },
    });
    if (!student) throw new NotFoundException('学生不存在');

    const [attempts, sessions] = await Promise.all([
      summaryDomains.includes('exams') ? this.prisma.examAttempt.findMany({
        where: {
          studentId: student.id,
          submittedAt: { not: null, ...(range.filter ?? {}) },
          exam: { deletedAt: null },
        },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          status: true,
          totalScore: true,
          submittedAt: true,
          exam: { select: { id: true, name: true, showScoreMode: true, endTime: true } },
        },
      }) : Promise.resolve([]),
      summaryDomains.includes('lessons') || summaryDomains.includes('homework') ? this.prisma.lessonSession.findMany({
        where: {
          ...(range.filter ? { startsAt: range.filter } : {}),
          classGroup: {
            deletedAt: null,
            students: { some: { studentId: student.id, status: ClassMemberStatus.ACTIVE } },
          },
          OR: [
            { lessonRecord: { status: LessonRecordStatus.PUBLISHED } },
            { attendance: { some: { studentId: student.id, confirmedAt: { not: null } } } },
          ],
        },
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          title: true,
          startsAt: true,
          attendance: {
            where: { studentId: student.id, confirmedAt: { not: null } },
            select: { id: true, status: true },
          },
          lessonRecord: {
            select: {
              id: true,
              status: true,
              publicLearningGoal: true,
              publicClassPerformance: true,
              publicHomework: true,
              publicNextPlan: true,
            },
          },
        },
      }) : Promise.resolve([]),
    ]);
    const selectedAttempts = this.recentExamAttempts(attempts, recentExamCount);
    const canUseStudentName = await this.aiDataPermissions.isAllowed('student_identity', user);
    return this.dataset(
      student.id,
      canUseStudentName ? (student.realName?.trim() || student.username) : '该学生',
      selectedAttempts,
      sessions,
      range,
      summaryDomains,
      recentExamCount,
    );
  }

  private dataset(
    studentId: string,
    studentAlias: string,
    attempts: ParentAttempt[],
    sessions: ParentSession[],
    range: NormalizedRange,
    summaryDomains: SummaryDataDomain[],
    recentExamCount?: number,
  ): ParentReportDataset {
    const generatedAt = new Date().toISOString();
    const evidence = new EvidenceCollector(generatedAt);
    const attendance = sessions.flatMap((session) => session.attendance);
    const published = sessions.filter((session) => session.lessonRecord?.status === LessonRecordStatus.PUBLISHED);
    const studentValue = (metric: string, value: number, unit: string) => evidence.collect({
      sourceType: 'student', sourceId: studentId, metric,
      path: `/students/${studentId}/parent-report/${metric}`, value, unit,
    });
    const attendanceCount = (status: AttendanceStatus) => attendance.filter((item) => item.status === status).length;
    const dataset: ParentReportDataset = {
      type: 'parent_report',
      datasetVersion: 'parent-report/v2',
      generatedAt,
      dataCoverage: {
        from: range.from?.toISOString() ?? null,
        to: range.to?.toISOString() ?? null,
        includes: [
          ...(summaryDomains.includes('exams') ? ['submitted_exams_with_score_visibility_policy'] : []),
          ...(summaryDomains.includes('lessons') ? [
            'confirmed_attendance', 'published_learning_goals', 'published_class_performance', 'published_next_plan',
          ] : []),
          ...(summaryDomains.includes('homework') ? ['published_homework'] : []),
        ],
        excludes: [
          'hidden_exam_scores', 'unpublished_lesson_records', 'internal_teaching_notes',
          'internal_class_performance', 'student_answer_text', 'other_students',
          ...(['exams', 'lessons', 'homework'] as SummaryDataDomain[])
            .filter((domain) => !summaryDomains.includes(domain))
            .map((domain) => `not_selected_${domain}`),
        ],
      },
      student: { id: studentId, alias: studentAlias },
      scope: { summaryDomains, recentExamCount: recentExamCount ?? null },
      coverage: {
        visibleExamCount: studentValue('visibleExamCount', attempts.length, 'exam'),
        publishedLessonRecordCount: studentValue('publishedLessonRecordCount', published.length, 'lesson_record'),
        confirmedAttendanceCount: studentValue('confirmedAttendanceCount', attendance.length, 'attendance'),
      },
      exams: attempts.map((attempt) => {
        const visible = isLearnerScoreVisible(
          attempt.exam.showScoreMode,
          attempt.status,
          attempt.submittedAt,
          attempt.exam.endTime,
        );
        return {
          attemptId: attempt.id,
          examId: attempt.exam.id,
          examName: attempt.exam.name,
          submittedAt: (attempt.submittedAt as Date).toISOString(),
          score: evidence.collect({
            sourceType: 'exam_attempt', sourceId: attempt.id, metric: 'parentVisibleScore',
            path: `/students/${studentId}/parent-report/exams/${attempt.exam.id}/score`,
            value: visible ? Number(attempt.totalScore) : null, unit: 'score',
          }),
          scoreVisible: evidence.collect({
            sourceType: 'exam_attempt', sourceId: attempt.id, metric: 'scoreVisible',
            path: `/students/${studentId}/parent-report/exams/${attempt.exam.id}/scoreVisible`,
            value: visible, unit: 'boolean',
          }),
        };
      }),
      attendance: {
        presentCount: studentValue('attendance.presentCount', attendanceCount(AttendanceStatus.PRESENT), 'attendance'),
        lateCount: studentValue('attendance.lateCount', attendanceCount(AttendanceStatus.LATE), 'attendance'),
        leaveCount: studentValue('attendance.leaveCount', attendanceCount(AttendanceStatus.LEAVE), 'attendance'),
        absentCount: studentValue('attendance.absentCount', attendanceCount(AttendanceStatus.ABSENT), 'attendance'),
      },
      publishedLessons: published.map((session) => ({
        sessionId: session.id,
        title: session.title,
        startsAt: session.startsAt.toISOString(),
        learningGoal: this.recordValue(evidence, studentId, session, 'learningGoal', session.lessonRecord?.publicLearningGoal ?? null),
        classPerformance: this.recordValue(evidence, studentId, session, 'classPerformance', session.lessonRecord?.publicClassPerformance ?? null),
        homework: this.recordValue(evidence, studentId, session, 'homework', session.lessonRecord?.publicHomework ?? null),
        nextPlan: this.recordValue(evidence, studentId, session, 'nextPlan', session.lessonRecord?.publicNextPlan ?? null),
      })),
      evidenceIndex: evidence.index,
    };
    assertSummaryDataset(dataset);
    return dataset;
  }

  private recentExamAttempts(attempts: ParentAttempt[], count?: number) {
    if (!count) return attempts;
    const selectedExamIds: string[] = [];
    for (const attempt of attempts) {
      if (!selectedExamIds.includes(attempt.exam.id)) selectedExamIds.push(attempt.exam.id);
      if (selectedExamIds.length === count) break;
    }
    const selected = new Set(selectedExamIds);
    return attempts.filter((attempt) => selected.has(attempt.exam.id));
  }

  private recordValue(
    evidence: EvidenceCollector,
    studentId: string,
    session: ParentSession,
    metric: string,
    value: string | null,
  ) {
    return evidence.collect({
      sourceType: 'lesson_record', sourceId: session.lessonRecord!.id, metric,
      path: `/students/${studentId}/parent-report/lessons/${session.id}/${metric}`,
      value, unit: 'text',
    });
  }

  private range(input: Pick<ParentReportScopeInput, 'from' | 'to'>): NormalizedRange {
    const from = input.from ? new Date(input.from) : undefined;
    const to = input.to ? new Date(input.to) : undefined;
    if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))) {
      throw new BadRequestException('时间范围格式无效');
    }
    if (from && to && from > to) throw new BadRequestException('开始时间不能晚于结束时间');
    return { from, to, filter: from || to ? { gte: from, lte: to } : undefined };
  }

  private assertStaff(user: RequestUser) {
    if (user.userType === UserType.STUDENT || user.userType === UserType.PARENT) {
      throw new ForbiddenException('家长报告必须由教师或管理员生成并审核');
    }
  }
}

type NormalizedRange = { from?: Date; to?: Date; filter?: Prisma.DateTimeFilter };
type ParentAttempt = Prisma.ExamAttemptGetPayload<{
  select: {
    id: true;
    status: true;
    totalScore: true;
    submittedAt: true;
    exam: { select: { id: true; name: true; showScoreMode: true; endTime: true } };
  };
}>;
type ParentSession = Prisma.LessonSessionGetPayload<{
  select: {
    id: true;
    title: true;
    startsAt: true;
    attendance: { select: { id: true; status: true } };
    lessonRecord: {
      select: {
        id: true;
        status: true;
        publicLearningGoal: true;
        publicClassPerformance: true;
        publicHomework: true;
        publicNextPlan: true;
      };
    };
  };
}>;
