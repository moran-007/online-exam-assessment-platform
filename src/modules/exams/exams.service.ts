import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ExamStatus, PaperStatus, Prisma } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { normalizeExamStatus, toApiEnum } from '../../common/utils/enum-normalizer';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { BulkUpdateExamStatusDto } from './dto/bulk-update-exam-status.dto';
import { CreateExamDto } from './dto/create-exam.dto';
import { QueryExamDto } from './dto/query-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: QueryExamDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.ExamWhereInput = {
      deletedAt: null,
      courseId: query.courseId,
      classId: query.classId,
      status: query.status ? normalizeExamStatus(query.status) : undefined,
      OR: query.keyword ? [{ name: { contains: query.keyword, mode: 'insensitive' } }] : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.exam.findMany({
        where,
        include: {
          course: { select: { name: true } },
          paper: { select: { name: true, totalScore: true } },
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
      items: items.map((exam) => ({
        ...exam,
        status: toApiEnum(exam.status),
        courseName: exam.course.name,
        paperName: exam.paper.name,
        className: exam.classId ? classMap.get(exam.classId)?.name ?? '' : '公开',
        totalScore: Number(exam.paper.totalScore),
        attemptCount: exam._count.attempts,
        announcement: this.extractAnnouncement(exam.antiCheatConfigJson),
        resultVisibility: this.extractResultVisibility(exam.antiCheatConfigJson),
      })),
      page,
      pageSize,
      total,
    };
  }

  async create(dto: CreateExamDto, userId: string) {
    const paper = await this.prisma.paper.findFirst({
      where: { id: dto.paperId, status: PaperStatus.PUBLISHED, deletedAt: null },
    });

    if (!paper) {
      throw new BadRequestException('只能基于已发布试卷创建考试');
    }

    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) {
      throw new BadRequestException('考试时间不合法');
    }

    const exam = await this.prisma.exam.create({
      data: {
        paperId: dto.paperId,
        name: dto.name,
        courseId: dto.courseId,
        classId: dto.classId,
        startTime,
        endTime,
        durationMinutes: dto.durationMinutes,
        attemptLimit: dto.attemptLimit ?? 1,
        showAnswerMode: this.normalizeShowAnswerMode(dto.showAnswerMode ?? 'after_exam_end'),
        showScoreMode: this.normalizeShowScoreMode(dto.showScoreMode ?? 'after_submit'),
        antiCheatConfigJson: this.buildAntiCheatConfig(dto.antiCheatConfig, dto.announcement),
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.audit.log({
      userId,
      action: 'exam:create',
      module: 'exam',
      targetType: 'exam',
      targetId: exam.id,
      afterData: { name: exam.name },
    });

    return { id: exam.id };
  }

  async detail(id: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, deletedAt: null },
      include: {
        paper: true,
        course: true,
      },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在');
    }

    const classMap = await this.loadClassMap(exam.classId ? [exam.classId] : []);

    return {
      ...exam,
      status: toApiEnum(exam.status),
      className: exam.classId ? classMap.get(exam.classId)?.name ?? '' : '公开',
      announcement: this.extractAnnouncement(exam.antiCheatConfigJson),
      resultVisibility: this.extractResultVisibility(exam.antiCheatConfigJson),
      paper: { ...exam.paper, status: toApiEnum(exam.paper.status), totalScore: Number(exam.paper.totalScore) },
    };
  }

  async update(id: string, dto: UpdateExamDto, userId: string) {
    const current = await this.prisma.exam.findFirst({
      where: { id, deletedAt: null },
    });

    if (!current) {
      throw new NotFoundException('考试不存在');
    }

    const statusOnlyPatch = this.isStatusOnlyPatch(dto);
    if ((current.status === ExamStatus.RUNNING || current.status === ExamStatus.ENDED) && !statusOnlyPatch) {
      throw new BadRequestException('考试已开始或已结束，不能修改核心配置');
    }

    const nextStartTime = dto.startTime ? new Date(dto.startTime) : current.startTime;
    const nextEndTime = dto.endTime ? new Date(dto.endTime) : current.endTime;
    if (
      Number.isNaN(nextStartTime.getTime()) ||
      Number.isNaN(nextEndTime.getTime()) ||
      nextEndTime <= nextStartTime
    ) {
      throw new BadRequestException('考试时间不合法');
    }

    const updated = await this.prisma.exam.update({
      where: { id },
      data: {
        paperId: dto.paperId,
        name: dto.name,
        courseId: dto.courseId,
        classId: dto.classId,
        startTime: dto.startTime ? nextStartTime : undefined,
        endTime: dto.endTime ? nextEndTime : undefined,
        durationMinutes: dto.durationMinutes,
        attemptLimit: dto.attemptLimit,
        status: dto.status ? normalizeExamStatus(dto.status) : undefined,
        showAnswerMode: dto.showAnswerMode ? this.normalizeShowAnswerMode(dto.showAnswerMode) : undefined,
        showScoreMode: dto.showScoreMode ? this.normalizeShowScoreMode(dto.showScoreMode) : undefined,
        antiCheatConfigJson:
          dto.antiCheatConfig !== undefined || dto.announcement !== undefined
            ? this.buildAntiCheatConfig(
                dto.antiCheatConfig ?? (current.antiCheatConfigJson as Record<string, unknown> | null) ?? undefined,
                dto.announcement,
              )
            : undefined,
        updatedBy: userId,
      },
    });

    await this.audit.log({
      userId,
      action: 'exam:update',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
      beforeData: { name: current.name, status: current.status },
      afterData: { name: updated.name, status: updated.status },
    });

    return { id };
  }

  async publish(id: string, userId: string) {
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
      data: { status, updatedBy: userId },
    });

    await this.audit.log({
      userId,
      action: 'exam:publish',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
      afterData: { status: updated.status },
    });

    return { id, status: toApiEnum(updated.status) };
  }

  async unpublish(id: string, userId: string) {
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
      data: { status: ExamStatus.DRAFT, updatedBy: userId },
    });

    await this.audit.log({
      userId,
      action: 'exam:unpublish',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
      afterData: { status: updated.status },
    });

    return { id, status: toApiEnum(updated.status) };
  }

  async bulkUpdateStatus(dto: BulkUpdateExamStatusDto, userId: string) {
    const status = normalizeExamStatus(dto.status);
    const ids = [...new Set(dto.ids)];
    const failed: Array<{ id: string; message: string }> = [];
    let successCount = 0;

    for (const id of ids) {
      try {
        await this.update(id, { status: toApiEnum(status) }, userId);
        successCount += 1;
      } catch (error) {
        failed.push({ id, message: error instanceof Error ? error.message : '状态更新失败' });
      }
    }

    await this.audit.log({
      userId,
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

  async remove(id: string, userId: string) {
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
        updatedBy: userId,
      },
    });

    await this.audit.log({
      userId,
      action: 'exam:delete',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
    });

    return true;
  }

  async results(id: string, query: QueryExamDto) {
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

  async statistics(id: string) {
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

  private buildAntiCheatConfig(config?: Record<string, unknown>, announcement?: string) {
    const next = { ...(config ?? {}) };
    if (announcement !== undefined) {
      const trimmed = announcement.trim();
      if (trimmed) {
        next.announcement = trimmed;
      } else {
        delete next.announcement;
      }
    }
    return Object.keys(next).length ? (next as Prisma.InputJsonObject) : undefined;
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
}
