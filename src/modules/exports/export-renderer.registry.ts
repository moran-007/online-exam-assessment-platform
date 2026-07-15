import { BadRequestException } from '@nestjs/common';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { CreateExportDto } from './dto/create-export.dto';
import { ExportsContext } from './exports.context';
import { writeQuestionPackageExport } from './export-archive.operations';
import {
  classRows,
  examRows,
  gradingRows,
  paperDocumentContent,
  paperDocumentRows,
  paperRows,
  questionDocumentContent,
  questionRows,
  wrongQuestionDocumentContent,
  wrongQuestionRows,
} from './export-dataset.operations';
import { writeDocumentExport, writeFullArchiveExport } from './export-document.operations';
import { ExportFormat, ExportRenderer, ExportRenderJob } from './export-renderer.interface';
import { writePaperDocumentPackageExport } from './export-package.operations';
import { statisticsRows } from './export-statistics.operations';
import { writeTableExportFile } from './export-zip.operations';

async function loadRows(ctx: ExportsContext, dto: CreateExportDto, user: RequestUser) {
  if (dto.type === 'exam_results') return examRows(ctx, dto, user);
  if (dto.type === 'grading') return gradingRows(ctx, dto, user);
  if (dto.type === 'question_bank') return questionRows(ctx, dto);
  if (dto.type === 'papers') return paperRows(ctx, dto);
  if (dto.type === 'paper_document') return paperDocumentRows(ctx, dto);
  if (dto.type === 'wrong_questions') return wrongQuestionRows(ctx, dto, user.id);
  if (dto.type === 'classes') return classRows(ctx, dto, user);
  if (dto.type === 'statistics') return statisticsRows(ctx, dto, user);
  throw new BadRequestException('不支持的导出类型');
}

class TableExportRenderer implements ExportRenderer {
  readonly formats = ['csv', 'xlsx', 'json'] as const;

  async render(ctx: ExportsContext, { taskId, dto, user }: ExportRenderJob) {
    const format = dto.format as ExportFormat;
    if (dto.type === 'paper_document') {
      return writeDocumentExport(ctx, taskId, dto.type, format, await paperDocumentContent(ctx, dto));
    }
    if (dto.type === 'wrong_questions') {
      return writeDocumentExport(ctx, taskId, dto.type, format, await wrongQuestionDocumentContent(ctx, dto, user.id));
    }
    return writeTableExportFile(ctx, taskId, dto.type, format, await loadRows(ctx, dto, user));
  }
}

class DocumentExportRenderer implements ExportRenderer {
  readonly formats = ['pdf', 'docx'] as const;

  async render(ctx: ExportsContext, { taskId, dto, user }: ExportRenderJob) {
    const format = dto.format as ExportFormat;
    if (dto.type === 'question_bank') {
      return writeDocumentExport(ctx, taskId, dto.type, format, await questionDocumentContent(ctx, dto));
    }
    if (dto.type === 'paper_document') {
      return writeDocumentExport(ctx, taskId, dto.type, format, await paperDocumentContent(ctx, dto));
    }
    if (dto.type === 'wrong_questions') {
      return writeDocumentExport(ctx, taskId, dto.type, format, await wrongQuestionDocumentContent(ctx, dto, user.id));
    }
    throw new BadRequestException('PDF/Word 仅支持题库、试卷文档或错题导出');
  }
}

class ZipExportRenderer implements ExportRenderer {
  readonly formats = ['zip'] as const;

  async render(ctx: ExportsContext, { taskId, dto, user }: ExportRenderJob) {
    if (dto.type === 'full_archive') return writeFullArchiveExport(ctx, taskId, dto, user);
    if (dto.type === 'paper_document') return writePaperDocumentPackageExport(ctx, taskId, dto);
    if (dto.type === 'question_bank') return writeQuestionPackageExport(ctx, taskId, dto);
    throw new BadRequestException('ZIP 仅支持全量归档、题库或试卷文档导出');
  }
}

const renderers: readonly ExportRenderer[] = [
  new TableExportRenderer(),
  new DocumentExportRenderer(),
  new ZipExportRenderer(),
];

export async function renderExportFile(
  ctx: ExportsContext,
  taskId: string,
  dto: CreateExportDto,
  format: string,
  user: RequestUser,
) {
  const renderer = renderers.find((candidate) => candidate.formats.includes(format as never));
  if (!renderer) throw new BadRequestException(`不支持的导出格式：${format}`);
  return renderer.render(ctx, { taskId, dto: { ...dto, format }, user });
}
