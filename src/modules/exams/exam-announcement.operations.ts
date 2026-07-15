/* eslint-disable @typescript-eslint/no-unused-vars */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AnswerRecordStatus, AttemptStatus, ExamStatus, PaperStatus, Prisma, QuestionType, ScoringEvaluationSource, UserStatus, UserType } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { normalizeExamStatus, toApiEnum } from '../../common/utils/enum-normalizer';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionTypeRegistry } from '../question-types/question-type-registry.service';
import { ScoringHistoryService } from '../question-types/scoring-history.service';
import { BulkUpdateExamStatusDto } from './dto/bulk-update-exam-status.dto';
import { CreateExamDto } from './dto/create-exam.dto';
import { QueryExamDto } from './dto/query-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';

type SnapshotQuestion = {
  questionId: string;
  score: number;
  snapshot: {
    type: string;
    scoringRule?: Prisma.JsonValue | null;
    scoringRuleVersionId?: string | null;
    engine?: { adapterKey?: string; adapterVersion?: number };
    children?: SnapshotQuestion[];
    answer?: {
      correctOptionIds?: string[];
      blanks?: Array<{
        index: number;
        answers: string[];
        ignoreCase?: boolean;
        trimSpace?: boolean;
        score?: number;
      }>;
    } | null;
  };
};

type PaperSnapshot = {
  sections: Array<{ questions: SnapshotQuestion[] }>;
};
import { ExamsContext } from './exams.context';
import { loadClassMap, studentsInClass } from './exam-query.operations';
import { extractAnnouncement } from './exam-write.operations';
export async function announcementReads(ctx: ExamsContext, id: string, user: RequestUser) {
    await ctx.dataScope.assertExamAccessible(user, id);
    const exam = await ctx.prisma.exam.findFirst({
      where: { id, deletedAt: null },
      include: {
        course: { select: { name: true } },
        announcements: {
          where: { isActive: true },
          orderBy: { version: 'desc' },
          take: 1,
          include: {
            reads: {
              orderBy: { readAt: 'desc' },
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    realName: true,
                    userType: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
        attempts: {
          select: {
            userId: true,
            startedAt: true,
            submittedAt: true,
          },
        },
      },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在');
    }

    const classMap = await loadClassMap(ctx, exam.classId ? [exam.classId] : []);
    const className = exam.classId ? classMap.get(exam.classId)?.name ?? '' : '公开';
    const activeAnnouncement = exam.announcements[0] ?? null;
    if (!activeAnnouncement) {
      return {
        examId: id,
        examName: exam.name,
        courseName: exam.course.name,
        className,
        announcement: null,
        expectedCount: 0,
        readCount: 0,
        unreadCount: 0,
        enteredCount: [...new Set(exam.attempts.map((attempt) => attempt.userId))].length,
        submittedCount: [...new Set(exam.attempts.filter((attempt) => attempt.submittedAt).map((attempt) => attempt.userId))]
          .length,
        items: [],
      };
    }

    const readMap = new Map(
      activeAnnouncement.reads.map((read) => [
        read.userId,
        {
          readAt: read.readAt,
          user: read.user,
        },
      ]),
    );
    const attemptMap = new Map<string, { enteredAt: Date; submittedAt: Date | null }>();
    for (const attempt of exam.attempts) {
      const current = attemptMap.get(attempt.userId);
      if (!current) {
        attemptMap.set(attempt.userId, { enteredAt: attempt.startedAt, submittedAt: attempt.submittedAt });
        continue;
      }
      if (attempt.startedAt < current.enteredAt) {
        current.enteredAt = attempt.startedAt;
      }
      if (!current.submittedAt && attempt.submittedAt) {
        current.submittedAt = attempt.submittedAt;
      }
    }

    const expectedUsers = exam.classId ? await studentsInClass(ctx, exam.classId) : [];
    const targetMap = new Map(expectedUsers.map((item) => [item.id, item]));
    for (const read of activeAnnouncement.reads) {
      if (read.user.userType === UserType.STUDENT && read.user.status === UserStatus.ACTIVE) {
        targetMap.set(read.user.id, read.user);
      }
    }
    if (!exam.classId) {
      const attemptedUserIds = [...attemptMap.keys()];
      if (attemptedUserIds.length) {
        const attemptedUsers = await ctx.prisma.user.findMany({
          where: {
            id: { in: attemptedUserIds },
            userType: UserType.STUDENT,
            status: UserStatus.ACTIVE,
            deletedAt: null,
          },
          select: {
            id: true,
            username: true,
            realName: true,
            userType: true,
            status: true,
          },
        });
        for (const student of attemptedUsers) {
          targetMap.set(student.id, student);
        }
      }
    }

    const targetUsers = [...targetMap.values()].sort((a, b) =>
      String(a.realName || a.username).localeCompare(String(b.realName || b.username), 'zh-CN'),
    );
    const items = targetUsers.map((student) => {
      const read = readMap.get(student.id);
      const attempt = attemptMap.get(student.id);
      return {
        userId: student.id,
        username: student.username,
        realName: student.realName,
        read: Boolean(read),
        readAt: read?.readAt ?? null,
        entered: Boolean(attempt),
        enteredAt: attempt?.enteredAt ?? null,
        submitted: Boolean(attempt?.submittedAt),
        submittedAt: attempt?.submittedAt ?? null,
      };
    });

    return {
      examId: id,
      examName: exam.name,
      courseName: exam.course.name,
      className,
      announcement: {
        id: activeAnnouncement.id,
        version: activeAnnouncement.version,
        content: activeAnnouncement.content,
        createdAt: activeAnnouncement.createdAt,
        updatedAt: activeAnnouncement.updatedAt,
      },
      expectedCount: items.length,
      readCount: items.filter((item) => item.read).length,
      unreadCount: items.filter((item) => !item.read).length,
      enteredCount: items.filter((item) => item.entered).length,
      submittedCount: items.filter((item) => item.submitted).length,
      items,
    };
  }

export async function remindAnnouncementUnread(ctx: ExamsContext, id: string, content: string | undefined, user: RequestUser) {
    const report = await announcementReads(ctx, id, user);
    if (!report.announcement) {
      throw new BadRequestException('该考试暂未设置公告');
    }

    const unreadItems = report.items.filter((item) => !item.read);
    if (!unreadItems.length) {
      return {
        examId: id,
        announcementId: report.announcement.id,
        targetCount: 0,
        createdCount: 0,
        skippedCount: 0,
        items: [],
      };
    }

    const existing = await ctx.prisma.notification.findMany({
      where: {
        userId: { in: unreadItems.map((item) => item.userId) },
        bizType: 'exam_announcement_unread',
        bizId: report.announcement.id,
        readAt: null,
      },
      select: { userId: true },
    });
    const existingUserIds = new Set(existing.map((item) => item.userId));
    const targets = unreadItems.filter((item) => !existingUserIds.has(item.userId));

    if (targets.length) {
      await ctx.prisma.notification.createMany({
        data: targets.map((item) => ({
          userId: item.userId,
          title: `考试公告待阅读：${report.examName}`,
          content:
            content?.trim() ||
            `请尽快阅读「${report.examName}」考试公告。公告版本：第 ${report.announcement?.version ?? 1} 版。`,
          type: 'warning',
          bizType: 'exam_announcement_unread',
          bizId: report.announcement?.id,
        })),
      });
    }

    await ctx.audit.log({
      userId: user.id,
      action: 'exam:announcement-unread-remind',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
      afterData: {
        announcementId: report.announcement.id,
        targetCount: unreadItems.length,
        createdCount: targets.length,
        skippedCount: unreadItems.length - targets.length,
      },
    });

    return {
      examId: id,
      announcementId: report.announcement.id,
      targetCount: unreadItems.length,
      createdCount: targets.length,
      skippedCount: unreadItems.length - targets.length,
      items: unreadItems,
    };
  }

export function activeAnnouncementText(ctx: ExamsContext, source: {
    announcements?: Array<{ content: string }>;
    antiCheatConfigJson?: Prisma.JsonValue | null;
  }) {
    return source.announcements?.[0]?.content ?? extractAnnouncement(ctx, source.antiCheatConfigJson ?? null);
  }