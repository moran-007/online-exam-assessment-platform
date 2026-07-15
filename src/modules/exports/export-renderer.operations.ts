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
import { formatAnswer, formatDate, plainText, toRecord, typeLabel } from './export-format.operations';
import { safeZipName } from './export-zip.operations';
export async function renderPdf(ctx: ExportsContext, content: DocumentExportContent): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      if (ctx.fontPath) {
        doc.registerFont('body', ctx.fontPath);
        doc.font('body');
      }
      const answerBook = content.template === 'answer_book';
      doc.fontSize(18).text(content.title, { align: 'center' });
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor('#4b5563').text(content.subtitle, { align: 'center' });
      doc.fillColor('#111827').moveDown();

      content.questions.forEach((question, index) => {
        doc.fontSize(12).fillColor('#111827').text(`${index + 1}. ${question.title}（${typeLabel(ctx, question.type)} · ${question.score} 分）`, {
          continued: false,
        });
        if (content.includeWrongInfo && question.wrongCount !== undefined) {
          doc.fontSize(9).fillColor('#6b7280').text(`错题次数：${question.wrongCount} · 最近记录：${formatDate(ctx, question.lastWrongAt)}`);
        }
        if (!answerBook) {
          doc.moveDown(0.2);
          doc.fontSize(10).fillColor('#111827');
          renderPdfMarkdown(ctx, doc, question.content);
          for (const option of question.options) {
            const suffix = content.includeAnswers && option.isCorrect ? '  [正确答案]' : '';
            doc.fontSize(10).fillColor('#111827').text(`${option.label}. ${suffix}`, { continued: false });
            renderPdfMarkdown(ctx, doc, option.content);
          }
        }
        if (content.includeAnswers) {
          doc.moveDown(0.2).fontSize(10).fillColor('#047857').text(`答案：${formatAnswer(ctx, question.answer, question.options) || '暂无'}`);
        }
        if (content.includeAnalysis) {
          doc.moveDown(0.2).fontSize(10).fillColor('#1f2937').text(`解析：${plainText(ctx, question.analysis ?? '') || '暂无解析'}`);
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

export async function renderDocx(ctx: ExportsContext, content: DocumentExportContent) {
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
          text: `${index + 1}. ${question.title}（${typeLabel(ctx, question.type)} · ${question.score} 分）`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 180, after: 120 },
        }),
      );
      if (content.includeWrongInfo && question.wrongCount !== undefined) {
        children.push(new Paragraph({ text: `错题次数：${question.wrongCount} · 最近记录：${formatDate(ctx, question.lastWrongAt)}` }));
      }
      if (!answerBook) {
        pushTextParagraphs(ctx, children, plainText(ctx, question.content));
        for (const option of question.options) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${option.label}. `, bold: true }),
                new TextRun({ text: plainText(ctx, option.content) }),
                ...(content.includeAnswers && option.isCorrect ? [new TextRun({ text: '  正确答案', bold: true, color: '047857' })] : []),
              ],
            }),
          );
        }
      }
      if (content.includeAnswers) {
        children.push(new Paragraph({ children: [new TextRun({ text: '答案：', bold: true }), new TextRun({ text: formatAnswer(ctx, question.answer, question.options) || '暂无' })] }));
      }
      if (content.includeAnalysis) {
        children.push(new Paragraph({ children: [new TextRun({ text: '解析：', bold: true }), new TextRun({ text: plainText(ctx, question.analysis ?? '') || '暂无解析' })] }));
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

export function pushTextParagraphs(ctx: ExportsContext, children: Paragraph[], text: string) {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      children.push(new Paragraph({ text: '' }));
      return;
    }
    for (const line of lines) {
      children.push(new Paragraph({ text: line }));
    }
  }

export function renderPdfMarkdown(ctx: ExportsContext, doc: PDFKit.PDFDocument, markdown: string) {
    const segments = markdownSegments(ctx, markdown);
    if (!segments.length) {
      doc.text('');
      return;
    }

    for (const segment of segments) {
      if (segment.type === 'text') {
        const text = plainText(ctx, segment.value);
        if (text) doc.text(text);
        continue;
      }

      renderPdfImage(ctx, doc, segment.src, segment.alt);
    }
  }

export function renderPdfImage(ctx: ExportsContext, doc: PDFKit.PDFDocument, src: string, alt: string) {
    const imagePath = localUploadPath(ctx, src);
    if (!imagePath || !isPdfRenderableImage(ctx, imagePath)) {
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

export function markdownSegments(ctx: ExportsContext, value: string): MarkdownSegment[] {
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
        src: cleanMarkdownUrl(ctx, match[2] ?? ''),
      });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < source.length) {
      segments.push({ type: 'text', value: source.slice(lastIndex) });
    }

    return segments.filter((segment) => segment.type === 'image' || segment.value.trim());
  }

export function cleanMarkdownUrl(ctx: ExportsContext, value: string) {
    return String(value ?? '')
      .trim()
      .replace(/^<|>$/g, '')
      .replace(/\s+["'][^"']*["']$/, '');
  }

export function localUploadPath(ctx: ExportsContext, src: string) {
    const raw = cleanMarkdownUrl(ctx, src);
    if (!raw || /^(https?:|data:|javascript:|mailto:)/i.test(raw)) {
      return '';
    }

    const withoutHash = raw.split('#')[0].split('?')[0];
    let decoded: string;
    try {
      decoded = decodeURIComponent(withoutHash);
    } catch {
      decoded = withoutHash;
    }

    const uploadsRoot = ctx.uploadsRoot;
    let candidate = '';
    if (decoded.startsWith('/uploads/')) {
      candidate = resolve(uploadsRoot, decoded.slice('/uploads/'.length));
    } else if (decoded.startsWith('uploads/')) {
      candidate = resolve(uploadsRoot, decoded.slice('uploads/'.length));
    } else if (isAbsolute(decoded)) {
      candidate = resolve(decoded);
    }

    if (!candidate) return '';
    const relativePath = relative(uploadsRoot, candidate);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) return '';
    return existsSync(candidate) ? candidate : '';
  }

export function isPdfRenderableImage(ctx: ExportsContext, path: string) {
    return ['.jpg', '.jpeg', '.png'].includes(extname(path).toLowerCase());
  }

export function collectMarkdownUploads(ctx: ExportsContext, assetMap: Map<string, string>, ...markdownValues: string[]) {
    const usedNames = new Set(assetMap.values());
    for (const value of markdownValues) {
      const source = String(value ?? '');
      const linkRegex = /!?\[[^\]]*\]\(([^)]+)\)/g;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(source))) {
        const localPath = localUploadPath(ctx, match[1] ?? '');
        if (!localPath || assetMap.has(localPath)) continue;

        const base = safeZipName(ctx, basename(localPath)) || `asset-${assetMap.size + 1}`;
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

export function rewriteMarkdownUploads(ctx: ExportsContext, value: string, assetMap: Map<string, string>) {
    return String(value ?? '').replace(/(!?\[[^\]]*\]\()([^)]+)(\))/g, (full, prefix: string, src: string, suffix: string) => {
      const localPath = localUploadPath(ctx, src);
      const zipPath = localPath ? assetMap.get(localPath) : '';
      return zipPath ? `${prefix}${zipPath}${suffix}` : full;
    });
  }

export function questionImportMarkdown(ctx: ExportsContext, questions: QuestionExportEntity[], assetMap: Map<string, string>, includeAnalysis: boolean) {
    return questions.map((question) => questionImportBlock(ctx, question, assetMap, includeAnalysis)).join('\n---\n');
  }

export function exportQuestionImportMarkdown(ctx: ExportsContext, questions: ExportQuestion[], assetMap: Map<string, string>, includeAnalysis: boolean) {
    return questions.map((question) => exportQuestionImportBlock(ctx, question, assetMap, includeAnalysis)).join('\n---\n');
  }

export function questionImportBlock(ctx: ExportsContext, question: QuestionExportEntity, assetMap: Map<string, string>, includeAnalysis: boolean) {
    const lines = [
      `标题：${question.title}`,
      `课程：${question.course.name}`,
      `题型：${typeLabel(ctx, toApiEnum(question.type))}`,
      `难度：${question.difficulty}`,
      `分值：${Number(question.defaultScore)}`,
    ];
    const tags = question.tags.map((item) => item.tag.name).filter(Boolean);
    const points = question.knowledgePoints.map((item) => item.knowledgePoint.name).filter(Boolean);
    if (tags.length) lines.push(`标签：${tags.join(',')}`);
    if (points.length) lines.push(`知识点：${points.join(',')}`);
    lines.push('题干：', rewriteMarkdownUploads(ctx, question.content, assetMap));
    if (question.options.length) {
      lines.push('选项：');
      for (const option of question.options) {
        const content = rewriteMarkdownUploads(ctx, option.content, assetMap);
        const [firstLine, ...restLines] = content.split('\n');
        lines.push(`${option.optionKey}. ${firstLine ?? ''}`);
        lines.push(...restLines);
      }
    }
    if (includeAnalysis) {
      lines.push('解析：', rewriteMarkdownUploads(ctx, question.analysis ?? '', assetMap));
    }
    return lines.join('\n').trim();
  }

export function exportQuestionImportBlock(ctx: ExportsContext, question: ExportQuestion, assetMap: Map<string, string>, includeAnalysis: boolean) {
    const lines = [
      `标题：${question.title}`,
      `课程：${question.courseName ?? ''}`,
      `题型：${typeLabel(ctx, question.type)}`,
      `难度：${question.difficulty ?? 1}`,
      `分值：${question.defaultScore ?? question.score}`,
    ];
    const tags = question.tagNames ?? [];
    const points = question.knowledgePointNames ?? [];
    if (tags.length) lines.push(`标签：${tags.join(',')}`);
    if (points.length) lines.push(`知识点：${points.join(',')}`);
    lines.push('题干：', rewriteMarkdownUploads(ctx, question.content, assetMap));
    if (question.options.length) {
      lines.push('选项：');
      for (const option of question.options) {
        const content = rewriteMarkdownUploads(ctx, option.content, assetMap);
        const [firstLine, ...restLines] = content.split('\n');
        lines.push(`${option.label}. ${firstLine ?? ''}`);
        lines.push(...restLines);
      }
    }
    if (includeAnalysis) {
      lines.push('解析：', rewriteMarkdownUploads(ctx, question.analysis ?? '', assetMap));
    }
    return lines.join('\n').trim();
  }

export function questionImportAnswers(ctx: ExportsContext, questions: QuestionExportEntity[], includeAnswers: boolean) {
    if (!includeAnswers) return '';
    return questions.map((question, index) => `${index + 1}. ${questionAnswerForImport(ctx, question)}`).join('\n');
  }

export function exportQuestionImportAnswers(ctx: ExportsContext, questions: ExportQuestion[], includeAnswers: boolean) {
    if (!includeAnswers) return '';
    return questions.map((question, index) => `${index + 1}. ${exportQuestionAnswerForImport(ctx, question)}`).join('\n');
  }

export function questionAnswerForImport(ctx: ExportsContext, question: QuestionExportEntity) {
    const type = toApiEnum(question.type);
    if (['single_choice', 'multiple_choice', 'true_false'].includes(type)) {
      return question.options.filter((option) => option.isCorrect).map((option) => option.optionKey).join(',');
    }

    const answer = toRecord(ctx, question.answer?.answerJson);
    if (type === 'fill_blank' && Array.isArray(answer.blanks)) {
      return answer.blanks
        .map((blank) => toRecord(ctx, blank))
        .flatMap((blank) => (Array.isArray(blank.answers) ? blank.answers.map(String) : []))
        .join(',');
    }

    if (typeof answer.reference === 'string') {
      return answer.reference;
    }

    return formatAnswer(ctx, answer, question.options.map((option) => ({
      id: option.id,
      label: option.optionKey,
      content: option.content,
      isCorrect: option.isCorrect,
    })));
  }

export function exportQuestionAnswerForImport(ctx: ExportsContext, question: ExportQuestion) {
    if (['single_choice', 'multiple_choice', 'true_false'].includes(question.type)) {
      return question.options.filter((option) => option.isCorrect).map((option) => option.label).join(',');
    }

    const answer = toRecord(ctx, question.answer);
    if (question.type === 'fill_blank' && Array.isArray(answer.blanks)) {
      return answer.blanks
        .map((blank) => toRecord(ctx, blank))
        .flatMap((blank) => (Array.isArray(blank.answers) ? blank.answers.map(String) : []))
        .join(',');
    }

    if (typeof answer.reference === 'string') {
      return answer.reference;
    }

    return formatAnswer(ctx, answer, question.options);
  }

export function collectExportQuestionUploads(ctx: ExportsContext, assetMap: Map<string, string>, question: ExportQuestion) {
    collectMarkdownUploads(ctx, assetMap, question.content, question.analysis ?? '');
    for (const option of question.options) {
      collectMarkdownUploads(ctx, assetMap, option.content);
    }
  }