import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ExportStatus, MasteryStatus, Prisma, UserType } from '@prisma/client';
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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
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

type ZipEntry = {
  name: string;
  data: Buffer;
  date?: Date;
};

@Injectable()
export class ExportsService {
  private readonly exportDir = join(process.cwd(), 'uploads', 'exports');
  private readonly fontPath = this.resolveFontPath();
  private readonly crc32Table = ExportsService.makeCrc32Table();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService,
  ) {}

  async list(query: QueryExportDto, userId: string) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.ExportTaskWhereInput = {
      createdBy: userId,
      type: query.type,
      status: query.status ? this.normalizeStatus(query.status) : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.exportTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.exportTask.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        status: toApiEnum(item.status),
      })),
      page,
      pageSize,
      total,
    };
  }

  async create(dto: CreateExportDto, user: RequestUser) {
    const format =
      dto.format ?? (['paper_document', 'wrong_questions'].includes(dto.type) ? 'pdf' : dto.type === 'question_bank' ? 'zip' : 'csv');
    const task = await this.prisma.exportTask.create({
      data: {
        type: dto.type,
        paramsJson: this.withPermissionSnapshot(dto, user),
        status: ExportStatus.PROCESSING,
        createdBy: user.id,
      },
    });

    try {
      const fileUrl = await this.writeExport(task.id, dto, format, user);
      const updated = await this.prisma.exportTask.update({
        where: { id: task.id },
        data: {
          status: ExportStatus.SUCCESS,
          fileUrl,
          finishedAt: new Date(),
        },
      });
      await this.audit.log({
        userId: user.id,
        action: 'export:create',
        module: 'export',
        targetType: 'export_task',
        targetId: task.id,
        afterData: { type: dto.type, format, fileUrl },
      });
      return { ...updated, status: toApiEnum(updated.status) };
    } catch (error) {
      await this.prisma.exportTask.update({
        where: { id: task.id },
        data: {
          status: ExportStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : '导出失败',
          finishedAt: new Date(),
        },
      });
      throw error;
    }
  }

  async createWrongQuestionExport(dto: CreateExportDto, user: RequestUser) {
    if (user.userType !== UserType.STUDENT) {
      throw new BadRequestException('只有学生可以导出个人错题本');
    }

    return this.create(
      {
        ...dto,
        type: 'wrong_questions',
        format: dto.format ?? 'pdf',
        includeAnswers: dto.includeAnswers ?? true,
        includeAnalysis: dto.includeAnalysis ?? true,
        includeWrongInfo: dto.includeWrongInfo ?? true,
      },
      user,
    );
  }

  async download(id: string, userId: string) {
    const task = await this.prisma.exportTask.findFirst({ where: { id, createdBy: userId } });
    if (!task) {
      throw new NotFoundException('导出任务不存在');
    }
    if (task.status !== ExportStatus.SUCCESS || !task.fileUrl) {
      throw new BadRequestException('导出文件尚未生成');
    }
    return { url: task.fileUrl };
  }

  private async buildRows(dto: CreateExportDto, user: RequestUser) {
    if (dto.type === 'exam_results') return this.examRows(dto, user);
    if (dto.type === 'grading') return this.gradingRows(dto, user);
    if (dto.type === 'question_bank') return this.questionRows(dto);
    if (dto.type === 'papers') return this.paperRows(dto);
    if (dto.type === 'paper_document') return this.paperDocumentRows(dto);
    if (dto.type === 'wrong_questions') return this.wrongQuestionRows(dto, user.id);
    if (dto.type === 'classes') return this.classRows(dto, user);
    if (dto.type === 'statistics') return this.statisticsRows(dto, user);
    throw new BadRequestException('不支持的导出类型');
  }

  private async writeExport(taskId: string, dto: CreateExportDto, format: string, user: RequestUser) {
    if (dto.type === 'paper_document') {
      if (format === 'csv' || format === 'json') {
        const rows = await this.paperDocumentRows(dto);
        return this.writeTableExportFile(taskId, dto.type, format, rows);
      }
      if (format === 'zip') {
        return this.writePaperDocumentPackageExport(taskId, dto);
      }
      const content = await this.paperDocumentContent(dto);
      return this.writeDocumentExport(taskId, dto.type, format, content);
    }

    if (dto.type === 'question_bank') {
      if (format === 'zip') {
        return this.writeQuestionPackageExport(taskId, dto);
      }
      if (format === 'pdf' || format === 'docx') {
        const content = await this.questionDocumentContent(dto);
        return this.writeDocumentExport(taskId, dto.type, format, content);
      }
    }

    if (dto.type === 'wrong_questions') {
      const content = await this.wrongQuestionDocumentContent(dto, user.id);
      return this.writeDocumentExport(taskId, dto.type, format, content);
    }

    const rows = await this.buildRows(dto, user);
    return this.writeTableExportFile(taskId, dto.type, format, rows);
  }

  private async examRows(dto: CreateExportDto, user: RequestUser) {
    if (!dto.examId) throw new BadRequestException('导出考试成绩需要选择考试');
    await this.dataScope.assertExamAccessible(user, dto.examId);
    const attempts = await this.prisma.examAttempt.findMany({
      where: { examId: dto.examId, submittedAt: { not: null } },
      include: { exam: true },
      orderBy: [{ totalScore: 'desc' }, { submittedAt: 'asc' }],
    });
    const users = await this.loadUsers(attempts.map((attempt) => attempt.userId));
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

  private async gradingRows(dto: CreateExportDto, user: RequestUser) {
    const examScope = await this.dataScope.examWhere(user, dto.classId);
    if (dto.examId) {
      await this.dataScope.assertExamAccessible(user, dto.examId);
    }
    const records = await this.prisma.answerRecord.findMany({
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
    const users = await this.loadUsers(records.map((record) => record.attempt.userId));
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

  private async questionRows(dto: CreateExportDto) {
    const questions = await this.loadQuestionExportItems(dto);
    return questions.map((question) => this.questionRow(question, dto));
  }

  private async loadQuestionExportItems(dto: CreateExportDto): Promise<QuestionExportEntity[]> {
    return this.prisma.question.findMany({
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

  private questionRow(question: QuestionExportEntity, dto: CreateExportDto) {
    return this.questionTransferRow(this.exportQuestionFromEntity(question), dto, undefined, 'question_bank', {
      createdAt: question.createdAt.toISOString(),
      updatedAt: question.updatedAt.toISOString(),
    });
  }

  private async paperRows(dto: CreateExportDto) {
    const papers = await this.prisma.paper.findMany({
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

  private async paperDocumentRows(dto: CreateExportDto) {
    const content = await this.paperDocumentContent(dto);
    return content.questions.map((question, index) =>
      this.questionTransferRow(question, dto, index, 'paper_document', {
        paperId: dto.paperId ?? '',
        paperName: content.title,
      }),
    );
  }

  private questionTransferRow(
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
      answerText: includeAnswers ? this.formatAnswer(answer, question.options) : '',
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

  private async wrongQuestionRows(dto: CreateExportDto, userId: string) {
    const content = await this.wrongQuestionDocumentContent(dto, userId);
    return content.questions.map((question, index) => ({
      no: index + 1,
      title: question.title,
      type: question.type,
      score: question.score,
      wrongCount: question.wrongCount ?? 0,
      lastWrongAt: question.lastWrongAt?.toISOString() ?? '',
      answer: this.formatAnswer(question.answer, question.options),
      analysis: question.analysis ?? '',
    }));
  }

  private async paperDocumentContent(dto: CreateExportDto): Promise<DocumentExportContent> {
    if (!dto.paperId) throw new BadRequestException('导出试卷文档需要选择试卷');
    const paper = await this.prisma.paper.findFirst({
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
        questions.push(this.exportQuestionFromSnapshot(question, section.title));
      }
    }
    for (const question of paper.questions) {
      questions.push(this.exportQuestionFromSnapshot(question, '未分区题目'));
    }

    return {
      title: paper.name,
      subtitle: `${paper.course.name} · ${questions.length} 题 · ${Number(paper.totalScore)} 分 · ${paper.durationMinutes} 分钟`,
      questions,
      includeAnswers: dto.includeAnswers ?? false,
      includeAnalysis: dto.includeAnalysis ?? false,
      includeWrongInfo: false,
    };
  }

  private async wrongQuestionDocumentContent(dto: CreateExportDto, userId: string): Promise<DocumentExportContent> {
    if (!userId) throw new BadRequestException('导出错题需要登录学生账号');
    const items = await this.prisma.wrongQuestion.findMany({
      where: {
        studentId: userId,
        masteryStatus: { in: [MasteryStatus.UNMASTERED, MasteryStatus.REVIEWING] },
        question: { deletedAt: null },
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
    };
  }

  private async questionDocumentContent(dto: CreateExportDto): Promise<DocumentExportContent> {
    const questions = await this.loadQuestionExportItems(dto);
    if (!questions.length) {
      throw new BadRequestException('没有可导出的题目');
    }
    const courseNames = [...new Set(questions.map((question) => question.course.name))].join('、');

    return {
      title: '题库导出',
      subtitle: `${courseNames || '全部课程'} · ${questions.length} 道题 · ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      questions: questions.map((question) => this.exportQuestionFromEntity(question)),
      includeAnswers: dto.includeAnswers ?? true,
      includeAnalysis: dto.includeAnalysis ?? true,
      includeWrongInfo: false,
    };
  }

  private async classRows(dto: CreateExportDto, user: RequestUser) {
    const classWhere = await this.dataScope.classWhere(user, dto.classId);
    const classes = await this.prisma.classGroup.findMany({
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

  private async statisticsRows(dto: CreateExportDto, user: RequestUser) {
    const examScope = await this.dataScope.examWhere(user, dto.classId);
    if (dto.examId) {
      await this.dataScope.assertExamAccessible(user, dto.examId);
    }
    const attempts = await this.prisma.examAttempt.findMany({
      where: {
        submittedAt: { not: null },
        examId: dto.examId,
        exam: { ...examScope, courseId: dto.courseId },
      },
      include: { exam: true },
      orderBy: { submittedAt: 'desc' },
    });
    const grouped = new Map<string, { exam: string; count: number; total: number; max: number; min: number }>();
    for (const attempt of attempts) {
      const current = grouped.get(attempt.examId) ?? {
        exam: attempt.exam.name,
        count: 0,
        total: 0,
        max: 0,
        min: Number.MAX_SAFE_INTEGER,
      };
      const score = Number(attempt.totalScore);
      current.count += 1;
      current.total += score;
      current.max = Math.max(current.max, score);
      current.min = Math.min(current.min, score);
      grouped.set(attempt.examId, current);
    }
    return [...grouped.values()].map((item) => ({
      exam: item.exam,
      submitCount: item.count,
      averageScore: item.count ? Number((item.total / item.count).toFixed(2)) : 0,
      maxScore: item.max,
      minScore: item.min === Number.MAX_SAFE_INTEGER ? 0 : item.min,
    }));
  }

  private withPermissionSnapshot(dto: CreateExportDto, user: RequestUser): Prisma.InputJsonObject {
    return {
      ...(dto as unknown as Record<string, unknown>),
      permissionSnapshot: {
        userId: user.id,
        userType: user.userType,
        roles: user.roles,
        permissions: user.permissions,
        capturedAt: new Date().toISOString(),
      },
    } as Prisma.InputJsonObject;
  }

  private exportQuestionFromSnapshot(
    question: {
      score: Prisma.Decimal;
      questionSnapshotJson: Prisma.JsonValue;
    },
    sectionTitle: string,
  ): ExportQuestion {
    const snapshot = this.toRecord(question.questionSnapshotJson);
    const options = Array.isArray(snapshot.options)
      ? snapshot.options.map((option) => {
          const value = this.toRecord(option);
          return {
            id: typeof value.id === 'string' ? value.id : undefined,
            label: String(value.optionKey ?? value.label ?? ''),
            content: String(value.content ?? ''),
            isCorrect: Boolean(value.isCorrect),
            sortOrder: Number(value.sortOrder) || undefined,
          };
        })
      : [];
    const knowledgePointNames = Array.isArray(snapshot.knowledgePoints)
      ? snapshot.knowledgePoints
          .map((item) => this.toRecord(item).name)
          .map((name) => String(name ?? '').trim())
          .filter(Boolean)
      : [];
    const tagNames = Array.isArray(snapshot.tags)
      ? snapshot.tags
          .map((item) => this.toRecord(item).name)
          .map((name) => String(name ?? '').trim())
          .filter(Boolean)
      : [];

    return {
      sourceId: typeof snapshot.id === 'string' ? snapshot.id : undefined,
      title: String(snapshot.title ?? '未命名题目'),
      type: String(snapshot.type ?? ''),
      score: Number(question.score),
      defaultScore: Number(snapshot.defaultScore) || Number(question.score),
      difficulty: Number(snapshot.difficulty) || 1,
      courseId: typeof snapshot.courseId === 'string' ? snapshot.courseId : undefined,
      courseName: typeof snapshot.courseName === 'string' ? snapshot.courseName : undefined,
      content: String(snapshot.content ?? ''),
      options,
      answer: this.toRecord(snapshot.answer),
      scoringRule: this.toRecord(snapshot.scoringRule),
      analysis: typeof snapshot.analysis === 'string' ? snapshot.analysis : '',
      sectionTitle,
      knowledgePointNames,
      tagNames,
      allowOptionShuffle: Boolean(snapshot.allowOptionShuffle),
    };
  }

  private exportQuestionFromEntity(question: QuestionExportEntity): ExportQuestion {
    return {
      sourceId: question.id,
      title: question.title,
      type: toApiEnum(question.type),
      score: Number(question.defaultScore),
      defaultScore: Number(question.defaultScore),
      difficulty: question.difficulty,
      status: toApiEnum(question.status),
      courseId: question.courseId,
      courseName: question.course.name,
      content: question.content,
      options: question.options.map((option) => ({
        id: option.id,
        label: option.optionKey,
        content: option.content,
        isCorrect: option.isCorrect,
        sortOrder: option.sortOrder,
      })),
      answer: (question.answer?.answerJson ?? {}) as Record<string, unknown>,
      scoringRule: (question.answer?.scoringRuleJson ?? {}) as Record<string, unknown>,
      analysis: question.analysis,
      sectionTitle: question.course.name,
      knowledgePointNames: question.knowledgePoints.map((item) => item.knowledgePoint.name),
      tagNames: question.tags.map((item) => item.tag.name),
      allowOptionShuffle: question.allowOptionShuffle,
    };
  }

  private async writeDocumentExport(taskId: string, type: string, format: string, content: DocumentExportContent) {
    if (format === 'pdf') {
      return this.writePdfExport(taskId, type, content);
    }
    if (format === 'docx') {
      return this.writeDocxExport(taskId, type, content);
    }
    const rows = content.questions.map((question, index) => ({
      no: index + 1,
      section: question.sectionTitle ?? '',
      title: question.title,
      type: question.type,
      score: question.score,
      content: this.plainText(question.content),
      answer: content.includeAnswers ? this.formatAnswer(question.answer, question.options) : '',
      analysis: content.includeAnalysis ? this.plainText(question.analysis ?? '') : '',
      wrongCount: content.includeWrongInfo ? question.wrongCount ?? '' : '',
    }));
    return this.writeTableExportFile(taskId, type, format, rows);
  }

  private async writePdfExport(taskId: string, type: string, content: DocumentExportContent) {
    await mkdir(this.exportDir, { recursive: true });
    const fileName = `${type}-${taskId}.pdf`;
    const filePath = join(this.exportDir, fileName);
    const buffer = await this.renderPdf(content);
    await writeFile(filePath, buffer);
    return `/uploads/exports/${fileName}`;
  }

  private async writeDocxExport(taskId: string, type: string, content: DocumentExportContent) {
    await mkdir(this.exportDir, { recursive: true });
    const fileName = `${type}-${taskId}.docx`;
    const filePath = join(this.exportDir, fileName);
    const buffer = await this.renderDocx(content);
    await writeFile(filePath, buffer);
    return `/uploads/exports/${fileName}`;
  }

  private async writeQuestionPackageExport(taskId: string, dto: CreateExportDto) {
    const questions = await this.loadQuestionExportItems(dto);
    if (!questions.length) {
      throw new BadRequestException('没有可导出的题目');
    }

    await mkdir(this.exportDir, { recursive: true });
    const assetMap = new Map<string, string>();
    for (const question of questions) {
      this.collectMarkdownUploads(assetMap, question.content, question.analysis ?? '');
      for (const option of question.options) {
        this.collectMarkdownUploads(assetMap, option.content);
      }
    }

    const exportedAt = new Date().toISOString();
    const includeAnswers = dto.includeAnswers ?? true;
    const includeAnalysis = dto.includeAnalysis ?? true;
    const templateText = this.questionImportMarkdown(questions, assetMap, includeAnalysis);
    const answerText = this.questionImportAnswers(questions, includeAnswers);
    const payload = {
      schemaVersion: 1,
      exportedAt,
      includeAnswers,
      includeAnalysis,
      count: questions.length,
      questions: questions.map((question) => this.questionPackageRecord(question, assetMap, dto)),
    };

    const entries: ZipEntry[] = [
      {
        name: 'README.txt',
        data: Buffer.from(
          [
            '题目压缩包',
            `导出时间：${exportedAt}`,
            `题目数量：${questions.length}`,
            '',
            includeAnswers
              ? 'questions-template.md 与 answers.txt 可直接用于“题目导入 > 批量导入”。'
              : '本次未包含答案；questions-template.md 可导入题干，客观题需补充 answers.txt 后再导入。',
            'questions.json 保留 importPayload、题目 Markdown、答案、解析、标签、知识点和状态。',
            'assets/ 目录保存题目中引用到的本地上传图片或附件，JSON 中的 /uploads 链接已改写为相对路径。',
          ].join('\n'),
          'utf8',
        ),
      },
      {
        name: 'questions.json',
        data: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
      },
      {
        name: 'questions-template.md',
        data: Buffer.from(templateText, 'utf8'),
      },
      {
        name: 'answers.txt',
        data: Buffer.from(answerText, 'utf8'),
      },
    ];

    for (const [localPath, zipPath] of assetMap.entries()) {
      entries.push({ name: zipPath, data: await readFile(localPath) });
    }

    const fileName = `question_bank-${taskId}.zip`;
    const filePath = join(this.exportDir, fileName);
    await writeFile(filePath, this.createZip(entries));
    return `/uploads/exports/${fileName}`;
  }

  private async writePaperDocumentPackageExport(taskId: string, dto: CreateExportDto) {
    const content = await this.paperDocumentContent(dto);
    if (!content.questions.length) {
      throw new BadRequestException('试卷内没有可导出的题目');
    }

    await mkdir(this.exportDir, { recursive: true });
    const assetMap = new Map<string, string>();
    for (const question of content.questions) {
      this.collectExportQuestionUploads(assetMap, question);
    }

    const exportedAt = new Date().toISOString();
    const includeAnswers = dto.includeAnswers ?? true;
    const includeAnalysis = dto.includeAnalysis ?? true;
    const templateText = this.exportQuestionImportMarkdown(content.questions, assetMap, includeAnalysis);
    const answerText = this.exportQuestionImportAnswers(content.questions, includeAnswers);
    const payload = {
      schemaVersion: 2,
      packageType: 'paper_document',
      exportedAt,
      includeAnswers,
      includeAnalysis,
      paper: {
        id: dto.paperId ?? '',
        name: content.title,
        subtitle: content.subtitle,
      },
      count: content.questions.length,
      questions: content.questions.map((question, index) =>
        this.exportQuestionPackageRecord(question, assetMap, dto, index, {
          paperId: dto.paperId ?? '',
          paperName: content.title,
        }),
      ),
    };

    const entries: ZipEntry[] = [
      {
        name: 'README.txt',
        data: Buffer.from(
          [
            '试卷题目迁移包',
            `试卷：${content.title}`,
            `导出时间：${exportedAt}`,
            `题目数量：${content.questions.length}`,
            '',
            'questions.json 是首选回导文件，保留题目 Markdown、选项、答案、解析、标签、知识点和填空规则。',
            'questions-template.md 与 answers.txt 可人工查看或兜底导入。',
            'assets/ 目录保存题目中引用到的本地上传图片或附件，JSON 与 Markdown 中的 /uploads 链接已改写为相对路径。',
          ].join('\n'),
          'utf8',
        ),
      },
      {
        name: 'questions.json',
        data: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
      },
      {
        name: 'questions-template.md',
        data: Buffer.from(templateText, 'utf8'),
      },
      {
        name: 'answers.txt',
        data: Buffer.from(answerText, 'utf8'),
      },
    ];

    for (const [localPath, zipPath] of assetMap.entries()) {
      entries.push({ name: zipPath, data: await readFile(localPath) });
    }

    const fileName = `paper_document-${taskId}.zip`;
    const filePath = join(this.exportDir, fileName);
    await writeFile(filePath, this.createZip(entries));
    return `/uploads/exports/${fileName}`;
  }

  private questionPackageRecord(question: QuestionExportEntity, assetMap: Map<string, string>, dto: CreateExportDto) {
    const includeAnswers = dto.includeAnswers ?? true;
    const includeAnalysis = dto.includeAnalysis ?? true;
    return {
      id: question.id,
      sourceId: question.id,
      title: question.title,
      type: toApiEnum(question.type),
      difficulty: question.difficulty,
      defaultScore: Number(question.defaultScore),
      status: toApiEnum(question.status),
      course: {
        id: question.courseId,
        name: question.course.name,
      },
      contentMarkdown: this.rewriteMarkdownUploads(question.content, assetMap),
      options: question.options.map((option) => ({
        id: option.id,
        optionKey: option.optionKey,
        contentMarkdown: this.rewriteMarkdownUploads(option.content, assetMap),
        isCorrect: includeAnswers ? option.isCorrect : undefined,
        sortOrder: option.sortOrder,
      })),
      answer: includeAnswers ? question.answer?.answerJson ?? {} : {},
      scoringRule: includeAnswers ? question.answer?.scoringRuleJson ?? {} : {},
      analysisMarkdown: includeAnalysis ? this.rewriteMarkdownUploads(question.analysis ?? '', assetMap) : '',
      knowledgePoints: question.knowledgePoints.map((item) => ({
        id: item.knowledgePoint.id,
        name: item.knowledgePoint.name,
      })),
      knowledgePointNames: question.knowledgePoints.map((item) => item.knowledgePoint.name),
      tags: question.tags.map((item) => ({
        id: item.tag.id,
        name: item.tag.name,
      })),
      tagNames: question.tags.map((item) => item.tag.name),
      importPayload: {
        type: toApiEnum(question.type),
        title: question.title,
        content: this.rewriteMarkdownUploads(question.content, assetMap),
        difficulty: question.difficulty,
        defaultScore: Number(question.defaultScore),
        analysis: this.rewriteMarkdownUploads(question.analysis ?? '', assetMap),
        options: question.options.map((option) => ({
          optionKey: option.optionKey,
          content: this.rewriteMarkdownUploads(option.content, assetMap),
          isCorrect: includeAnswers ? option.isCorrect : false,
          sortOrder: option.sortOrder,
        })),
        answer: includeAnswers ? question.answer?.answerJson ?? {} : {},
        scoringRule: includeAnswers ? question.answer?.scoringRuleJson ?? {} : {},
        tagNames: question.tags.map((item) => item.tag.name),
        knowledgePointNames: question.knowledgePoints.map((item) => item.knowledgePoint.name),
      },
      createdAt: question.createdAt.toISOString(),
      updatedAt: question.updatedAt.toISOString(),
    };
  }

  private exportQuestionPackageRecord(
    question: ExportQuestion,
    assetMap: Map<string, string>,
    dto: CreateExportDto,
    index: number,
    extra: Record<string, string> = {},
  ) {
    const includeAnswers = dto.includeAnswers ?? true;
    const includeAnalysis = dto.includeAnalysis ?? true;
    const options = question.options.map((option, optionIndex) => ({
      id: option.id,
      optionKey: option.label,
      contentMarkdown: this.rewriteMarkdownUploads(option.content, assetMap),
      isCorrect: includeAnswers ? Boolean(option.isCorrect) : undefined,
      sortOrder: option.sortOrder ?? optionIndex + 1,
    }));
    return {
      id: question.sourceId ?? '',
      sourceId: question.sourceId ?? '',
      no: index + 1,
      paperId: extra.paperId ?? '',
      paperName: extra.paperName ?? '',
      section: question.sectionTitle ?? '',
      title: question.title,
      type: question.type,
      difficulty: question.difficulty ?? 1,
      defaultScore: question.defaultScore ?? question.score,
      score: question.score,
      status: question.status ?? '',
      course: {
        id: question.courseId ?? '',
        name: question.courseName ?? '',
      },
      courseId: question.courseId ?? '',
      courseName: question.courseName ?? '',
      contentMarkdown: this.rewriteMarkdownUploads(question.content, assetMap),
      options,
      answer: includeAnswers ? question.answer ?? {} : {},
      scoringRule: includeAnswers ? question.scoringRule ?? {} : {},
      analysisMarkdown: includeAnalysis ? this.rewriteMarkdownUploads(question.analysis ?? '', assetMap) : '',
      knowledgePoints: (question.knowledgePointNames ?? []).map((name) => ({ name })),
      knowledgePointNames: question.knowledgePointNames ?? [],
      tags: (question.tagNames ?? []).map((name) => ({ name })),
      tagNames: question.tagNames ?? [],
      allowOptionShuffle: question.allowOptionShuffle ?? false,
      importPayload: {
        type: question.type,
        title: question.title,
        content: this.rewriteMarkdownUploads(question.content, assetMap),
        difficulty: question.difficulty ?? 1,
        defaultScore: question.defaultScore ?? question.score,
        analysis: includeAnalysis ? this.rewriteMarkdownUploads(question.analysis ?? '', assetMap) : '',
        options: options.map((option) => ({
          optionKey: option.optionKey,
          content: option.contentMarkdown,
          isCorrect: Boolean(option.isCorrect),
          sortOrder: option.sortOrder,
        })),
        answer: includeAnswers ? question.answer ?? {} : {},
        scoringRule: includeAnswers ? question.scoringRule ?? {} : {},
        tagNames: question.tagNames ?? [],
        knowledgePointNames: question.knowledgePointNames ?? [],
        allowOptionShuffle: question.allowOptionShuffle ?? false,
      },
    };
  }

  private async renderPdf(content: DocumentExportContent): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      if (this.fontPath) {
        doc.registerFont('body', this.fontPath);
        doc.font('body');
      }
      doc.fontSize(18).text(content.title, { align: 'center' });
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor('#4b5563').text(content.subtitle, { align: 'center' });
      doc.fillColor('#111827').moveDown();

      content.questions.forEach((question, index) => {
        doc.fontSize(12).fillColor('#111827').text(`${index + 1}. ${question.title}（${this.typeLabel(question.type)} · ${question.score} 分）`, {
          continued: false,
        });
        if (content.includeWrongInfo && question.wrongCount !== undefined) {
          doc.fontSize(9).fillColor('#6b7280').text(`错题次数：${question.wrongCount} · 最近记录：${this.formatDate(question.lastWrongAt)}`);
        }
        doc.moveDown(0.2);
        doc.fontSize(10).fillColor('#111827');
        this.renderPdfMarkdown(doc, question.content);
        for (const option of question.options) {
          const suffix = content.includeAnswers && option.isCorrect ? '  [正确答案]' : '';
          doc.fontSize(10).fillColor('#111827').text(`${option.label}. ${suffix}`, { continued: false });
          this.renderPdfMarkdown(doc, option.content);
        }
        if (content.includeAnswers) {
          doc.moveDown(0.2).fontSize(10).fillColor('#047857').text(`答案：${this.formatAnswer(question.answer, question.options) || '暂无'}`);
        }
        if (content.includeAnalysis) {
          doc.moveDown(0.2).fontSize(10).fillColor('#1f2937').text(`解析：${this.plainText(question.analysis ?? '') || '暂无解析'}`);
        }
        doc.fillColor('#111827').moveDown();
      });

      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor('#9ca3af').text(`第 ${i + 1} 页 / 共 ${range.count} 页`, 48, doc.page.height - 36, {
          align: 'center',
          width: doc.page.width - 96,
        });
      }
      doc.end();
    });
  }

  private async renderDocx(content: DocumentExportContent) {
    const children: Paragraph[] = [
      new Paragraph({
        text: content.title,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({
        children: [new TextRun({ text: content.subtitle, color: '6B7280' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 360 },
      }),
    ];

    for (const [index, question] of content.questions.entries()) {
      children.push(
        new Paragraph({
          text: `${index + 1}. ${question.title}（${this.typeLabel(question.type)} · ${question.score} 分）`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 180, after: 120 },
        }),
      );
      if (content.includeWrongInfo && question.wrongCount !== undefined) {
        children.push(new Paragraph({ text: `错题次数：${question.wrongCount} · 最近记录：${this.formatDate(question.lastWrongAt)}` }));
      }
      this.pushTextParagraphs(children, this.plainText(question.content));
      for (const option of question.options) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${option.label}. `, bold: true }),
              new TextRun({ text: this.plainText(option.content) }),
              ...(content.includeAnswers && option.isCorrect ? [new TextRun({ text: '  正确答案', bold: true, color: '047857' })] : []),
            ],
          }),
        );
      }
      if (content.includeAnswers) {
        children.push(new Paragraph({ children: [new TextRun({ text: '答案：', bold: true }), new TextRun({ text: this.formatAnswer(question.answer, question.options) || '暂无' })] }));
      }
      if (content.includeAnalysis) {
        children.push(new Paragraph({ children: [new TextRun({ text: '解析：', bold: true }), new TextRun({ text: this.plainText(question.analysis ?? '') || '暂无解析' })] }));
      }
    }

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: 'Microsoft YaHei', size: 22 },
            paragraph: { spacing: { after: 120 } },
          },
        },
      },
      sections: [{ children }],
    });
    return Packer.toBuffer(doc);
  }

  private pushTextParagraphs(children: Paragraph[], text: string) {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      children.push(new Paragraph({ text: '' }));
      return;
    }
    for (const line of lines) {
      children.push(new Paragraph({ text: line }));
    }
  }

  private renderPdfMarkdown(doc: PDFKit.PDFDocument, markdown: string) {
    const segments = this.markdownSegments(markdown);
    if (!segments.length) {
      doc.text('');
      return;
    }

    for (const segment of segments) {
      if (segment.type === 'text') {
        const text = this.plainText(segment.value);
        if (text) doc.text(text);
        continue;
      }

      this.renderPdfImage(doc, segment.src, segment.alt);
    }
  }

  private renderPdfImage(doc: PDFKit.PDFDocument, src: string, alt: string) {
    const imagePath = this.localUploadPath(src);
    if (!imagePath || !this.isPdfRenderableImage(imagePath)) {
      doc.fontSize(9).fillColor('#6b7280').text(`附件：${alt || src}`);
      doc.fillColor('#111827');
      return;
    }

    try {
      const page = doc.page;
      const maxWidth = page.width - page.margins.left - page.margins.right;
      const maxHeight = 220;
      if (doc.y + maxHeight > page.height - page.margins.bottom - 36) {
        doc.addPage();
      }
      doc.image(imagePath, {
        fit: [maxWidth, maxHeight],
        align: 'center',
      });
      doc.moveDown(0.3);
    } catch {
      doc.fontSize(9).fillColor('#6b7280').text(`图片无法嵌入：${alt || src}`);
      doc.fillColor('#111827');
    }
  }

  private markdownSegments(value: string): MarkdownSegment[] {
    const source = String(value ?? '');
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const segments: MarkdownSegment[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = imageRegex.exec(source))) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', value: source.slice(lastIndex, match.index) });
      }
      segments.push({
        type: 'image',
        alt: match[1] ?? '',
        src: this.cleanMarkdownUrl(match[2] ?? ''),
      });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < source.length) {
      segments.push({ type: 'text', value: source.slice(lastIndex) });
    }

    return segments.filter((segment) => segment.type === 'image' || segment.value.trim());
  }

  private cleanMarkdownUrl(value: string) {
    return String(value ?? '')
      .trim()
      .replace(/^<|>$/g, '')
      .replace(/\s+["'][^"']*["']$/, '');
  }

  private localUploadPath(src: string) {
    const raw = this.cleanMarkdownUrl(src);
    if (!raw || /^(https?:|data:|javascript:|mailto:)/i.test(raw)) {
      return '';
    }

    const withoutHash = raw.split('#')[0].split('?')[0];
    let decoded = withoutHash;
    try {
      decoded = decodeURIComponent(withoutHash);
    } catch {
      decoded = withoutHash;
    }

    const uploadsRoot = resolve(process.cwd(), 'uploads');
    let candidate = '';
    if (decoded.startsWith('/uploads/')) {
      candidate = resolve(process.cwd(), decoded.slice(1));
    } else if (decoded.startsWith('uploads/')) {
      candidate = resolve(process.cwd(), decoded);
    } else if (isAbsolute(decoded)) {
      candidate = resolve(decoded);
    }

    if (!candidate) return '';
    const rootWithSep = uploadsRoot.endsWith('\\') ? uploadsRoot : `${uploadsRoot}\\`;
    if (candidate !== uploadsRoot && !candidate.startsWith(rootWithSep)) return '';
    return existsSync(candidate) ? candidate : '';
  }

  private isPdfRenderableImage(path: string) {
    return ['.jpg', '.jpeg', '.png'].includes(extname(path).toLowerCase());
  }

  private collectMarkdownUploads(assetMap: Map<string, string>, ...markdownValues: string[]) {
    const usedNames = new Set(assetMap.values());
    for (const value of markdownValues) {
      const source = String(value ?? '');
      const linkRegex = /!?\[[^\]]*\]\(([^)]+)\)/g;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(source))) {
        const localPath = this.localUploadPath(match[1] ?? '');
        if (!localPath || assetMap.has(localPath)) continue;

        const base = this.safeZipName(basename(localPath)) || `asset-${assetMap.size + 1}`;
        const extension = extname(base);
        const stem = extension ? base.slice(0, -extension.length) : base;
        let zipPath = `assets/${base}`;
        let index = 2;
        while (usedNames.has(zipPath)) {
          zipPath = `assets/${stem}-${index}${extension}`;
          index += 1;
        }
        usedNames.add(zipPath);
        assetMap.set(localPath, zipPath);
      }
    }
  }

  private rewriteMarkdownUploads(value: string, assetMap: Map<string, string>) {
    return String(value ?? '').replace(/(!?\[[^\]]*\]\()([^)]+)(\))/g, (full, prefix: string, src: string, suffix: string) => {
      const localPath = this.localUploadPath(src);
      const zipPath = localPath ? assetMap.get(localPath) : '';
      return zipPath ? `${prefix}${zipPath}${suffix}` : full;
    });
  }

  private questionImportMarkdown(questions: QuestionExportEntity[], assetMap: Map<string, string>, includeAnalysis: boolean) {
    return questions.map((question) => this.questionImportBlock(question, assetMap, includeAnalysis)).join('\n---\n');
  }

  private exportQuestionImportMarkdown(questions: ExportQuestion[], assetMap: Map<string, string>, includeAnalysis: boolean) {
    return questions.map((question) => this.exportQuestionImportBlock(question, assetMap, includeAnalysis)).join('\n---\n');
  }

  private questionImportBlock(question: QuestionExportEntity, assetMap: Map<string, string>, includeAnalysis: boolean) {
    const lines = [
      `标题：${question.title}`,
      `题型：${this.typeLabel(toApiEnum(question.type))}`,
      `难度：${question.difficulty}`,
      `分值：${Number(question.defaultScore)}`,
    ];
    const tags = question.tags.map((item) => item.tag.name).filter(Boolean);
    const points = question.knowledgePoints.map((item) => item.knowledgePoint.name).filter(Boolean);
    if (tags.length) lines.push(`标签：${tags.join(',')}`);
    if (points.length) lines.push(`知识点：${points.join(',')}`);
    lines.push('题干：', this.rewriteMarkdownUploads(question.content, assetMap));
    if (question.options.length) {
      lines.push('选项：');
      for (const option of question.options) {
        const content = this.rewriteMarkdownUploads(option.content, assetMap);
        const [firstLine, ...restLines] = content.split('\n');
        lines.push(`${option.optionKey}. ${firstLine ?? ''}`);
        lines.push(...restLines);
      }
    }
    if (includeAnalysis) {
      lines.push('解析：', this.rewriteMarkdownUploads(question.analysis ?? '', assetMap));
    }
    return lines.join('\n').trim();
  }

  private exportQuestionImportBlock(question: ExportQuestion, assetMap: Map<string, string>, includeAnalysis: boolean) {
    const lines = [
      `标题：${question.title}`,
      `题型：${this.typeLabel(question.type)}`,
      `难度：${question.difficulty ?? 1}`,
      `分值：${question.defaultScore ?? question.score}`,
    ];
    const tags = question.tagNames ?? [];
    const points = question.knowledgePointNames ?? [];
    if (tags.length) lines.push(`标签：${tags.join(',')}`);
    if (points.length) lines.push(`知识点：${points.join(',')}`);
    lines.push('题干：', this.rewriteMarkdownUploads(question.content, assetMap));
    if (question.options.length) {
      lines.push('选项：');
      for (const option of question.options) {
        const content = this.rewriteMarkdownUploads(option.content, assetMap);
        const [firstLine, ...restLines] = content.split('\n');
        lines.push(`${option.label}. ${firstLine ?? ''}`);
        lines.push(...restLines);
      }
    }
    if (includeAnalysis) {
      lines.push('解析：', this.rewriteMarkdownUploads(question.analysis ?? '', assetMap));
    }
    return lines.join('\n').trim();
  }

  private questionImportAnswers(questions: QuestionExportEntity[], includeAnswers: boolean) {
    if (!includeAnswers) return '';
    return questions.map((question, index) => `${index + 1}. ${this.questionAnswerForImport(question)}`).join('\n');
  }

  private exportQuestionImportAnswers(questions: ExportQuestion[], includeAnswers: boolean) {
    if (!includeAnswers) return '';
    return questions.map((question, index) => `${index + 1}. ${this.exportQuestionAnswerForImport(question)}`).join('\n');
  }

  private questionAnswerForImport(question: QuestionExportEntity) {
    const type = toApiEnum(question.type);
    if (['single_choice', 'multiple_choice', 'true_false'].includes(type)) {
      return question.options.filter((option) => option.isCorrect).map((option) => option.optionKey).join(',');
    }

    const answer = this.toRecord(question.answer?.answerJson);
    if (type === 'fill_blank' && Array.isArray(answer.blanks)) {
      return answer.blanks
        .map((blank) => this.toRecord(blank))
        .flatMap((blank) => (Array.isArray(blank.answers) ? blank.answers.map(String) : []))
        .join(',');
    }

    if (typeof answer.reference === 'string') {
      return answer.reference;
    }

    return this.formatAnswer(answer, question.options.map((option) => ({
      id: option.id,
      label: option.optionKey,
      content: option.content,
      isCorrect: option.isCorrect,
    })));
  }

  private exportQuestionAnswerForImport(question: ExportQuestion) {
    if (['single_choice', 'multiple_choice', 'true_false'].includes(question.type)) {
      return question.options.filter((option) => option.isCorrect).map((option) => option.label).join(',');
    }

    const answer = this.toRecord(question.answer);
    if (question.type === 'fill_blank' && Array.isArray(answer.blanks)) {
      return answer.blanks
        .map((blank) => this.toRecord(blank))
        .flatMap((blank) => (Array.isArray(blank.answers) ? blank.answers.map(String) : []))
        .join(',');
    }

    if (typeof answer.reference === 'string') {
      return answer.reference;
    }

    return this.formatAnswer(answer, question.options);
  }

  private collectExportQuestionUploads(assetMap: Map<string, string>, question: ExportQuestion) {
    this.collectMarkdownUploads(assetMap, question.content, question.analysis ?? '');
    for (const option of question.options) {
      this.collectMarkdownUploads(assetMap, option.content);
    }
  }

  private createZip(entries: ZipEntry[]) {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
      const name = entry.name.replace(/\\/g, '/');
      const nameBuffer = Buffer.from(name, 'utf8');
      const data = entry.data;
      const crc = this.crc32(data);
      const { time, date } = this.toDosDateTime(entry.date ?? new Date());

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0x0800, 6);
      localHeader.writeUInt16LE(0, 8);
      localHeader.writeUInt16LE(time, 10);
      localHeader.writeUInt16LE(date, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(data.length, 18);
      localHeader.writeUInt32LE(data.length, 22);
      localHeader.writeUInt16LE(nameBuffer.length, 26);
      localHeader.writeUInt16LE(0, 28);
      localParts.push(localHeader, nameBuffer, data);

      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0x0800, 8);
      centralHeader.writeUInt16LE(0, 10);
      centralHeader.writeUInt16LE(time, 12);
      centralHeader.writeUInt16LE(date, 14);
      centralHeader.writeUInt32LE(crc, 16);
      centralHeader.writeUInt32LE(data.length, 20);
      centralHeader.writeUInt32LE(data.length, 24);
      centralHeader.writeUInt16LE(nameBuffer.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(offset, 42);
      centralParts.push(centralHeader, nameBuffer);

      offset += localHeader.length + nameBuffer.length + data.length;
    }

    const central = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, central, end]);
  }

  private crc32(buffer: Buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc = (crc >>> 8) ^ this.crc32Table[(crc ^ byte) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  private static makeCrc32Table() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let value = i;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[i] = value >>> 0;
    }
    return table;
  }

  private toDosDateTime(value: Date) {
    const year = Math.max(1980, value.getFullYear());
    const month = value.getMonth() + 1;
    const day = value.getDate();
    const hours = value.getHours();
    const minutes = value.getMinutes();
    const seconds = Math.floor(value.getSeconds() / 2);
    return {
      time: (hours << 11) | (minutes << 5) | seconds,
      date: ((year - 1980) << 9) | (month << 5) | day,
    };
  }

  private safeZipName(value: string) {
    return String(value || '')
      .replace(/[<>:"\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 160);
  }

  private async writeTableExportFile(taskId: string, type: string, format: string, rows: Array<Record<string, unknown>>) {
    if (!['csv', 'json'].includes(format)) {
      throw new BadRequestException('表格类导出仅支持 CSV 或 JSON；PDF/Word 请使用“试卷文档”或“错题导出”');
    }
    await mkdir(this.exportDir, { recursive: true });
    const ext = format === 'json' ? 'json' : 'csv';
    const fileName = `${type}-${taskId}.${ext}`;
    const filePath = join(this.exportDir, fileName);
    const content = format === 'json' ? JSON.stringify(rows, null, 2) : this.toCsv(rows);
    await writeFile(filePath, content, 'utf8');
    return `/uploads/exports/${fileName}`;
  }

  private toCsv(rows: Array<Record<string, unknown>>) {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const lines = rows.map((row) =>
      headers
        .map((header) => {
          const value = row[header] ?? '';
          return `"${String(value).replace(/"/g, '""')}"`;
        })
        .join(','),
    );
    return [`\uFEFF${headers.join(',')}`, ...lines].join('\n');
  }

  private formatAnswer(answer: Record<string, unknown> | null | undefined, options: Array<{ id?: string; label: string; content: string; isCorrect?: boolean }>) {
    if (!answer || !Object.keys(answer).length) {
      const correctOptions = options.filter((option) => option.isCorrect);
      return correctOptions.length ? correctOptions.map((option) => `${option.label}. ${this.plainText(option.content)}`).join('；') : '';
    }

    if (Array.isArray(answer.correctOptionIds)) {
      const labels = answer.correctOptionIds
        .map((id) => options.find((option) => option.id === id || option.label === id || `${option.label}` === id))
        .filter(Boolean)
        .map((option) => `${option?.label}. ${this.plainText(option?.content ?? '')}`);
      if (labels.length) return labels.join('；');
      const correctOptions = options.filter((option) => option.isCorrect);
      return correctOptions.map((option) => `${option.label}. ${this.plainText(option.content)}`).join('；');
    }

    if (Array.isArray(answer.blanks)) {
      return answer.blanks
        .map((blank) => this.toRecord(blank))
        .map((blank) => `第 ${blank.index ?? ''} 空：${Array.isArray(blank.answers) ? blank.answers.join(' / ') : ''}`)
        .join('；');
    }

    if (typeof answer.reference === 'string') {
      return this.plainText(answer.reference);
    }

    return JSON.stringify(answer);
  }

  private plainText(value: string) {
    return String(value ?? '')
      .replace(/```[\w-]*\n([\s\S]*?)```/g, '$1')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '图片：$1 $2')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/[*_`>#]/g, '')
      .replace(/\r\n/g, '\n')
      .trim();
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private typeLabel(value: string) {
    const map: Record<string, string> = {
      single_choice: '单选题',
      multiple_choice: '多选题',
      true_false: '判断题',
      fill_blank: '填空题',
      short_answer: '简答题',
      programming: '编程题',
      material: '材料题',
      file_upload: '文件上传题',
      scratch_project: 'Scratch 项目题',
      arduino_project: 'Arduino 项目题',
    };
    return map[value] ?? value;
  }

  private formatDate(value?: Date) {
    return value ? value.toLocaleString('zh-CN', { hour12: false }) : '-';
  }

  private resolveFontPath() {
    const candidates = [
      'C:\\Windows\\Fonts\\simhei.ttf',
      'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf',
      'C:\\Windows\\Fonts\\Deng.ttf',
    ];
    return candidates.find((path) => existsSync(path)) ?? '';
  }

  private async loadUsers(userIds: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, username: true, realName: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

  private normalizeStatus(value: string) {
    const normalized = value.replace(/-/g, '_').toUpperCase() as keyof typeof ExportStatus;
    return ExportStatus[normalized];
  }
}
