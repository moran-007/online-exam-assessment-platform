import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import ExcelJS = require('exceljs');
import { ExamStatus, Prisma, QuestionStatus, QuestionType, TagType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { toPagination } from '../../common/dto/pagination-query.dto';
import {
  normalizeQuestionStatus,
  normalizeQuestionType,
  toApiEnum,
} from '../../common/utils/enum-normalizer';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionTypeRegistry } from '../question-types/question-type-registry.service';
import { AssetTokenService } from '../uploads/asset-token.service';
import { CheckQuestionAnswerDto } from './dto/check-question-answer.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { QueryQuestionDto } from './dto/query-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';

type QuestionAnswerJson = {
  correctOptionIds?: string[];
  blanks?: Array<{
    index: number;
    answers: string[];
    ignoreCase?: boolean;
    trimSpace?: boolean;
    score?: number;
  }>;
  reference?: string;
  [key: string]: unknown;
};

type ComparableQuestion = {
  index: number;
  id?: string;
  courseId: string;
  courseKey: string;
  courseName?: string;
  title: string;
  type: string;
  status?: string;
  titleKey: string;
  contentHash: string;
  contentLength: number;
  optionContentHash: string;
  optionContentLength: number;
  optionFullHash: string;
  optionFullLength: number;
  answerHash: string;
  answerLength: number;
};

type ExcelImportOptions = {
  publish?: boolean;
  skipDuplicates?: boolean;
};

type ExcelQuestionRow = {
  rowNumber: number;
  title: string;
  content: string;
  type: string;
  courseName: string;
  knowledgePointNames: string[];
  tagNames: string[];
  difficulty: number;
  defaultScore: number;
  analysis: string;
  answerText: string;
  optionValues: Array<{ optionKey: string; content: string }>;
  allowOptionShuffle?: boolean;
  identifier: string;
  parentIdentifier: string;
  childScore: number;
  childOrder: number;
};

@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assetTokens: AssetTokenService,
    private readonly questionTypes: QuestionTypeRegistry,
  ) {}

  async list(query: QueryQuestionDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const scopeWhere = this.questionScopeWhere(query.scope);
    const where: Prisma.QuestionWhereInput = {
      deletedAt: null,
      courseId: query.courseId,
      type: query.type ? normalizeQuestionType(query.type) : undefined,
      status: query.status ? normalizeQuestionStatus(query.status) : undefined,
      difficulty: query.difficulty,
      tags: query.tagId ? { some: { tagId: query.tagId } } : undefined,
      knowledgePoints: query.knowledgePointId ? { some: { knowledgePointId: query.knowledgePointId } } : undefined,
      compositionParents: query.includeChildItems ? undefined : { none: {} },
      AND: [scopeWhere],
      OR: query.keyword
        ? [
            { title: { contains: query.keyword, mode: 'insensitive' } },
            { content: { contains: query.keyword, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.question.findMany({
        where,
        include: {
          course: { select: { name: true } },
          knowledgePoints: { include: { knowledgePoint: true } },
          tags: { include: { tag: true } },
        },
        orderBy: this.questionOrderBy(query),
        skip,
        take,
      }),
      this.prisma.question.count({ where }),
    ]);
    const occupationMap = await this.findOccupationMap(items.map((item) => item.id));

    return {
      items: items.map((item) => {
        const occupationExams = occupationMap.get(item.id) ?? [];
        return {
          id: item.id,
          courseId: item.courseId,
          courseName: item.course.name,
          title: item.title,
          type: toApiEnum(item.type),
          status: toApiEnum(item.status),
          difficulty: item.difficulty,
          defaultScore: Number(item.defaultScore),
          knowledgePoints: item.knowledgePoints.map((relation) => relation.knowledgePoint),
          tags: item.tags.map((relation) => relation.tag),
          occupiedByExam: occupationExams.length > 0,
          occupationLabels: occupationExams.map((exam) => `${exam.name}（${toApiEnum(exam.status)}）`),
          occupationExams: occupationExams.map((exam) => ({
            id: exam.id,
            name: exam.name,
            status: toApiEnum(exam.status),
          })),
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  private questionScopeWhere(scope?: string): Prisma.QuestionWhereInput {
    const value = String(scope || '').trim().toLowerCase();
    const now = new Date();
    const activeOccupation: Prisma.PaperQuestionWhereInput = {
      paper: {
        exams: {
          some: {
            status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
            startTime: { lte: now },
            endTime: { gt: now },
          },
        },
      },
    };
    if (value === 'occupied') {
      return { paperQuestions: { some: activeOccupation } };
    }
    if (value === 'published') {
      return {
        status: QuestionStatus.PUBLISHED,
        paperQuestions: { none: activeOccupation },
      };
    }
    if (value === 'draft') {
      return {
        status: { in: [QuestionStatus.DRAFT, QuestionStatus.PENDING_REVIEW, QuestionStatus.DISABLED] },
      };
    }
    return {};
  }

  async publicList(query: QueryQuestionDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const now = new Date();
    const where: Prisma.QuestionWhereInput = {
      deletedAt: null,
      status: QuestionStatus.PUBLISHED,
      courseId: query.courseId,
      type: query.type ? normalizeQuestionType(query.type) : undefined,
      difficulty: query.difficulty,
      tags: query.tagId ? { some: { tagId: query.tagId } } : undefined,
      knowledgePoints: query.knowledgePointId ? { some: { knowledgePointId: query.knowledgePointId } } : undefined,
      compositionParents: query.includeChildItems ? undefined : { none: {} },
      paperQuestions: {
        none: {
          paper: {
            exams: {
              some: {
                status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
                startTime: { lte: now },
                endTime: { gt: now },
              },
            },
          },
        },
      },
      OR: query.keyword
        ? [
            { title: { contains: query.keyword, mode: 'insensitive' } },
            { content: { contains: query.keyword, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.question.findMany({
        where,
        include: {
          course: { select: { name: true } },
          knowledgePoints: { include: { knowledgePoint: true } },
          tags: { include: { tag: true } },
        },
        orderBy: this.questionOrderBy(query),
        skip,
        take,
      }),
      this.prisma.question.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        type: toApiEnum(item.type),
        difficulty: item.difficulty,
        defaultScore: Number(item.defaultScore),
        courseName: item.course.name,
        knowledgePoints: item.knowledgePoints.map((relation) => relation.knowledgePoint),
        tags: item.tags.map((relation) => relation.tag),
      })),
      page,
      pageSize,
      total,
    };
  }

  async publicDetail(id: string) {
    const now = new Date();
    const question = await this.prisma.question.findFirst({
      where: {
        id,
        deletedAt: null,
        status: QuestionStatus.PUBLISHED,
        compositionParents: { none: {} },
        paperQuestions: {
          none: {
            paper: {
              exams: {
                some: {
                  status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
                  startTime: { lte: now },
                  endTime: { gt: now },
                },
              },
            },
          },
        },
      },
      include: {
        course: true,
        options: { orderBy: { sortOrder: 'asc' } },
        answer: { select: { answerJson: true } },
        programmingRef: true,
        tags: { include: { tag: true } },
        compositionChildren: {
          orderBy: { sortOrder: 'asc' },
          include: {
            childQuestion: {
              include: {
                course: true,
                options: { orderBy: { sortOrder: 'asc' } },
                answer: { select: { answerJson: true } },
                programmingRef: true,
                tags: { include: { tag: true } },
              },
            },
          },
        },
      },
    });

    if (!question) {
      throw new NotFoundException('题目不存在或暂不可见');
    }

    return {
      id: question.id,
      assetAccessToken: this.assetTokens.issuePublicQuestionToken(question.id),
      title: question.title,
      content: question.content,
      type: toApiEnum(question.type),
      difficulty: question.difficulty,
      defaultScore: Number(question.defaultScore),
      courseName: question.course.name,
      tags: question.tags.map((relation) => relation.tag),
      blankCount: this.blankCount(question.answer?.answerJson),
      programmingRef: question.programmingRef ? this.formatProgrammingRef(question.programmingRef) : null,
      options: question.options.map((option) => ({
        optionId: option.id,
        label: option.optionKey,
        content: option.content,
      })),
      children: question.compositionChildren.map((relation) => ({
        questionId: relation.childQuestionId,
        score: Number(relation.score),
        sortOrder: relation.sortOrder,
        assetAccessToken: this.assetTokens.issuePublicQuestionToken(relation.childQuestionId),
        title: relation.childQuestion.title,
        content: relation.childQuestion.content,
        type: toApiEnum(relation.childQuestion.type),
        difficulty: relation.childQuestion.difficulty,
        blankCount: this.blankCount(relation.childQuestion.answer?.answerJson),
        programmingRef: relation.childQuestion.programmingRef
          ? this.formatProgrammingRef(relation.childQuestion.programmingRef)
          : null,
        options: relation.childQuestion.options.map((option) => ({
          optionId: option.id,
          label: option.optionKey,
          content: option.content,
        })),
      })),
    };
  }

  async detail(id: string) {
    const question = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
      include: {
        course: true,
        options: { orderBy: { sortOrder: 'asc' } },
        answer: true,
        programmingRef: true,
        knowledgePoints: { include: { knowledgePoint: true } },
        tags: { include: { tag: true } },
        versions: { orderBy: { version: 'desc' }, take: 10 },
        compositionChildren: {
          orderBy: { sortOrder: 'asc' },
          include: {
            childQuestion: {
              include: {
                course: true,
                options: { orderBy: { sortOrder: 'asc' } },
                answer: true,
                programmingRef: true,
                knowledgePoints: { include: { knowledgePoint: true } },
                tags: { include: { tag: true } },
              },
            },
          },
        },
      },
    });

    if (!question) {
      throw new NotFoundException('题目不存在');
    }

    return {
      ...question,
      type: toApiEnum(question.type),
      status: toApiEnum(question.status),
      programmingRef: question.programmingRef ? this.formatProgrammingRef(question.programmingRef) : null,
      blankCount: this.blankCount(question.answer?.answerJson),
      knowledgePoints: question.knowledgePoints.map((relation) => relation.knowledgePoint),
      tags: question.tags.map((relation) => relation.tag),
      children: question.compositionChildren.map((relation) => ({
        questionId: relation.childQuestionId,
        score: Number(relation.score),
        sortOrder: relation.sortOrder,
        question: {
          ...relation.childQuestion,
          type: toApiEnum(relation.childQuestion.type),
          status: toApiEnum(relation.childQuestion.status),
          defaultScore: Number(relation.childQuestion.defaultScore),
          blankCount: this.blankCount(relation.childQuestion.answer?.answerJson),
          programmingRef: relation.childQuestion.programmingRef
            ? this.formatProgrammingRef(relation.childQuestion.programmingRef)
            : null,
          knowledgePoints: relation.childQuestion.knowledgePoints.map((item) => item.knowledgePoint),
          tags: relation.childQuestion.tags.map((item) => item.tag),
        },
      })),
    };
  }

  async checkDuplicates(questions: unknown[] = []) {
    const normalized = questions.map((question) => this.normalizeCheckQuestion(question));
    await this.resolveCheckCourseIds(normalized);
    const incoming = normalized.map((question, index) => this.toComparableQuestion(question, index));
    if (!incoming.length) {
      return { items: [], total: 0, duplicateCount: 0, conflictCount: 0, similarCount: 0 };
    }

    const courseIds = [...new Set(incoming.map((item) => item.courseId).filter(Boolean))];
    const titles = [...new Set(incoming.map((item) => item.title).filter(Boolean))];
    const candidates = await this.findDuplicateCandidates(courseIds, titles);
    const existing = candidates.map((question, index) => this.toComparableQuestion(question, index, true));

    const items = incoming.map((item, index) => {
      const matches: Array<{
        source: 'batch' | 'question_bank';
        id?: string;
        title: string;
        type: string;
        status?: string;
        courseName?: string;
        reason: 'duplicate' | 'conflict' | 'similar';
        message: string;
      }> = [];

      for (const previous of incoming.slice(0, index)) {
        if (previous.courseKey !== item.courseKey || previous.type !== item.type) continue;
        if (this.hasSameQuestionBody(previous, item)) {
          matches.push({
            source: 'batch',
            title: previous.title,
            type: previous.type,
            reason: 'duplicate',
            message: `与本次导入第 ${previous.index + 1} 题完全重复`,
          });
          continue;
        }
        if (previous.titleKey === item.titleKey) {
          matches.push({
            source: 'batch',
            title: previous.title,
            type: previous.type,
            reason: 'conflict',
            message: `与本次导入第 ${previous.index + 1} 题标题相同，但题干、选项或答案不一致`,
          });
          continue;
        }
        if (this.hasSameContentAndOptions(previous, item)) {
          matches.push({
            source: 'batch',
            title: previous.title,
            type: previous.type,
            reason: 'similar',
            message: `与本次导入第 ${previous.index + 1} 题题干和选项相似`,
          });
        }
      }

      for (const candidate of existing) {
        if (candidate.courseKey !== item.courseKey || candidate.type !== item.type) continue;
        if (candidate.titleKey === item.titleKey) {
          const isDuplicate = this.hasSameQuestionBody(candidate, item);
          matches.push({
            source: 'question_bank',
            id: candidate.id,
            title: candidate.title,
            type: candidate.type,
            status: candidate.status,
            courseName: candidate.courseName,
            reason: isDuplicate ? 'duplicate' : 'conflict',
            message:
              isDuplicate
                ? '题库中已有完全相同题目'
                : '题库中已有同标题题目，但题干、选项或答案不一致',
          });
          continue;
        }
        if (this.hasSameContentAndOptions(candidate, item)) {
          matches.push({
            source: 'question_bank',
            id: candidate.id,
            title: candidate.title,
            type: candidate.type,
            status: candidate.status,
            courseName: candidate.courseName,
            reason: 'similar',
            message: '题库中存在题干和选项相似的题目',
          });
        }
      }

      const hasConflict = matches.some((match) => match.reason === 'conflict');
      const hasDuplicate = matches.some((match) => match.reason === 'duplicate');
      const hasSimilar = matches.some((match) => match.reason === 'similar');
      const status = hasConflict ? 'conflict' : hasDuplicate ? 'duplicate' : hasSimilar ? 'similar' : 'ok';

      return {
        index,
        title: item.title,
        type: item.type,
        status,
        severity: hasConflict ? 'danger' : hasDuplicate || hasSimilar ? 'warning' : 'none',
        message:
          status === 'ok'
            ? '未发现重复或冲突'
            : matches
                .slice(0, 3)
                .map((match) => match.message)
                .join('；'),
        matches,
      };
    });

    return {
      items,
      total: items.length,
      duplicateCount: items.filter((item) => item.status === 'duplicate').length,
      conflictCount: items.filter((item) => item.status === 'conflict').length,
      similarCount: items.filter((item) => item.status === 'similar').length,
    };
  }

  async excelImportTemplate() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'online-exam-assessment-platform';
    const worksheet = workbook.addWorksheet('题库导入模板');
    worksheet.columns = [
      { header: '题目标识', key: 'identifier', width: 16 },
      { header: '父题标识', key: 'parentIdentifier', width: 16 },
      { header: '子题分值', key: 'childScore', width: 12 },
      { header: '子题顺序', key: 'childOrder', width: 12 },
      { header: '题型', key: 'type', width: 16 },
      { header: '标题', key: 'title', width: 28 },
      { header: '题干', key: 'content', width: 48 },
      { header: '选项A', key: 'optionA', width: 24 },
      { header: '选项B', key: 'optionB', width: 24 },
      { header: '选项C', key: 'optionC', width: 24 },
      { header: '选项D', key: 'optionD', width: 24 },
      { header: '正确答案', key: 'answer', width: 22 },
      { header: '解析', key: 'analysis', width: 36 },
      { header: '课程', key: 'course', width: 20 },
      { header: '知识点', key: 'knowledgePoints', width: 28 },
      { header: '标签', key: 'tags', width: 24 },
      { header: '难度', key: 'difficulty', width: 10 },
      { header: '分值', key: 'score', width: 10 },
      { header: '允许选项随机', key: 'allowOptionShuffle', width: 14 },
    ];
    worksheet.addRows([
      {
        identifier: 'Q-001',
        type: '单选题',
        title: 'Python 输出',
        content: '以下哪个函数用于输出内容？',
        optionA: 'print()',
        optionB: 'input()',
        optionC: 'len()',
        optionD: 'range()',
        answer: 'A',
        analysis: 'print() 用于输出。',
        course: 'Python 基础',
        knowledgePoints: '输入输出',
        tags: '基础题,课堂练习',
        difficulty: 1,
        score: 2,
        allowOptionShuffle: '是',
      },
      {
        identifier: 'Q-002',
        type: '多选题',
        title: '循环语句',
        content: '下面哪些是 Python 循环语句？',
        optionA: 'for',
        optionB: 'while',
        optionC: 'if',
        optionD: 'def',
        answer: 'A,B',
        analysis: 'for 和 while 是循环。',
        course: 'Python 基础',
        knowledgePoints: '循环',
        tags: '基础题',
        difficulty: 2,
        score: 4,
        allowOptionShuffle: '是',
      },
      {
        identifier: 'Q-003',
        type: '填空题',
        title: '变量赋值',
        content: '把数字 3 赋值给变量 a：a = ____',
        answer: '3',
        analysis: '赋值号右侧写 3。',
        course: 'Python 基础',
        knowledgePoints: '变量',
        tags: '填空',
        difficulty: 1,
        score: 2,
        allowOptionShuffle: '否',
      },
    ]);
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async importFromExcel(
    file: { originalname?: string; buffer: Buffer },
    options: ExcelImportOptions,
    userId: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('请上传 Excel 文件');
    }
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Excel 文件格式无效或已损坏');
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException('Excel 文件中没有可读取的工作表');
    }

    const headerMap = this.excelHeaderMap(worksheet);
    const rows = this.excelQuestionRows(worksheet, headerMap);
    if (!rows.length) {
      throw new BadRequestException('Excel 中没有可导入的题目行');
    }

    const publish = options.publish ?? false;
    const skipDuplicates = options.skipDuplicates ?? true;
    const items: Array<{
      rowNumber: number;
      title: string;
      status: 'imported' | 'skipped' | 'failed';
      questionId?: string;
      message: string;
    }> = [];

    const importedIds = new Map<string, string>();
    const orderedRows = [
      ...rows.filter((row) => this.excelQuestionType(row.type) !== 'material'),
      ...rows.filter((row) => this.excelQuestionType(row.type) === 'material'),
    ];
    for (const row of orderedRows) {
      try {
        const payload = this.excelRowToCreateDto(row);
        if (this.excelQuestionType(row.type) === 'material') {
          if (!row.identifier) throw new BadRequestException(`第 ${row.rowNumber} 行材料题缺少题目标识`);
          const childRows = rows
            .filter((child) => child.parentIdentifier === row.identifier)
            .sort((a, b) => a.childOrder - b.childOrder || a.rowNumber - b.rowNumber);
          payload.children = childRows.map((child, index) => {
            const questionId = importedIds.get(child.identifier);
            if (!questionId) throw new BadRequestException(`子题标识 ${child.identifier || `第 ${child.rowNumber} 行`} 尚未成功导入`);
            return {
              questionId,
              score: child.childScore > 0 ? child.childScore : child.defaultScore,
              sortOrder: child.childOrder || index + 1,
            };
          });
          if (!payload.children.length) throw new BadRequestException(`材料题 ${row.identifier} 没有匹配到子题`);
        }
        const duplicate = (await this.checkDuplicates([payload])).items[0];
        if (duplicate && duplicate.status !== 'ok') {
          const message = duplicate.message || '发现重复或冲突题目';
          if (skipDuplicates) {
            items.push({ rowNumber: row.rowNumber, title: row.title, status: 'skipped', message });
            continue;
          }
          throw new BadRequestException(message);
        }

        const created = await this.create(payload, userId);
        if (row.identifier) importedIds.set(row.identifier, created.id);
        if (publish) {
          await this.publish(created.id, userId);
        }
        items.push({
          rowNumber: row.rowNumber,
          title: row.title,
          status: 'imported',
          questionId: created.id,
          message: publish ? '已导入并发布' : '已导入为草稿',
        });
      } catch (error) {
        items.push({
          rowNumber: row.rowNumber,
          title: row.title,
          status: 'failed',
          message: error instanceof Error ? error.message : '导入失败',
        });
      }
    }

    const importedCount = items.filter((item) => item.status === 'imported').length;
    const skippedCount = items.filter((item) => item.status === 'skipped').length;
    const failedCount = items.filter((item) => item.status === 'failed').length;

    await this.audit.log({
      userId,
      action: 'question:import-excel',
      module: 'question',
      afterData: {
        fileName: file.originalname,
        importedCount,
        skippedCount,
        failedCount,
      },
    });

    return {
      importedCount,
      skippedCount,
      failedCount,
      total: items.length,
      items,
    };
  }

  async checkAnswer(id: string, dto: CheckQuestionAnswerDto, userId: string) {
    const question = await this.prisma.question.findFirst({
      where: { id, deletedAt: null, status: QuestionStatus.PUBLISHED },
      include: {
        options: { orderBy: { sortOrder: 'asc' } },
        answer: true,
      },
    });

    if (!question) {
      throw new NotFoundException('题目不存在或未发布');
    }

    const answerJson = (question.answer?.answerJson ?? {}) as QuestionAnswerJson;
    const scoreResult = this.questionTypes.grade({
      snapshot: {
        id: question.id,
        type: toApiEnum(question.type),
        answer: answerJson as Prisma.JsonObject,
        scoringRule: (question.answer?.scoringRuleJson ?? {}) as Prisma.JsonObject,
        options: question.options,
      },
      answer: dto,
      maxScore: Number(question.defaultScore),
    });
    const grading = {
      isCorrect: scoreResult.isCorrect,
      score: scoreResult.score,
      status: toApiEnum(scoreResult.status),
      message: this.scoreResultMessage(scoreResult),
      details: scoreResult.details,
      warnings: scoreResult.warnings,
      engine: scoreResult.engine,
    };
    const answerSummary = this.buildAnswerSummary(question.type, answerJson, dto, question.options);

    await this.audit.log({
      userId,
      action: 'question:check-answer',
      module: 'question',
      targetType: 'question',
      targetId: id,
      afterData: { isCorrect: grading.isCorrect, score: grading.score },
    });

    return {
      ...grading,
      totalScore: Number(question.defaultScore),
      questionType: toApiEnum(question.type),
      studentAnswer: dto,
      studentAnswerText: answerSummary.studentAnswerText,
      correctAnswer: answerJson,
      correctAnswerText: answerSummary.correctAnswerText || answerSummary.referenceAnswerText,
      referenceAnswerText: answerSummary.referenceAnswerText,
      answerExplanation: answerSummary.answerExplanation,
      options: question.options.map((option) => ({
        optionId: option.id,
        label: option.optionKey,
        content: option.content,
        isCorrect: option.isCorrect,
      })),
      analysis: question.analysis,
    };
  }

  async deleteImpact(id: string) {
    const question = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
      include: {
        course: { select: { name: true } },
        options: { orderBy: { sortOrder: 'asc' } },
        answer: true,
      },
    });

    if (!question) {
      throw new NotFoundException('题目不存在');
    }

    const resourceReferences = this.extractResourceReferences(
      question.content,
      question.analysis,
      question.options.map((option) => option.content),
      question.answer?.answerJson,
      question.answer?.scoringRuleJson,
    );
    const resourceAssets = resourceReferences.length
      ? await this.prisma.fileAsset.findMany({
          where: {
            deletedAt: null,
            OR: [
              { url: { in: resourceReferences } },
              { objectKey: { in: resourceReferences.map((url) => url.replace(/^\/uploads\//, '')) } },
            ],
          },
        })
      : [];
    const resourceStats = await this.resourceReferenceStats(resourceReferences);

    const [paperQuestionCount, relatedPapers, examCount, activeExamCount, paperInstanceCount, answerRecordCount, wrongQuestionCount, judgeSubmissionCount, versionCount] =
      await this.prisma.$transaction([
        this.prisma.paperQuestion.count({ where: { questionId: id } }),
        this.prisma.paper.findMany({
          where: {
            deletedAt: null,
            questions: { some: { questionId: id } },
          },
          select: { id: true, name: true, status: true },
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.exam.count({
          where: {
            deletedAt: null,
            paper: { questions: { some: { questionId: id } } },
          },
        }),
        this.prisma.exam.count({
          where: {
            deletedAt: null,
            status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
            paper: { questions: { some: { questionId: id } } },
          },
        }),
        this.prisma.paperInstance.count({
          where: {
            exam: { deletedAt: null, paper: { questions: { some: { questionId: id } } } },
          },
        }),
        this.prisma.answerRecord.count({ where: { questionId: id } }),
        this.prisma.wrongQuestion.count({ where: { questionId: id } }),
        this.prisma.judgeSubmission.count({ where: { questionId: id } }),
        this.prisma.questionVersion.count({ where: { questionId: id } }),
      ]);
    const paperCount = relatedPapers.length;

    const risks: string[] = [];
    if (paperQuestionCount > 0) risks.push(`删除时会从 ${paperCount} 份试卷的 ${paperQuestionCount} 个题位中同步移除，并重算试卷总分`);
    if (activeExamCount > 0) risks.push(`有 ${activeExamCount} 场已安排或进行中的考试引用该题`);
    if (answerRecordCount > 0) risks.push(`已有 ${answerRecordCount} 条答题记录，删除后历史成绩仍保留快照`);
    if (wrongQuestionCount > 0) risks.push(`已有 ${wrongQuestionCount} 条错题记录`);
    if (resourceReferences.length > 0) risks.push(`题干/选项/解析引用 ${resourceReferences.length} 个资源，删除题目不会删除资源文件`);

    return {
      question: {
        id: question.id,
        title: question.title,
        courseName: question.course.name,
        status: toApiEnum(question.status),
      },
      references: {
        paperQuestionCount,
        paperCount,
        examCount,
        activeExamCount,
        paperInstanceCount,
        answerRecordCount,
        wrongQuestionCount,
        judgeSubmissionCount,
        versionCount,
      },
      relatedPapers: relatedPapers.map((paper) => ({
        id: paper.id,
        name: paper.name,
        status: toApiEnum(paper.status),
      })),
      resources: resourceReferences.map((url) => {
        const asset = resourceAssets.find((item) => item.url === url || `/uploads/${item.objectKey}` === url || item.objectKey === url.replace(/^\/uploads\//, ''));
        const stats = resourceStats.get(url) ?? { count: 0, locations: [] };
        return {
          url,
          kind: this.resourceKind(url, asset?.mimeType),
          fileName: asset?.fileName ?? url.split('/').pop() ?? url,
          fileSize: asset ? Number(asset.fileSize) : null,
          managed: Boolean(asset),
          referenceCount: stats.count,
          locations: stats.locations.slice(0, 8),
        };
      }),
      risks,
      canDelete: true,
    };
  }

  async create(dto: CreateQuestionDto, userId: string) {
    const question = await this.prisma.$transaction((tx) => this.createQuestionInTransaction(tx, dto, userId));

    await this.audit.log({
      userId,
      action: 'question:create',
      module: 'question',
      targetType: 'question',
      targetId: question.id,
      afterData: { title: question.title, type: question.type, childIds: question.childIds },
    });

    return { id: question.id, childIds: question.childIds };
  }

  private async createQuestionInTransaction(
    tx: Prisma.TransactionClient,
    dto: CreateQuestionDto,
    userId: string,
    inherited?: {
      courseId?: string;
      knowledgePointIds?: string[];
      tagIds?: string[];
      tagNames?: string[];
    },
  ) {
    const type = normalizeQuestionType(dto.type);
    const inlineChildren = dto.inlineChildren ?? [];
    if (inlineChildren.length && type !== QuestionType.MATERIAL) {
      throw new BadRequestException('只有材料/组合题可以内联创建子题');
    }
    if (inlineChildren.length && dto.children?.length) {
      throw new BadRequestException('材料/组合题不能同时选择已有子题和内联创建子题');
    }
    if (inlineChildren.some((child) => normalizeQuestionType(child.type) === QuestionType.MATERIAL)) {
      throw new BadRequestException('当前版本只支持单层组合，内联子题不能再是材料/组合题');
    }

    const validationDto = inlineChildren.length
      ? ({
          ...dto,
          children: inlineChildren.map((child, index) => ({
            questionId: '00000000-0000-0000-0000-000000000000',
            score: child.score,
            sortOrder: child.sortOrder ?? index + 1,
          })),
        } as CreateQuestionDto)
      : dto;
    this.validateQuestionInput(type, validationDto);
    this.questionTypes.validate(toApiEnum(type), validationDto);

    const courseId = inherited?.courseId ?? await this.resolveCourseIdForQuestion(tx, dto, userId);
    const knowledgePointIds = inherited?.knowledgePointIds ?? await this.resolveKnowledgePointIdsForQuestion(
      tx,
      courseId,
      dto.knowledgePointIds,
      dto.knowledgePointNames,
    );
    const tagNames = this.withProgrammingSourceTags(inherited?.tagNames ?? dto.tagNames, type, dto.programmingRef);
    const tagIds = inherited?.tagIds ?? await this.resolveTagIdsForQuestion(tx, dto.tagIds, tagNames);
    const created = await tx.question.create({
      data: {
        courseId,
        type,
        title: dto.title,
        content: dto.content,
        difficulty: dto.difficulty,
        defaultScore: dto.defaultScore,
        analysis: dto.analysis,
        allowOptionShuffle: dto.allowOptionShuffle,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    const options = await this.replaceOptions(tx, created.id, dto.options);
    const answerJson = this.resolveAnswerJson(type, dto, options);

    const questionAnswer = await tx.questionAnswer.create({
      data: {
        questionId: created.id,
        answerJson,
        scoringRuleJson: (dto.scoringRule ?? { mode: 'strict' }) as Prisma.InputJsonObject,
      },
    });
    await this.replaceRelations(tx, created.id, knowledgePointIds, tagIds);
    await this.upsertProgrammingRef(tx, created.id, type, dto.programmingRef);

    const childIds: string[] = [];
    let compositionChildren = dto.children;
    if (inlineChildren.length) {
      compositionChildren = [];
      for (const [index, child] of inlineChildren.entries()) {
        const childDto = this.inlineChildToCreateDto(child, dto, courseId, knowledgePointIds, tagNames);
        const createdChild = await this.createQuestionInTransaction(tx, childDto, userId, {
          courseId,
          knowledgePointIds,
          tagNames,
        });
        childIds.push(createdChild.id);
        compositionChildren.push({
          questionId: createdChild.id,
          score: child.score,
          sortOrder: child.sortOrder ?? index + 1,
        });
      }
    }
    const materialScore = await this.replaceComposition(tx, created.id, type, compositionChildren);
    if (materialScore !== null) {
      await tx.question.update({ where: { id: created.id }, data: { defaultScore: materialScore } });
    }
    const ruleVersion = await this.createScoringRuleVersion(
      tx,
      created.id,
      type,
      1,
      answerJson,
      dto.scoringRule ?? { mode: 'strict' },
      userId,
    );
    await tx.questionAnswer.update({
      where: { id: questionAnswer.id },
      data: { currentRuleVersionId: ruleVersion.id },
    });

    const snapshot = await this.buildSnapshot(tx, created.id);
    await tx.questionVersion.create({
      data: {
        questionId: created.id,
        version: 1,
        snapshotJson: snapshot,
        createdBy: userId,
      },
    });

    return { ...created, childIds };
  }

  private inlineChildToCreateDto(
    child: NonNullable<CreateQuestionDto['inlineChildren']>[number],
    parent: CreateQuestionDto,
    courseId: string,
    knowledgePointIds: string[],
    tagNames: string[],
  ): CreateQuestionDto {
    return {
      courseId,
      type: child.type,
      title: child.title,
      content: child.content,
      difficulty: child.difficulty,
      defaultScore: child.score,
      analysis: child.analysis,
      allowOptionShuffle: child.allowOptionShuffle,
      knowledgePointIds,
      tagNames,
      options: child.options,
      answer: child.answer,
      scoringRule: child.scoringRule,
      programmingRef: child.programmingRef,
      comparable: parent.comparable,
    };
  }

  async update(id: string, dto: UpdateQuestionDto, userId: string) {
    const current = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
      include: {
        answer: true,
        compositionChildren: {
          include: { childQuestion: { include: { answer: true } } },
        },
      },
    });

    if (!current) {
      throw new NotFoundException('题目不存在');
    }

    const type = dto.type ? normalizeQuestionType(dto.type) : current.type;
    const status = dto.status ? normalizeQuestionStatus(dto.status) : undefined;
    const hasOptionsPatch = dto.options !== undefined;
    const hasAnswerPatch = dto.answer !== undefined;
    const hasScoringRulePatch = dto.scoringRule !== undefined;
    const hasChildrenPatch = dto.children !== undefined;
    const hasKnowledgePatch = dto.knowledgePointIds !== undefined || dto.knowledgePointNames !== undefined;
    const hasTagPatch = dto.tagIds !== undefined || dto.tagNames !== undefined;
    const hasProgrammingRefPatch = dto.programmingRef !== undefined || type !== QuestionType.PROGRAMMING;

    if (hasOptionsPatch || hasChildrenPatch || dto.type) {
      const existingOptions = dto.options
        ? []
        : await this.prisma.questionOption.findMany({
            where: { questionId: id },
            orderBy: { sortOrder: 'asc' },
          });
      this.validateQuestionInput(type, {
        ...dto,
        type,
        title: dto.title ?? current.title,
        content: dto.content ?? current.content,
        difficulty: dto.difficulty ?? current.difficulty,
        defaultScore: Number(dto.defaultScore ?? current.defaultScore),
        options:
          (hasOptionsPatch ? dto.options : undefined) ??
          existingOptions.map((option) => ({
            optionKey: option.optionKey,
            content: option.content,
            isCorrect: option.isCorrect,
            sortOrder: option.sortOrder,
          })),
      } as CreateQuestionDto);
      this.questionTypes.validate(toApiEnum(type), { ...dto, type: toApiEnum(type) });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const courseId =
        dto.courseId !== undefined || dto.courseName !== undefined
          ? await this.resolveCourseIdForQuestion(
              tx,
              {
                ...dto,
                courseId: dto.courseName !== undefined && dto.courseId === undefined ? undefined : dto.courseId ?? current.courseId,
                courseName: dto.courseName,
              } as CreateQuestionDto,
              userId,
            )
          : undefined;
      const targetCourseId = courseId ?? current.courseId;
      const knowledgePointIds = hasKnowledgePatch
        ? await this.resolveKnowledgePointIdsForQuestion(
            tx,
            targetCourseId,
            dto.knowledgePointIds,
            dto.knowledgePointNames,
          )
        : undefined;
      const tagIds = hasTagPatch
        ? await this.resolveTagIdsForQuestion(
            tx,
            dto.tagIds,
            this.withProgrammingSourceTags(dto.tagNames, type, dto.programmingRef),
          )
        : undefined;
      const question = await tx.question.update({
        where: { id },
        data: {
          courseId,
          type,
          title: dto.title,
          content: dto.content,
          difficulty: dto.difficulty,
          defaultScore: dto.defaultScore,
          analysis: dto.analysis,
          allowOptionShuffle: dto.allowOptionShuffle,
          status,
          version: { increment: 1 },
          updatedBy: userId,
        },
      });

      let options:
        | Array<{
            id: string;
            optionKey: string;
            content: string;
            isCorrect: boolean;
            sortOrder: number;
          }>
        | undefined;

      if (hasOptionsPatch) {
        options = await this.replaceOptions(tx, id, dto.options);
      }

      if (hasAnswerPatch || hasOptionsPatch || hasScoringRulePatch || dto.type) {
        const currentOptions =
          options ??
          (await tx.questionOption.findMany({
            where: { questionId: id },
            orderBy: { sortOrder: 'asc' },
          }));
        const nextAnswerJson =
          hasAnswerPatch || hasOptionsPatch
            ? this.resolveAnswerJson(type, dto as CreateQuestionDto, currentOptions)
            : (current.answer?.answerJson ?? {});
        const nextRuleJson =
          hasScoringRulePatch
            ? (dto.scoringRule as Prisma.InputJsonObject)
            : ((current.answer?.scoringRuleJson ?? { mode: 'strict' }) as Prisma.InputJsonObject);
        const answer = await tx.questionAnswer.upsert({
          where: { questionId: id },
          update: {
            answerJson: nextAnswerJson,
            scoringRuleJson: nextRuleJson,
          },
          create: {
            questionId: id,
            answerJson: nextAnswerJson,
            scoringRuleJson: nextRuleJson,
          },
        });
        const ruleVersion = await this.createScoringRuleVersion(
          tx,
          id,
          type,
          question.version,
          nextAnswerJson,
          nextRuleJson,
          userId,
        );
        await tx.questionAnswer.update({ where: { id: answer.id }, data: { currentRuleVersionId: ruleVersion.id } });
      }

      if (hasKnowledgePatch || hasTagPatch) {
        await this.replaceRelations(tx, id, knowledgePointIds, tagIds);
      }

      if (!hasTagPatch && type === QuestionType.PROGRAMMING && dto.programmingRef !== undefined) {
        const sourceTagIds = await this.resolveTagIdsForQuestion(
          tx,
          undefined,
          this.programmingSourceTagNames(type, dto.programmingRef),
        );
        if (sourceTagIds.length) {
          await tx.questionTag.createMany({
            data: sourceTagIds.map((tagId) => ({ questionId: id, tagId })),
            skipDuplicates: true,
          });
        }
      }

      if (hasProgrammingRefPatch) {
        await this.upsertProgrammingRef(tx, id, type, dto.programmingRef);
      }

      if (hasChildrenPatch || dto.type) {
        const materialScore = await this.replaceComposition(tx, id, type, dto.children);
        if (materialScore !== null) {
          await tx.question.update({ where: { id }, data: { defaultScore: materialScore } });
        }
      }

      const snapshot = await this.buildSnapshot(tx, id);
      await tx.questionVersion.create({
        data: {
          questionId: id,
          version: question.version,
          snapshotJson: snapshot,
          createdBy: userId,
        },
      });

      return question;
    });

    await this.audit.log({
      userId,
      action: 'question:update',
      module: 'question',
      targetType: 'question',
      targetId: id,
      beforeData: { title: current.title, status: current.status },
      afterData: { title: updated.title, status: updated.status },
    });

    return { id };
  }

  async publish(id: string, userId: string) {
    const question = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
      include: {
        answer: true,
        compositionChildren: {
          orderBy: { sortOrder: 'asc' },
          include: { childQuestion: { include: { answer: true } } },
        },
      },
    });

    if (!question) {
      throw new NotFoundException('题目不存在');
    }

    if (question.type === QuestionType.MATERIAL) {
      if (!question.compositionChildren.length) throw new BadRequestException('材料/组合题至少需要一道子题');
      const unavailable = question.compositionChildren.filter(
        (item) => item.childQuestion.status !== QuestionStatus.PUBLISHED || !item.childQuestion.answer,
      );
      if (unavailable.length) throw new BadRequestException('材料/组合题存在未发布或缺少答案的子题');
    } else if (!question.answer) {
      throw new BadRequestException('题目缺少答案，不能发布');
    }

    const updated = await this.prisma.question.update({
      where: { id },
      data: {
        status: QuestionStatus.PUBLISHED,
        reviewedBy: userId,
        reviewedAt: new Date(),
      },
    });

    await this.audit.log({
      userId,
      action: 'question:publish',
      module: 'question',
      targetType: 'question',
      targetId: id,
      afterData: { status: updated.status },
    });

    return { id };
  }

  async remove(id: string, userId: string) {
    const exists = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
    });

    if (!exists) {
      throw new NotFoundException('题目不存在');
    }
    const parentReferences = await this.prisma.questionComposition.count({ where: { childQuestionId: id } });
    if (parentReferences > 0) {
      throw new BadRequestException(`该题目正被 ${parentReferences} 道材料/组合题引用，请先移除子题关系`);
    }

    const deletion = await this.prisma.$transaction(async (tx) => {
      const paperLinks = await tx.paperQuestion.findMany({
        where: { questionId: id },
        select: { paperId: true },
      });
      const paperIds = [...new Set(paperLinks.map((item) => item.paperId))];

      if (paperLinks.length) {
        await tx.paperQuestion.deleteMany({ where: { questionId: id } });
        for (const paperId of paperIds) {
          const aggregate = await tx.paperQuestion.aggregate({
            where: { paperId },
            _sum: { score: true },
          });
          await tx.paper.updateMany({
            where: { id: paperId, deletedAt: null },
            data: {
              totalScore: aggregate._sum.score ?? 0,
              updatedBy: userId,
            },
          });
        }
      }

      await tx.question.update({
        where: { id },
        data: {
          status: QuestionStatus.ARCHIVED,
          deletedAt: new Date(),
          updatedBy: userId,
        },
      });

      return { paperCount: paperIds.length, paperQuestionCount: paperLinks.length };
    });

    await this.audit.log({
      userId,
      action: 'question:delete',
      module: 'question',
      targetType: 'question',
      targetId: id,
      beforeData: { title: exists.title },
      afterData: deletion,
    });

    return {
      deleted: true,
      ...deletion,
      message: deletion.paperQuestionCount
        ? `题目已删除，并从 ${deletion.paperCount} 份试卷中移除 ${deletion.paperQuestionCount} 个关联题位`
        : '题目已删除',
    };
  }

  async bulkDelete(ids: string[], userId: string) {
    const uniqueIds = [...new Set(ids)];
    const failed: Array<{ id: string; message: string }> = [];
    let successCount = 0;

    for (const id of uniqueIds) {
      try {
        await this.remove(id, userId);
        successCount += 1;
      } catch (error) {
        failed.push({ id, message: error instanceof Error ? error.message : '删除失败' });
      }
    }

    await this.audit.log({
      userId,
      action: 'question:bulk-delete',
      module: 'question',
      targetType: 'question',
      targetId: uniqueIds[0],
      afterData: { ids: uniqueIds, successCount, failedCount: failed.length },
    });

    return {
      successCount,
      failed,
    };
  }

  async bulkUpdateStatus(ids: string[], status: string, userId: string) {
    const uniqueIds = [...new Set(ids)];
    const targetStatus = normalizeQuestionStatus(status);
    if (targetStatus === QuestionStatus.ARCHIVED) {
      throw new BadRequestException('归档请使用删除操作');
    }

    const failed: Array<{ id: string; message: string }> = [];
    let successCount = 0;

    for (const id of uniqueIds) {
      try {
        if (targetStatus === QuestionStatus.PUBLISHED) {
          await this.publish(id, userId);
        } else {
          await this.update(id, { status } as UpdateQuestionDto, userId);
        }
        successCount += 1;
      } catch (error) {
        failed.push({ id, message: error instanceof Error ? error.message : '状态更新失败' });
      }
    }

    await this.audit.log({
      userId,
      action: 'question:bulk-status',
      module: 'question',
      targetType: 'question',
      targetId: uniqueIds[0],
      afterData: { ids: uniqueIds, status: targetStatus, successCount, failedCount: failed.length },
    });

    return {
      status: toApiEnum(targetStatus),
      successCount,
      failed,
    };
  }

  private async replaceComposition(
    tx: Prisma.TransactionClient,
    parentQuestionId: string,
    type: QuestionType,
    children: CreateQuestionDto['children'],
  ) {
    if (type !== QuestionType.MATERIAL) {
      if (children?.length) throw new BadRequestException('只有材料/组合题可以配置子题');
      await tx.questionComposition.deleteMany({ where: { parentQuestionId } });
      return null;
    }
    if (!children?.length) throw new BadRequestException('材料/组合题至少需要一道子题');
    if (children.length > 100) throw new BadRequestException('单道材料/组合题最多包含 100 道子题');

    const uniqueIds = [...new Set(children.map((item) => item.questionId))];
    if (uniqueIds.length !== children.length) throw new BadRequestException('材料/组合题不能重复引用同一道子题');
    if (uniqueIds.includes(parentQuestionId)) throw new BadRequestException('材料/组合题不能引用自身');
    const questions = await tx.question.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
      select: { id: true, type: true },
    });
    if (questions.length !== uniqueIds.length) throw new BadRequestException('部分子题不存在或已删除');
    if (questions.some((item) => item.type === QuestionType.MATERIAL)) {
      throw new BadRequestException('当前版本只支持单层组合，子题不能再是材料/组合题');
    }

    await tx.questionComposition.deleteMany({ where: { parentQuestionId } });
    await tx.questionComposition.createMany({
      data: children.map((item, index) => ({
        parentQuestionId,
        childQuestionId: item.questionId,
        score: item.score,
        sortOrder: item.sortOrder ?? index,
      })),
    });
    return children.reduce((sum, item) => sum + item.score, 0);
  }

  private async createScoringRuleVersion(
    tx: Prisma.TransactionClient,
    questionId: string,
    type: QuestionType,
    version: number,
    answerJson: Prisma.InputJsonValue,
    ruleJson: unknown,
    userId: string,
  ) {
    const rule = this.toPlainRecord(ruleJson);
    return tx.scoringRuleVersion.create({
      data: {
        questionId,
        version,
        adapterKey: toApiEnum(type),
        adapterVersion: this.questionTypes.descriptor(toApiEnum(type)).version,
        answerJson,
        ruleJson: rule as Prisma.InputJsonObject,
        rubricJson: Array.isArray(rule.rubric) ? (rule.rubric as Prisma.InputJsonArray) : Prisma.JsonNull,
        checksum: createHash('sha256').update(JSON.stringify({ answerJson, rule })).digest('hex'),
        createdBy: userId,
      },
    });
  }

  private async buildResourceSnapshot(
    tx: Prisma.TransactionClient | PrismaService,
    ...values: unknown[]
  ): Promise<Prisma.InputJsonArray> {
    const urls = this.extractResourceReferences(...values);
    const objectKeys = urls.map((url) => url.replace(/^\/?uploads\//, ''));
    const assets = objectKeys.length
      ? await tx.fileAsset.findMany({ where: { objectKey: { in: objectKeys }, deletedAt: null } })
      : [];
    const byKey = new Map(assets.map((asset) => [asset.objectKey, asset]));
    return urls.map((url) => {
      const objectKey = url.replace(/^\/?uploads\//, '');
      const asset = byKey.get(objectKey);
      return {
        logicalUrl: url,
        assetId: asset?.id ?? null,
        objectKey,
        version: asset?.version ?? 1,
        sha256: asset?.sha256 ?? null,
        fileSize: asset ? Number(asset.fileSize) : null,
        mimeType: asset?.mimeType ?? null,
      } as Prisma.InputJsonObject;
    });
  }

  async buildSnapshot(
    tx: Prisma.TransactionClient | PrismaService,
    questionId: string,
  ): Promise<Prisma.InputJsonObject> {
    const question = await tx.question.findUniqueOrThrow({
      where: { id: questionId },
      include: {
        course: true,
        options: { orderBy: { sortOrder: 'asc' } },
        answer: true,
        programmingRef: true,
        knowledgePoints: { include: { knowledgePoint: true } },
        tags: { include: { tag: true } },
        compositionChildren: { orderBy: { sortOrder: 'asc' } },
      },
    });

    const children = await Promise.all(
      question.compositionChildren.map(async (relation) => ({
        questionId: relation.childQuestionId,
        score: Number(relation.score),
        sortOrder: relation.sortOrder,
        snapshot: await this.buildSnapshot(tx, relation.childQuestionId),
      })),
    );
    const resources = await this.buildResourceSnapshot(
      tx,
      question.content,
      question.analysis,
      question.options,
      question.answer?.answerJson,
      question.answer?.scoringRuleJson,
    );

    return {
      id: question.id,
      courseId: question.courseId,
      courseName: question.course.name,
      type: toApiEnum(question.type),
      title: question.title,
      content: question.content,
      difficulty: question.difficulty,
      defaultScore: Number(question.defaultScore),
      analysis: question.analysis,
      allowOptionShuffle: question.allowOptionShuffle,
      version: question.version,
      engine: {
        adapterKey: toApiEnum(question.type),
        adapterVersion: this.questionTypes.descriptor(toApiEnum(question.type)).version,
        schemaVersion: 1,
      },
      options: question.options.map((option) => ({
        id: option.id,
        optionKey: option.optionKey,
        content: option.content,
        isCorrect: option.isCorrect,
        sortOrder: option.sortOrder,
      })),
      answer: question.answer?.answerJson ?? null,
      scoringRule: question.answer?.scoringRuleJson ?? null,
      scoringRuleVersionId: question.answer?.currentRuleVersionId ?? null,
      programmingRef: question.programmingRef
        ? this.formatProgrammingRef(question.programmingRef)
        : null,
      knowledgePoints: question.knowledgePoints.map((relation) => ({
        id: relation.knowledgePoint.id,
        name: relation.knowledgePoint.name,
      })),
      tags: question.tags.map((relation) => ({
        id: relation.tag.id,
        name: relation.tag.name,
      })),
      resources,
      children,
    };
  }

  private programmingLanguages(value: Prisma.JsonValue | null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const languages = (value as Record<string, unknown>).languages;
    return Array.isArray(languages) ? languages.map(String).filter(Boolean) : [];
  }

  private formatProgrammingRef(ref: {
    judgeProvider: string;
    externalProblemId: string;
    externalProblemUrl: string | null;
    languageConfigJson: Prisma.JsonValue | null;
    timeLimit: number | null;
    memoryLimit: number | null;
    judgeConfigJson: Prisma.JsonValue | null;
  }) {
    const judgeConfig = this.toPlainRecord(ref.judgeConfigJson);
    return {
      judgeProvider: ref.judgeProvider,
      externalProblemId: ref.externalProblemId,
      externalProblemUrl: ref.externalProblemUrl,
      platformBaseUrl: String(judgeConfig.platformBaseUrl ?? this.baseUrlFromProblemUrl(ref.externalProblemUrl)).trim(),
      domainId: String(judgeConfig.domainId ?? this.domainIdFromProblemUrl(ref.externalProblemUrl) ?? 'system').trim(),
      domainName: String(judgeConfig.domainName ?? judgeConfig.domainId ?? this.domainIdFromProblemUrl(ref.externalProblemUrl) ?? 'system').trim(),
      accountId: judgeConfig.accountId ? String(judgeConfig.accountId) : null,
      accountLabel: judgeConfig.accountLabel ? String(judgeConfig.accountLabel) : null,
      languages: this.programmingLanguages(ref.languageConfigJson),
      timeLimit: ref.timeLimit,
      memoryLimit: ref.memoryLimit,
      judgeConfig: ref.judgeConfigJson,
    };
  }

  private async upsertProgrammingRef(
    tx: Prisma.TransactionClient,
    questionId: string,
    type: QuestionType,
    ref: CreateQuestionDto['programmingRef'] | undefined,
  ) {
    if (type !== QuestionType.PROGRAMMING) {
      await tx.programmingProblemRef.deleteMany({ where: { questionId } });
      return;
    }

    if (ref === undefined) return;
    const externalProblemId = String(ref?.externalProblemId ?? '').trim();
    if (!externalProblemId) {
      await tx.programmingProblemRef.deleteMany({ where: { questionId } });
      return;
    }

    const provider = String(ref?.judgeProvider || 'hydro').trim().toLowerCase();
    const platformBaseUrl = this.normalizeHydroBaseUrl(ref?.platformBaseUrl || this.baseUrlFromProblemUrl(ref?.externalProblemUrl));
    const domainId = String(ref?.domainId || this.domainIdFromProblemUrl(ref?.externalProblemUrl) || 'system').trim() || 'system';
    const domainName = String(ref?.domainName || domainId).trim();
    const externalProblemUrl = ref?.externalProblemUrl?.trim() || this.defaultHydroProblemUrl(externalProblemId, platformBaseUrl, domainId);
    const languageConfig = {
      languages: Array.isArray(ref?.languages)
        ? ref.languages.map((item) => String(item).trim()).filter(Boolean)
        : [],
    };
    const judgeConfig = {
      ...(ref?.judgeConfig ?? {}),
      platformCode: provider,
      platformBaseUrl,
      domainId,
      domainName,
      accountId: ref?.accountId ?? this.toPlainRecord(ref?.judgeConfig).accountId ?? null,
      accountLabel: ref?.accountLabel?.trim() || String(this.toPlainRecord(ref?.judgeConfig).accountLabel ?? ''),
      submitPageUrl:
        String(this.toPlainRecord(ref?.judgeConfig).submitPageUrl ?? '').trim() ||
        `${externalProblemUrl.replace(/\/+$/, '')}/submit`,
    };

    await tx.programmingProblemRef.upsert({
      where: { questionId },
      update: {
        judgeProvider: provider,
        externalProblemId,
        externalProblemUrl,
        languageConfigJson: languageConfig as Prisma.InputJsonObject,
        timeLimit: ref?.timeLimit,
        memoryLimit: ref?.memoryLimit,
        judgeConfigJson: judgeConfig as Prisma.InputJsonObject,
      },
      create: {
        questionId,
        judgeProvider: provider,
        externalProblemId,
        externalProblemUrl,
        languageConfigJson: languageConfig as Prisma.InputJsonObject,
        timeLimit: ref?.timeLimit,
        memoryLimit: ref?.memoryLimit,
        judgeConfigJson: judgeConfig as Prisma.InputJsonObject,
      },
    });
  }

  private defaultHydroProblemUrl(problemId: string, baseUrl = process.env.HYDRO_BASE_URL || 'https://oj.example.com', domainId?: string) {
    const normalizedBaseUrl = this.normalizeHydroBaseUrl(baseUrl);
    const normalizedDomain = String(domainId || '').trim();
    const domainPrefix = normalizedDomain && normalizedDomain !== 'system' ? `/d/${encodeURIComponent(normalizedDomain)}` : '';
    return `${normalizedBaseUrl}${domainPrefix}/p/${encodeURIComponent(problemId)}`;
  }

  private normalizeHydroBaseUrl(value?: string | null) {
    const raw = String(value || process.env.HYDRO_BASE_URL || 'https://oj.example.com').trim();
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return withScheme.replace(/\/+$/, '');
  }

  private baseUrlFromProblemUrl(url?: string | null) {
    const raw = String(url || '').trim();
    if (!raw) return process.env.HYDRO_BASE_URL || 'https://oj.example.com';
    try {
      const parsed = new URL(raw);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return process.env.HYDRO_BASE_URL || 'https://oj.example.com';
    }
  }

  private domainIdFromProblemUrl(url?: string | null) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      const match = parsed.pathname.match(/\/d\/([^/]+)\/p\//);
      return match?.[1] ? decodeURIComponent(match[1]) : 'system';
    } catch {
      const match = raw.match(/\/d\/([^/]+)\/p\//);
      return match?.[1] ? decodeURIComponent(match[1]) : '';
    }
  }

  private async resolveCourseIdForQuestion(
    tx: Prisma.TransactionClient,
    dto: Pick<CreateQuestionDto, 'courseId' | 'courseName'>,
    userId: string,
  ) {
    const courseName = this.cleanName(dto.courseName);
    if (dto.courseId) {
      const exists = await tx.course.findFirst({
        where: { id: dto.courseId, deletedAt: null },
        select: { id: true },
      });
      if (exists) return exists.id;
      if (!courseName) {
        throw new BadRequestException('课程不存在，请选择有效课程或提供课程名称');
      }
    }

    if (!courseName) {
      throw new BadRequestException('请选择课程或填写课程名称');
    }

    const existing = await tx.course.findFirst({
      where: {
        deletedAt: null,
        name: { equals: courseName, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    const code = await this.nextCourseCode(tx, courseName);
    try {
      const created = await tx.course.create({
        data: {
          name: courseName,
          code,
          description: '题目导入时自动创建',
          createdBy: userId,
        },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const raceCreated = await tx.course.findFirst({
        where: {
          deletedAt: null,
          name: { equals: courseName, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (raceCreated) return raceCreated.id;
      const created = await tx.course.create({
        data: {
          name: courseName,
          code: await this.nextCourseCode(tx, `${courseName}-${Date.now().toString(36)}`),
          description: '题目导入时自动创建',
          createdBy: userId,
        },
        select: { id: true },
      });
      return created.id;
    }
  }

  private async resolveKnowledgePointIdsForQuestion(
    tx: Prisma.TransactionClient,
    courseId: string,
    ids?: string[],
    names?: string[],
  ) {
    const result = new Set<string>();
    const uniqueIds = [...new Set((ids ?? []).filter(Boolean))];
    if (uniqueIds.length) {
      const existing = await tx.knowledgePoint.findMany({
        where: {
          id: { in: uniqueIds },
          courseId,
          deletedAt: null,
        },
        select: { id: true },
      });
      existing.forEach((item) => result.add(item.id));
    }

    for (const name of this.cleanNameList(names)) {
      const existing = await tx.knowledgePoint.findFirst({
        where: {
          courseId,
          deletedAt: null,
          name: { equals: name, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (existing) {
        result.add(existing.id);
        continue;
      }

      const created = await this.createKnowledgePointByName(tx, courseId, name);
      result.add(created.id);
    }

    return [...result];
  }

  private async createKnowledgePointByName(tx: Prisma.TransactionClient, courseId: string, name: string) {
    try {
      return await tx.knowledgePoint.create({
        data: {
          courseId,
          name,
          code: await this.nextKnowledgePointCode(tx, courseId, name),
          level: 1,
          sortOrder: 0,
        },
        select: { id: true },
      });
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const existing = await tx.knowledgePoint.findFirst({
        where: {
          courseId,
          deletedAt: null,
          name: { equals: name, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (existing) return existing;
      return tx.knowledgePoint.create({
        data: {
          courseId,
          name,
          code: await this.nextKnowledgePointCode(tx, courseId, `${name}-${Date.now().toString(36)}`),
          level: 1,
          sortOrder: 0,
        },
        select: { id: true },
      });
    }
  }

  private async resolveTagIdsForQuestion(
    tx: Prisma.TransactionClient,
    ids?: string[],
    names?: string[],
  ) {
    const result = new Set<string>();
    const uniqueIds = [...new Set((ids ?? []).filter(Boolean))];
    if (uniqueIds.length) {
      const existing = await tx.tag.findMany({
        where: {
          id: { in: uniqueIds },
          type: TagType.QUESTION,
          deletedAt: null,
        },
        select: { id: true },
      });
      existing.forEach((item) => result.add(item.id));
    }

    for (const name of this.cleanNameList(names)) {
      const existing = await tx.tag.findFirst({
        where: {
          type: TagType.QUESTION,
          deletedAt: null,
          name: { equals: name, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (existing) {
        result.add(existing.id);
        continue;
      }

      try {
        const created = await tx.tag.create({
          data: {
            name,
            code: await this.nextTagCode(tx, name),
            type: TagType.QUESTION,
          },
          select: { id: true },
        });
        result.add(created.id);
      } catch (error) {
        if (!this.isUniqueConflict(error)) throw error;
        const raceCreated = await tx.tag.findFirst({
          where: {
            type: TagType.QUESTION,
            deletedAt: null,
            name: { equals: name, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (raceCreated) {
          result.add(raceCreated.id);
          continue;
        }
        const created = await tx.tag.create({
          data: {
            name,
            code: await this.nextTagCode(tx, `${name}-${Date.now().toString(36)}`),
            type: TagType.QUESTION,
          },
          select: { id: true },
        });
        result.add(created.id);
      }
    }

    return [...result];
  }

  private async resolveCheckCourseIds(questions: CreateQuestionDto[]) {
    const existingIds = new Set<string>();
    const courseIds = [...new Set(questions.map((question) => question.courseId).filter((id): id is string => Boolean(id)))];
    for (const chunk of this.chunk(courseIds, 100)) {
      const courses = await this.prisma.course.findMany({
        where: { id: { in: chunk }, deletedAt: null },
        select: { id: true },
      });
      courses.forEach((course) => existingIds.add(course.id));
    }

    const names = this.cleanNameList(questions.map((question) => question.courseName));
    const unresolvedNames = names.filter((name) =>
      questions.some((question) => (!question.courseId || !existingIds.has(question.courseId)) && this.sameName(question.courseName, name)),
    );
    if (!unresolvedNames.length) {
      for (const question of questions) {
        if (question.courseId && !existingIds.has(question.courseId)) question.courseId = '';
      }
      return;
    }

    const courseMap = new Map<string, string>();
    for (const chunk of this.chunk(unresolvedNames, 100)) {
      const courses = await this.prisma.course.findMany({
        where: {
          deletedAt: null,
          OR: chunk.map((name) => ({ name: { equals: name, mode: 'insensitive' } })),
        },
        select: { id: true, name: true },
      });
      courses.forEach((course) => courseMap.set(this.nameKey(course.name), course.id));
    }

    for (const question of questions) {
      if (question.courseId && existingIds.has(question.courseId)) continue;
      const courseId = courseMap.get(this.nameKey(question.courseName));
      question.courseId = courseId ?? '';
    }
  }

  private normalizeCheckQuestion(value: unknown): CreateQuestionDto {
    const record = this.toPlainRecord(this.parseJsonish(value));
    const importPayload = this.toPlainRecord(this.parseJsonish(record.importPayload));
    const source = Object.keys(importPayload).length ? { ...record, ...importPayload } : record;
    const options = this.normalizeCheckOptions(source.optionsJson ?? source.options);

    return {
      courseId: String(source.courseId ?? ''),
      courseName: String(source.courseName ?? (this.toPlainRecord(source.course).name ?? '')),
      type: String(source.type ?? 'single_choice'),
      title: String(source.title ?? '未命名题目'),
      content: String(source.contentMarkdown ?? source.content ?? ''),
      difficulty: Number(source.difficulty) || 1,
      defaultScore: Number(source.defaultScore ?? source.score) || 0,
      analysis: typeof source.analysisMarkdown === 'string'
        ? source.analysisMarkdown
        : typeof source.analysis === 'string'
          ? source.analysis
          : undefined,
      allowOptionShuffle: typeof source.allowOptionShuffle === 'boolean' ? source.allowOptionShuffle : undefined,
      knowledgePointIds: Array.isArray(source.knowledgePointIds) ? source.knowledgePointIds.map(String) : undefined,
      tagIds: Array.isArray(source.tagIds) ? source.tagIds.map(String) : undefined,
      options,
      answer: this.toPlainRecord(this.parseJsonish(source.answerJson ?? source.answer)),
      scoringRule: this.toPlainRecord(this.parseJsonish(source.scoringRuleJson ?? source.scoringRule)),
      comparable: this.toPlainRecord(source.comparable),
    };
  }

  private toComparableQuestion(
    value:
      | CreateQuestionDto
      | Prisma.QuestionGetPayload<{
          include: {
            course: { select: { name: true } };
            options: true;
            answer: true;
          };
        }>,
    index: number,
    fromEntity = false,
  ): ComparableQuestion {
    const type = fromEntity
      ? toApiEnum(String((value as { type: string }).type))
      : toApiEnum(normalizeQuestionType(String((value as CreateQuestionDto).type || 'single_choice')));
    const summary = this.toPlainRecord((value as { comparable?: unknown }).comparable);
    const title = String((value as { title?: string }).title ?? '').trim();
    const content = String((value as { content?: string }).content ?? '').trim();
    const options = this.comparableOptions(value);
    const answer = this.comparableAnswer(value, type);
    const titleKey = typeof summary.titleKey === 'string' ? summary.titleKey : this.normalizeComparableText(title);
    const contentKey = this.normalizeComparableText(content);
    const optionContentKey = options.map((option) => this.normalizeComparableText(option.content)).join('|');
    const optionFullKey = options
      .map((option) => `${this.normalizeComparableText(option.content)}:${option.isCorrect ? '1' : '0'}`)
      .join('|');
    const answerKey = this.stableStringify(answer);

    return {
      index,
      id: typeof (value as { id?: unknown }).id === 'string' ? ((value as { id: string }).id) : undefined,
      courseId: String((value as { courseId?: string }).courseId ?? ''),
      courseKey: this.comparableCourseKey(value),
      courseName: (value as { course?: { name?: string }; courseName?: string }).course?.name ?? (value as { courseName?: string }).courseName,
      title,
      type,
      status: fromEntity ? toApiEnum(String((value as { status?: string }).status ?? '')) : undefined,
      titleKey,
      contentHash: this.summaryHash(summary, 'contentHash', contentKey),
      contentLength: this.summaryLength(summary, 'contentLength', contentKey),
      optionContentHash: this.summaryHash(summary, 'optionContentHash', optionContentKey),
      optionContentLength: this.summaryLength(summary, 'optionContentLength', optionContentKey),
      optionFullHash: this.summaryHash(summary, 'optionFullHash', optionFullKey),
      optionFullLength: this.summaryLength(summary, 'optionFullLength', optionFullKey),
      answerHash: this.summaryHash(summary, 'answerHash', answerKey),
      answerLength: this.summaryLength(summary, 'answerLength', answerKey),
    };
  }

  private normalizeCheckOptions(value: unknown): CreateQuestionDto['options'] {
    const parsed = this.parseJsonish(value);
    if (!Array.isArray(parsed)) return [];
    const options = parsed.map((option, index) => {
      const item = this.toPlainRecord(option);
      return {
        optionKey: String(item.optionKey ?? item.label ?? String.fromCharCode(65 + index)),
        content: String(item.contentMarkdown ?? item.content ?? ''),
        isCorrect: item.isCorrect === true || item.isCorrect === 'true',
        sortOrder: Number(item.sortOrder ?? index + 1) || index + 1,
      };
    });
    return options;
  }

  private async findDuplicateCandidates(courseIds: string[], titles: string[]) {
    if (!courseIds.length || !titles.length) return [];

    const result = new Map<string, Prisma.QuestionGetPayload<{
      include: {
        course: { select: { name: true } };
        options: true;
        answer: true;
      };
    }>>();

    for (const courseChunk of this.chunk(courseIds, 100)) {
      for (const titleChunk of this.chunk(titles, 100)) {
        const questions = await this.prisma.question.findMany({
          where: {
            deletedAt: null,
            courseId: { in: courseChunk },
            OR: titleChunk.map((title) => ({ title: { equals: title, mode: 'insensitive' } })),
          },
          include: {
            course: { select: { name: true } },
            options: { orderBy: { sortOrder: 'asc' } },
            answer: true,
          },
        });
        questions.forEach((question) => result.set(question.id, question));
      }
    }

    return [...result.values()];
  }

  private hasSameQuestionBody(left: ComparableQuestion, right: ComparableQuestion) {
    return (
      left.titleKey === right.titleKey &&
      this.sameSignature(left.contentHash, left.contentLength, right.contentHash, right.contentLength) &&
      this.sameSignature(left.optionFullHash, left.optionFullLength, right.optionFullHash, right.optionFullLength) &&
      this.sameSignature(left.answerHash, left.answerLength, right.answerHash, right.answerLength)
    );
  }

  private hasSameContentAndOptions(left: ComparableQuestion, right: ComparableQuestion) {
    return (
      left.contentLength > 0 &&
      this.sameSignature(left.contentHash, left.contentLength, right.contentHash, right.contentLength) &&
      this.sameSignature(left.optionContentHash, left.optionContentLength, right.optionContentHash, right.optionContentLength)
    );
  }

  private sameSignature(leftHash: string, leftLength: number, rightHash: string, rightLength: number) {
    return leftLength === rightLength && leftHash === rightHash;
  }

  private comparableCourseKey(value: { courseId?: string; courseName?: string; course?: { name?: string } }) {
    const courseId = String(value.courseId ?? '').trim();
    if (courseId) return `id:${courseId}`;
    const courseName = this.nameKey(value.courseName ?? value.course?.name);
    return courseName ? `name:${courseName}` : 'none';
  }

  private summaryHash(summary: Record<string, unknown>, key: string, fallback: string) {
    const value = summary[key];
    return typeof value === 'string' && value ? value : this.hashComparableText(fallback);
  }

  private summaryLength(summary: Record<string, unknown>, key: string, fallback: string) {
    const value = Number(summary[key]);
    return Number.isFinite(value) && value >= 0 ? value : fallback.length;
  }

  private parseJsonish(value: unknown): unknown {
    if (value && typeof value === 'object') return value;
    const text = String(value ?? '').trim();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return value;
    }
  }

  private toPlainRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private comparableOptions(
    value:
      | CreateQuestionDto
      | Prisma.QuestionGetPayload<{
          include: {
            course: { select: { name: true } };
            options: true;
            answer: true;
          };
        }>,
  ) {
    const options = ((value as CreateQuestionDto).options ??
      (value as { options?: Array<{ optionKey: string; content: string; isCorrect: boolean; sortOrder: number }> }).options ??
      []) as Array<{ optionKey?: string; content?: string; isCorrect?: boolean; sortOrder?: number }>;

    return [...options]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.optionKey ?? '').localeCompare(String(b.optionKey ?? '')))
      .map((option, index) => ({
        optionKey: String(option.optionKey ?? String.fromCharCode(65 + index)).trim(),
        content: String(option.content ?? '').trim(),
        isCorrect: Boolean(option.isCorrect),
      }));
  }

  private comparableAnswer(
    value:
      | CreateQuestionDto
      | Prisma.QuestionGetPayload<{
          include: {
            course: { select: { name: true } };
            options: true;
            answer: true;
          };
        }>,
    apiType: string,
  ) {
    const type = normalizeQuestionType(apiType);
    if (this.isChoiceQuestion(type)) {
      return {};
    }

    return (
      (value as CreateQuestionDto).answer ??
      (value as { answer?: { answerJson?: unknown } }).answer?.answerJson ??
      {}
    );
  }

  private normalizeComparableText(value: unknown) {
    return String(value ?? '')
      .replace(/!\[[^\]]*]\([^)]+\)/g, '![image]')
      .replace(/\[[^\]]+]\([^)]+\)/g, '[link]')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private hashComparableText(value: string) {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask = 0xffffffffffffffffn;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= BigInt(value.charCodeAt(index));
      hash = (hash * prime) & mask;
    }
    return hash.toString(16).padStart(16, '0');
  }

  private async nextCourseCode(tx: Prisma.TransactionClient, name: string) {
    const base = this.codeBase(name, 'course');
    return this.nextScopedCode((code) => tx.course.findUnique({ where: { code }, select: { id: true } }), base);
  }

  private async nextKnowledgePointCode(tx: Prisma.TransactionClient, courseId: string, name: string) {
    const base = this.codeBase(name, 'kp');
    return this.nextScopedCode(
      (code) =>
        tx.knowledgePoint.findFirst({
          where: { courseId, code },
          select: { id: true },
        }),
      base,
    );
  }

  private async nextTagCode(tx: Prisma.TransactionClient, name: string) {
    const base = this.codeBase(name, 'tag');
    return this.nextScopedCode((code) => tx.tag.findUnique({ where: { code }, select: { id: true } }), base);
  }

  private async nextScopedCode(
    exists: (code: string) => Promise<{ id: string } | null>,
    base: string,
  ) {
    for (let index = 0; index < 50; index += 1) {
      const suffix = index ? `_${index + 1}` : '';
      const code = `${base.slice(0, 64 - suffix.length)}${suffix}`;
      if (!(await exists(code))) return code;
    }
    const suffix = `_${Date.now().toString(36)}`;
    return `${base.slice(0, 64 - suffix.length)}${suffix}`;
  }

  private codeBase(value: string, prefix: string) {
    const cleaned = this.cleanName(value);
    const ascii = cleaned
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30);
    const hash = this.hashComparableText(cleaned).slice(0, 10);
    return `${prefix}_${ascii || 'auto'}_${hash}`.slice(0, 64);
  }

  private cleanName(value: unknown) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    return text && !['undefined', 'null', '-', '无'].includes(text.toLowerCase()) ? text : '';
  }

  private cleanNameList(values?: unknown[] | null) {
    return [...new Set((values ?? []).map((value) => this.cleanName(value)).filter(Boolean))];
  }

  private withProgrammingSourceTags(
    tagNames: string[] | undefined,
    type: QuestionType,
    ref: CreateQuestionDto['programmingRef'] | undefined | null,
  ) {
    return this.cleanNameList([...(tagNames ?? []), ...this.programmingSourceTagNames(type, ref)]);
  }

  private programmingSourceTagNames(
    type: QuestionType,
    ref: CreateQuestionDto['programmingRef'] | undefined | null,
  ) {
    if (type !== QuestionType.PROGRAMMING || !ref?.externalProblemId) return [];
    const judgeConfig = this.toPlainRecord(ref.judgeConfig);
    const rawBaseUrl =
      ref.platformBaseUrl ||
      String(judgeConfig.platformBaseUrl ?? '') ||
      (ref.externalProblemUrl ? this.baseUrlFromProblemUrl(ref.externalProblemUrl) : '');
    const host = this.hostTagName(rawBaseUrl);
    return ['外部编程题', host].filter(Boolean);
  }

  private hostTagName(value?: string | null) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    try {
      return new URL(withScheme).host.toLowerCase().replace(/^www\./, '');
    } catch {
      return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase().replace(/^www\./, '');
    }
  }

  private nameKey(value: unknown) {
    return this.cleanName(value).toLowerCase();
  }

  private sameName(left: unknown, right: unknown) {
    return this.nameKey(left) === this.nameKey(right);
  }

  private chunk<T>(values: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
      chunks.push(values.slice(index, index + size));
    }
    return chunks;
  }

  private extractResourceReferences(...values: unknown[]) {
    const references = new Set<string>();
    const visit = (value: unknown) => {
      if (typeof value === 'string') {
        const markdownLinkRegex = /!?\[[^\]]*]\(([^)]+)\)/g;
        const uploadRegex = /(?:^|["'\s(])((?:\/uploads\/|uploads\/)[^"'\s)]+)/g;
        let match: RegExpExecArray | null;
        while ((match = markdownLinkRegex.exec(value))) {
          const url = this.cleanResourceUrl(match[1]);
          if (url) references.add(url);
        }
        while ((match = uploadRegex.exec(value))) {
          const url = this.cleanResourceUrl(match[1]);
          if (url) references.add(url);
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value && typeof value === 'object') {
        Object.values(value as Record<string, unknown>).forEach(visit);
      }
    };

    values.forEach(visit);
    return [...references];
  }

  private async resourceReferenceStats(urls: string[]) {
    const targetUrls = new Set(urls.map((url) => this.cleanResourceUrl(url)).filter(Boolean));
    const stats = new Map<string, { count: number; locations: string[] }>();
    for (const url of targetUrls) stats.set(url, { count: 0, locations: [] });
    if (!targetUrls.size) return stats;

    const add = (location: string, ...values: unknown[]) => {
      for (const url of this.extractResourceReferences(...values)) {
        if (!targetUrls.has(url)) continue;
        const current = stats.get(url) ?? { count: 0, locations: [] };
        current.count += 1;
        if (current.locations.length < 30) current.locations.push(location);
        stats.set(url, current);
      }
    };

    const [questions, questionVersions, paperQuestions, paperInstances] = await Promise.all([
      this.prisma.question.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          title: true,
          content: true,
          analysis: true,
          options: { select: { content: true } },
          answer: { select: { answerJson: true, scoringRuleJson: true } },
        },
      }),
      this.prisma.questionVersion.findMany({ select: { snapshotJson: true } }),
      this.prisma.paperQuestion.findMany({ select: { questionSnapshotJson: true } }),
      this.prisma.paperInstance.findMany({ select: { paperSnapshotJson: true } }),
    ]);

    for (const question of questions) {
      add(
        `题目：${question.title || question.id}`,
        question.content,
        question.analysis,
        question.options.map((option) => option.content),
        question.answer?.answerJson,
        question.answer?.scoringRuleJson,
      );
    }
    for (const version of questionVersions) add('题目版本快照', version.snapshotJson);
    for (const paperQuestion of paperQuestions) add('试卷题目快照', paperQuestion.questionSnapshotJson);
    for (const instance of paperInstances) add('考试试卷实例快照', instance.paperSnapshotJson);

    return stats;
  }

  private cleanResourceUrl(value: unknown) {
    const raw = String(value ?? '')
      .trim()
      .replace(/^<|>$/g, '')
      .split('#')[0]
      .split('?')[0];
    if (!raw || /^(https?:|data:|javascript:|mailto:)/i.test(raw)) return '';
    return raw.startsWith('uploads/') ? `/${raw}` : raw;
  }

  private resourceKind(url: string, mimeType?: string | null) {
    const value = `${mimeType ?? ''} ${url}`.toLowerCase();
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(value) || value.includes('image/')) return 'image';
    if (/\.pdf$/.test(value) || value.includes('application/pdf')) return 'pdf';
    if (/\.(doc|docx)$/.test(value) || value.includes('word')) return 'word';
    if (/\.(xls|xlsx|csv)$/.test(value) || value.includes('spreadsheet')) return 'sheet';
    return 'file';
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.stableStringify((value as Record<string, unknown>)[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value ?? null);
  }

  private async findOccupationMap(questionIds: string[]) {
    const result = new Map<string, Array<{ id: string; name: string; status: ExamStatus }>>();
    if (!questionIds.length) return result;
    const now = new Date();

    const relations = await this.prisma.paperQuestion.findMany({
      where: {
        questionId: { in: questionIds },
        paper: {
          exams: {
            some: {
              status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
              startTime: { lte: now },
              endTime: { gt: now },
            },
          },
        },
      },
      include: {
        paper: {
          include: {
            exams: {
              where: {
                status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
                startTime: { lte: now },
                endTime: { gt: now },
              },
              select: { id: true, name: true, status: true },
            },
          },
        },
      },
    });

    for (const relation of relations) {
      result.set(relation.questionId, [...(result.get(relation.questionId) ?? []), ...relation.paper.exams]);
    }

    return result;
  }

  private gradeStandaloneQuestion(
    type: QuestionType,
    totalScore: number,
    answerJson: QuestionAnswerJson,
    submitted: CheckQuestionAnswerDto,
  ) {
    if (this.isChoiceQuestion(type)) {
      const selected = new Set((submitted.selectedOptionIds ?? []).filter(Boolean));
      const correct = new Set(answerJson.correctOptionIds ?? []);
      const isCorrect =
        selected.size === correct.size && [...selected].every((optionId) => correct.has(optionId));

      return {
        isCorrect,
        score: isCorrect ? totalScore : 0,
        status: 'auto_graded',
        message: isCorrect ? '回答正确' : '回答错误',
      };
    }

    if (type === QuestionType.FILL_BLANK) {
      const blanks = submitted.blanks ?? [];
      const rules = answerJson.blanks ?? [];
      let score = 0;
      let allCorrect = true;

      for (const rule of rules) {
        const submittedValue = blanks.find((blank) => blank.index === rule.index)?.value ?? '';
        const normalizedSubmitted = this.normalizeBlank(submittedValue, rule);
        const matched = rule.answers
          .map((answer) => this.normalizeBlank(answer, rule))
          .includes(normalizedSubmitted);
        if (matched) {
          score += rule.score ?? totalScore / Math.max(rules.length, 1);
        } else {
          allCorrect = false;
        }
      }

      return {
        isCorrect: allCorrect,
        score,
        status: 'auto_graded',
        message: allCorrect ? '回答正确' : '回答错误',
      };
    }

    return {
      isCorrect: null,
      score: 0,
      status: type === QuestionType.PROGRAMMING ? 'judge_pending' : 'manual_needed',
      message: type === QuestionType.PROGRAMMING ? '该题型需要外部评测，已提供参考答案' : '该题型需要人工批改，已提供参考答案',
    };
  }

  private scoreResultMessage(result: { isCorrect: boolean | null; status: unknown; warnings?: string[] }) {
    if (result.warnings?.length) return result.warnings[0];
    if (result.isCorrect === true) return '回答正确';
    if (result.isCorrect === false) return '回答错误';
    const status = toApiEnum(result.status as never);
    if (status === 'judge_pending') return '该题型需要外部评测，已提供参考答案';
    if (status === 'submitted') return '该题型已提交，成绩由子题或后续流程汇总';
    return '该题型需要人工批改，已提供参考答案';
  }

  private buildAnswerSummary(
    type: QuestionType,
    answerJson: QuestionAnswerJson,
    submitted: CheckQuestionAnswerDto,
    options: Array<{ id: string; optionKey: string; content: string }>,
  ) {
    const optionMap = new Map(options.map((option) => [option.id, option]));
    const selectedOptionIds = (submitted.selectedOptionIds ?? []).filter(Boolean);
    const studentAnswerText = this.describeSubmittedAnswer(submitted, optionMap);
    const correctAnswerText = this.describeCorrectAnswer(type, answerJson, optionMap);
    const referenceAnswerText = this.describeReferenceAnswer(type, answerJson, correctAnswerText);
    const answerExplanation = this.describeAnswerRule(type, answerJson);

    return {
      studentAnswerText,
      correctAnswerText,
      referenceAnswerText,
      answerExplanation,
      selectedOptionLabels: selectedOptionIds.map((optionId) => this.describeOption(optionId, optionMap)),
    };
  }

  private describeSubmittedAnswer(
    submitted: CheckQuestionAnswerDto,
    optionMap: Map<string, { optionKey: string; content: string }>,
  ) {
    const selectedOptionIds = (submitted.selectedOptionIds ?? []).filter(Boolean);
    if (selectedOptionIds.length) {
      return selectedOptionIds.map((optionId) => this.describeOption(optionId, optionMap)).join('\n\n');
    }

    if (submitted.blanks?.length) {
      const lines = submitted.blanks
        .filter((blank) => String(blank.value ?? '').trim())
        .map((blank) => `第 ${blank.index} 空：${blank.value}`);
      return lines.length ? lines.join('\n') : '未作答';
    }

    if (String(submitted.text ?? '').trim()) {
      return submitted.text?.trim() ?? '';
    }

    if (submitted.extra && Object.keys(submitted.extra).length) {
      return JSON.stringify(submitted.extra, null, 2);
    }

    return '未作答';
  }

  private describeCorrectAnswer(
    type: QuestionType,
    answerJson: QuestionAnswerJson,
    optionMap: Map<string, { optionKey: string; content: string }>,
  ) {
    if (this.isChoiceQuestion(type)) {
      const correctOptionIds = answerJson.correctOptionIds ?? [];
      return correctOptionIds.length
        ? correctOptionIds.map((optionId) => this.describeOption(optionId, optionMap)).join('\n\n')
        : '未配置正确选项';
    }

    if (type === QuestionType.FILL_BLANK) {
      const blanks = answerJson.blanks ?? [];
      return blanks.length
        ? blanks
            .map((blank) => {
              const answers = blank.answers?.filter(Boolean).join(' / ') || '未配置';
              return `第 ${blank.index} 空：${answers}`;
            })
            .join('\n')
        : '未配置填空答案';
    }

    return '';
  }

  private describeReferenceAnswer(type: QuestionType, answerJson: QuestionAnswerJson, correctAnswerText: string) {
    if (answerJson.reference && String(answerJson.reference).trim()) {
      return String(answerJson.reference).trim();
    }

    if (correctAnswerText) {
      return correctAnswerText;
    }

    const jsonText = JSON.stringify(answerJson ?? {}, null, 2);
    if (jsonText && jsonText !== '{}') {
      return jsonText;
    }

    return type === QuestionType.PROGRAMMING ? '暂无参考代码或外部评测说明' : '暂无参考答案';
  }

  private describeAnswerRule(type: QuestionType, answerJson: QuestionAnswerJson) {
    if (type !== QuestionType.FILL_BLANK) return '';
    const blanks = answerJson.blanks ?? [];
    if (!blanks.length) return '';

    return blanks
      .map((blank) => {
        const rules = [
          blank.ignoreCase ? '不区分大小写' : '区分大小写',
          blank.trimSpace ?? true ? '忽略首尾空格' : '区分首尾空格',
        ];
        return `第 ${blank.index} 空：${rules.join('，')}`;
      })
      .join('\n');
  }

  private blankCount(answerJson: unknown) {
    if (!answerJson || typeof answerJson !== 'object' || Array.isArray(answerJson)) return 1;
    const blanks = (answerJson as QuestionAnswerJson).blanks;
    return Array.isArray(blanks) && blanks.length ? blanks.length : 1;
  }

  private excelHeaderMap(worksheet: ExcelJS.Worksheet) {
    const map = new Map<string, number>();
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      for (const key of this.excelHeaderKeys(this.cellText(cell.value))) {
        if (!map.has(key)) map.set(key, colNumber);
      }
    });
    return map;
  }

  private excelQuestionRows(worksheet: ExcelJS.Worksheet, headerMap: Map<string, number>) {
    const rows: ExcelQuestionRow[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const content = this.excelValue(row, headerMap, ['content', '题干', '题目内容']);
      const title = this.excelValue(row, headerMap, ['title', '标题', '题目标题']) || content.slice(0, 80);
      const type = this.excelValue(row, headerMap, ['type', '题型']) || '单选题';
      const courseName = this.excelValue(row, headerMap, ['course', 'courseName', '课程']);
      if (!title && !content && !courseName) return;

      const optionValues: ExcelQuestionRow['optionValues'] = [];
      for (const key of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        const value = this.excelValue(row, headerMap, [`option${key}`, `选项${key}`]);
        if (value) optionValues.push({ optionKey: key, content: value });
      }

      rows.push({
        rowNumber,
        title,
        content,
        type,
        courseName,
        knowledgePointNames: this.splitNames(this.excelValue(row, headerMap, ['knowledgePoints', 'knowledgePoint', '知识点'])),
        tagNames: this.splitNames(this.excelValue(row, headerMap, ['tags', '标签'])),
        difficulty: this.clampImportNumber(this.excelValue(row, headerMap, ['difficulty', '难度']), 1, 5, 1),
        defaultScore: this.nonNegativeImportNumber(this.excelValue(row, headerMap, ['score', 'defaultScore', '分值']), 2),
        analysis: this.excelValue(row, headerMap, ['analysis', '解析']),
        answerText: this.excelValue(row, headerMap, ['answer', 'correctAnswer', '正确答案', '答案']),
        optionValues,
        allowOptionShuffle: this.optionalBooleanFromExcel(
          this.excelValue(row, headerMap, ['allowOptionShuffle', '允许选项随机']),
        ),
        identifier: this.excelValue(row, headerMap, ['identifier', '题目标识']),
        parentIdentifier: this.excelValue(row, headerMap, ['parentIdentifier', '父题标识']),
        childScore: this.nonNegativeImportNumber(this.excelValue(row, headerMap, ['childScore', '子题分值']), 0),
        childOrder: this.nonNegativeImportNumber(this.excelValue(row, headerMap, ['childOrder', '子题顺序']), rowNumber),
      });
    });
    return rows;
  }

  private excelRowToCreateDto(row: ExcelQuestionRow): CreateQuestionDto {
    if (!row.courseName) throw new BadRequestException(`第 ${row.rowNumber} 行缺少课程`);
    if (!row.content) throw new BadRequestException(`第 ${row.rowNumber} 行缺少题干`);
    const type = this.excelQuestionType(row.type);
    const options = this.excelOptions(type, row.optionValues, row.answerText);
    return {
      courseName: row.courseName,
      type,
      title: row.title || row.content.slice(0, 80),
      content: row.content,
      difficulty: row.difficulty,
      defaultScore: row.defaultScore,
      analysis: row.analysis,
      allowOptionShuffle: row.allowOptionShuffle,
      knowledgePointNames: row.knowledgePointNames,
      tagNames: row.tagNames,
      options,
      answer: this.excelAnswer(type, row.answerText),
      scoringRule: type === 'fill_blank' ? { mode: 'exact' } : { mode: 'strict' },
    };
  }

  private excelOptions(type: string, values: ExcelQuestionRow['optionValues'], answerText: string) {
    const options =
      type === 'true_false' && !values.length
        ? [
            { optionKey: 'A', content: '正确' },
            { optionKey: 'B', content: '错误' },
          ]
        : values;
    const correctKeys = this.excelCorrectOptionKeys(type, answerText);
    return options.map((option, index) => ({
      optionKey: option.optionKey,
      content: option.content,
      isCorrect: correctKeys.has(option.optionKey),
      sortOrder: index + 1,
    }));
  }

  private excelAnswer(type: string, answerText: string) {
    if (type === 'fill_blank') {
      const parts = answerText.split(/[;；]/).map((item) => item.trim()).filter(Boolean);
      return {
        blanks: (parts.length ? parts : [answerText]).map((part, index) => ({
          index: index + 1,
          answers: part.split(/[，,、/|]/).map((item) => item.trim()).filter(Boolean),
          trimSpace: true,
          ignoreCase: false,
        })),
      };
    }
    if (['short_answer', 'programming', 'material', 'file_upload', 'scratch_project', 'arduino_project'].includes(type)) {
      return { reference: answerText };
    }
    return {};
  }

  private excelCorrectOptionKeys(type: string, answerText: string) {
    const normalized = answerText.trim();
    if (type === 'true_false') {
      if (/^(正确|对|true|t|yes|y|1|a)$/i.test(normalized)) return new Set(['A']);
      if (/^(错误|错|false|f|no|n|0|b)$/i.test(normalized)) return new Set(['B']);
    }
    return new Set(
      normalized
        .split(/[，,;；、\s]+/)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    );
  }

  private excelQuestionType(value: string) {
    const map: Record<string, string> = {
      单选: 'single_choice',
      单选题: 'single_choice',
      多选: 'multiple_choice',
      多选题: 'multiple_choice',
      判断: 'true_false',
      判断题: 'true_false',
      填空: 'fill_blank',
      填空题: 'fill_blank',
      简答: 'short_answer',
      简答题: 'short_answer',
      编程: 'programming',
      编程题: 'programming',
      材料: 'material',
      材料题: 'material',
      '材料/组合题': 'material',
      组合题: 'material',
      大题: 'material',
      '大题/组合题': 'material',
      多问题: 'material',
      多问简答: 'material',
      文件上传: 'file_upload',
      文件上传题: 'file_upload',
      scratch: 'scratch_project',
      scratch项目题: 'scratch_project',
      arduino: 'arduino_project',
      arduino项目题: 'arduino_project',
    };
    const raw = value.trim();
    return toApiEnum(normalizeQuestionType(map[raw] ?? map[raw.toLowerCase()] ?? (raw || 'single_choice')));
  }

  private excelValue(row: ExcelJS.Row, headerMap: Map<string, number>, keys: string[]) {
    for (const key of keys.flatMap((item) => this.excelHeaderKeys(item))) {
      const index = headerMap.get(key);
      if (!index) continue;
      const value = this.cellText(row.getCell(index).value);
      if (value) return value;
    }
    return '';
  }

  private excelHeaderKeys(value: string) {
    const normalized = value.trim();
    const compact = normalized.toLowerCase().replace(/\s+/g, '');
    const optionMatch = compact.match(/^(?:选项|option)([a-z])$/i);
    return [
      normalized,
      compact,
      optionMatch ? `option${optionMatch[1].toUpperCase()}` : '',
      optionMatch ? `选项${optionMatch[1].toUpperCase()}` : '',
    ].filter(Boolean);
  }

  private cellText(value: ExcelJS.CellValue) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      if ('text' in value && value.text) return String(value.text).trim();
      if ('result' in value && value.result !== undefined) return String(value.result).trim();
      if ('richText' in value && Array.isArray(value.richText)) {
        return value.richText.map((item) => item.text).join('').trim();
      }
      if (value instanceof Date) return value.toISOString();
      return String((value as { formula?: string }).formula ?? '').trim();
    }
    return String(value).trim();
  }

  private splitNames(value: string) {
    return [...new Set(value.split(/[，,;；、]/).map((item) => item.trim()).filter(Boolean))];
  }

  private clampImportNumber(value: string, min: number, max: number, fallback: number) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  private nonNegativeImportNumber(value: string, fallback: number) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, number);
  }

  private optionalBooleanFromExcel(value: string) {
    if (!value) return undefined;
    if (/^(是|true|1|yes|y)$/i.test(value)) return true;
    if (/^(否|false|0|no|n)$/i.test(value)) return false;
    return undefined;
  }

  private describeOption(
    optionId: string,
    optionMap: Map<string, { optionKey: string; content: string }>,
  ) {
    const option = optionMap.get(optionId);
    if (!option) return optionId;
    return `${option.optionKey}. ${option.content}`;
  }

  private normalizeBlank(value: string, rule: { ignoreCase?: boolean; trimSpace?: boolean }) {
    let result = value;
    if (rule.trimSpace ?? true) {
      result = result.trim();
    }
    if (rule.ignoreCase) {
      result = result.toLowerCase();
    }
    return result;
  }

  private validateQuestionInput(type: QuestionType, dto: CreateQuestionDto) {
    if (this.isChoiceQuestion(type) && !dto.options?.length) {
      throw new BadRequestException('客观选择题必须包含选项');
    }

    if (type === QuestionType.SINGLE_CHOICE) {
      const correctCount = dto.options?.filter((option) => option.isCorrect).length ?? 0;
      if (dto.options?.length && correctCount !== 1) {
        throw new BadRequestException('单选题必须有且只有一个正确选项');
      }
    }

    if (type === QuestionType.MULTIPLE_CHOICE) {
      const correctCount = dto.options?.filter((option) => option.isCorrect).length ?? 0;
      if (dto.options?.length && correctCount < 2) {
        throw new BadRequestException('多选题至少需要两个正确选项');
      }
    }
  }

  private async replaceOptions(
    tx: Prisma.TransactionClient,
    questionId: string,
    options: CreateQuestionDto['options'],
  ) {
    await tx.questionOption.deleteMany({ where: { questionId } });

    if (!options?.length) {
      return [];
    }

    await tx.questionOption.createMany({
      data: options.map((option, index) => ({
        questionId,
        optionKey: option.optionKey,
        content: option.content,
        isCorrect: option.isCorrect ?? false,
        sortOrder: option.sortOrder ?? index + 1,
      })),
    });

    return tx.questionOption.findMany({
      where: { questionId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  private async replaceRelations(
    tx: Prisma.TransactionClient,
    questionId: string,
    knowledgePointIds?: string[],
    tagIds?: string[],
  ) {
    if (knowledgePointIds) {
      await tx.questionKnowledgePoint.deleteMany({ where: { questionId } });
      if (knowledgePointIds.length) {
        await tx.questionKnowledgePoint.createMany({
          data: knowledgePointIds.map((knowledgePointId) => ({
            questionId,
            knowledgePointId,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (tagIds) {
      await tx.questionTag.deleteMany({ where: { questionId } });
      if (tagIds.length) {
        await tx.questionTag.createMany({
          data: tagIds.map((tagId) => ({
            questionId,
            tagId,
          })),
          skipDuplicates: true,
        });
      }
    }
  }

  private resolveAnswerJson(
    type: QuestionType,
    dto: CreateQuestionDto,
    options: Array<{ id: string; optionKey: string; isCorrect: boolean }>,
  ): Prisma.InputJsonObject {
    if (this.isChoiceQuestion(type)) {
      const correctOptionIds = options.filter((option) => option.isCorrect).map((option) => option.id);
      return { correctOptionIds };
    }

    if (type === QuestionType.FILL_BLANK) {
      if (dto.answer?.blanks && Array.isArray(dto.answer.blanks)) {
        return dto.answer as Prisma.InputJsonObject;
      }

      return { blanks: [] };
    }

    return (dto.answer as Prisma.InputJsonObject | undefined) ?? {};
  }

  private isUniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private questionOrderBy(query: QueryQuestionDto): Prisma.QuestionOrderByWithRelationInput[] {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const orderMap: Record<string, Prisma.QuestionOrderByWithRelationInput> = {
      createdAt: { createdAt: direction },
      updatedAt: { updatedAt: direction },
      difficulty: { difficulty: direction },
      type: { type: direction },
      status: { status: direction },
      defaultScore: { defaultScore: direction },
      title: { title: direction },
    };
    const primary = orderMap[query.sortBy || 'createdAt'] ?? { createdAt: 'desc' };
    return query.sortBy && query.sortBy !== 'createdAt' ? [primary, { createdAt: 'desc' }] : [primary];
  }

  private isChoiceQuestion(type: QuestionType) {
    return (
      type === QuestionType.SINGLE_CHOICE ||
      type === QuestionType.MULTIPLE_CHOICE ||
      type === QuestionType.TRUE_FALSE
    );
  }
}
