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
import type { ExportPage, ExportRecord } from '../models';

export const listExportTasks = (params: Parameters<typeof exportsList>[0]) =>
  generatedData(asGenerated<ExportPage>(exportsList(params)));
export const listExportCourses = () => generatedData(asGenerated<ExportPage>(
  coursesList({ pageSize: 100 } as Parameters<typeof coursesList>[0]),
));
export const listExportClasses = () => generatedData(asGenerated<ExportPage>(
  classesList({ pageSize: 100 } as Parameters<typeof classesList>[0]),
));
export const listExportPapers = (params: Parameters<typeof papersList>[0]) =>
  generatedData(asGenerated<ExportPage>(papersList(params)));
export const listExportExams = (params: Parameters<typeof examsList>[0]) =>
  generatedData(asGenerated<ExportPage>(examsList(params)));
export const createExportTask = (body: Parameters<typeof exportsCreate>[0]) =>
  generatedData(asGenerated<ExportRecord>(exportsCreate(body)));
export const createWrongQuestionExportTask = (body: Parameters<typeof exportsCreateWrongQuestionExport>[0]) =>
  generatedData(asGenerated<ExportRecord>(exportsCreateWrongQuestionExport(body)));
export const retryExportTask = (id: string) => generatedData(asGenerated<ExportRecord>(exportsRetry(id)));
export const retryExportTasks = (ids: string[]) =>
  generatedData(asGenerated<ExportRecord>(exportsRetryMany({ ids })));
export const cancelExportTask = (id: string) => generatedData(asGenerated<ExportRecord>(exportsCancel(id)));
export const cancelExportTasks = (ids: string[]) =>
  generatedData(asGenerated<ExportRecord>(exportsCancelMany({ ids })));
export const cleanupExpiredExportTasks = () => generatedData(asGenerated<ExportRecord>(exportsCleanupExpired()));
export const downloadExportTask = async (id: string) => {
  const response = await exportsDownload(id) as unknown as { data: Blob; headers: Headers };
  return {
    blob: response.data,
    contentDisposition: response.headers.get('Content-Disposition') || '',
  };
};
export const listExportDownloadAudits = (params: Parameters<typeof exportsDownloadAudits>[0]) =>
  generatedData(asGenerated<ExportPage>(exportsDownloadAudits(params)));
