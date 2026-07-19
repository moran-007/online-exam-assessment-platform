import { Injectable } from '@nestjs/common';
import {
  AiSummaryReviewStatus,
  AiSummaryType,
  ClassMemberStatus,
  UserType,
} from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { LessonRecordAccessService } from './lesson-record-access.service';
import { LessonRecordsService } from './lesson-records.service';
import { isLearnerScoreVisible } from '../ai/datasets/learner-visibility';

@Injectable()
export class LearningPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LessonRecordAccessService,
    private readonly lessonRecords: LessonRecordsService,
  ) {}

  async students(actor: RequestUser) {
    if (actor.userType === UserType.STUDENT) {
      const student = await this.student(actor.id);
      return student ? [{ student, relationship: '本人', isPrimary: true }] : [];
    }
    if (actor.userType !== UserType.PARENT) return [];
    const relations = await this.prisma.parentStudent.findMany({
      where: { parentId: actor.id, status: ClassMemberStatus.ACTIVE },
      include: {
        student: {
          select: {
            id: true,
            username: true,
            realName: true,
            studentProfile: { select: { studentNo: true, school: true, grade: true } },
            studentClasses: {
              where: { status: ClassMemberStatus.ACTIVE, classGroup: { deletedAt: null, status: 'active' } },
              select: { classGroup: { select: { id: true, name: true } } },
            },
          },
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { linkedAt: 'asc' }],
    });
    return relations.map((item) => ({
      student: item.student,
      relationship: item.relationship,
      isPrimary: item.isPrimary,
    }));
  }

  async overview(studentId: string, actor: RequestUser) {
    const learnerId = await this.access.learnerId(actor, studentId);
    const student = await this.student(learnerId);
    if (!student) return null;
    const [lessons, attempts] = await Promise.all([
      this.lessonRecords.list({ studentId: learnerId, page: 1, pageSize: 50 }, actor),
      this.prisma.examAttempt.findMany({
        where: { studentId: learnerId, submittedAt: { not: null } },
        include: {
          exam: { select: { id: true, name: true, endTime: true, showScoreMode: true, course: { select: { name: true } } } },
        },
        orderBy: { submittedAt: 'desc' },
        take: 50,
      }),
    ]);
    const examIds = [...new Set(attempts.map((attempt) => attempt.examId))];
    const classIds = student.studentClasses.map((membership) => membership.classGroup.id);
    const summaries = await this.prisma.aiSummary.findMany({
      where: {
        reviewStatus: AiSummaryReviewStatus.PUBLISHED,
        publishedAt: { not: null },
        OR: [
          {
            type: {
              in: actor.userType === UserType.PARENT
                ? [AiSummaryType.STUDENT, AiSummaryType.PARENT_REPORT]
                : [AiSummaryType.STUDENT],
            },
            subjectId: learnerId,
          },
          ...(examIds.length ? [{ type: AiSummaryType.EXAM, subjectId: { in: examIds } }] : []),
          ...(actor.userType === UserType.STUDENT && classIds.length
            ? [{ type: AiSummaryType.CLASS, subjectId: { in: classIds } }]
            : []),
        ],
      },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });
    return {
      student,
      lessons,
      exams: attempts.map((attempt) => ({
        id: attempt.id,
        examId: attempt.examId,
        name: attempt.exam.name,
        courseName: attempt.exam.course.name,
        status: attempt.status,
        submittedAt: attempt.submittedAt,
        score: isLearnerScoreVisible(attempt.exam.showScoreMode, attempt.status, attempt.submittedAt, attempt.exam.endTime)
          ? Number(attempt.totalScore)
          : null,
      })),
      summaries: summaries.map((summary) => ({
        id: summary.id,
        type: summary.type.toLowerCase(),
        subjectId: summary.subjectId,
        content: summary.summaryJson,
        publishedAt: summary.publishedAt,
      })),
    };
  }

  private student(studentId: string) {
    return this.prisma.user.findFirst({
      where: { id: studentId, userType: UserType.STUDENT, deletedAt: null },
      select: {
        id: true,
        username: true,
        realName: true,
        studentProfile: { select: { studentNo: true, school: true, grade: true } },
        studentClasses: {
          where: { status: ClassMemberStatus.ACTIVE, classGroup: { deletedAt: null, status: 'active' } },
          select: { classGroup: { select: { id: true, name: true } } },
        },
      },
    });
  }

}
