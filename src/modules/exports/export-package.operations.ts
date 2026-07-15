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
import { loadQuestionExportItems, paperDocumentContent } from './export-dataset.operations';
import { collectExportQuestionUploads, collectMarkdownUploads, exportQuestionImportAnswers, exportQuestionImportMarkdown, questionImportAnswers, questionImportMarkdown, rewriteMarkdownUploads } from './export-renderer.operations';
import { createZip } from './export-zip.operations';
export async function buildQuestionPackageEntries(ctx: ExportsContext, dto: CreateExportDto, allowEmpty = false) {
    const questions = await loadQuestionExportItems(ctx, dto);
    if (!questions.length && !allowEmpty) {
      throw new BadRequestException('没有可导出的题目');
    }

    const assetMap = new Map<string, string>();
    for (const question of questions) {
      collectMarkdownUploads(ctx, assetMap, question.content, question.analysis ?? '');
      for (const option of question.options) {
        collectMarkdownUploads(ctx, assetMap, option.content);
      }
    }

    const exportedAt = new Date().toISOString();
    const includeAnswers = dto.includeAnswers ?? true;
    const includeAnalysis = dto.includeAnalysis ?? true;
    const templateText = questionImportMarkdown(ctx, questions, assetMap, includeAnalysis);
    const answerText = questionImportAnswers(ctx, questions, includeAnswers);
    const payload = {
      schemaVersion: 1,
      exportedAt,
      includeAnswers,
      includeAnalysis,
      count: questions.length,
      questions: questions.map((question) => questionPackageRecord(ctx, question, assetMap, dto)),
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

export async function writePaperDocumentPackageExport(ctx: ExportsContext, taskId: string, dto: CreateExportDto) {
    const packageContent = await buildPaperDocumentPackageEntries(ctx, dto);
    await mkdir(ctx.exportDir, { recursive: true });
    const fileName = `paper_document-${taskId}.zip`;
    const filePath = join(ctx.exportDir, fileName);
    await writeFile(filePath, createZip(ctx, packageContent.entries));
    return `/uploads/exports/${fileName}`;
  }

export async function buildPaperDocumentPackageEntries(ctx: ExportsContext, dto: CreateExportDto, allowEmpty = false) {
    const content = await paperDocumentContent(ctx, dto);
    if (!content.questions.length && !allowEmpty) {
      throw new BadRequestException('试卷内没有可导出的题目');
    }

    const assetMap = new Map<string, string>();
    for (const question of content.questions) {
      collectExportQuestionUploads(ctx, assetMap, question);
    }

    const exportedAt = new Date().toISOString();
    const includeAnswers = dto.includeAnswers ?? true;
    const includeAnalysis = dto.includeAnalysis ?? true;
    const templateText = exportQuestionImportMarkdown(ctx, content.questions, assetMap, includeAnalysis);
    const answerText = exportQuestionImportAnswers(ctx, content.questions, includeAnswers);
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
        exportQuestionPackageRecord(ctx, question, assetMap, dto, index, {
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

export function questionPackageRecord(ctx: ExportsContext, question: QuestionExportEntity, assetMap: Map<string, string>, dto: CreateExportDto) {
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
      contentMarkdown: rewriteMarkdownUploads(ctx, question.content, assetMap),
      options: question.options.map((option) => ({
        id: option.id,
        optionKey: option.optionKey,
        contentMarkdown: rewriteMarkdownUploads(ctx, option.content, assetMap),
        isCorrect: includeAnswers ? option.isCorrect : undefined,
        sortOrder: option.sortOrder,
      })),
      answer: includeAnswers ? question.answer?.answerJson ?? {} : {},
      scoringRule: includeAnswers ? question.answer?.scoringRuleJson ?? {} : {},
      analysisMarkdown: includeAnalysis ? rewriteMarkdownUploads(ctx, question.analysis ?? '', assetMap) : '',
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
        content: rewriteMarkdownUploads(ctx, question.content, assetMap),
        difficulty: question.difficulty,
        defaultScore: Number(question.defaultScore),
        analysis: rewriteMarkdownUploads(ctx, question.analysis ?? '', assetMap),
        options: question.options.map((option) => ({
          optionKey: option.optionKey,
          content: rewriteMarkdownUploads(ctx, option.content, assetMap),
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

export function exportQuestionPackageRecord(ctx: ExportsContext, 
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
      contentMarkdown: rewriteMarkdownUploads(ctx, option.content, assetMap),
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
      contentMarkdown: rewriteMarkdownUploads(ctx, question.content, assetMap),
      options,
      answer: includeAnswers ? question.answer ?? {} : {},
      scoringRule: includeAnswers ? question.scoringRule ?? {} : {},
      analysisMarkdown: includeAnalysis ? rewriteMarkdownUploads(ctx, question.analysis ?? '', assetMap) : '',
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
        content: rewriteMarkdownUploads(ctx, question.content, assetMap),
        difficulty: question.difficulty ?? 1,
        defaultScore: question.defaultScore ?? question.score,
        analysis: includeAnalysis ? rewriteMarkdownUploads(ctx, question.analysis ?? '', assetMap) : '',
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