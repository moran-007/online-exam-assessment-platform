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
import { toRecord } from './export-format.operations';
export function defaultExportFormat(ctx: ExportsContext, dto: CreateExportDto) {
    if (dto.format) return dto.format;
    if (['full_archive', 'question_bank'].includes(dto.type)) return 'zip';
    if (['paper_document', 'wrong_questions'].includes(dto.type)) return 'pdf';
    return 'csv';
  }

export function assertExportRequestAllowed(ctx: ExportsContext, dto: CreateExportDto, user: RequestUser) {
    if (dto.type !== 'full_archive') return;
    assertSuperAdmin(ctx, user);
    if (dto.format && dto.format !== 'zip') {
      throw new BadRequestException('全量导出仅支持 ZIP 格式');
    }
  }

export function assertSuperAdmin(ctx: ExportsContext, user: RequestUser) {
    if (user.userType !== UserType.SUPER_ADMIN) {
      throw new ForbiddenException('只有超级管理员可以一键导出全部资源');
    }
  }

export function withPermissionSnapshot(ctx: ExportsContext, dto: CreateExportDto, user: RequestUser): Prisma.InputJsonObject {
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

export function userFromExportPayload(ctx: ExportsContext, payload: Record<string, unknown>, fallbackUserId: string): RequestUser {
    const snapshot = toRecord(ctx, payload.permissionSnapshot);
    return {
      id: String(snapshot.userId ?? fallbackUserId),
      username: String(snapshot.username ?? 'export-worker'),
      realName: typeof snapshot.realName === 'string' ? snapshot.realName : null,
      userType: String(snapshot.userType ?? UserType.ADMIN),
      roles: Array.isArray(snapshot.roles) ? snapshot.roles.map(String) : [],
      permissions: Array.isArray(snapshot.permissions) ? snapshot.permissions.map(String) : [],
    };
  }

export function exportAccessWhere(ctx: ExportsContext, query: QueryExportDto, user: RequestUser): Prisma.ExportTaskWhereInput {
    if (query.scope === 'all') {
      if (!ctx.dataScope.isUnrestricted(user)) {
        throw new ForbiddenException('只有管理员可以查看全部导出任务');
      }
      return {};
    }
    return { createdBy: user.id };
  }

export async function findAccessibleTask(ctx: ExportsContext, id: string, user: RequestUser) {
    const task = await ctx.prisma.exportTask.findFirst({
      where: ctx.dataScope.isUnrestricted(user) ? { id } : { id, createdBy: user.id },
    });
    if (!task) {
      throw new NotFoundException('导出任务不存在');
    }
    return task;
  }

export function formatTask<T extends { status: ExportStatus; paramsJson?: Prisma.JsonValue | null }>(ctx: ExportsContext, task: T) {
    const paramsJson = task.paramsJson === undefined ? undefined : sanitizedExportParams(ctx, task.paramsJson);
    const formatted = {
      ...task,
      status: toApiEnum(task.status),
      ...(paramsJson === undefined ? {} : { paramsJson }),
    };
    const fileUrl = (formatted as typeof formatted & { fileUrl?: unknown }).fileUrl;
    delete (formatted as typeof formatted & { fileUrl?: unknown }).fileUrl;
    return { ...formatted, downloadReady: task.status === ExportStatus.SUCCESS && Boolean(fileUrl) };
  }

export function sanitizedExportParams(ctx: ExportsContext, value: unknown) {
    const params = { ...toRecord(ctx, value) };
    delete params.permissionSnapshot;
    return params;
  }

export function futureDate(ctx: ExportsContext, days: number) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

export async function deleteExportFile(ctx: ExportsContext, fileUrl: string | null) {
    const filePath = exportFilePath(ctx, fileUrl);
    if (!filePath || !existsSync(filePath)) return;
    try {
      await unlink(filePath);
    } catch {
      // Best effort cleanup; the database status is still moved to expired.
    }
  }

export function exportFilePath(ctx: ExportsContext, fileUrl: string | null) {
    if (!fileUrl || !fileUrl.startsWith('/uploads/exports/')) return '';
    const candidate = resolve(ctx.uploadsRoot, fileUrl.slice('/uploads/'.length));
    const exportRoot = resolve(ctx.exportDir);
    const relativePath = relative(exportRoot, candidate);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) return '';
    return candidate;
  }

export function exportMimeType(ctx: ExportsContext, fileName: string) {
    const mimeTypes: Record<string, string> = {
      '.csv': 'text/csv; charset=utf-8',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.pdf': 'application/pdf',
      '.zip': 'application/zip',
      '.json': 'application/json; charset=utf-8',
    };
    return mimeTypes[extname(fileName).toLowerCase()] || 'application/octet-stream';
  }

export function exportQuestionFromSnapshot(ctx: ExportsContext, 
    question: {
      score: Prisma.Decimal;
      questionSnapshotJson: Prisma.JsonValue;
    },
    sectionTitle: string,
  ): ExportQuestion {
    const snapshot = toRecord(ctx, question.questionSnapshotJson);
    const options = Array.isArray(snapshot.options)
      ? snapshot.options.map((option) => {
          const value = toRecord(ctx, option);
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
          .map((item) => toRecord(ctx, item).name)
          .map((name) => String(name ?? '').trim())
          .filter(Boolean)
      : [];
    const tagNames = Array.isArray(snapshot.tags)
      ? snapshot.tags
          .map((item) => toRecord(ctx, item).name)
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
      answer: toRecord(ctx, snapshot.answer),
      scoringRule: toRecord(ctx, snapshot.scoringRule),
      analysis: typeof snapshot.analysis === 'string' ? snapshot.analysis : '',
      sectionTitle,
      knowledgePointNames,
      tagNames,
      allowOptionShuffle: Boolean(snapshot.allowOptionShuffle),
    };
  }

export function exportQuestionFromEntity(ctx: ExportsContext, question: QuestionExportEntity): ExportQuestion {
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