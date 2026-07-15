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
export function formatAnswer(ctx: ExportsContext, answer: Record<string, unknown> | null | undefined, options: Array<{ id?: string; label: string; content: string; isCorrect?: boolean }>) {
    if (!answer || !Object.keys(answer).length) {
      const correctOptions = options.filter((option) => option.isCorrect);
      return correctOptions.length ? correctOptions.map((option) => `${option.label}. ${plainText(ctx, option.content)}`).join('；') : '';
    }

    if (Array.isArray(answer.correctOptionIds)) {
      const labels = answer.correctOptionIds
        .map((id) => options.find((option) => option.id === id || option.label === id || `${option.label}` === id))
        .filter(Boolean)
        .map((option) => `${option?.label}. ${plainText(ctx, option?.content ?? '')}`);
      if (labels.length) return labels.join('；');
      const correctOptions = options.filter((option) => option.isCorrect);
      return correctOptions.map((option) => `${option.label}. ${plainText(ctx, option.content)}`).join('；');
    }

    if (Array.isArray(answer.blanks)) {
      return answer.blanks
        .map((blank) => toRecord(ctx, blank))
        .map((blank) => `第 ${blank.index ?? ''} 空：${Array.isArray(blank.answers) ? blank.answers.join(' / ') : ''}`)
        .join('；');
    }

    if (typeof answer.reference === 'string') {
      return plainText(ctx, answer.reference);
    }

    return JSON.stringify(answer);
  }

export function plainText(ctx: ExportsContext, value: string) {
    return String(value ?? '')
      .replace(/```[\w-]*\n([\s\S]*?)```/g, '$1')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '图片：$1 $2')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/[*_`>#]/g, '')
      .replace(/\r\n/g, '\n')
      .trim();
  }

export function toRecord(ctx: ExportsContext, value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

export function typeLabel(ctx: ExportsContext, value: string) {
    const map: Record<string, string> = {
      single_choice: '单选题',
      multiple_choice: '多选题',
      true_false: '判断题',
      fill_blank: '填空题',
      short_answer: '简答题',
      programming: '编程题',
      material: '材料/组合题',
      file_upload: '文件上传题',
      scratch_project: 'Scratch 项目题',
      arduino_project: 'Arduino 项目题',
    };
    return map[value] ?? value;
  }

export function documentTemplateLabel(ctx: ExportsContext, value?: string) {
    const map: Record<string, string> = {
      student: '学生版',
      teacher: '教师讲义版',
      answer_book: '答案册',
    };
    return map[value || 'student'] ?? '学生版';
  }

export function formatDate(ctx: ExportsContext, value?: Date) {
    return value ? value.toLocaleString('zh-CN', { hour12: false }) : '-';
  }

export function resolveFontPath(ctx: ExportsContext) {
    const candidates = [
      'C:\\Windows\\Fonts\\simhei.ttf',
      'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf',
      'C:\\Windows\\Fonts\\Deng.ttf',
    ];
    return candidates.find((path) => existsSync(path)) ?? '';
  }

export async function loadUsers(ctx: ExportsContext, userIds: string[]) {
    const users = await ctx.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, username: true, realName: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

export function normalizeStatus(ctx: ExportsContext, value: string) {
    const normalized = value.replace(/-/g, '_').toUpperCase() as keyof typeof ExportStatus;
    return ExportStatus[normalized];
  }

export function exportDateRange(ctx: ExportsContext, dto: CreateExportDto): Prisma.DateTimeNullableFilter {
    return {
      not: null,
      gte: dto.startDate ? new Date(dto.startDate) : undefined,
      lte: dto.endDate ? new Date(dto.endDate) : undefined,
    };
  }

export function exportDateTimeRange(ctx: ExportsContext, dto: CreateExportDto): Prisma.DateTimeFilter | undefined {
    if (!dto.startDate && !dto.endDate) return undefined;
    return {
      gte: dto.startDate ? new Date(dto.startDate) : undefined,
      lte: dto.endDate ? new Date(dto.endDate) : undefined,
    };
  }

export function normalizeWrongSourceType(ctx: ExportsContext, value?: string): WrongQuestionSourceType | undefined {
    const map: Record<string, WrongQuestionSourceType> = {
      exam: WrongQuestionSourceType.EXAM,
      practice: WrongQuestionSourceType.PRACTICE,
      manual: WrongQuestionSourceType.MANUAL,
      ai_recommendation: WrongQuestionSourceType.AI_RECOMMENDATION,
    };
    return value ? map[value] : undefined;
  }