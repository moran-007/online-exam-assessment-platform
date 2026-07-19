import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { CreateExportDto } from './dto/create-export.dto';

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

import { ExportsContext } from './exports.context';
import { assertExportRequestAllowed } from './export-access.operations';
import { csvZipEntry, fullArchiveClassRows, fullArchiveCourseRows, fullArchiveExamRows, fullArchiveKnowledgePointRows, fullArchivePaperRows, fullArchiveTagRows, jsonZipEntry, safeArchiveFolderName, textZipEntry } from './export-archive.operations';
import { questionRows } from './export-dataset.operations';
import { writeExportFileAtomically } from './export-file.operations';
import { formatAnswer, plainText } from './export-format.operations';
import { buildPaperDocumentPackageEntries, buildQuestionPackageEntries } from './export-package.operations';
import { renderDocxStream, writePdfFile } from './export-renderer.operations';
import { csvZipStreamEntry, StreamingZipWriter, writeTableExportFile, writeZipArchive } from './export-zip.operations';
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
    const fileName = `${type}-${taskId}.pdf`;
    const filePath = join(ctx.exportDir, fileName);
    await writePdfFile(ctx, filePath, content);
    return `/uploads/exports/${fileName}`;
  }

export async function writeDocxExport(ctx: ExportsContext, taskId: string, type: string, content: DocumentExportContent) {
    const fileName = `${type}-${taskId}.docx`;
    const filePath = join(ctx.exportDir, fileName);
    await writeExportFileAtomically(filePath, async (partialPath) => {
      await pipeline(renderDocxStream(ctx, content), createWriteStream(partialPath));
    });
    return `/uploads/exports/${fileName}`;
  }

export async function writeFullArchiveExport(ctx: ExportsContext, taskId: string, dto: CreateExportDto, user: RequestUser) {
  assertExportRequestAllowed(ctx, dto, user);
  const exportedAt = new Date().toISOString();
  const archiveDto: CreateExportDto = {
    type: 'full_archive',
    format: 'zip',
    includeAnswers: dto.includeAnswers ?? true,
    includeAnalysis: dto.includeAnalysis ?? true,
    includeWrongInfo: dto.includeWrongInfo,
  };
  const fileName = `full_archive-${taskId}.zip`;
  const filePath = join(ctx.exportDir, fileName);

  await writeZipArchive(filePath, async (writer) => {
    const counts = await writeArchiveDomains(ctx, writer, archiveDto, exportedAt);
    const papers = await ctx.prisma.paper.findMany({
      where: { deletedAt: null },
      include: {
        course: true,
        _count: { select: { sections: true, questions: true, exams: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    counts.papers = papers.length;
    await writeRowsToArchive(writer, ctx, 'papers', 'papers', fullArchivePaperRows(ctx, papers), exportedAt);

    for (const paper of papers) {
      const paperPackage = await buildPaperDocumentPackageEntries(ctx, {
        ...archiveDto,
        type: 'paper_document',
        paperId: paper.id,
        template: 'teacher',
      }, true);
      counts.paperQuestions += paperPackage.count;
      counts.paperAssets += paperPackage.assetCount;
      const prefix = `papers/${safeArchiveFolderName(ctx, paper.name, paper.id)}`;
      await writer.addEntries(paperPackage.entries, prefix);
    }

    await writer.addEntry(textZipEntry(ctx, 'README.txt', archiveReadme(exportedAt, counts.questions, counts.papers)));
    await writer.addEntry(jsonZipEntry(ctx, 'metadata.json', {
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
      counts,
    }));
  });
  return `/uploads/exports/${fileName}`;
}

type ArchiveCounts = {
  questions: number;
  questionAssets: number;
  papers: number;
  paperQuestions: number;
  paperAssets: number;
  courses: number;
  knowledgePoints: number;
  tags: number;
  classes: number;
  exams: number;
};

async function writeArchiveDomains(
  ctx: ExportsContext,
  writer: StreamingZipWriter,
  archiveDto: CreateExportDto,
  exportedAt: string,
): Promise<ArchiveCounts> {
  const questionDto: CreateExportDto = { ...archiveDto, type: 'question_bank' };
  const questionPackage = await buildQuestionPackageEntries(ctx, questionDto, true);
  const questionCount = questionPackage.count;
  const questionAssetCount = questionPackage.assetCount;
  await writer.addEntries(questionPackage.entries, 'question_bank');
  const exportedQuestionRows = await questionRows(ctx, questionDto);
  await writer.addEntry(csvZipStreamEntry('question_bank/questions.csv', exportedQuestionRows));

  const counts: ArchiveCounts = {
    questions: questionCount,
    questionAssets: questionAssetCount,
    papers: 0,
    paperQuestions: 0,
    paperAssets: 0,
    courses: 0,
    knowledgePoints: 0,
    tags: 0,
    classes: 0,
    exams: 0,
  };
  const domains = [
    ['courses', 'courses', fullArchiveCourseRows, 'courses'],
    ['knowledge_points', 'knowledge_points', fullArchiveKnowledgePointRows, 'knowledgePoints'],
    ['tags', 'tags', fullArchiveTagRows, 'tags'],
    ['classes', 'classes', fullArchiveClassRows, 'classes'],
    ['exams', 'exams', fullArchiveExamRows, 'exams'],
  ] as const;
  for (const [folder, name, loadRows, countKey] of domains) {
    const rows = await loadRows(ctx);
    counts[countKey] = rows.length;
    await writeRowsToArchive(writer, ctx, folder, name, rows, exportedAt);
  }
  return counts;
}

async function writeRowsToArchive(
  writer: StreamingZipWriter,
  ctx: ExportsContext,
  folder: string,
  name: string,
  rows: Array<Record<string, unknown>>,
  exportedAt: string,
) {
  await writer.addEntry(csvZipEntry(ctx, `${folder}/${name}.csv`, rows));
  await writer.addEntry(jsonZipEntry(ctx, `${folder}/${name}.json`, {
    schemaVersion: 1,
    exportedAt,
    count: rows.length,
    items: rows,
  }));
}

function archiveReadme(exportedAt: string, questionCount: number, paperCount: number) {
  return [
    '平台全量资源导出包',
    `导出时间：${exportedAt}`,
    `题目数量：${questionCount}`,
    `试卷数量：${paperCount}`,
    '',
    'question_bank/ 保存完整题库迁移文件。',
    'papers/ 下包含试卷清单，以及每张试卷的题目迁移目录。',
    'courses/、knowledge_points/、tags/、classes/、exams/ 保存基础资源清单。',
    '本导出包不包含用户密码、登录令牌或外部账号凭据。',
  ].join('\n');
}
