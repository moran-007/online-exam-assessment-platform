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
import ExcelJS = require('exceljs');
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
export function createZip(ctx: ExportsContext, entries: ZipEntry[]) {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
      const name = entry.name.replace(/\\/g, '/');
      const nameBuffer = Buffer.from(name, 'utf8');
      const data = entry.data;
      const crc = crc32(ctx, data);
      const { time, date } = toDosDateTime(ctx, entry.date ?? new Date());

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

export function crc32(ctx: ExportsContext, buffer: Buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc = (crc >>> 8) ^ ctx.crc32Table[(crc ^ byte) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

export function makeCrc32Table(ctx: ExportsContext) {
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

export function toDosDateTime(ctx: ExportsContext, value: Date) {
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

export function safeZipName(ctx: ExportsContext, value: string) {
    const withoutControlCharacters = [...String(value || '')]
      .map((character) => character.charCodeAt(0) < 32 ? '_' : character)
      .join('');
    return withoutControlCharacters
      .replace(/[<>:"\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 160);
  }

export async function writeTableExportFile(ctx: ExportsContext, taskId: string, type: string, format: string, rows: Array<Record<string, unknown>>) {
    if (!['csv', 'xlsx', 'json'].includes(format)) {
      throw new BadRequestException('表格类导出仅支持 CSV、XLSX 或 JSON；PDF/Word 请使用“试卷文档”或“错题导出”');
    }
    await mkdir(ctx.exportDir, { recursive: true });
    const ext = format;
    const fileName = `${type}-${taskId}.${ext}`;
    const filePath = join(ctx.exportDir, fileName);
    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('导出数据');
      const headers = rows.length ? Object.keys(rows[0]) : [];
      worksheet.columns = headers.map((header) => ({ header, key: header, width: 18 }));
      rows.forEach((row) => worksheet.addRow(row));
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];
      if (worksheet.getRow(1).cellCount) worksheet.getRow(1).font = { bold: true };
      await workbook.xlsx.writeFile(filePath);
      return `/uploads/exports/${fileName}`;
    }
    const content = format === 'json' ? JSON.stringify(rows, null, 2) : toCsv(ctx, rows);
    await writeFile(filePath, content, 'utf8');
    return `/uploads/exports/${fileName}`;
  }

export function toCsv(ctx: ExportsContext, rows: Array<Record<string, unknown>>) {
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
