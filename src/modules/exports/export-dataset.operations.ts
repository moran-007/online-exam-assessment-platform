import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MasteryStatus, Prisma, QuestionStatus } from '@prisma/client';
import { toApiEnum } from '../../common/utils/enum-normalizer';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { CreateExportDto } from './dto/create-export.dto';

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

type QuestionExportEntity = Prisma.QuestionGetPayload<{
  include: {
    course: true;
    options: true;
    answer: true;
    tags: { include: { tag: true } };
    knowledgePoints: { include: { knowledgePoint: true } };
  };
}>;

type WrongQuestionExportEntity = Prisma.WrongQuestionGetPayload<{
  include: {
    question: { include: { course: true; options: true; answer: true } };
  };
}>;

import { ExportsContext } from './exports.context';
import { exportQuestionFromEntity, exportQuestionFromSnapshot } from './export-access.operations';
import { documentTemplateLabel, formatAnswer, loadUsers } from './export-format.operations';
import { cursorBatches, prismaCursorPage } from './export-pagination.operations';
export async function* examRows(ctx: ExportsContext, dto: CreateExportDto, user: RequestUser) {
    if (!dto.examId) throw new BadRequestException('导出考试成绩需要选择考试');
    await ctx.dataScope.assertExamAccessible(user, dto.examId);
    const counters = new Map<string, number>();
    let rank = 0;
    const batches = cursorBatches((cursor, take) => ctx.prisma.examAttempt.findMany({
      where: { examId: dto.examId, submittedAt: { not: null } },
      include: { exam: true },
      orderBy: [{ totalScore: 'desc' }, { submittedAt: 'asc' }, { id: 'asc' }],
      ...prismaCursorPage(cursor, take),
    }));
    for await (const attempts of batches) {
      const users = await loadUsers(ctx, attempts.map((attempt) => attempt.userId));
      for (const attempt of attempts) {
        const next = (counters.get(attempt.userId) ?? 0) + 1;
        counters.set(attempt.userId, next);
        const student = users.get(attempt.userId);
        rank += 1;
        yield {
          rank,
          exam: attempt.exam.name,
          student: student?.realName ?? student?.username ?? attempt.userId,
          username: student?.username ?? '',
          attemptNo: next,
          totalScore: Number(attempt.totalScore),
          objectiveScore: Number(attempt.objectiveScore),
          subjectiveScore: Number(attempt.subjectiveScore),
          judgeScore: Number(attempt.judgeScore),
          status: toApiEnum(attempt.status),
          submittedAt: attempt.submittedAt?.toISOString() ?? '',
        };
      }
    }
  }

export async function* gradingRows(ctx: ExportsContext, dto: CreateExportDto, user: RequestUser) {
    const examScope = await ctx.dataScope.examWhere(user, dto.classId);
    if (dto.examId) {
      await ctx.dataScope.assertExamAccessible(user, dto.examId);
    }
    const batches = cursorBatches((cursor, take) => ctx.prisma.answerRecord.findMany({
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
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      ...prismaCursorPage(cursor, take),
    }));
    for await (const records of batches) {
      const users = await loadUsers(ctx, records.map((record) => record.attempt.userId));
      for (const record of records) {
        const student = users.get(record.attempt.userId);
        yield {
          exam: record.attempt.exam.name,
          student: student?.realName ?? student?.username ?? record.attempt.userId,
          username: student?.username ?? '',
          question: record.question.title,
          questionType: toApiEnum(record.question.type),
          answerStatus: toApiEnum(record.status),
          score: Number(record.score),
          manualComment: record.manualComment ?? '',
          gradedAt: record.gradedAt?.toISOString() ?? '',
        };
      }
    }
  }

export async function* questionRows(ctx: ExportsContext, dto: CreateExportDto) {
    for await (const questions of questionExportBatches(ctx, dto)) {
      for (const question of questions) yield questionRow(ctx, question, dto);
    }
  }

export async function loadQuestionExportItems(ctx: ExportsContext, dto: CreateExportDto): Promise<QuestionExportEntity[]> {
    const items: QuestionExportEntity[] = [];
    for await (const batch of questionExportBatches(ctx, dto)) items.push(...batch);
    return items;
  }

export function questionExportBatches(ctx: ExportsContext, dto: CreateExportDto) {
    return cursorBatches((cursor, take) => ctx.prisma.question.findMany({
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
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      ...prismaCursorPage(cursor, take),
    }));
  }

export function questionRow(ctx: ExportsContext, question: QuestionExportEntity, dto: CreateExportDto) {
    return questionTransferRow(ctx, exportQuestionFromEntity(ctx, question), dto, undefined, 'question_bank', {
      createdAt: question.createdAt.toISOString(),
      updatedAt: question.updatedAt.toISOString(),
    });
  }

export async function* paperRows(ctx: ExportsContext, dto: CreateExportDto) {
    const batches = cursorBatches((cursor, take) => ctx.prisma.paper.findMany({
      where: { deletedAt: null, courseId: dto.courseId },
      include: { course: true, _count: { select: { questions: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      ...prismaCursorPage(cursor, take),
    }));
    for await (const papers of batches) {
      for (const paper of papers) {
        yield {
          name: paper.name,
          course: paper.course.name,
          questionCount: paper._count.questions,
          totalScore: Number(paper.totalScore),
          durationMinutes: paper.durationMinutes,
          status: toApiEnum(paper.status),
          createdAt: paper.createdAt.toISOString(),
        };
      }
    }
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

export async function* wrongQuestionRows(ctx: ExportsContext, _dto: CreateExportDto, userId: string) {
    if (!userId) throw new BadRequestException('导出错题需要登录学生账号');
    let index = 0;
    for await (const items of wrongQuestionBatches(ctx, userId)) {
      for (const item of items) {
        index += 1;
        const options = item.question.options.map((option) => ({
          id: option.id,
          label: option.optionKey,
          content: option.content,
          isCorrect: option.isCorrect,
        }));
        const answer = (item.question.answer?.answerJson ?? item.correctAnswerJson ?? {}) as Record<string, unknown>;
        yield {
          no: index,
          title: item.question.title,
          type: toApiEnum(item.question.type),
          score: Number(item.question.defaultScore),
          wrongCount: item.wrongCount,
          lastWrongAt: item.lastWrongAt.toISOString(),
          answer: formatAnswer(ctx, answer, options),
          analysis: item.question.analysis ?? '',
        };
      }
    }
  }

export async function paperDocumentContent(ctx: ExportsContext, dto: CreateExportDto): Promise<DocumentExportContent> {
    if (!dto.paperId) throw new BadRequestException('导出试卷文档需要选择试卷');
    const paper = await ctx.prisma.paper.findFirst({
      where: { id: dto.paperId, deletedAt: null },
      include: {
        course: true,
        sections: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!paper) throw new NotFoundException('试卷不存在');

    const questions: ExportQuestion[] = [];
    for (const section of paper.sections) {
      for await (const batch of paperQuestionBatches(ctx, paper.id, section.id)) {
        for (const question of batch) {
          questions.push(exportQuestionFromSnapshot(ctx, question, section.title));
        }
      }
    }
    for await (const batch of paperQuestionBatches(ctx, paper.id, null)) {
      for (const question of batch) {
        questions.push(exportQuestionFromSnapshot(ctx, question, '未分区题目'));
      }
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

function paperQuestionBatches(ctx: ExportsContext, paperId: string, sectionId: string | null) {
  return cursorBatches((cursor, take) => ctx.prisma.paperQuestion.findMany({
    where: { paperId, sectionId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    ...prismaCursorPage(cursor, take),
  }));
}

export async function wrongQuestionDocumentContent(ctx: ExportsContext, dto: CreateExportDto, userId: string): Promise<DocumentExportContent> {
    if (!userId) throw new BadRequestException('导出错题需要登录学生账号');
    const items: WrongQuestionExportEntity[] = [];
    for await (const batch of wrongQuestionBatches(ctx, userId)) items.push(...batch);

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

function wrongQuestionBatches(ctx: ExportsContext, userId: string) {
  return cursorBatches((cursor, take) => ctx.prisma.wrongQuestion.findMany({
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
    orderBy: [{ wrongCount: 'desc' }, { lastWrongAt: 'desc' }, { id: 'asc' }],
    ...prismaCursorPage(cursor, take),
  }));
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

export async function* classRows(ctx: ExportsContext, dto: CreateExportDto, user: RequestUser) {
    const classWhere = await ctx.dataScope.classWhere(user, dto.classId);
    const batches = cursorBatches((cursor, take) => ctx.prisma.classGroup.findMany({
      where: { ...classWhere, deletedAt: null, courseId: dto.courseId },
      include: { course: true, _count: { select: { students: true, teachers: true } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
      ...prismaCursorPage(cursor, take),
    }));
    for await (const classes of batches) {
      for (const item of classes) {
        yield {
          name: item.name,
          code: item.code,
          course: item.course?.name ?? '',
          status: item.status,
          students: item._count.students,
          teachers: item._count.teachers,
          createdAt: item.createdAt.toISOString(),
        };
      }
    }
  }
