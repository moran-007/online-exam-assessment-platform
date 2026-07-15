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
import { defaultExportFormat, deleteExportFile, formatTask, futureDate, userFromExportPayload } from './export-access.operations';
import { writeQuestionPackageExport } from './export-archive.operations';
import { classRows, examRows, gradingRows, paperDocumentContent, paperDocumentRows, paperRows, questionDocumentContent, questionRows, wrongQuestionDocumentContent, wrongQuestionRows } from './export-dataset.operations';
import { writeDocumentExport, writeFullArchiveExport } from './export-document.operations';
import { toRecord } from './export-format.operations';
import { writePaperDocumentPackageExport } from './export-package.operations';
import { statisticsRows } from './export-statistics.operations';
import { writeTableExportFile } from './export-zip.operations';
import { renderExportFile } from './export-renderer.registry';
export function enqueue(ctx: ExportsContext, taskId: string) {
    ctx.queue.add(taskId);
    setTimeout(() => {
      void processQueue(ctx);
    }, 0);
  }

export async function resumeQueuedTasks(ctx: ExportsContext) {
    const stale = await ctx.prisma.exportTask.findMany({
      where: { status: { in: [ExportStatus.PENDING, ExportStatus.PROCESSING] } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    stale.forEach((task) => enqueue(ctx, task.id));
  }

export async function processQueue(ctx: ExportsContext) {
    if (ctx.processingQueue) return;
    ctx.processingQueue = true;
    try {
      while (ctx.queue.size) {
        const taskId = ctx.queue.values().next().value as string | undefined;
        if (!taskId) break;
        ctx.queue.delete(taskId);
        await processTask(ctx, taskId);
      }
    } finally {
      ctx.processingQueue = false;
    }
  }

export async function processTask(ctx: ExportsContext, taskId: string) {
    const task = await ctx.prisma.exportTask.findUnique({ where: { id: taskId } });
    if (!task || (task.status !== ExportStatus.PENDING && task.status !== ExportStatus.PROCESSING)) return;

    const payload = toRecord(ctx, task.paramsJson);
    const dto = payload as unknown as CreateExportDto;
    const format = defaultExportFormat(ctx, dto);
    const user = userFromExportPayload(ctx, payload, task.createdBy ?? '');

    try {
      await ctx.prisma.exportTask.update({
        where: { id: taskId },
        data: { status: ExportStatus.PROCESSING, progress: 10, errorMessage: null },
      });
      const fileUrl = await renderExportFile(ctx, task.id, dto, format, user);
      const latest = await ctx.prisma.exportTask.findUnique({ where: { id: task.id }, select: { status: true } });
      if (latest?.status === ExportStatus.CANCELED) {
        await deleteExportFile(ctx, fileUrl);
        return null;
      }
      const updated = await ctx.prisma.exportTask.update({
        where: { id: task.id },
        data: {
          status: ExportStatus.SUCCESS,
          progress: 100,
          fileUrl,
          finishedAt: new Date(),
          expiresAt: futureDate(ctx, ctx.exportExpireDays),
        },
      });
      await ctx.audit.log({
        userId: user.id,
        action: 'export:complete',
        module: 'export',
        targetType: 'export_task',
        targetId: task.id,
        afterData: { type: dto.type, format, fileUrl },
      });
      return formatTask(ctx, updated);
    } catch (error) {
      const latest = await ctx.prisma.exportTask.findUnique({ where: { id: task.id }, select: { status: true } });
      if (latest?.status === ExportStatus.CANCELED) {
        return null;
      }
      const nextRetry = task.retryCount + 1;
      const message = error instanceof Error ? error.message : '导出失败';
      const retryable = nextRetry <= task.maxRetries;
      await ctx.prisma.exportTask.update({
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
        setTimeout(() => enqueue(ctx, task.id), Math.min(1000 * nextRetry, 5000));
      }
      return null;
    }
  }
