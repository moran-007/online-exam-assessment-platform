/* eslint-disable @typescript-eslint/no-unused-vars */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExportStatus, MasteryStatus, Prisma, QuestionStatus, UserType, WrongQuestionSourceType } from '@prisma/client';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import PDFDocument = require('pdfkit');
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { toApiEnum } from '../../common/utils/enum-normalizer';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExportDto } from './dto/create-export.dto';
import { QueryExportDto } from './dto/query-export.dto';

type ExportQuestion = {
  sourceId?: string;
  title: string;
  type: string;
  score: number;
  defaultScore?: number;
  difficulty?: number;
  status?: string;
  courseId?: string;
  courseName?: string;
  content: string;
  options: Array<{ id?: string; label: string; content: string; isCorrect?: boolean; sortOrder?: number }>;
  answer?: Record<string, unknown> | null;
  scoringRule?: Record<string, unknown> | null;
  analysis?: string | null;
  sectionTitle?: string;
  tagNames?: string[];
  knowledgePointNames?: string[];
  allowOptionShuffle?: boolean;
  wrongCount?: number;
  lastWrongAt?: Date;
};

type DocumentExportContent = {
  title: string;
  subtitle: string;
  questions: ExportQuestion[];
  includeAnswers: boolean;
  includeAnalysis: boolean;
  includeWrongInfo: boolean;
  template?: string;
};

type MarkdownSegment =
  | { type: 'text'; value: string }
  | { type: 'image'; alt: string; src: string };

type QuestionExportEntity = Prisma.QuestionGetPayload<{
  include: {
    course: true;
    options: true;
    answer: true;
    tags: { include: { tag: true } };
    knowledgePoints: { include: { knowledgePoint: true } };
  };
}>;

type FullArchivePaper = Prisma.PaperGetPayload<{
  include: {
    course: true;
    _count: { select: { sections: true; questions: true; exams: true } };
  };
}>;

type ZipEntry = {
  name: string;
  data: Buffer;
  date?: Date;
};
import { ExportsContext } from './exports.context';
import { exportDateRange, exportDateTimeRange, normalizeWrongSourceType } from './export-format.operations';
export async function statisticsRows(ctx: ExportsContext, dto: CreateExportDto, user: RequestUser) {
    const examScope = await ctx.dataScope.examWhere(user, dto.classId);
    if (dto.examId) {
      await ctx.dataScope.assertExamAccessible(user, dto.examId);
    }
    const submittedAt = exportDateRange(ctx, dto);
    const attempts = await ctx.prisma.examAttempt.findMany({
      where: {
        submittedAt,
        examId: dto.examId,
        exam: { ...examScope, courseId: dto.courseId },
      },
      include: {
        exam: {
          include: {
            course: { select: { name: true } },
            paper: { select: { totalScore: true } },
          },
        },
        answers: {
          include: {
            question: {
              include: {
                knowledgePoints: { include: { knowledgePoint: true } },
              },
            },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });
    const section = dto.section ?? 'current';
    if (section === 'distribution') {
      return statisticsDistributionRows(ctx, attempts);
    }
    if (section === 'knowledge') {
      return statisticsKnowledgeRows(ctx, attempts);
    }
    if (section === 'classes') {
      return statisticsClassRows(ctx, attempts);
    }
    if (section === 'diagnostics') {
      return statisticsQuestionDiagnosticRows(ctx, attempts);
    }
    if (section === 'wrong_questions') {
      return statisticsWrongQuestionRows(ctx, dto, user);
    }

    const rows: Array<Record<string, unknown>> = [];
    const grouped = new Map<string, { exam: string; course: string; count: number; total: number; max: number; min: number; fullScore: number }>();
    for (const attempt of attempts) {
      const current = grouped.get(attempt.examId) ?? {
        exam: attempt.exam.name,
        course: attempt.exam.course.name,
        count: 0,
        total: 0,
        max: 0,
        min: Number.MAX_SAFE_INTEGER,
        fullScore: Number(attempt.exam.paper.totalScore) || 0,
      };
      const score = Number(attempt.totalScore);
      current.count += 1;
      current.total += score;
      current.max = Math.max(current.max, score);
      current.min = Math.min(current.min, score);
      grouped.set(attempt.examId, current);
    }
    rows.push(
      ...[...grouped.values()].map((item) => ({
      section: '考试汇总',
      exam: item.exam,
      course: item.course,
      submitCount: item.count,
      averageScore: item.count ? Number((item.total / item.count).toFixed(2)) : 0,
      maxScore: item.max,
      minScore: item.min === Number.MAX_SAFE_INTEGER ? 0 : item.min,
      fullScore: item.fullScore,
      averagePercent: item.count && item.fullScore > 0 ? Number(((item.total / item.count / item.fullScore) * 100).toFixed(2)) : 0,
    })),
    );

    if (section === 'current' || section === 'overview') {
      rows.push(...statisticsDistributionRows(ctx, attempts));
      rows.push(...statisticsClassRows(ctx, attempts));
      rows.push(...statisticsKnowledgeRows(ctx, attempts));
      rows.push(...statisticsQuestionDiagnosticRows(ctx, attempts));
    }

    return rows;
  }

export function statisticsDistributionRows(ctx: ExportsContext, 
    attempts: Array<Prisma.ExamAttemptGetPayload<{
      include: {
        exam: { include: { course: { select: { name: true } }; paper: { select: { totalScore: true } } } };
        answers: { include: { question: { include: { knowledgePoints: { include: { knowledgePoint: true } } } } } };
      };
    }>>,
  ) {
    const buckets = [
      { label: '0-59%', min: 0, max: 59, count: 0 },
      { label: '60-69%', min: 60, max: 69, count: 0 },
      { label: '70-79%', min: 70, max: 79, count: 0 },
      { label: '80-89%', min: 80, max: 89, count: 0 },
      { label: '90-100%', min: 90, max: 100, count: 0 },
    ];
    for (const attempt of attempts) {
      const fullScore = Number(attempt.exam.paper.totalScore) || 0;
      const percent = fullScore > 0 ? Math.min(100, Math.max(0, (Number(attempt.totalScore) / fullScore) * 100)) : 0;
      const rounded = Math.floor(percent);
      const bucket = buckets.find((item) => rounded >= item.min && rounded <= item.max) ?? buckets[buckets.length - 1];
      bucket.count += 1;
    }
    return buckets.map((bucket) => ({
      section: '成绩分布',
      bucket: bucket.label,
      minPercent: bucket.min,
      maxPercent: bucket.max,
      count: bucket.count,
      percent: attempts.length ? Number(((bucket.count / attempts.length) * 100).toFixed(2)) : 0,
    }));
  }

export function statisticsClassRows(ctx: ExportsContext, 
    attempts: Array<Prisma.ExamAttemptGetPayload<{
      include: {
        exam: { include: { course: { select: { name: true } }; paper: { select: { totalScore: true } } } };
        answers: { include: { question: { include: { knowledgePoints: { include: { knowledgePoint: true } } } } } };
      };
    }>>,
  ) {
    const groups = new Map<string, { classId: string; courseName: string; total: number; count: number; pass: number; max: number; min: number }>();
    for (const attempt of attempts) {
      const classId = attempt.exam.classId ?? '公开';
      const fullScore = Number(attempt.exam.paper.totalScore) || 0;
      const current = groups.get(classId) ?? {
        classId,
        courseName: attempt.exam.course.name,
        total: 0,
        count: 0,
        pass: 0,
        max: 0,
        min: Number.MAX_SAFE_INTEGER,
      };
      const score = Number(attempt.totalScore);
      current.count += 1;
      current.total += score;
      current.max = Math.max(current.max, score);
      current.min = Math.min(current.min, score);
      if (fullScore > 0 && score / fullScore >= 0.6) current.pass += 1;
      groups.set(classId, current);
    }
    return [...groups.values()].map((item) => ({
      section: '班级对比',
      classId: item.classId,
      course: item.courseName,
      submitCount: item.count,
      averageScore: item.count ? Number((item.total / item.count).toFixed(2)) : 0,
      maxScore: item.max,
      minScore: item.min === Number.MAX_SAFE_INTEGER ? 0 : item.min,
      passRate: item.count ? Number(((item.pass / item.count) * 100).toFixed(2)) : 0,
    }));
  }

export function statisticsKnowledgeRows(ctx: ExportsContext, 
    attempts: Array<Prisma.ExamAttemptGetPayload<{
      include: {
        exam: { include: { course: { select: { name: true } }; paper: { select: { totalScore: true } } } };
        answers: { include: { question: { include: { knowledgePoints: { include: { knowledgePoint: true } } } } } };
      };
    }>>,
  ) {
    const groups = new Map<string, { name: string; total: number; correct: number; score: number }>();
    for (const attempt of attempts) {
      for (const record of attempt.answers) {
        for (const relation of record.question.knowledgePoints) {
          const point = relation.knowledgePoint;
          const current = groups.get(point.id) ?? { name: point.name, total: 0, correct: 0, score: 0 };
          current.total += 1;
          current.correct += record.isCorrect ? 1 : 0;
          current.score += Number(record.score);
          groups.set(point.id, current);
        }
      }
    }
    return [...groups.entries()].map(([knowledgePointId, item]) => ({
      section: '知识点趋势',
      knowledgePointId,
      knowledgePoint: item.name,
      answerCount: item.total,
      correctRate: item.total ? Number(((item.correct / item.total) * 100).toFixed(2)) : 0,
      averageScore: item.total ? Number((item.score / item.total).toFixed(2)) : 0,
    }));
  }

export function statisticsQuestionDiagnosticRows(ctx: ExportsContext, 
    attempts: Array<Prisma.ExamAttemptGetPayload<{
      include: {
        exam: { include: { course: { select: { name: true } }; paper: { select: { totalScore: true } } } };
        answers: { include: { question: { include: { knowledgePoints: { include: { knowledgePoint: true } } } } } };
      };
    }>>,
  ) {
    const attemptScores = attempts.map((attempt) => ({ id: attempt.id, score: Number(attempt.totalScore) })).sort((a, b) => b.score - a.score);
    const groupSize = attemptScores.length >= 4 ? Math.max(1, Math.floor(attemptScores.length * 0.27)) : Math.max(1, Math.ceil(attemptScores.length / 2));
    const topIds = new Set(attemptScores.slice(0, groupSize).map((attempt) => attempt.id));
    const bottomIds = new Set(attemptScores.slice(-groupSize).map((attempt) => attempt.id));
    const groups = new Map<string, {
      title: string;
      type: string;
      difficulty: number;
      total: number;
      correct: number;
      score: number;
      topTotal: number;
      topCorrect: number;
      bottomTotal: number;
      bottomCorrect: number;
    }>();
    for (const attempt of attempts) {
      for (const record of attempt.answers) {
        const current = groups.get(record.questionId) ?? {
          title: record.question.title,
          type: toApiEnum(record.question.type),
          difficulty: record.question.difficulty,
          total: 0,
          correct: 0,
          score: 0,
          topTotal: 0,
          topCorrect: 0,
          bottomTotal: 0,
          bottomCorrect: 0,
        };
        const isCorrect = record.isCorrect === true;
        current.total += 1;
        current.correct += isCorrect ? 1 : 0;
        current.score += Number(record.score);
        if (topIds.has(attempt.id)) {
          current.topTotal += 1;
          current.topCorrect += isCorrect ? 1 : 0;
        }
        if (bottomIds.has(attempt.id)) {
          current.bottomTotal += 1;
          current.bottomCorrect += isCorrect ? 1 : 0;
        }
        groups.set(record.questionId, current);
      }
    }
    return [...groups.entries()].map(([questionId, item]) => {
      const correctRate = item.total ? item.correct / item.total : 0;
      const discrimination = (item.topTotal ? item.topCorrect / item.topTotal : 0) - (item.bottomTotal ? item.bottomCorrect / item.bottomTotal : 0);
      const actualDifficulty = 1 + (1 - correctRate) * 4;
      return {
        section: '题目诊断',
        questionId,
        question: item.title,
        type: item.type,
        configuredDifficulty: item.difficulty,
        actualDifficulty: Number(actualDifficulty.toFixed(2)),
        difficultyDelta: Number((actualDifficulty - item.difficulty).toFixed(2)),
        answerCount: item.total,
        correctRate: Number((correctRate * 100).toFixed(2)),
        averageScore: item.total ? Number((item.score / item.total).toFixed(2)) : 0,
        discrimination: Number(discrimination.toFixed(4)),
      };
    });
  }

export async function statisticsWrongQuestionRows(ctx: ExportsContext, dto: CreateExportDto, user: RequestUser) {
    const classWhere = await ctx.dataScope.classWhere(user, dto.classId);
    const classGroups = await ctx.prisma.classGroup.findMany({
      where: { ...classWhere, deletedAt: null, courseId: dto.courseId },
      include: { students: { select: { studentId: true } } },
    });
    const scopedStudentIds = [...new Set(classGroups.flatMap((item) => item.students.map((student) => student.studentId)))];
    const studentIdFilter = dto.classId || !ctx.dataScope.isUnrestricted(user) ? scopedStudentIds : undefined;
    const items = await ctx.prisma.wrongQuestion.findMany({
      where: {
        studentId: studentIdFilter ? { in: studentIdFilter } : undefined,
        sourceType: normalizeWrongSourceType(ctx, dto.sourceType),
        lastWrongAt: exportDateTimeRange(ctx, dto),
        question: { deletedAt: null, courseId: dto.courseId },
      },
      include: {
        question: {
          include: {
            course: { select: { name: true } },
            knowledgePoints: { include: { knowledgePoint: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ wrongCount: 'desc' }, { lastWrongAt: 'desc' }],
      take: 1000,
    });
    return items.map((item) => ({
      section: '高频错题',
      questionId: item.questionId,
      question: item.question.title,
      course: item.question.course.name,
      knowledgePoints: item.question.knowledgePoints.map((relation) => relation.knowledgePoint.name).join('、'),
      sourceType: toApiEnum(item.sourceType),
      masteryStatus: toApiEnum(item.masteryStatus),
      wrongCount: item.wrongCount,
      score: Number(item.score),
      lastWrongAt: item.lastWrongAt.toISOString(),
    }));
  }