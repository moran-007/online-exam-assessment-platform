import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AiSummaryReviewStatus,
  AiSummaryType,
  ClassMemberStatus,
  UserType,
} from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';

const SUPPORTED_TYPES: AiSummaryType[] = [
  AiSummaryType.EXAM,
  AiSummaryType.STUDENT,
  AiSummaryType.CLASS,
  AiSummaryType.PARENT_REPORT,
  AiSummaryType.LESSON,
];

@Injectable()
export class AiSummaryAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  async require(id: string, user: RequestUser) {
    const summary = await this.prisma.aiSummary.findUnique({
      where: { id },
      include: { task: { select: { scopeJson: true } } },
    });
    if (!summary || !SUPPORTED_TYPES.includes(summary.type)) {
      throw new NotFoundException('AI 总结不存在');
    }
    await this.assertSubject(summary.type, summary.subjectId, user);
    return summary;
  }

  async requirePublishedForFeedback(id: string, user: RequestUser) {
    const summary = await this.prisma.aiSummary.findFirst({
      where: { id, reviewStatus: AiSummaryReviewStatus.PUBLISHED, publishedAt: { not: null } },
      include: { task: { select: { scopeJson: true } } },
    });
    if (!summary || !SUPPORTED_TYPES.includes(summary.type)) throw new NotFoundException('已发布 AI 总结不存在');
    if (user.userType !== UserType.STUDENT && user.userType !== UserType.PARENT) {
      await this.assertSubject(summary.type, summary.subjectId, user);
      return summary;
    }
    if (!await this.learnerCanView(summary.type, summary.subjectId, user)) {
      throw new NotFoundException('已发布 AI 总结不存在');
    }
    return summary;
  }

  async assertSubject(type: AiSummaryType, subjectId: string, user: RequestUser) {
    if (type === AiSummaryType.EXAM) {
      await this.dataScope.assertExamAccessible(user, subjectId);
      return;
    }
    if (type === AiSummaryType.STUDENT) {
      await this.dataScope.assertStudentSummaryAccessible(user, subjectId);
      return;
    }
    if (type === AiSummaryType.CLASS) {
      await this.dataScope.assertAcademicClassAccessible(user, subjectId);
      return;
    }
    if (type === AiSummaryType.PARENT_REPORT) {
      await this.dataScope.assertStudentSummaryAccessible(user, subjectId);
      return;
    }
    if (type === AiSummaryType.LESSON) {
      const session = await this.prisma.lessonSession.findUnique({
        where: { id: subjectId },
        select: { classId: true },
      });
      if (!session) throw new NotFoundException('课次不存在');
      await this.dataScope.assertAcademicClassAccessible(user, session.classId);
      return;
    }
    throw new NotFoundException('AI 总结类型暂不支持');
  }

  find(id: string) {
    return this.prisma.aiSummary.findUniqueOrThrow({
      where: { id },
      include: { task: { select: { scopeJson: true } } },
    });
  }

  private async learnerCanView(type: AiSummaryType, subjectId: string, user: RequestUser) {
    const learnerIds = user.userType === UserType.STUDENT
      ? [user.id]
      : (await this.prisma.parentStudent.findMany({
        where: { parentId: user.id, status: ClassMemberStatus.ACTIVE },
        select: { studentId: true },
      })).map((item) => item.studentId);
    if (!learnerIds.length) return false;
    if (type === AiSummaryType.STUDENT) return learnerIds.includes(subjectId);
    if (type === AiSummaryType.PARENT_REPORT) {
      return user.userType === UserType.PARENT && learnerIds.includes(subjectId);
    }
    if (type === AiSummaryType.EXAM) {
      return Boolean(await this.prisma.examAttempt.findFirst({
        where: { examId: subjectId, userId: { in: learnerIds }, submittedAt: { not: null } },
        select: { id: true },
      }));
    }
    if (type === AiSummaryType.CLASS && user.userType === UserType.STUDENT) {
      return Boolean(await this.prisma.classStudent.findFirst({
        where: { classId: subjectId, studentId: user.id, status: ClassMemberStatus.ACTIVE },
        select: { id: true },
      }));
    }
    return false;
  }
}
