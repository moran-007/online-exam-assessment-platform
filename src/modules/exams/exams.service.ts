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

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService,
    private readonly questionTypes: QuestionTypeRegistry,
    private readonly scoringHistory: ScoringHistoryService,
  ) {}

  async list(query: QueryExamDto, user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const scopeWhere = await this.dataScope.examWhere(user, query.classId);
    const where: Prisma.ExamWhereInput = {
      deletedAt: null,
      courseId: query.courseId,
      AND: [
        scopeWhere,
        this.examStatusWhere(query.status),
        query.keyword ? { OR: [{ name: { contains: query.keyword, mode: 'insensitive' } }] } : {},
      ],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.exam.findMany({
        where,
        include: {
          course: { select: { name: true } },
          paper: { select: { name: true, totalScore: true } },
          announcements: {
            where: { isActive: true },
            orderBy: { version: 'desc' },
            take: 1,
          },
          _count: { select: { attempts: true } },
        },
        orderBy: this.examOrderBy(query),
        skip,
        take,
      }),
      this.prisma.exam.count({ where }),
    ]);

    const classMap = await this.loadClassMap(items.map((exam) => exam.classId).filter(Boolean) as string[]);

    return {
      items: items.map((exam) => {
        const effectiveStatus = this.effectiveExamStatus(exam);
        return {
          ...exam,
          status: toApiEnum(effectiveStatus),
          storedStatus: toApiEnum(exam.status),
          courseName: exam.course.name,
          paperName: exam.paper.name,
          className: exam.classId ? classMap.get(exam.classId)?.name ?? '' : '公开',
          totalScore: Number(exam.paper.totalScore),
          attemptCount: exam._count.attempts,
          announcement: this.activeAnnouncementText(exam),
          announcementId: exam.announcements[0]?.id ?? null,
          announcementVersion: exam.announcements[0]?.version ?? null,
          resultVisibility: this.extractResultVisibility(exam.antiCheatConfigJson),
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  async create(dto: CreateExamDto, user: RequestUser) {
    await this.dataScope.assertClassWritable(user, dto.classId);
    const paper = await this.prisma.paper.findFirst({
      where: { id: dto.paperId, status: PaperStatus.PUBLISHED, deletedAt: null },
    });

    if (!paper) {
      throw new BadRequestException('只能基于已发布试卷创建考试');
    }

    const startTime = this.parseExamTime(dto.startTime);
    const durationMinutes = dto.durationMinutes ?? paper.durationMinutes;
    const endTime = this.examEndTime(startTime, durationMinutes);
    if (Number.isNaN(startTime.getTime()) || durationMinutes < 1) {
      throw new BadRequestException('考试时间不合法');
    }

    const exam = await this.prisma.$transaction(async (tx) => {
      const created = await tx.exam.create({
        data: {
          paperId: dto.paperId,
          name: dto.name,
          courseId: dto.courseId,
          classId: dto.classId,
          startTime,
          endTime,
          durationMinutes,
          attemptLimit: dto.attemptLimit ?? 1,
          showAnswerMode: this.normalizeShowAnswerMode(dto.showAnswerMode ?? 'after_exam_end'),
          showScoreMode: this.normalizeShowScoreMode(dto.showScoreMode ?? 'after_submit'),
          antiCheatConfigJson: this.buildAntiCheatConfig(dto.antiCheatConfig),
          createdBy: user.id,
          updatedBy: user.id,
        },
      });

      await this.syncAnnouncement(tx, created.id, dto.announcement, user.id);
      return created;
    });

    await this.audit.log({
      userId: user.id,
      action: 'exam:create',
      module: 'exam',
      targetType: 'exam',
      targetId: exam.id,
      afterData: { name: exam.name },
    });

    return { id: exam.id };
  }

  async detail(id: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, id);
    const exam = await this.prisma.exam.findFirst({
      where: { id, deletedAt: null },
      include: {
        paper: true,
        course: true,
        announcements: {
          where: { isActive: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在');
    }

    const classMap = await this.loadClassMap(exam.classId ? [exam.classId] : []);

    return {
      ...exam,
      status: toApiEnum(this.effectiveExamStatus(exam)),
      storedStatus: toApiEnum(exam.status),
      className: exam.classId ? classMap.get(exam.classId)?.name ?? '' : '公开',
      announcement: this.activeAnnouncementText(exam),
      announcementId: exam.announcements[0]?.id ?? null,
      announcementVersion: exam.announcements[0]?.version ?? null,
      resultVisibility: this.extractResultVisibility(exam.antiCheatConfigJson),
      paper: { ...exam.paper, status: toApiEnum(exam.paper.status), totalScore: Number(exam.paper.totalScore) },
    };
  }

  async update(id: string, dto: UpdateExamDto, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, id);
    await this.dataScope.assertClassWritable(user, dto.classId);
    const current = await this.prisma.exam.findFirst({
      where: { id, deletedAt: null },
    });

    if (!current) {
      throw new NotFoundException('考试不存在');
    }

    const statusOnlyPatch = this.isStatusOnlyPatch(dto);
    if (
      (current.status === ExamStatus.RUNNING || current.status === ExamStatus.ENDED) &&
      !statusOnlyPatch &&
      !this.canOverrideLockedExam(user)
    ) {
      throw new BadRequestException('考试已开始或已结束，不能修改核心配置');
    }
    if (statusOnlyPatch && dto.status) {
      const targetStatus = normalizeExamStatus(dto.status);
      if (targetStatus === ExamStatus.ENDED) {
        return this.end(id, user);
      }
      if (targetStatus === ExamStatus.RUNNING) {
        return this.start(id, user);
      }
    }

    const nextStartTime = dto.startTime ? this.parseExamTime(dto.startTime) : current.startTime;
    const nextDurationMinutes = dto.durationMinutes ?? current.durationMinutes;
    const nextEndTime = this.examEndTime(nextStartTime, nextDurationMinutes);
    if (Number.isNaN(nextStartTime.getTime()) || nextDurationMinutes < 1) {
      throw new BadRequestException('考试时间不合法');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextConfigSource =
        dto.antiCheatConfig !== undefined
          ? dto.antiCheatConfig
          : (current.antiCheatConfigJson as Record<string, unknown> | null) ?? undefined;
      const saved = await tx.exam.update({
        where: { id },
        data: {
          paperId: dto.paperId,
          name: dto.name,
          courseId: dto.courseId,
          classId: dto.classId,
          startTime: dto.startTime ? nextStartTime : undefined,
          endTime: dto.startTime !== undefined || dto.durationMinutes !== undefined || dto.endTime !== undefined ? nextEndTime : undefined,
          durationMinutes: dto.durationMinutes,
          attemptLimit: dto.attemptLimit,
          status: dto.status ? normalizeExamStatus(dto.status) : undefined,
          showAnswerMode: dto.showAnswerMode ? this.normalizeShowAnswerMode(dto.showAnswerMode) : undefined,
          showScoreMode: dto.showScoreMode ? this.normalizeShowScoreMode(dto.showScoreMode) : undefined,
          antiCheatConfigJson:
            dto.antiCheatConfig !== undefined || dto.announcement !== undefined
              ? this.buildAntiCheatConfig(nextConfigSource)
              : undefined,
          updatedBy: user.id,
        },
      });

      await this.syncAnnouncement(tx, id, dto.announcement, user.id);
      return saved;
    });

    await this.audit.log({
      userId: user.id,
      action: 'exam:update',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
      beforeData: { name: current.name, status: current.status },
      afterData: { name: updated.name, status: updated.status },
    });

    return { id };
  }

  async publish(id: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, id);
    const exam = await this.prisma.exam.findFirst({
      where: { id, deletedAt: null },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在');
    }

    const now = Date.now();
    const status =
      exam.endTime.getTime() <= now
        ? ExamStatus.ENDED
        : exam.startTime.getTime() <= now
          ? ExamStatus.RUNNING
          : ExamStatus.SCHEDULED;

    const updated = await this.prisma.exam.update({
      where: { id },
      data: { status, updatedBy: user.id },
    });

    await this.audit.log({
      userId: user.id,
      action: 'exam:publish',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
      afterData: { status: updated.status },
    });

    return { id, status: toApiEnum(updated.status) };
  }

  async unpublish(id: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, id);
    const exam = await this.prisma.exam.findFirst({
      where: { id, deletedAt: null },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在');
    }

    if (exam.status === ExamStatus.RUNNING || exam.status === ExamStatus.ENDED) {
      throw new BadRequestException('考试已开始或已结束，不能取消发布');
    }

    const updated = await this.prisma.exam.update({
      where: { id },
      data: { status: ExamStatus.DRAFT, updatedBy: user.id },
    });

    await this.audit.log({
      userId: user.id,
      action: 'exam:unpublish',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
      afterData: { status: updated.status },
    });

    return { id, status: toApiEnum(updated.status) };
  }

  async start(id: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, id);
    const exam = await this.prisma.exam.findFirst({
      where: { id, deletedAt: null },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在');
    }

    if (exam.status === ExamStatus.ARCHIVED) {
      throw new BadRequestException('归档考试不能直接启动');
    }

    const now = new Date();
    const effectiveStatus = this.effectiveExamStatus(exam, now);
    const isAlreadyRunning = effectiveStatus === ExamStatus.RUNNING;
    const nextStartTime = isAlreadyRunning ? exam.startTime : now;
    const nextEndTime = isAlreadyRunning
      ? exam.endTime
      : new Date(nextStartTime.getTime() + Math.max(1, exam.durationMinutes) * 60_000);
    const updated = await this.prisma.exam.update({
      where: { id },
      data: {
        status: ExamStatus.RUNNING,
        startTime: nextStartTime,
        endTime: nextEndTime,
        updatedBy: user.id,
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'exam:start',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
      beforeData: { status: exam.status, startTime: exam.startTime, endTime: exam.endTime },
      afterData: { status: updated.status, startTime: updated.startTime, endTime: updated.endTime },
    });

    return { id, status: toApiEnum(updated.status), startTime: updated.startTime, endTime: updated.endTime };
  }

  async end(id: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, id);
    const exam = await this.prisma.exam.findFirst({
      where: { id, deletedAt: null },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在');
    }

    const endedAt = new Date();
    let finalizedAttemptCount = 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.exam.update({
        where: { id },
        data: {
          status: ExamStatus.ENDED,
          endTime: endedAt,
          updatedBy: user.id,
        },
      });

      const attempts = await tx.examAttempt.findMany({
        where: { examId: id, status: AttemptStatus.IN_PROGRESS },
        include: {
          exam: true,
          paperInstance: true,
          answers: true,
        },
      });
      for (const attempt of attempts) {
        await this.finalizeAttemptForManualEnd(tx, attempt, endedAt);
        finalizedAttemptCount += 1;
      }
    });

    await this.audit.log({
      userId: user.id,
      action: 'exam:end',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
      beforeData: { status: exam.status, endTime: exam.endTime },
      afterData: { status: ExamStatus.ENDED, endTime: endedAt, finalizedAttemptCount },
    });

    return {
      id,
      status: toApiEnum(ExamStatus.ENDED),
      endTime: endedAt,
      finalizedAttemptCount,
    };
  }

  async bulkUpdateStatus(dto: BulkUpdateExamStatusDto, user: RequestUser) {
    const status = normalizeExamStatus(dto.status);
    const ids = [...new Set(dto.ids)];
    const failed: Array<{ id: string; message: string }> = [];
    let successCount = 0;

    for (const id of ids) {
      try {
        await this.update(id, { status: toApiEnum(status) }, user);
        successCount += 1;
      } catch (error) {
        failed.push({ id, message: error instanceof Error ? error.message : '状态更新失败' });
      }
    }

    await this.audit.log({
      userId: user.id,
      action: 'exam:bulk-update-status',
      module: 'exam',
      targetType: 'exam',
      targetId: ids[0],
      afterData: {
        ids,
        status: toApiEnum(status),
        successCount,
        failedCount: failed.length,
      },
    });

    return {
      status: toApiEnum(status),
      successCount,
      failed,
    };
  }

  async remove(id: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, id);
    const exam = await this.prisma.exam.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { attempts: true } } },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在');
    }

    if (exam.status === ExamStatus.RUNNING) {
      throw new BadRequestException('进行中考试不能删除');
    }

    if (exam._count.attempts > 0) {
      throw new BadRequestException('已有提交记录的考试不能删除，可归档隐藏');
    }

    await this.prisma.exam.update({
      where: { id },
      data: {
        status: ExamStatus.ARCHIVED,
        deletedAt: new Date(),
        updatedBy: user.id,
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'exam:delete',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
    });

    return true;
  }

  async results(id: string, query: QueryExamDto, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, id);
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.ExamAttemptWhereInput = { examId: id };
    const [items, total, allAttempts] = await this.prisma.$transaction([
      this.prisma.examAttempt.findMany({
        where,
        orderBy: [{ totalScore: 'desc' }, { submittedAt: 'asc' }],
        skip,
        take,
      }),
      this.prisma.examAttempt.count({ where }),
      this.prisma.examAttempt.findMany({
        where,
        orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, userId: true },
      }),
    ]);
    const userIds = [...new Set(items.map((item) => item.userId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, realName: true },
    });
    const userMap = new Map(users.map((user) => [user.id, user]));
    const attemptNoMap = new Map<string, number>();
    const counters = new Map<string, number>();
    for (const attempt of allAttempts) {
      const next = (counters.get(attempt.userId) ?? 0) + 1;
      counters.set(attempt.userId, next);
      attemptNoMap.set(attempt.id, next);
    }

    return {
      items: items.map((attempt, index) => ({
        ...attempt,
        status: toApiEnum(attempt.status),
        studentName: userMap.get(attempt.userId)?.realName ?? userMap.get(attempt.userId)?.username ?? attempt.userId,
        username: userMap.get(attempt.userId)?.username ?? '',
        attemptNo: attemptNoMap.get(attempt.id) ?? 1,
        objectiveScore: Number(attempt.objectiveScore),
        subjectiveScore: Number(attempt.subjectiveScore),
        judgeScore: Number(attempt.judgeScore),
        totalScore: Number(attempt.totalScore),
        rank: skip + index + 1,
      })),
      page,
      pageSize,
      total,
    };
  }

  async statistics(id: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, id);
    const attempts = await this.prisma.examAttempt.findMany({
      where: { examId: id, submittedAt: { not: null } },
      include: { answers: true },
    });
    const scores = attempts.map((attempt) => Number(attempt.totalScore));
    const submitCount = attempts.length;
    const averageScore = submitCount ? scores.reduce((sum, score) => sum + score, 0) / submitCount : 0;

    const questionStatsMap = new Map<string, { total: number; correct: number; score: number }>();
    for (const attempt of attempts) {
      for (const answer of attempt.answers) {
        const item = questionStatsMap.get(answer.questionId) ?? { total: 0, correct: 0, score: 0 };
        item.total += 1;
        item.correct += answer.isCorrect ? 1 : 0;
        item.score += Number(answer.score);
        questionStatsMap.set(answer.questionId, item);
      }
    }

    return {
      averageScore,
      maxScore: scores.length ? Math.max(...scores) : 0,
      minScore: scores.length ? Math.min(...scores) : 0,
      submitCount,
      studentCount: submitCount,
      passRate: submitCount
        ? scores.filter((score) => score >= averageScore).length / submitCount
        : 0,
      excellentRate: submitCount ? scores.filter((score) => score >= 90).length / submitCount : 0,
      questionStats: [...questionStatsMap.entries()].map(([questionId, value]) => ({
        questionId,
        correctRate: value.total ? value.correct / value.total : 0,
        averageScore: value.total ? value.score / value.total : 0,
      })),
      knowledgePointStats: [],
    };
  }

  async announcementReads(id: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, id);
    const exam = await this.prisma.exam.findFirst({
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

    const classMap = await this.loadClassMap(exam.classId ? [exam.classId] : []);
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

    const expectedUsers = exam.classId ? await this.studentsInClass(exam.classId) : [];
    const targetMap = new Map(expectedUsers.map((item) => [item.id, item]));
    for (const read of activeAnnouncement.reads) {
      if (read.user.userType === UserType.STUDENT && read.user.status === UserStatus.ACTIVE) {
        targetMap.set(read.user.id, read.user);
      }
    }
    if (!exam.classId) {
      const attemptedUserIds = [...attemptMap.keys()];
      if (attemptedUserIds.length) {
        const attemptedUsers = await this.prisma.user.findMany({
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

  async remindAnnouncementUnread(id: string, content: string | undefined, user: RequestUser) {
    const report = await this.announcementReads(id, user);
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

    const existing = await this.prisma.notification.findMany({
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
      await this.prisma.notification.createMany({
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

    await this.audit.log({
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

  private effectiveExamStatus(exam: { status: ExamStatus; startTime: Date; endTime: Date }, now = new Date()) {
    if (exam.status === ExamStatus.DRAFT || exam.status === ExamStatus.ARCHIVED) return exam.status;
    if (exam.status === ExamStatus.ENDED || exam.endTime <= now) return ExamStatus.ENDED;
    if (exam.status === ExamStatus.RUNNING || exam.startTime <= now) return ExamStatus.RUNNING;
    return ExamStatus.SCHEDULED;
  }

  private examStatusWhere(status?: string): Prisma.ExamWhereInput {
    if (!status) return {};
    const normalized = normalizeExamStatus(status);
    const now = new Date();
    if (normalized === ExamStatus.SCHEDULED) {
      return {
        status: ExamStatus.SCHEDULED,
        startTime: { gt: now },
      };
    }
    if (normalized === ExamStatus.RUNNING) {
      return {
        OR: [
          { status: ExamStatus.RUNNING, endTime: { gt: now } },
          { status: ExamStatus.SCHEDULED, startTime: { lte: now }, endTime: { gt: now } },
        ],
      };
    }
    if (normalized === ExamStatus.ENDED) {
      return {
        OR: [
          { status: ExamStatus.ENDED },
          { status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] }, endTime: { lte: now } },
        ],
      };
    }
    return { status: normalized };
  }

  private parseExamTime(value: string) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('考试时间不合法');
    }
    return parsed;
  }

  private examEndTime(startTime: Date, durationMinutes: number) {
    const duration = Math.max(1, Math.round(Number(durationMinutes) || 1));
    return new Date(startTime.getTime() + duration * 60_000);
  }

  private canOverrideLockedExam(user: RequestUser) {
    return user.userType === UserType.SUPER_ADMIN || user.userType === UserType.ADMIN;
  }

  private async finalizeAttemptForManualEnd(
    tx: Prisma.TransactionClient,
    attempt: Prisma.ExamAttemptGetPayload<{
      include: { exam: true; paperInstance: true; answers: true };
    }>,
    endedAt: Date,
  ) {
    const paperSnapshot = attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot;
    const answerMap = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    let objectiveScore = 0;
    let subjectiveScore = 0;
    let judgeScore = 0;
    let hasManual = false;
    let hasJudge = false;

    for (const paperQuestion of this.flattenPaperQuestions(paperSnapshot)) {
      const existing = answerMap.get(paperQuestion.questionId);
      const answerJson = (existing?.answerJson as Record<string, unknown> | undefined) ?? {};
      const grading =
        String(paperQuestion.snapshot.type).toUpperCase() === QuestionType.PROGRAMMING &&
        existing?.status === AnswerRecordStatus.JUDGE_DONE
          ? {
              score: Number(existing.score),
              isCorrect: existing.isCorrect,
              status: AnswerRecordStatus.JUDGE_DONE,
              autoResult: existing.autoResultJson ?? {},
            }
          : this.gradeQuestionForEnd(paperQuestion, answerJson);

      if (grading.status === AnswerRecordStatus.AUTO_GRADED) {
        objectiveScore += grading.score;
      } else if (grading.status === AnswerRecordStatus.MANUAL_NEEDED) {
        hasManual = true;
        subjectiveScore += grading.score;
      } else if (grading.status === AnswerRecordStatus.JUDGE_PENDING || grading.status === AnswerRecordStatus.JUDGE_DONE) {
        hasJudge ||= grading.status === AnswerRecordStatus.JUDGE_PENDING;
        judgeScore += grading.score;
      }

      const answerRecord = await tx.answerRecord.upsert({
        where: {
          attemptId_questionId: {
            attemptId: attempt.id,
            questionId: paperQuestion.questionId,
          },
        },
        update: {
          answerJson: answerJson as Prisma.InputJsonObject,
          isCorrect: grading.isCorrect,
          score: grading.score,
          status: grading.status,
          autoResultJson: grading.autoResult as Prisma.InputJsonObject,
        },
        create: {
          attemptId: attempt.id,
          questionId: paperQuestion.questionId,
          answerJson: answerJson as Prisma.InputJsonObject,
          isCorrect: grading.isCorrect,
          score: grading.score,
          status: grading.status,
          autoResultJson: grading.autoResult as Prisma.InputJsonObject,
        },
      });
      await this.scoringHistory.recordOfficial(tx, {
        answerRecordId: answerRecord.id,
        answerJson: answerRecord.answerJson,
        score: grading.score,
        maxScore: paperQuestion.score,
        isCorrect: grading.isCorrect,
        status: grading.status,
        details: grading.autoResult as Prisma.InputJsonObject,
        adapterKey: String(paperQuestion.snapshot.type).toLowerCase(),
        adapterVersion: this.questionTypes.descriptor(paperQuestion.snapshot.type).version,
        source: grading.status === AnswerRecordStatus.JUDGE_DONE ? ScoringEvaluationSource.JUDGE : ScoringEvaluationSource.AUTO,
        scoringRuleVersionId: (paperQuestion.snapshot as any).scoringRuleVersionId ?? null,
        ruleSnapshot: (paperQuestion.snapshot as any).scoringRule ?? null,
      });
    }

    await tx.examAttempt.update({
      where: { id: attempt.id },
      data: {
        submittedAt: endedAt,
        status: hasManual || hasJudge ? AttemptStatus.GRADING : AttemptStatus.GRADED,
        objectiveScore,
        subjectiveScore,
        judgeScore,
        totalScore: objectiveScore + subjectiveScore + judgeScore,
        durationSeconds: this.attemptDurationSeconds(attempt, endedAt),
      },
    });
  }

  private flattenPaperQuestions(snapshot: PaperSnapshot) {
    const flatten = (question: SnapshotQuestion): SnapshotQuestion[] => {
      const children = Array.isArray(question.snapshot.children) ? question.snapshot.children : [];
      return children.length ? children.flatMap(flatten) : [question];
    };
    return snapshot.sections.flatMap((section) => section.questions.flatMap(flatten));
  }

  private gradeQuestionForEnd(paperQuestion: SnapshotQuestion, answerJson: Record<string, unknown>) {
    const result = this.questionTypes.grade({
      snapshot: paperQuestion.snapshot,
      answer: answerJson as Prisma.InputJsonObject,
      maxScore: paperQuestion.score,
    });
    return { ...result, autoResult: result.details };
  }

  private attemptDurationSeconds(
    attempt: { startedAt: Date; exam?: { durationMinutes: number; endTime: Date } },
    endedAt: Date,
  ) {
    const durationDeadline = attempt.exam
      ? new Date(attempt.startedAt.getTime() + attempt.exam.durationMinutes * 60_000)
      : endedAt;
    const effectiveEnd = endedAt < durationDeadline ? endedAt : durationDeadline;
    return Math.max(0, Math.floor((effectiveEnd.getTime() - attempt.startedAt.getTime()) / 1000));
  }

  private normalizeShowAnswerMode(value: string) {
    return value.replace(/-/g, '_').toUpperCase() as never;
  }

  private isStatusOnlyPatch(dto: UpdateExamDto) {
    const keys = Object.entries(dto)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    return keys.length === 1 && keys[0] === 'status';
  }

  private normalizeShowScoreMode(value: string) {
    return value.replace(/-/g, '_').toUpperCase() as never;
  }

  private examOrderBy(query: QueryExamDto): Prisma.ExamOrderByWithRelationInput[] {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const orderMap: Record<string, Prisma.ExamOrderByWithRelationInput> = {
      createdAt: { createdAt: direction },
      updatedAt: { updatedAt: direction },
      startTime: { startTime: direction },
      endTime: { endTime: direction },
      name: { name: direction },
      status: { status: direction },
      durationMinutes: { durationMinutes: direction },
    };
    const primary = orderMap[query.sortBy || 'createdAt'] ?? { createdAt: 'desc' };
    return query.sortBy && query.sortBy !== 'createdAt' ? [primary, { createdAt: 'desc' }] : [primary];
  }

  private buildAntiCheatConfig(config?: Record<string, unknown> | null) {
    const next = { ...(config ?? {}) };
    delete next.announcement;
    delete next.announcementVersion;
    return Object.keys(next).length ? (next as Prisma.InputJsonObject) : undefined;
  }

  private activeAnnouncementText(source: {
    announcements?: Array<{ content: string }>;
    antiCheatConfigJson?: Prisma.JsonValue | null;
  }) {
    return source.announcements?.[0]?.content ?? this.extractAnnouncement(source.antiCheatConfigJson ?? null);
  }

  private async syncAnnouncement(
    tx: Prisma.TransactionClient,
    examId: string,
    rawAnnouncement: string | undefined,
    userId: string,
  ) {
    if (rawAnnouncement === undefined) return;

    const content = rawAnnouncement.trim();
    const active = await tx.examAnnouncement.findFirst({
      where: { examId, isActive: true },
      orderBy: { version: 'desc' },
    });

    if (!content) {
      if (active) {
        await tx.examAnnouncement.updateMany({
          where: { examId, isActive: true },
          data: { isActive: false },
        });
      }
      return;
    }

    if (active?.content === content) return;

    await tx.examAnnouncement.updateMany({
      where: { examId, isActive: true },
      data: { isActive: false },
    });
    const latest = await tx.examAnnouncement.aggregate({
      where: { examId },
      _max: { version: true },
    });
    await tx.examAnnouncement.create({
      data: {
        examId,
        version: (latest._max.version ?? 0) + 1,
        content,
        createdBy: userId,
      },
    });
  }

  private extractAnnouncement(config: Prisma.JsonValue | null) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return '';
    const value = (config as Record<string, unknown>).announcement;
    return typeof value === 'string' ? value : '';
  }

  private extractResultVisibility(config: Prisma.JsonValue | null) {
    const defaults = {
      questionScore: true,
      content: false,
      studentAnswer: false,
      correctness: false,
      correctAnswer: false,
      analysis: false,
    };
    if (!config || typeof config !== 'object' || Array.isArray(config)) return defaults;
    const value = (config as Record<string, unknown>).resultVisibility;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
    const source = value as Record<string, unknown>;
    return {
      questionScore: typeof source.questionScore === 'boolean' ? source.questionScore : defaults.questionScore,
      content: typeof source.content === 'boolean' ? source.content : defaults.content,
      studentAnswer: typeof source.studentAnswer === 'boolean' ? source.studentAnswer : defaults.studentAnswer,
      correctness: typeof source.correctness === 'boolean' ? source.correctness : defaults.correctness,
      correctAnswer: typeof source.correctAnswer === 'boolean' ? source.correctAnswer : defaults.correctAnswer,
      analysis: typeof source.analysis === 'boolean' ? source.analysis : defaults.analysis,
    };
  }

  private async loadClassMap(classIds: string[]) {
    if (!classIds.length) return new Map<string, { id: string; name: string }>();
    const classes = await this.prisma.classGroup.findMany({
      where: { id: { in: [...new Set(classIds)] }, deletedAt: null },
      select: { id: true, name: true },
    });
    return new Map(classes.map((item) => [item.id, item]));
  }

  private async studentsInClass(classId: string) {
    const relations = await this.prisma.classStudent.findMany({
      where: {
        classId,
        student: {
          userType: UserType.STUDENT,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
      },
      include: {
        student: {
          select: {
            id: true,
            username: true,
            realName: true,
            userType: true,
            status: true,
          },
        },
      },
    });

    return relations.map((relation) => relation.student);
  }
}
