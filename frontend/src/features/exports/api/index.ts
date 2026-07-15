import {
  exportsCancel,
  exportsCancelMany,
  exportsCleanupExpired,
  exportsCreate,
  exportsCreateWrongQuestionExport,
  exportsDownload,
  exportsDownloadAudits,
  exportsList,
  exportsRetry,
  exportsRetryMany,
} from '../../../api/generated/exports/exports';
import { classesList } from '../../../api/generated/classes/classes';
import { coursesList } from '../../../api/generated/course/course';
import { examsList } from '../../../api/generated/exam/exam';
import { papersList } from '../../../api/generated/paper/paper';
import { asGenerated, generatedData } from '../../../api/generated-data';
import type {
  ClassOption,
  CourseOption,
  ExamSummary,
  ExportBatchResult,
  ExportCleanupResult,
  ExportDownloadAudit,
  ExportTask,
  PageResult,
  PaperSummary,
} from '../models';

export const listExportTasks = (params: Parameters<typeof exportsList>[0]) =>
  generatedData(asGenerated<PageResult<ExportTask>>(exportsList(params)));
export const listExportCourses = () => generatedData(asGenerated<PageResult<CourseOption>>(
  coursesList({ pageSize: 100 } as Parameters<typeof coursesList>[0]),
));
export const listExportClasses = () => generatedData(asGenerated<PageResult<ClassOption>>(
  classesList({ pageSize: 100 } as Parameters<typeof classesList>[0]),
));
export const listExportPapers = (params: Parameters<typeof papersList>[0]) =>
  generatedData(asGenerated<PageResult<PaperSummary>>(papersList(params)));
export const listExportExams = (params: Parameters<typeof examsList>[0]) =>
  generatedData(asGenerated<PageResult<ExamSummary>>(examsList(params)));
export const createExportTask = (body: Parameters<typeof exportsCreate>[0]) =>
  generatedData(asGenerated<ExportTask>(exportsCreate(body)));
export const createWrongQuestionExportTask = (body: Parameters<typeof exportsCreateWrongQuestionExport>[0]) =>
  generatedData(asGenerated<ExportTask>(exportsCreateWrongQuestionExport(body)));
export const retryExportTask = (id: string) => generatedData(asGenerated<ExportTask>(exportsRetry(id)));
export const retryExportTasks = (ids: string[]) =>
  generatedData(asGenerated<ExportBatchResult>(exportsRetryMany({ ids })));
export const cancelExportTask = (id: string) => generatedData(asGenerated<ExportTask>(exportsCancel(id)));
export const cancelExportTasks = (ids: string[]) =>
  generatedData(asGenerated<ExportBatchResult>(exportsCancelMany({ ids })));
export const cleanupExpiredExportTasks = () => generatedData(asGenerated<ExportCleanupResult>(exportsCleanupExpired()));
export const downloadExportTask = async (id: string) => {
  const response = await exportsDownload(id) as unknown as { data: Blob; headers: Headers };
  return {
    blob: response.data,
    contentDisposition: response.headers.get('Content-Disposition') || '',
  };
};
export const listExportDownloadAudits = (params: Parameters<typeof exportsDownloadAudits>[0]) =>
  generatedData(asGenerated<PageResult<ExportDownloadAudit>>(exportsDownloadAudits(params)));
