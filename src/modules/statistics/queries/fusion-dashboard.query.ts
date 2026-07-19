import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AnswerRecordStatus,
  AttendanceStatus,
  LessonHourLedgerType,
  LessonRecordStatus,
  LessonSessionStatus,
  MasteryStatus,
  Prisma,
  UserType,
} from '@prisma/client';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { toApiEnum } from '../../../common/utils/enum-normalizer';
import { DataScopeService } from '../../data-scope/data-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FusionDashboardDto,
  FusionDashboardQueryDto,
  FusionRecentExamDto,
  TeacherPerformanceDto,
} from '../dto/fusion-dashboard.dto';
import { average, ratio } from '../statistics-math';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 366 * DAY_MS;

@Injectable()
export class FusionDashboardQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  async execute(query: FusionDashboardQueryDto, user: RequestUser): Promise<FusionDashboardDto> {
    const range = this.range(query);
    const scope = await this.resolveScope(query, user);
    const sessionWhere = this.sessionWhere(scope.classIds, range);
    const attemptWhere = await this.attemptWhere(scope, range, user);
    const attendanceWhere: Prisma.AttendanceRecordWhereInput = {
      session: sessionWhere,
      confirmedAt: { not: null },
      ...(scope.studentIds === null ? {} : { studentId: { in: scope.studentIds } }),
    };
    const ledgerScope: Prisma.LessonHourLedgerWhereInput = {
      ...(scope.classIds === null ? {} : { classId: { in: scope.classIds } }),
      ...(scope.studentIds === null ? {} : { studentId: { in: scope.studentIds } }),
    };

    const [sessions, attempts, pendingManual, activeWrongQuestions, attendance, periodLedger, allLedger] = await Promise.all([
      this.prisma.lessonSession.findMany({
        where: sessionWhere,
        select: {
          id: true, status: true, lessonHours: true, teacherId: true,
          teacher: { select: { realName: true, username: true } },
          lessonRecord: { select: { status: true } },
          _count: { select: { attendance: { where: { confirmedAt: { not: null } } } } },
        },
      }),
      this.prisma.examAttempt.findMany({
        where: attemptWhere,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        take: 200,
        select: {
          id: true, status: true, totalScore: true, submittedAt: true,
          exam: {
            select: {
              id: true, name: true, status: true,
              course: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.answerRecord.count({
        where: {
          status: { in: [AnswerRecordStatus.MANUAL_NEEDED, AnswerRecordStatus.JUDGE_PENDING] },
          attempt: attemptWhere,
        },
      }),
      this.prisma.wrongQuestion.count({
        where: {
          masteryStatus: { in: [MasteryStatus.UNMASTERED, MasteryStatus.REVIEWING] },
          ...(scope.studentIds === null ? {} : { studentId: { in: scope.studentIds } }),
        },
      }),
      this.prisma.attendanceRecord.findMany({ where: attendanceWhere, select: { status: true } }),
      this.prisma.lessonHourLedger.findMany({
        where: { ...ledgerScope, createdAt: { gte: range.from, lte: range.to } },
        select: { type: true, amount: true },
      }),
      this.prisma.lessonHourLedger.findMany({ where: ledgerScope, select: { amount: true } }),
    ]);

    const gradedAttempts = attempts.filter((attempt) => toApiEnum(attempt.status) === 'graded');
    const confirmedAttendance = attendance.length;
    const attendedStatuses = new Set<AttendanceStatus>([
      AttendanceStatus.PRESENT,
      AttendanceStatus.LATE,
      AttendanceStatus.EARLY_LEAVE,
      AttendanceStatus.MAKEUP,
    ]);
    const attended = attendance.filter((item) => attendedStatuses.has(item.status)).length;
    const consumptionTypes = new Set<LessonHourLedgerType>([
      LessonHourLedgerType.CONSUME,
      LessonHourLedgerType.REVERSAL,
    ]);
    const consumed = periodLedger
      .filter((entry) => consumptionTypes.has(entry.type))
      .reduce((sum, entry) => sum + Number(entry.amount), 0);

    return {
      role: scope.role,
      scopeLabel: scope.scopeLabel,
      from: range.from,
      to: range.to,
      assessment: {
        exams: new Set(attempts.map((attempt) => attempt.exam.id)).size,
        submittedAttempts: attempts.length,
        gradedAttempts: gradedAttempts.length,
        averageScore: average(gradedAttempts.map((attempt) => Number(attempt.totalScore))),
        pendingManual,
        activeWrongQuestions,
      },
      academic: {
        scheduledLessons: sessions.filter((session) => session.status !== LessonSessionStatus.CANCELLED).length,
        completedLessons: sessions.filter((session) => session.status === LessonSessionStatus.COMPLETED).length,
        publishedLessonRecords: sessions.filter((session) => session.lessonRecord?.status === LessonRecordStatus.PUBLISHED).length,
        confirmedAttendance,
        attendanceRate: ratio(attended, confirmedAttendance),
        absentCount: attendance.filter((item) => item.status === AttendanceStatus.ABSENT).length,
        assignedLessonHours: this.sum(sessions.map((session) => session.lessonHours)),
        consumedLessonHours: Number(Math.max(0, -consumed).toFixed(2)),
        remainingLessonHours: this.sum(allLedger.map((entry) => entry.amount)),
      },
      recentExams: this.recentExams(attempts),
      teacherPerformance: scope.showTeacherPerformance ? this.teacherPerformance(sessions) : [],
      drilldowns: this.drilldowns(range, scope.role),
    };
  }

  private async resolveScope(query: FusionDashboardQueryDto, user: RequestUser): Promise<ResolvedDashboardScope> {
    const [allowedClassIds, allowedStudentIds] = await Promise.all([
      this.dataScope.academicClassIdsFor(user),
      this.dataScope.studentIdsFor(user),
    ]);
    if (query.classId) await this.dataScope.assertAcademicClassAccessible(user, query.classId);
    if (query.studentId) await this.dataScope.assertStudentAccessible(user, query.studentId);
    const classIds = query.classId ? [query.classId] : allowedClassIds;
    const studentIds = query.studentId ? [query.studentId] : allowedStudentIds;
    return {
      classIds,
      studentIds,
      role: this.role(user),
      scopeLabel: query.studentId ? '单个学生' : query.classId ? '单个班级' : this.scopeLabel(user),
      showTeacherPerformance: this.isPrivileged(user),
    };
  }

  private async attemptWhere(scope: ResolvedDashboardScope, range: DateRange, user: RequestUser) {
    const submittedAt = { not: null, gte: range.from, lte: range.to } satisfies Prisma.DateTimeNullableFilter;
    if (user.userType === UserType.STUDENT || user.userType === UserType.PARENT) {
      return {
        submittedAt,
        userId: { in: scope.studentIds ?? [] },
        exam: { deletedAt: null },
      } satisfies Prisma.ExamAttemptWhereInput;
    }
    const examScope = await this.dataScope.examWhere(user, scope.classIds?.length === 1 ? scope.classIds[0] : undefined);
    return {
      submittedAt,
      exam: {
        ...examScope,
        deletedAt: null,
        ...(scope.classIds === null ? {} : { classId: { in: scope.classIds } }),
      },
      ...(scope.studentIds === null ? {} : { userId: { in: scope.studentIds } }),
    } satisfies Prisma.ExamAttemptWhereInput;
  }

  private sessionWhere(classIds: string[] | null, range: DateRange): Prisma.LessonSessionWhereInput {
    return {
      startsAt: { gte: range.from, lte: range.to },
      classGroup: { deletedAt: null, status: 'active' },
      ...(classIds === null ? {} : { classId: { in: classIds } }),
    };
  }

  private recentExams(attempts: DashboardAttempt[]): FusionRecentExamDto[] {
    const grouped = new Map<string, DashboardAttempt[]>();
    for (const attempt of attempts) {
      const current = grouped.get(attempt.exam.id) ?? [];
      current.push(attempt);
      grouped.set(attempt.exam.id, current);
    }
    return [...grouped.values()].slice(0, 10).map((items) => {
      const graded = items.filter((item) => toApiEnum(item.status) === 'graded');
      return {
        examId: items[0].exam.id,
        examName: items[0].exam.name,
        courseName: items[0].exam.course.name,
        status: toApiEnum(items[0].exam.status),
        submitCount: items.length,
        gradedCount: graded.length,
        averageScore: average(graded.map((item) => Number(item.totalScore))),
        occurredAt: items[0].submittedAt as Date,
      };
    });
  }

  private teacherPerformance(sessions: DashboardSession[]): TeacherPerformanceDto[] {
    const groups = new Map<string, DashboardSession[]>();
    for (const session of sessions) {
      const key = session.teacherId ?? 'unassigned';
      groups.set(key, [...(groups.get(key) ?? []), session]);
    }
    return [...groups.entries()].map(([key, items]) => ({
      teacherId: key === 'unassigned' ? null : key,
      teacherName: items[0].teacher?.realName || items[0].teacher?.username || '待安排',
      scheduledLessons: items.filter((item) => item.status !== LessonSessionStatus.CANCELLED).length,
      completedLessons: items.filter((item) => item.status === LessonSessionStatus.COMPLETED).length,
      completedHours: this.sum(items
        .filter((item) => item.status === LessonSessionStatus.COMPLETED)
        .map((item) => item.lessonHours)),
      publishedLessonRecords: items.filter((item) => item.lessonRecord?.status === LessonRecordStatus.PUBLISHED).length,
      confirmedAttendance: items.reduce((sum, item) => sum + item._count.attendance, 0),
    })).sort((left, right) => right.completedLessons - left.completedLessons || left.teacherName.localeCompare(right.teacherName));
  }

  private drilldowns(range: DateRange, role: DashboardRole) {
    const dates = `startDate=${encodeURIComponent(range.from.toISOString())}&endDate=${encodeURIComponent(range.to.toISOString())}`;
    if (role === 'student' || role === 'parent') {
      return [
        { metric: 'assessment.exams', label: '考试记录', source: 'Exam / ExamAttempt', path: '/learning-portal?tab=exams' },
        { metric: 'academic.scheduledLessons', label: '课次学习', source: 'LessonSession', path: '/learning-portal?tab=lessons' },
        { metric: 'academic.confirmedAttendance', label: '考勤记录', source: 'AttendanceRecord', path: '/teaching-operations?tab=attendance' },
        { metric: 'academic.remainingLessonHours', label: '课时台账', source: 'LessonHourLedger', path: '/teaching-operations?tab=ledger' },
        { metric: 'academic.publishedLessonRecords', label: '教学记录', source: 'LessonRecord', path: '/learning-portal?tab=lessons' },
      ];
    }
    return [
      { metric: 'assessment.exams', label: '考试统计', source: 'Exam / ExamAttempt', path: `/statistics?${dates}` },
      { metric: 'academic.scheduledLessons', label: '排课日历', source: 'LessonSession', path: '/teaching-operations?tab=schedule' },
      { metric: 'academic.confirmedAttendance', label: '考勤确认', source: 'AttendanceRecord', path: '/teaching-operations?tab=attendance' },
      { metric: 'academic.remainingLessonHours', label: '课时台账', source: 'LessonHourLedger', path: '/teaching-operations?tab=ledger' },
      { metric: 'academic.publishedLessonRecords', label: '教学记录', source: 'LessonRecord', path: '/teaching-operations?tab=schedule' },
    ];
  }

  private range(query: FusionDashboardQueryDto): DateRange {
    const now = new Date();
    const from = query.startDate ? new Date(query.startDate) : new Date(now.getTime() - 30 * DAY_MS);
    const to = query.endDate ? new Date(query.endDate) : new Date(now.getTime() + 30 * DAY_MS);
    if (from > to) throw new BadRequestException('开始时间不能晚于结束时间');
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new BadRequestException('看板时间范围不能超过 366 天');
    return { from, to };
  }

  private role(user: RequestUser): DashboardRole {
    if (user.userType === UserType.SUPER_ADMIN || user.userType === UserType.ADMIN) return 'administrator';
    if (user.userType === UserType.TEACHER || user.userType === UserType.ASSISTANT) return 'teacher';
    return user.userType === UserType.PARENT ? 'parent' : 'student';
  }

  private scopeLabel(user: RequestUser) {
    return this.role(user) === 'administrator' ? '全部可管理数据'
      : this.role(user) === 'teacher' ? '任教班级'
        : this.role(user) === 'parent' ? '已关联学生' : '本人数据';
  }

  private sum(values: Array<Prisma.Decimal | number>) {
    return Number(values.reduce<number>((sum, value) => sum + Number(value), 0).toFixed(2));
  }

  private isPrivileged(user: RequestUser) {
    return user.userType === UserType.SUPER_ADMIN
      || user.userType === UserType.ADMIN
      || user.userType === UserType.TEACHER
      || user.userType === UserType.ASSISTANT;
  }
}

type DateRange = { from: Date; to: Date };
type DashboardRole = 'administrator' | 'teacher' | 'student' | 'parent';
type ResolvedDashboardScope = {
  classIds: string[] | null;
  studentIds: string[] | null;
  role: DashboardRole;
  scopeLabel: string;
  showTeacherPerformance: boolean;
};
type DashboardAttempt = Prisma.ExamAttemptGetPayload<{
  select: {
    id: true;
    status: true;
    totalScore: true;
    submittedAt: true;
    exam: { select: { id: true; name: true; status: true; course: { select: { name: true } } } };
  };
}>;
type DashboardSession = Prisma.LessonSessionGetPayload<{
  select: {
    id: true;
    status: true;
    lessonHours: true;
    teacherId: true;
    teacher: { select: { realName: true; username: true } };
    lessonRecord: { select: { status: true } };
    _count: { select: { attendance: true } };
  };
}>;
