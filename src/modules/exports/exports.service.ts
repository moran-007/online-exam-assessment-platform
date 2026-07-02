import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ExportStatus, MasteryStatus, Prisma, UserType, WrongQuestionSourceType } from '@prisma/client';
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

@Injectable()
export class ExportsService implements OnModuleInit {
  private readonly exportDir = join(process.cwd(), 'uploads', 'exports');
  private readonly fontPath = this.resolveFontPath();
  private readonly crc32Table = ExportsService.makeCrc32Table();
  private readonly exportExpireDays = 7;
  private readonly queue = new Set<string>();
  private processingQueue = false;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService,
  ) {}

  onModuleInit() {
    void this.resumeQueuedTasks();
    void this.cleanupExpiredTasks();
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredTasks();
    }, 60 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  async list(query: QueryExportDto, user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.ExportTaskWhereInput = {
      ...this.exportAccessWhere(query, user),
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
      items: items.map((item) => this.formatTask(item)),
      page,
      pageSize,
      total,
    };
  }

  async create(dto: CreateExportDto, user: RequestUser) {
    this.assertExportRequestAllowed(dto, user);
    const format = this.defaultExportFormat(dto);
    const payload = this.withPermissionSnapshot({ ...dto, format }, user);
    const task = await this.prisma.exportTask.create({
      data: {
        type: dto.type,
        paramsJson: payload,
        status: ExportStatus.PENDING,
        progress: 0,
        maxRetries: 2,
        createdBy: user.id,
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'export:queue',
      module: 'export',
      targetType: 'export_task',
      targetId: task.id,
      afterData: { type: dto.type, format },
    });
    this.enqueue(task.id);
    return this.formatTask(task);
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

  async download(id: string, user: RequestUser) {
    const task = await this.findAccessibleTask(id, user);
    if (task.status !== ExportStatus.SUCCESS || !task.fileUrl) {
      throw new BadRequestException('导出文件尚未生成');
    }
    const params = this.toRecord(task.paramsJson);
    const snapshot = this.toRecord(params.permissionSnapshot);
    await this.audit.log({
      userId: user.id,
      action: 'export:download',
      module: 'export',
      targetType: 'export_task',
      targetId: task.id,
      afterData: {
        type: task.type,
        fileUrl: task.fileUrl,
        createdBy: task.createdBy,
        downloadedBy: user.id,
        permissionSnapshotUserId: snapshot.userId ?? null,
        permissionSnapshotUserType: snapshot.userType ?? null,
        permissionSnapshotCapturedAt: snapshot.capturedAt ?? null,
      },
    });
    return { url: task.fileUrl };
  }

  async retry(id: string, user: RequestUser) {
    const task = await this.findAccessibleTask(id, user);
    const retryableStatuses: ExportStatus[] = [ExportStatus.FAILED, ExportStatus.EXPIRED, ExportStatus.CANCELED];
    if (!retryableStatuses.includes(task.status)) {
      throw new BadRequestException('只有失败、过期或已取消任务可以重试');
    }
    const updated = await this.prisma.exportTask.update({
      where: { id },
      data: {
        status: ExportStatus.PENDING,
        progress: 0,
        errorMessage: null,
        fileUrl: null,
        finishedAt: null,
        expiresAt: null,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'export:retry',
      module: 'export',
      targetType: 'export_task',
      targetId: id,
      afterData: { type: task.type, retryCount: task.retryCount },
    });
    this.enqueue(id);
    return this.formatTask(updated);
  }

  async retryMany(ids: string[], user: RequestUser) {
    const uniqueIds = [...new Set(ids)];
    const failed: Array<{ id: string; message: string }> = [];
    let successCount = 0;

    for (const id of uniqueIds) {
      try {
        await this.retry(id, user);
        successCount += 1;
      } catch (error) {
        failed.push({ id, message: error instanceof Error ? error.message : '重试失败' });
      }
    }

    await this.audit.log({
      userId: user.id,
      action: 'export:batch-retry',
      module: 'export',
      targetType: 'export_task',
      targetId: uniqueIds[0],
      afterData: { ids: uniqueIds, successCount, failedCount: failed.length },
    });
    return { successCount, failed };
  }

  async cancel(id: string, user: RequestUser) {
    const task = await this.findAccessibleTask(id, user);
    const cancelableStatuses: ExportStatus[] = [ExportStatus.PENDING, ExportStatus.PROCESSING];
    if (!cancelableStatuses.includes(task.status)) {
      throw new BadRequestException('只有等待中或处理中任务可以取消');
    }

    this.queue.delete(id);
    const updated = await this.prisma.exportTask.update({
      where: { id },
      data: {
        status: ExportStatus.CANCELED,
        progress: 100,
        errorMessage: '用户取消导出',
        finishedAt: new Date(),
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'export:cancel',
      module: 'export',
      targetType: 'export_task',
      targetId: id,
      afterData: { type: task.type, previousStatus: task.status },
    });
    return this.formatTask(updated);
  }

  async cancelMany(ids: string[], user: RequestUser) {
    const uniqueIds = [...new Set(ids)];
    const failed: Array<{ id: string; message: string }> = [];
    let successCount = 0;

    for (const id of uniqueIds) {
      try {
        await this.cancel(id, user);
        successCount += 1;
      } catch (error) {
        failed.push({ id, message: error instanceof Error ? error.message : '取消失败' });
      }
    }

    await this.audit.log({
      userId: user.id,
      action: 'export:batch-cancel',
      module: 'export',
      targetType: 'export_task',
      targetId: uniqueIds[0],
      afterData: { ids: uniqueIds, successCount, failedCount: failed.length },
    });
    return { successCount, failed };
  }

  async downloadAudits(query: QueryExportDto, user: RequestUser) {
    if (!this.dataScope.isUnrestricted(user)) {
      throw new ForbiddenException('只有管理员可以查看导出下载审计');
    }
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.AuditLogWhereInput = {
      module: 'export',
      action: 'export:download',
      targetType: 'export_task',
    };
    const [logs, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              realName: true,
              userType: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const taskIds = logs.map((log) => log.targetId).filter((id): id is string => Boolean(id));
    const tasks = await this.prisma.exportTask.findMany({
      where: { id: { in: taskIds } },
      select: {
        id: true,
        type: true,
        status: true,
        createdBy: true,
        createdAt: true,
        fileUrl: true,
      },
    });
    const taskMap = new Map(tasks.map((task) => [task.id, task]));

    return {
      items: logs.map((log) => {
        const afterData = this.toRecord(log.afterData);
        const task = log.targetId ? taskMap.get(log.targetId) : undefined;
        return {
          id: log.id,
          taskId: log.targetId,
          type: String(afterData.type ?? task?.type ?? ''),
          fileUrl: String(afterData.fileUrl ?? task?.fileUrl ?? ''),
          downloadedAt: log.createdAt,
          downloadedBy: log.user
            ? {
                id: log.user.id,
                username: log.user.username,
                realName: log.user.realName,
                userType: toApiEnum(log.user.userType),
              }
            : null,
          taskStatus: task ? toApiEnum(task.status) : null,
          taskCreatedBy: String(afterData.createdBy ?? task?.createdBy ?? ''),
          taskCreatedAt: task?.createdAt ?? null,
          permissionSnapshot: {
            userId: afterData.permissionSnapshotUserId ?? null,
            userType: afterData.permissionSnapshotUserType ?? null,
            capturedAt: afterData.permissionSnapshotCapturedAt ?? null,
          },
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  async cleanupExpiredTasks() {
    const now = new Date();
    const tasks = await this.prisma.exportTask.findMany({
      where: {
        status: ExportStatus.SUCCESS,
        expiresAt: { lte: now },
      },
      select: { id: true, fileUrl: true },
      take: 100,
    });
    for (const task of tasks) {
      await this.deleteExportFile(task.fileUrl);
      await this.prisma.exportTask.update({
        where: { id: task.id },
        data: {
          status: ExportStatus.EXPIRED,
          fileUrl: null,
          errorMessage: '导出文件已过期清理',
        },
      });
    }
    return { cleaned: tasks.length };
  }

  private enqueue(taskId: string) {
    this.queue.add(taskId);
    setTimeout(() => {
      void this.processQueue();
    }, 0);
  }

  private async resumeQueuedTasks() {
    const stale = await this.prisma.exportTask.findMany({
      where: { status: { in: [ExportStatus.PENDING, ExportStatus.PROCESSING] } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    stale.forEach((task) => this.enqueue(task.id));
  }

  private async processQueue() {
    if (this.processingQueue) return;
    this.processingQueue = true;
    try {
      while (this.queue.size) {
        const taskId = this.queue.values().next().value as string | undefined;
        if (!taskId) break;
        this.queue.delete(taskId);
        await this.processTask(taskId);
      }
    } finally {
      this.processingQueue = false;
    }
  }

  private async processTask(taskId: string) {
    const task = await this.prisma.exportTask.findUnique({ where: { id: taskId } });
    if (!task || (task.status !== ExportStatus.PENDING && task.status !== ExportStatus.PROCESSING)) return;

    const payload = this.toRecord(task.paramsJson);
    const dto = payload as unknown as CreateExportDto;
    const format = this.defaultExportFormat(dto);
    const user = this.userFromExportPayload(payload, task.createdBy ?? '');

    try {
      await this.prisma.exportTask.update({
        where: { id: taskId },
        data: { status: ExportStatus.PROCESSING, progress: 10, errorMessage: null },
      });
      const fileUrl = await this.writeExport(task.id, dto, format, user);
      const latest = await this.prisma.exportTask.findUnique({ where: { id: task.id }, select: { status: true } });
      if (latest?.status === ExportStatus.CANCELED) {
        await this.deleteExportFile(fileUrl);
        return null;
      }
      const updated = await this.prisma.exportTask.update({
        where: { id: task.id },
        data: {
          status: ExportStatus.SUCCESS,
          progress: 100,
          fileUrl,
          finishedAt: new Date(),
          expiresAt: this.futureDate(this.exportExpireDays),
        },
      });
      await this.audit.log({
        userId: user.id,
        action: 'export:complete',
        module: 'export',
        targetType: 'export_task',
        targetId: task.id,
        afterData: { type: dto.type, format, fileUrl },
      });
      return this.formatTask(updated);
    } catch (error) {
      const latest = await this.prisma.exportTask.findUnique({ where: { id: task.id }, select: { status: true } });
      if (latest?.status === ExportStatus.CANCELED) {
        return null;
      }
      const nextRetry = task.retryCount + 1;
      const message = error instanceof Error ? error.message : '导出失败';
      const retryable = nextRetry <= task.maxRetries;
      await this.prisma.exportTask.update({
        where: { id: task.id },
        data: {
          status: retryable ? ExportStatus.PENDING : ExportStatus.FAILED,
          progress: retryable ? 0 : 100,
          retryCount: nextRetry,
          errorMessage: retryable ? `${message}；准备第 ${nextRetry} 次重试` : message,
          finishedAt: retryable ? null : new Date(),
        },
      });
      if (retryable) {
        setTimeout(() => this.enqueue(task.id), Math.min(1000 * nextRetry, 5000));
      }
      return null;
    }
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
    if (dto.type === 'full_archive') {
      return this.writeFullArchiveExport(taskId, { ...dto, format }, user);
    }

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
      subtitle: `${this.documentTemplateLabel(dto.template)} · ${paper.course.name} · ${questions.length} 题 · ${Number(paper.totalScore)} 分 · ${paper.durationMinutes} 分钟`,
      questions,
      includeAnswers: dto.template === 'answer_book' ? true : dto.includeAnswers ?? false,
      includeAnalysis: dto.template === 'answer_book' ? true : dto.includeAnalysis ?? false,
      includeWrongInfo: false,
      template: dto.template ?? 'student',
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
      template: dto.template ?? 'teacher',
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
      template: dto.template ?? 'teacher',
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
    const submittedAt = this.exportDateRange(dto);
    const attempts = await this.prisma.examAttempt.findMany({
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
      return this.statisticsDistributionRows(attempts);
    }
    if (section === 'knowledge') {
      return this.statisticsKnowledgeRows(attempts);
    }
    if (section === 'classes') {
      return this.statisticsClassRows(attempts);
    }
    if (section === 'diagnostics') {
      return this.statisticsQuestionDiagnosticRows(attempts);
    }
    if (section === 'wrong_questions') {
      return this.statisticsWrongQuestionRows(dto, user);
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
      rows.push(...this.statisticsDistributionRows(attempts));
      rows.push(...this.statisticsClassRows(attempts));
      rows.push(...this.statisticsKnowledgeRows(attempts));
      rows.push(...this.statisticsQuestionDiagnosticRows(attempts));
    }

    return rows;
  }

  private statisticsDistributionRows(
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

  private statisticsClassRows(
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

  private statisticsKnowledgeRows(
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

  private statisticsQuestionDiagnosticRows(
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

  private async statisticsWrongQuestionRows(dto: CreateExportDto, user: RequestUser) {
    const classWhere = await this.dataScope.classWhere(user, dto.classId);
    const classGroups = await this.prisma.classGroup.findMany({
      where: { ...classWhere, deletedAt: null, courseId: dto.courseId },
      include: { students: { select: { studentId: true } } },
    });
    const scopedStudentIds = [...new Set(classGroups.flatMap((item) => item.students.map((student) => student.studentId)))];
    const studentIdFilter = dto.classId || !this.dataScope.isUnrestricted(user) ? scopedStudentIds : undefined;
    const items = await this.prisma.wrongQuestion.findMany({
      where: {
        studentId: studentIdFilter ? { in: studentIdFilter } : undefined,
        sourceType: this.normalizeWrongSourceType(dto.sourceType),
        lastWrongAt: this.exportDateTimeRange(dto),
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

  private defaultExportFormat(dto: CreateExportDto) {
    if (dto.format) return dto.format;
    if (['full_archive', 'question_bank'].includes(dto.type)) return 'zip';
    if (['paper_document', 'wrong_questions'].includes(dto.type)) return 'pdf';
    return 'csv';
  }

  private assertExportRequestAllowed(dto: CreateExportDto, user: RequestUser) {
    if (dto.type !== 'full_archive') return;
    this.assertSuperAdmin(user);
    if (dto.format && dto.format !== 'zip') {
      throw new BadRequestException('全量导出仅支持 ZIP 格式');
    }
  }

  private assertSuperAdmin(user: RequestUser) {
    if (user.userType !== UserType.SUPER_ADMIN) {
      throw new ForbiddenException('只有超级管理员可以一键导出全部资源');
    }
  }

  private withPermissionSnapshot(dto: CreateExportDto, user: RequestUser): Prisma.InputJsonObject {
    return {
      ...(dto as unknown as Record<string, unknown>),
      permissionSnapshot: {
        userId: user.id,
        username: user.username,
        realName: user.realName,
        userType: user.userType,
        roles: user.roles,
        permissions: user.permissions,
        capturedAt: new Date().toISOString(),
      },
    } as Prisma.InputJsonObject;
  }

  private userFromExportPayload(payload: Record<string, unknown>, fallbackUserId: string): RequestUser {
    const snapshot = this.toRecord(payload.permissionSnapshot);
    return {
      id: String(snapshot.userId ?? fallbackUserId),
      username: String(snapshot.username ?? 'export-worker'),
      realName: typeof snapshot.realName === 'string' ? snapshot.realName : null,
      userType: String(snapshot.userType ?? UserType.ADMIN),
      roles: Array.isArray(snapshot.roles) ? snapshot.roles.map(String) : [],
      permissions: Array.isArray(snapshot.permissions) ? snapshot.permissions.map(String) : [],
    };
  }

  private exportAccessWhere(query: QueryExportDto, user: RequestUser): Prisma.ExportTaskWhereInput {
    if (query.scope === 'all') {
      if (!this.dataScope.isUnrestricted(user)) {
        throw new ForbiddenException('只有管理员可以查看全部导出任务');
      }
      return {};
    }
    return { createdBy: user.id };
  }

  private async findAccessibleTask(id: string, user: RequestUser) {
    const task = await this.prisma.exportTask.findFirst({
      where: this.dataScope.isUnrestricted(user) ? { id } : { id, createdBy: user.id },
    });
    if (!task) {
      throw new NotFoundException('导出任务不存在');
    }
    return task;
  }

  private formatTask<T extends { status: ExportStatus; paramsJson?: Prisma.JsonValue | null }>(task: T) {
    const paramsJson = task.paramsJson === undefined ? undefined : this.sanitizedExportParams(task.paramsJson);
    return {
      ...task,
      status: toApiEnum(task.status),
      ...(paramsJson === undefined ? {} : { paramsJson }),
    };
  }

  private sanitizedExportParams(value: unknown) {
    const params = { ...this.toRecord(value) };
    delete params.permissionSnapshot;
    return params;
  }

  private futureDate(days: number) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private async deleteExportFile(fileUrl: string | null) {
    const filePath = this.exportFilePath(fileUrl);
    if (!filePath || !existsSync(filePath)) return;
    try {
      await unlink(filePath);
    } catch {
      // Best effort cleanup; the database status is still moved to expired.
    }
  }

  private exportFilePath(fileUrl: string | null) {
    if (!fileUrl || !fileUrl.startsWith('/uploads/exports/')) return '';
    const candidate = resolve(process.cwd(), fileUrl.slice(1));
    const exportRoot = resolve(this.exportDir);
    const rootWithSep = exportRoot.endsWith('\\') ? exportRoot : `${exportRoot}\\`;
    if (candidate !== exportRoot && !candidate.startsWith(rootWithSep)) return '';
    return candidate;
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

  private async writeFullArchiveExport(taskId: string, dto: CreateExportDto, user: RequestUser) {
    this.assertExportRequestAllowed(dto, user);
    await mkdir(this.exportDir, { recursive: true });

    const exportedAt = new Date().toISOString();
    const archiveDto: CreateExportDto = {
      type: 'full_archive',
      format: 'zip',
      includeAnswers: dto.includeAnswers ?? true,
      includeAnalysis: dto.includeAnalysis ?? true,
      includeWrongInfo: dto.includeWrongInfo,
    };
    const questionDto: CreateExportDto = { ...archiveDto, type: 'question_bank' };

    const [questionPackage, questionRows, papers, courses, knowledgePoints, tags, classes, exams] = await Promise.all([
      this.buildQuestionPackageEntries(questionDto, true),
      this.questionRows(questionDto),
      this.prisma.paper.findMany({
        where: { deletedAt: null },
        include: {
          course: true,
          _count: { select: { sections: true, questions: true, exams: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.fullArchiveCourseRows(),
      this.fullArchiveKnowledgePointRows(),
      this.fullArchiveTagRows(),
      this.fullArchiveClassRows(),
      this.fullArchiveExamRows(),
    ]);

    const entries: ZipEntry[] = [
      ...this.prefixZipEntries('question_bank', questionPackage.entries),
      this.csvZipEntry('question_bank/questions.csv', questionRows),
    ];
    const paperRows = this.fullArchivePaperRows(papers);
    this.addRowsEntries(entries, 'courses', 'courses', courses, exportedAt);
    this.addRowsEntries(entries, 'knowledge_points', 'knowledge_points', knowledgePoints, exportedAt);
    this.addRowsEntries(entries, 'tags', 'tags', tags, exportedAt);
    this.addRowsEntries(entries, 'classes', 'classes', classes, exportedAt);
    this.addRowsEntries(entries, 'exams', 'exams', exams, exportedAt);
    this.addRowsEntries(entries, 'papers', 'papers', paperRows, exportedAt);

    let paperQuestionCount = 0;
    let paperAssetCount = 0;
    for (const paper of papers) {
      const paperPackage = await this.buildPaperDocumentPackageEntries(
        {
          ...archiveDto,
          type: 'paper_document',
          paperId: paper.id,
          template: 'teacher',
        },
        true,
      );
      paperQuestionCount += paperPackage.count;
      paperAssetCount += paperPackage.assetCount;
      entries.push(...this.prefixZipEntries(`papers/${this.safeArchiveFolderName(paper.name, paper.id)}`, paperPackage.entries));
    }

    entries.unshift(
      this.jsonZipEntry('metadata.json', {
        packageType: 'full_archive',
        schemaVersion: 1,
        exportedAt,
        includeAnswers: archiveDto.includeAnswers,
        includeAnalysis: archiveDto.includeAnalysis,
        createdBy: {
          id: user.id,
          username: user.username,
          realName: user.realName,
          userType: user.userType,
        },
        counts: {
          questions: questionPackage.count,
          questionAssets: questionPackage.assetCount,
          papers: papers.length,
          paperQuestions: paperQuestionCount,
          paperAssets: paperAssetCount,
          courses: courses.length,
          knowledgePoints: knowledgePoints.length,
          tags: tags.length,
          classes: classes.length,
          exams: exams.length,
        },
      }),
      this.textZipEntry(
        'README.txt',
        [
          '平台全量资源导出包',
          `导出时间：${exportedAt}`,
          `题目数量：${questionPackage.count}`,
          `试卷数量：${papers.length}`,
          '',
          'question_bank/ 保存完整题库迁移文件。',
          'papers/ 下包含试卷清单，以及每张试卷的题目迁移目录。',
          'courses/、knowledge_points/、tags/、classes/、exams/ 保存基础资源清单。',
          '本导出包不包含用户密码、登录令牌或外部账号凭据。',
        ].join('\n'),
      ),
    );

    const fileName = `full_archive-${taskId}.zip`;
    const filePath = join(this.exportDir, fileName);
    await writeFile(filePath, this.createZip(entries));
    return `/uploads/exports/${fileName}`;
  }

  private async fullArchiveCourseRows() {
    const courses = await this.prisma.course.findMany({
      where: { deletedAt: null },
      include: {
        _count: { select: { knowledgePoints: true, questions: true, papers: true, exams: true, classes: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return courses.map((course) => ({
      id: course.id,
      name: course.name,
      code: course.code,
      description: course.description ?? '',
      status: toApiEnum(course.status),
      sortOrder: course.sortOrder,
      knowledgePointCount: course._count.knowledgePoints,
      questionCount: course._count.questions,
      paperCount: course._count.papers,
      examCount: course._count.exams,
      classCount: course._count.classes,
      createdAt: course.createdAt.toISOString(),
      updatedAt: course.updatedAt.toISOString(),
    }));
  }

  private async fullArchiveKnowledgePointRows() {
    const points = await this.prisma.knowledgePoint.findMany({
      where: { deletedAt: null, course: { deletedAt: null } },
      include: {
        course: { select: { id: true, name: true, code: true } },
        parent: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ courseId: 'asc' }, { level: 'asc' }, { sortOrder: 'asc' }],
    });
    return points.map((point) => ({
      id: point.id,
      courseId: point.courseId,
      courseName: point.course.name,
      courseCode: point.course.code,
      parentId: point.parentId ?? '',
      parentName: point.parent?.name ?? '',
      name: point.name,
      code: point.code,
      level: point.level,
      sortOrder: point.sortOrder,
      status: toApiEnum(point.status),
      createdAt: point.createdAt.toISOString(),
      updatedAt: point.updatedAt.toISOString(),
    }));
  }

  private async fullArchiveTagRows() {
    const tags = await this.prisma.tag.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { questions: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      code: tag.code,
      type: toApiEnum(tag.type),
      status: toApiEnum(tag.status),
      questionCount: tag._count.questions,
      createdAt: tag.createdAt.toISOString(),
      updatedAt: tag.updatedAt.toISOString(),
    }));
  }

  private async fullArchiveClassRows() {
    const classes = await this.prisma.classGroup.findMany({
      where: { deletedAt: null },
      include: { course: true, _count: { select: { students: true, teachers: true } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return classes.map((item) => ({
      id: item.id,
      name: item.name,
      code: item.code,
      courseId: item.courseId ?? '',
      courseName: item.course?.name ?? '',
      description: item.description ?? '',
      status: item.status,
      sortOrder: item.sortOrder,
      studentCount: item._count.students,
      teacherCount: item._count.teachers,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    }));
  }

  private fullArchivePaperRows(papers: FullArchivePaper[]) {
    return papers.map((paper) => ({
      id: paper.id,
      name: paper.name,
      courseId: paper.courseId,
      courseName: paper.course.name,
      totalScore: Number(paper.totalScore),
      durationMinutes: paper.durationMinutes,
      type: toApiEnum(paper.type),
      status: toApiEnum(paper.status),
      shuffleQuestions: paper.shuffleQuestions,
      shuffleOptions: paper.shuffleOptions,
      sectionCount: paper._count.sections,
      questionCount: paper._count.questions,
      examCount: paper._count.exams,
      createdBy: paper.createdBy ?? '',
      createdAt: paper.createdAt.toISOString(),
      updatedAt: paper.updatedAt.toISOString(),
    }));
  }

  private async fullArchiveExamRows() {
    const exams = await this.prisma.exam.findMany({
      where: { deletedAt: null },
      include: {
        course: { select: { id: true, name: true, code: true } },
        paper: { select: { id: true, name: true } },
        _count: { select: { attempts: true, announcements: true } },
      },
      orderBy: { startTime: 'desc' },
    });
    const classIds = [...new Set(exams.map((exam) => exam.classId).filter((id): id is string => Boolean(id)))];
    const classGroups = classIds.length
      ? await this.prisma.classGroup.findMany({
          where: { id: { in: classIds } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const classMap = new Map(classGroups.map((item) => [item.id, item]));
    return exams.map((exam) => {
      const classGroup = exam.classId ? classMap.get(exam.classId) : undefined;
      return {
        id: exam.id,
        name: exam.name,
        paperId: exam.paperId,
        paperName: exam.paper.name,
        courseId: exam.courseId,
        courseName: exam.course.name,
        courseCode: exam.course.code,
        classId: exam.classId ?? '',
        className: classGroup?.name ?? '',
        classCode: classGroup?.code ?? '',
        startTime: exam.startTime.toISOString(),
        endTime: exam.endTime.toISOString(),
        durationMinutes: exam.durationMinutes,
        attemptLimit: exam.attemptLimit,
        showAnswerMode: toApiEnum(exam.showAnswerMode),
        showScoreMode: toApiEnum(exam.showScoreMode),
        status: toApiEnum(exam.status),
        attemptCount: exam._count.attempts,
        announcementCount: exam._count.announcements,
        antiCheatConfigJson: JSON.stringify(exam.antiCheatConfigJson ?? {}),
        createdBy: exam.createdBy ?? '',
        createdAt: exam.createdAt.toISOString(),
        updatedAt: exam.updatedAt.toISOString(),
      };
    });
  }

  private addRowsEntries(entries: ZipEntry[], folder: string, name: string, rows: Array<Record<string, unknown>>, exportedAt: string) {
    entries.push(
      this.csvZipEntry(`${folder}/${name}.csv`, rows),
      this.jsonZipEntry(`${folder}/${name}.json`, {
        schemaVersion: 1,
        exportedAt,
        count: rows.length,
        items: rows,
      }),
    );
  }

  private prefixZipEntries(prefix: string, entries: ZipEntry[]) {
    const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
    return entries.map((entry) => ({
      ...entry,
      name: `${normalizedPrefix}/${entry.name.replace(/^\/+/, '')}`,
    }));
  }

  private safeArchiveFolderName(name: string, id: string) {
    const safeName = this.safeZipName(name) || 'paper';
    const suffix = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8);
    return suffix ? `${safeName}-${suffix}` : safeName;
  }

  private jsonZipEntry(name: string, value: unknown): ZipEntry {
    return {
      name,
      data: Buffer.from(
        JSON.stringify(
          value,
          (_key, item) => {
            if (typeof item === 'bigint') return item.toString();
            return item;
          },
          2,
        ),
        'utf8',
      ),
    };
  }

  private csvZipEntry(name: string, rows: Array<Record<string, unknown>>): ZipEntry {
    return { name, data: Buffer.from(this.toCsv(rows), 'utf8') };
  }

  private textZipEntry(name: string, value: string): ZipEntry {
    return { name, data: Buffer.from(value, 'utf8') };
  }

  private async writeQuestionPackageExport(taskId: string, dto: CreateExportDto) {
    const packageContent = await this.buildQuestionPackageEntries(dto);
    await mkdir(this.exportDir, { recursive: true });
    const fileName = `question_bank-${taskId}.zip`;
    const filePath = join(this.exportDir, fileName);
    await writeFile(filePath, this.createZip(packageContent.entries));
    return `/uploads/exports/${fileName}`;
  }

  private async buildQuestionPackageEntries(dto: CreateExportDto, allowEmpty = false) {
    const questions = await this.loadQuestionExportItems(dto);
    if (!questions.length && !allowEmpty) {
      throw new BadRequestException('没有可导出的题目');
    }

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
        name: 'metadata.json',
        data: Buffer.from(
          JSON.stringify(
            {
              packageType: 'question_bank',
              schemaVersion: 1,
              exportedAt,
              includeAnswers,
              includeAnalysis,
              count: questions.length,
              assetCount: assetMap.size,
            },
            null,
            2,
          ),
          'utf8',
        ),
      },
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

    return {
      entries,
      count: questions.length,
      assetCount: assetMap.size,
    };
  }

  private async writePaperDocumentPackageExport(taskId: string, dto: CreateExportDto) {
    const packageContent = await this.buildPaperDocumentPackageEntries(dto);
    await mkdir(this.exportDir, { recursive: true });
    const fileName = `paper_document-${taskId}.zip`;
    const filePath = join(this.exportDir, fileName);
    await writeFile(filePath, this.createZip(packageContent.entries));
    return `/uploads/exports/${fileName}`;
  }

  private async buildPaperDocumentPackageEntries(dto: CreateExportDto, allowEmpty = false) {
    const content = await this.paperDocumentContent(dto);
    if (!content.questions.length && !allowEmpty) {
      throw new BadRequestException('试卷内没有可导出的题目');
    }

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
        name: 'metadata.json',
        data: Buffer.from(
          JSON.stringify(
            {
              packageType: 'paper_document',
              schemaVersion: 2,
              exportedAt,
              includeAnswers,
              includeAnalysis,
              template: dto.template ?? 'teacher',
              paperId: dto.paperId ?? '',
              paperName: content.title,
              count: content.questions.length,
              assetCount: assetMap.size,
            },
            null,
            2,
          ),
          'utf8',
        ),
      },
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

    return {
      entries,
      count: content.questions.length,
      assetCount: assetMap.size,
      paperName: content.title,
    };
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
      courseId: question.courseId,
      courseName: question.course.name,
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
        courseId: question.courseId,
        courseName: question.course.name,
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
        courseId: question.courseId ?? '',
        courseName: question.courseName ?? '',
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
      const answerBook = content.template === 'answer_book';
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
        if (!answerBook) {
          doc.moveDown(0.2);
          doc.fontSize(10).fillColor('#111827');
          this.renderPdfMarkdown(doc, question.content);
          for (const option of question.options) {
            const suffix = content.includeAnswers && option.isCorrect ? '  [正确答案]' : '';
            doc.fontSize(10).fillColor('#111827').text(`${option.label}. ${suffix}`, { continued: false });
            this.renderPdfMarkdown(doc, option.content);
          }
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
    const answerBook = content.template === 'answer_book';
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
      if (!answerBook) {
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
      `课程：${question.course.name}`,
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
      `课程：${question.courseName ?? ''}`,
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

  private documentTemplateLabel(value?: string) {
    const map: Record<string, string> = {
      student: '学生版',
      teacher: '教师讲义版',
      answer_book: '答案册',
    };
    return map[value || 'student'] ?? '学生版';
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

  private exportDateRange(dto: CreateExportDto): Prisma.DateTimeNullableFilter {
    return {
      not: null,
      gte: dto.startDate ? new Date(dto.startDate) : undefined,
      lte: dto.endDate ? new Date(dto.endDate) : undefined,
    };
  }

  private exportDateTimeRange(dto: CreateExportDto): Prisma.DateTimeFilter | undefined {
    if (!dto.startDate && !dto.endDate) return undefined;
    return {
      gte: dto.startDate ? new Date(dto.startDate) : undefined,
      lte: dto.endDate ? new Date(dto.endDate) : undefined,
    };
  }

  private normalizeWrongSourceType(value?: string): WrongQuestionSourceType | undefined {
    const map: Record<string, WrongQuestionSourceType> = {
      exam: WrongQuestionSourceType.EXAM,
      practice: WrongQuestionSourceType.PRACTICE,
      manual: WrongQuestionSourceType.MANUAL,
      ai_recommendation: WrongQuestionSourceType.AI_RECOMMENDATION,
    };
    return value ? map[value] : undefined;
  }
}
