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
import { end, start } from './exam-lifecycle.operations';
export async function create(ctx: ExamsContext, dto: CreateExamDto, user: RequestUser) {
    await ctx.dataScope.assertClassWritable(user, dto.classId);
    const paper = await ctx.prisma.paper.findFirst({
      where: { id: dto.paperId, status: PaperStatus.PUBLISHED, deletedAt: null },
    });

    if (!paper) {
      throw new BadRequestException('只能基于已发布试卷创建考试');
    }

    const startTime = parseExamTime(ctx, dto.startTime);
    const durationMinutes = dto.durationMinutes ?? paper.durationMinutes;
    const endTime = examEndTime(ctx, startTime, durationMinutes);
    if (Number.isNaN(startTime.getTime()) || durationMinutes < 1) {
      throw new BadRequestException('考试时间不合法');
    }

    const exam = await ctx.prisma.$transaction(async (tx) => {
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
          showAnswerMode: normalizeShowAnswerMode(ctx, dto.showAnswerMode ?? 'after_exam_end'),
          showScoreMode: normalizeShowScoreMode(ctx, dto.showScoreMode ?? 'after_submit'),
          antiCheatConfigJson: buildAntiCheatConfig(ctx, dto.antiCheatConfig),
          createdBy: user.id,
          updatedBy: user.id,
        },
      });

      await syncAnnouncement(ctx, tx, created.id, dto.announcement, user.id);
      return created;
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'exam:create',
      module: 'exam',
      targetType: 'exam',
      targetId: exam.id,
      afterData: { name: exam.name },
    });

    return { id: exam.id };
  }

export async function update(ctx: ExamsContext, id: string, dto: UpdateExamDto, user: RequestUser) {
    await ctx.dataScope.assertExamAccessible(user, id);
    await ctx.dataScope.assertClassWritable(user, dto.classId);
    const current = await ctx.prisma.exam.findFirst({
      where: { id, deletedAt: null },
    });

    if (!current) {
      throw new NotFoundException('考试不存在');
    }

    const statusOnlyPatch = isStatusOnlyPatch(ctx, dto);
    if (
      (current.status === ExamStatus.RUNNING || current.status === ExamStatus.ENDED) &&
      !statusOnlyPatch &&
      !canOverrideLockedExam(ctx, user)
    ) {
      throw new BadRequestException('考试已开始或已结束，不能修改核心配置');
    }
    if (statusOnlyPatch && dto.status) {
      const targetStatus = normalizeExamStatus(dto.status);
      if (targetStatus === ExamStatus.ENDED) {
        return end(ctx, id, user);
      }
      if (targetStatus === ExamStatus.RUNNING) {
        return start(ctx, id, user);
      }
    }

    const nextStartTime = dto.startTime ? parseExamTime(ctx, dto.startTime) : current.startTime;
    const nextDurationMinutes = dto.durationMinutes ?? current.durationMinutes;
    const nextEndTime = examEndTime(ctx, nextStartTime, nextDurationMinutes);
    if (Number.isNaN(nextStartTime.getTime()) || nextDurationMinutes < 1) {
      throw new BadRequestException('考试时间不合法');
    }

    const updated = await ctx.prisma.$transaction(async (tx) => {
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
          showAnswerMode: dto.showAnswerMode ? normalizeShowAnswerMode(ctx, dto.showAnswerMode) : undefined,
          showScoreMode: dto.showScoreMode ? normalizeShowScoreMode(ctx, dto.showScoreMode) : undefined,
          antiCheatConfigJson:
            dto.antiCheatConfig !== undefined || dto.announcement !== undefined
              ? buildAntiCheatConfig(ctx, nextConfigSource)
              : undefined,
          updatedBy: user.id,
        },
      });

      await syncAnnouncement(ctx, tx, id, dto.announcement, user.id);
      return saved;
    });

    await ctx.audit.log({
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

export async function remove(ctx: ExamsContext, id: string, user: RequestUser) {
    await ctx.dataScope.assertExamAccessible(user, id);
    const exam = await ctx.prisma.exam.findFirst({
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

    await ctx.prisma.exam.update({
      where: { id },
      data: {
        status: ExamStatus.ARCHIVED,
        deletedAt: new Date(),
        updatedBy: user.id,
      },
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'exam:delete',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
    });

    return true;
  }

export function parseExamTime(ctx: ExamsContext, value: string) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('考试时间不合法');
    }
    return parsed;
  }

export function examEndTime(ctx: ExamsContext, startTime: Date, durationMinutes: number) {
    const duration = Math.max(1, Math.round(Number(durationMinutes) || 1));
    return new Date(startTime.getTime() + duration * 60_000);
  }

export function canOverrideLockedExam(ctx: ExamsContext, user: RequestUser) {
    return user.userType === UserType.SUPER_ADMIN || user.userType === UserType.ADMIN;
  }

export function normalizeShowAnswerMode(ctx: ExamsContext, value: string) {
    return value.replace(/-/g, '_').toUpperCase() as never;
  }

export function isStatusOnlyPatch(ctx: ExamsContext, dto: UpdateExamDto) {
    const keys = Object.entries(dto)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    return keys.length === 1 && keys[0] === 'status';
  }

export function normalizeShowScoreMode(ctx: ExamsContext, value: string) {
    return value.replace(/-/g, '_').toUpperCase() as never;
  }

export function buildAntiCheatConfig(ctx: ExamsContext, config?: Record<string, unknown> | null) {
    const next = { ...(config ?? {}) };
    delete next.announcement;
    delete next.announcementVersion;
    return Object.keys(next).length ? (next as Prisma.InputJsonObject) : undefined;
  }

export async function syncAnnouncement(ctx: ExamsContext, 
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

export function extractAnnouncement(ctx: ExamsContext, config: Prisma.JsonValue | null) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return '';
    const value = (config as Record<string, unknown>).announcement;
    return typeof value === 'string' ? value : '';
  }

export function extractResultVisibility(ctx: ExamsContext, config: Prisma.JsonValue | null) {
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