import { Prisma } from '@prisma/client';
import { join } from 'node:path';
import { toApiEnum } from '../../common/utils/enum-normalizer';
import { CreateExportDto } from './dto/create-export.dto';

type FullArchivePaper = Prisma.PaperGetPayload<{
  include: {
    course: true;
    _count: { select: { sections: true; questions: true; exams: true } };
  };
}>;

import { ExportsContext } from './exports.context';
import { buildQuestionPackageEntries } from './export-package.operations';
import { safeZipName, toCsv, writeZipFile, type ZipEntry } from './export-zip.operations';
export async function fullArchiveCourseRows(ctx: ExportsContext) {
    const courses = await ctx.prisma.course.findMany({
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

export async function fullArchiveKnowledgePointRows(ctx: ExportsContext) {
    const points = await ctx.prisma.knowledgePoint.findMany({
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

export async function fullArchiveTagRows(ctx: ExportsContext) {
    const tags = await ctx.prisma.tag.findMany({
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

export async function fullArchiveClassRows(ctx: ExportsContext) {
    const classes = await ctx.prisma.classGroup.findMany({
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

export function fullArchivePaperRows(ctx: ExportsContext, papers: FullArchivePaper[]) {
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

export async function fullArchiveExamRows(ctx: ExportsContext) {
    const exams = await ctx.prisma.exam.findMany({
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
      ? await ctx.prisma.classGroup.findMany({
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

export function addRowsEntries(ctx: ExportsContext, entries: ZipEntry[], folder: string, name: string, rows: Array<Record<string, unknown>>, exportedAt: string) {
    entries.push(
      csvZipEntry(ctx, `${folder}/${name}.csv`, rows),
      jsonZipEntry(ctx, `${folder}/${name}.json`, {
        schemaVersion: 1,
        exportedAt,
        count: rows.length,
        items: rows,
      }),
    );
  }

export function prefixZipEntries(ctx: ExportsContext, prefix: string, entries: ZipEntry[]) {
    const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
    return entries.map((entry) => ({
      ...entry,
      name: `${normalizedPrefix}/${entry.name.replace(/^\/+/, '')}`,
    }));
  }

export function safeArchiveFolderName(ctx: ExportsContext, name: string, id: string) {
    const safeName = safeZipName(ctx, name) || 'paper';
    const suffix = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8);
    return suffix ? `${safeName}-${suffix}` : safeName;
  }

export function jsonZipEntry(ctx: ExportsContext, name: string, value: unknown): ZipEntry {
    return {
      name,
      data: JSON.stringify(
        value,
        (_key, item) => {
          if (typeof item === 'bigint') return item.toString();
          return item;
        },
        2,
      ),
    };
  }

export function csvZipEntry(ctx: ExportsContext, name: string, rows: Array<Record<string, unknown>>): ZipEntry {
    return { name, data: toCsv(ctx, rows) };
  }

export function textZipEntry(ctx: ExportsContext, name: string, value: string): ZipEntry {
    return { name, data: value };
  }

export async function writeQuestionPackageExport(ctx: ExportsContext, taskId: string, dto: CreateExportDto) {
    const packageContent = await buildQuestionPackageEntries(ctx, dto);
    const fileName = `question_bank-${taskId}.zip`;
    const filePath = join(ctx.exportDir, fileName);
    await writeZipFile(filePath, packageContent.entries);
    return `/uploads/exports/${fileName}`;
  }
