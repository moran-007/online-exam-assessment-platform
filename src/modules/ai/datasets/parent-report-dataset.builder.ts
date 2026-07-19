import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
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

export type ParentReportScopeInput = {
  studentId: string;
  from?: string;
  to?: string;
};

@Injectable()
export class ParentReportDatasetBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  async build(input: ParentReportScopeInput, user: RequestUser): Promise<ParentReportDataset> {
    this.assertStaff(user);
    await this.dataScope.assertStudentSummaryAccessible(user, input.studentId);
    const range = this.range(input);
    const student = await this.prisma.user.findFirst({
      where: {
        id: input.studentId,
        userType: UserType.STUDENT,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('学生不存在');

    const [attempts, sessions] = await Promise.all([
      this.prisma.examAttempt.findMany({
        where: {
          studentId: student.id,
          submittedAt: { not: null, ...(range.filter ?? {}) },
          exam: { deletedAt: null },
        },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        distinct: ['examId'],
        take: 20,
        select: {
          id: true,
          status: true,
          totalScore: true,
          submittedAt: true,
          exam: { select: { id: true, name: true, showScoreMode: true, endTime: true } },
        },
      }),
      this.prisma.lessonSession.findMany({
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
        take: 50,
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
      }),
    ]);
    return this.dataset(student.id, attempts, sessions, range);
  }

  private dataset(
    studentId: string,
    attempts: ParentAttempt[],
    sessions: ParentSession[],
    range: NormalizedRange,
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
      datasetVersion: 'parent-report/v1',
      generatedAt,
      dataCoverage: {
        from: range.from?.toISOString() ?? null,
        to: range.to?.toISOString() ?? null,
        includes: [
          'submitted_exams_with_score_visibility_policy', 'confirmed_attendance',
          'published_learning_goals', 'published_class_performance',
          'published_homework', 'published_next_plan',
        ],
        excludes: [
          'hidden_exam_scores', 'unpublished_lesson_records', 'internal_teaching_notes',
          'internal_class_performance', 'student_answer_text', 'other_students',
        ],
      },
      student: { id: studentId, alias: '该学生' },
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
