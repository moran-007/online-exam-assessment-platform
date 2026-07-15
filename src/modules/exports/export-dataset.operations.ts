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
import { exportQuestionFromEntity, exportQuestionFromSnapshot } from './export-access.operations';
import { documentTemplateLabel, formatAnswer, loadUsers } from './export-format.operations';
export async function examRows(ctx: ExportsContext, dto: CreateExportDto, user: RequestUser) {
    if (!dto.examId) throw new BadRequestException('导出考试成绩需要选择考试');
    await ctx.dataScope.assertExamAccessible(user, dto.examId);
    const attempts = await ctx.prisma.examAttempt.findMany({
      where: { examId: dto.examId, submittedAt: { not: null } },
      include: { exam: true },
      orderBy: [{ totalScore: 'desc' }, { submittedAt: 'asc' }],
    });
    const users = await loadUsers(ctx, attempts.map((attempt) => attempt.userId));
    const counters = new Map<string, number>();
    return attempts.map((attempt, index) => {
      const next = (counters.get(attempt.userId) ?? 0) + 1;
      counters.set(attempt.userId, next);
      const user = users.get(attempt.userId);
      return {
        rank: index + 1,
        exam: attempt.exam.name,
        student: user?.realName ?? user?.username ?? attempt.userId,
        username: user?.username ?? '',
        attemptNo: next,
        totalScore: Number(attempt.totalScore),
        objectiveScore: Number(attempt.objectiveScore),
        subjectiveScore: Number(attempt.subjectiveScore),
        judgeScore: Number(attempt.judgeScore),
        status: toApiEnum(attempt.status),
        submittedAt: attempt.submittedAt?.toISOString() ?? '',
      };
    });
  }

export async function gradingRows(ctx: ExportsContext, dto: CreateExportDto, user: RequestUser) {
    const examScope = await ctx.dataScope.examWhere(user, dto.classId);
    if (dto.examId) {
      await ctx.dataScope.assertExamAccessible(user, dto.examId);
    }
    const records = await ctx.prisma.answerRecord.findMany({
      where: {
        attempt: {
          examId: dto.examId,
          exam: { ...examScope, courseId: dto.courseId },
          submittedAt: { not: null },
        },
      },
      include: {
        question: { select: { title: true, type: true } },
        attempt: { include: { exam: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const users = await loadUsers(ctx, records.map((record) => record.attempt.userId));
    return records.map((record) => {
      const user = users.get(record.attempt.userId);
      return {
        exam: record.attempt.exam.name,
        student: user?.realName ?? user?.username ?? record.attempt.userId,
        username: user?.username ?? '',
        question: record.question.title,
        questionType: toApiEnum(record.question.type),
        answerStatus: toApiEnum(record.status),
        score: Number(record.score),
        manualComment: record.manualComment ?? '',
        gradedAt: record.gradedAt?.toISOString() ?? '',
      };
    });
  }

export async function questionRows(ctx: ExportsContext, dto: CreateExportDto) {
    const questions = await loadQuestionExportItems(ctx, dto);
    return questions.map((question) => questionRow(ctx, question, dto));
  }

export async function loadQuestionExportItems(ctx: ExportsContext, dto: CreateExportDto): Promise<QuestionExportEntity[]> {
    return ctx.prisma.question.findMany({
      where: {
        deletedAt: null,
        courseId: dto.courseId,
        id: dto.questionIds?.length ? { in: dto.questionIds } : undefined,
      },
      include: {
        course: true,
        options: { orderBy: { sortOrder: 'asc' } },
        answer: true,
        tags: { include: { tag: true } },
        knowledgePoints: { include: { knowledgePoint: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

export function questionRow(ctx: ExportsContext, question: QuestionExportEntity, dto: CreateExportDto) {
    return questionTransferRow(ctx, exportQuestionFromEntity(ctx, question), dto, undefined, 'question_bank', {
      createdAt: question.createdAt.toISOString(),
      updatedAt: question.updatedAt.toISOString(),
    });
  }

export async function paperRows(ctx: ExportsContext, dto: CreateExportDto) {
    const papers = await ctx.prisma.paper.findMany({
      where: { deletedAt: null, courseId: dto.courseId },
      include: { course: true, _count: { select: { questions: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return papers.map((paper) => ({
      name: paper.name,
      course: paper.course.name,
      questionCount: paper._count.questions,
      totalScore: Number(paper.totalScore),
      durationMinutes: paper.durationMinutes,
      status: toApiEnum(paper.status),
      createdAt: paper.createdAt.toISOString(),
    }));
  }

export async function paperDocumentRows(ctx: ExportsContext, dto: CreateExportDto) {
    const content = await paperDocumentContent(ctx, dto);
    return content.questions.map((question, index) =>
      questionTransferRow(ctx, question, dto, index, 'paper_document', {
        paperId: dto.paperId ?? '',
        paperName: content.title,
      }),
    );
  }

export function questionTransferRow(ctx: ExportsContext, 
    question: ExportQuestion,
    dto: CreateExportDto,
    index?: number,
    source = 'question_bank',
    extra: Record<string, unknown> = {},
  ) {
    const includeAnswers = dto.includeAnswers ?? true;
    const includeAnalysis = dto.includeAnalysis ?? true;
    const options = question.options.map((option, optionIndex) => ({
      id: option.id,
      optionKey: option.label,
      label: option.label,
      content: option.content,
      contentMarkdown: option.content,
      isCorrect: includeAnswers ? Boolean(option.isCorrect) : false,
      sortOrder: option.sortOrder ?? optionIndex + 1,
    }));
    const answer = includeAnswers ? question.answer ?? {} : {};
    const scoringRule = includeAnswers ? question.scoringRule ?? {} : {};
    const analysis = includeAnalysis ? question.analysis ?? '' : '';
    const tagNames = question.tagNames ?? [];
    const knowledgePointNames = question.knowledgePointNames ?? [];

    return {
      schemaVersion: 'question-transfer-v2',
      source,
      no: index === undefined ? '' : index + 1,
      questionId: question.sourceId ?? '',
      paperId: extra.paperId ?? '',
      paperName: extra.paperName ?? '',
      section: question.sectionTitle ?? '',
      title: question.title,
      type: question.type,
      difficulty: question.difficulty ?? 1,
      defaultScore: question.defaultScore ?? question.score,
      score: question.score,
      status: question.status ?? '',
      courseId: question.courseId ?? '',
      courseName: question.courseName ?? '',
      contentMarkdown: question.content,
      content: question.content,
      optionsJson: JSON.stringify(options),
      options: JSON.stringify(options),
      answerJson: JSON.stringify(answer),
      answer: JSON.stringify(answer),
      answerText: includeAnswers ? formatAnswer(ctx, answer, question.options) : '',
      scoringRuleJson: JSON.stringify(scoringRule),
      scoringRule: JSON.stringify(scoringRule),
      analysisMarkdown: analysis,
      analysis,
      knowledgePointNames: knowledgePointNames.join(','),
      tagNames: tagNames.join(','),
      allowOptionShuffle: question.allowOptionShuffle ?? '',
      createdAt: extra.createdAt ?? '',
      updatedAt: extra.updatedAt ?? '',
    };
  }

export async function wrongQuestionRows(ctx: ExportsContext, dto: CreateExportDto, userId: string) {
    const content = await wrongQuestionDocumentContent(ctx, dto, userId);
    return content.questions.map((question, index) => ({
      no: index + 1,
      title: question.title,
      type: question.type,
      score: question.score,
      wrongCount: question.wrongCount ?? 0,
      lastWrongAt: question.lastWrongAt?.toISOString() ?? '',
      answer: formatAnswer(ctx, question.answer, question.options),
      analysis: question.analysis ?? '',
    }));
  }

export async function paperDocumentContent(ctx: ExportsContext, dto: CreateExportDto): Promise<DocumentExportContent> {
    if (!dto.paperId) throw new BadRequestException('导出试卷文档需要选择试卷');
    const paper = await ctx.prisma.paper.findFirst({
      where: { id: dto.paperId, deletedAt: null },
      include: {
        course: true,
        sections: { orderBy: { sortOrder: 'asc' }, include: { questions: { orderBy: { sortOrder: 'asc' } } } },
        questions: { where: { sectionId: null }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!paper) throw new NotFoundException('试卷不存在');

    const questions: ExportQuestion[] = [];
    for (const section of paper.sections) {
      for (const question of section.questions) {
        questions.push(exportQuestionFromSnapshot(ctx, question, section.title));
      }
    }
    for (const question of paper.questions) {
      questions.push(exportQuestionFromSnapshot(ctx, question, '未分区题目'));
    }

    return {
      title: paper.name,
      subtitle: `${documentTemplateLabel(ctx, dto.template)} · ${paper.course.name} · ${questions.length} 题 · ${Number(paper.totalScore)} 分 · ${paper.durationMinutes} 分钟`,
      questions,
      includeAnswers: dto.template === 'answer_book' ? true : dto.includeAnswers ?? false,
      includeAnalysis: dto.template === 'answer_book' ? true : dto.includeAnalysis ?? false,
      includeWrongInfo: false,
      template: dto.template ?? 'student',
    };
  }

export async function wrongQuestionDocumentContent(ctx: ExportsContext, dto: CreateExportDto, userId: string): Promise<DocumentExportContent> {
    if (!userId) throw new BadRequestException('导出错题需要登录学生账号');
    const items = await ctx.prisma.wrongQuestion.findMany({
      where: {
        studentId: userId,
        masteryStatus: { in: [MasteryStatus.UNMASTERED, MasteryStatus.REVIEWING] },
        question: { deletedAt: null, status: QuestionStatus.PUBLISHED },
      },
      include: {
        question: {
          include: {
            course: true,
            options: { orderBy: { sortOrder: 'asc' } },
            answer: true,
          },
        },
      },
      orderBy: [{ wrongCount: 'desc' }, { lastWrongAt: 'desc' }],
    });

    return {
      title: '个人错题导出',
      subtitle: `${items.length} 道错题 · ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      questions: items.map((item) => ({
        title: item.question.title,
        type: toApiEnum(item.question.type),
        score: Number(item.question.defaultScore),
        content: item.question.content,
        options: item.question.options.map((option) => ({
          id: option.id,
          label: option.optionKey,
          content: option.content,
          isCorrect: option.isCorrect,
        })),
        answer: (item.question.answer?.answerJson ?? item.correctAnswerJson ?? {}) as Record<string, unknown>,
        analysis: item.question.analysis,
        sectionTitle: item.question.course.name,
        wrongCount: item.wrongCount,
        lastWrongAt: item.lastWrongAt,
      })),
      includeAnswers: dto.includeAnswers ?? true,
      includeAnalysis: dto.includeAnalysis ?? true,
      includeWrongInfo: dto.includeWrongInfo ?? true,
      template: dto.template ?? 'teacher',
    };
  }

export async function questionDocumentContent(ctx: ExportsContext, dto: CreateExportDto): Promise<DocumentExportContent> {
    const questions = await loadQuestionExportItems(ctx, dto);
    if (!questions.length) {
      throw new BadRequestException('没有可导出的题目');
    }
    const courseNames = [...new Set(questions.map((question) => question.course.name))].join('、');

    return {
      title: '题库导出',
      subtitle: `${courseNames || '全部课程'} · ${questions.length} 道题 · ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      questions: questions.map((question) => exportQuestionFromEntity(ctx, question)),
      includeAnswers: dto.includeAnswers ?? true,
      includeAnalysis: dto.includeAnalysis ?? true,
      includeWrongInfo: false,
      template: dto.template ?? 'teacher',
    };
  }

export async function classRows(ctx: ExportsContext, dto: CreateExportDto, user: RequestUser) {
    const classWhere = await ctx.dataScope.classWhere(user, dto.classId);
    const classes = await ctx.prisma.classGroup.findMany({
      where: { ...classWhere, deletedAt: null, courseId: dto.courseId },
      include: { course: true, _count: { select: { students: true, teachers: true } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return classes.map((item) => ({
      name: item.name,
      code: item.code,
      course: item.course?.name ?? '',
      status: item.status,
      students: item._count.students,
      teachers: item._count.teachers,
      createdAt: item.createdAt.toISOString(),
    }));
  }