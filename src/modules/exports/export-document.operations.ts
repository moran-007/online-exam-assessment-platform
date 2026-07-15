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
import { assertExportRequestAllowed } from './export-access.operations';
import { addRowsEntries, csvZipEntry, fullArchiveClassRows, fullArchiveCourseRows, fullArchiveExamRows, fullArchiveKnowledgePointRows, fullArchivePaperRows, fullArchiveTagRows, jsonZipEntry, prefixZipEntries, safeArchiveFolderName, textZipEntry } from './export-archive.operations';
import { questionRows } from './export-dataset.operations';
import { formatAnswer, plainText } from './export-format.operations';
import { buildPaperDocumentPackageEntries, buildQuestionPackageEntries } from './export-package.operations';
import { renderDocx, renderPdf } from './export-renderer.operations';
import { createZip, writeTableExportFile } from './export-zip.operations';
export async function writeDocumentExport(ctx: ExportsContext, taskId: string, type: string, format: string, content: DocumentExportContent) {
    if (format === 'pdf') {
      return writePdfExport(ctx, taskId, type, content);
    }
    if (format === 'docx') {
      return writeDocxExport(ctx, taskId, type, content);
    }
    const rows = content.questions.map((question, index) => ({
      no: index + 1,
      section: question.sectionTitle ?? '',
      title: question.title,
      type: question.type,
      score: question.score,
      content: plainText(ctx, question.content),
      answer: content.includeAnswers ? formatAnswer(ctx, question.answer, question.options) : '',
      analysis: content.includeAnalysis ? plainText(ctx, question.analysis ?? '') : '',
      wrongCount: content.includeWrongInfo ? question.wrongCount ?? '' : '',
    }));
    return writeTableExportFile(ctx, taskId, type, format, rows);
  }

export async function writePdfExport(ctx: ExportsContext, taskId: string, type: string, content: DocumentExportContent) {
    await mkdir(ctx.exportDir, { recursive: true });
    const fileName = `${type}-${taskId}.pdf`;
    const filePath = join(ctx.exportDir, fileName);
    const buffer = await renderPdf(ctx, content);
    await writeFile(filePath, buffer);
    return `/uploads/exports/${fileName}`;
  }

export async function writeDocxExport(ctx: ExportsContext, taskId: string, type: string, content: DocumentExportContent) {
    await mkdir(ctx.exportDir, { recursive: true });
    const fileName = `${type}-${taskId}.docx`;
    const filePath = join(ctx.exportDir, fileName);
    const buffer = await renderDocx(ctx, content);
    await writeFile(filePath, buffer);
    return `/uploads/exports/${fileName}`;
  }

export async function writeFullArchiveExport(ctx: ExportsContext, taskId: string, dto: CreateExportDto, user: RequestUser) {
    assertExportRequestAllowed(ctx, dto, user);
    await mkdir(ctx.exportDir, { recursive: true });

    const exportedAt = new Date().toISOString();
    const archiveDto: CreateExportDto = {
      type: 'full_archive',
      format: 'zip',
      includeAnswers: dto.includeAnswers ?? true,
      includeAnalysis: dto.includeAnalysis ?? true,
      includeWrongInfo: dto.includeWrongInfo,
    };
    const questionDto: CreateExportDto = { ...archiveDto, type: 'question_bank' };

    const [questionPackage, exportedQuestionRows, papers, courses, knowledgePoints, tags, classes, exams] = await Promise.all([
      buildQuestionPackageEntries(ctx, questionDto, true),
      questionRows(ctx, questionDto),
      ctx.prisma.paper.findMany({
        where: { deletedAt: null },
        include: {
          course: true,
          _count: { select: { sections: true, questions: true, exams: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      fullArchiveCourseRows(ctx),
      fullArchiveKnowledgePointRows(ctx),
      fullArchiveTagRows(ctx),
      fullArchiveClassRows(ctx),
      fullArchiveExamRows(ctx),
    ]);

    const entries: ZipEntry[] = [
      ...prefixZipEntries(ctx, 'question_bank', questionPackage.entries),
      csvZipEntry(ctx, 'question_bank/questions.csv', exportedQuestionRows),
    ];
    const paperRows = fullArchivePaperRows(ctx, papers);
    addRowsEntries(ctx, entries, 'courses', 'courses', courses, exportedAt);
    addRowsEntries(ctx, entries, 'knowledge_points', 'knowledge_points', knowledgePoints, exportedAt);
    addRowsEntries(ctx, entries, 'tags', 'tags', tags, exportedAt);
    addRowsEntries(ctx, entries, 'classes', 'classes', classes, exportedAt);
    addRowsEntries(ctx, entries, 'exams', 'exams', exams, exportedAt);
    addRowsEntries(ctx, entries, 'papers', 'papers', paperRows, exportedAt);

    let paperQuestionCount = 0;
    let paperAssetCount = 0;
    for (const paper of papers) {
      const paperPackage = await buildPaperDocumentPackageEntries(ctx, 
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
      entries.push(...prefixZipEntries(ctx, `papers/${safeArchiveFolderName(ctx, paper.name, paper.id)}`, paperPackage.entries));
    }

    entries.unshift(
      jsonZipEntry(ctx, 'metadata.json', {
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
      textZipEntry(ctx, 
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
    const filePath = join(ctx.exportDir, fileName);
    await writeFile(filePath, createZip(ctx, entries));
    return `/uploads/exports/${fileName}`;
  }
