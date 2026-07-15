export type ExportTaskStatus = 'pending' | 'processing' | 'success' | 'failed' | 'canceled' | 'expired';

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type CourseOption = { id: string; name: string };
export type ClassOption = { id: string; name: string };

export type PaperSummary = {
  id: string;
  name: string;
  courseName?: string | null;
  questionCount?: number | null;
  totalScore?: number | null;
  durationMinutes?: number | null;
  status: string;
  createdAt?: string | null;
};

export type ExamSummary = {
  id: string;
  name: string;
  paperId?: string | null;
  paperName?: string | null;
  courseName?: string | null;
  className?: string | null;
  attemptCount?: number | null;
  status: string;
  startTime?: string | null;
};

export type ExportTask = {
  id: string;
  type: string;
  status: ExportTaskStatus;
  progress?: number | null;
  retryCount?: number | null;
  createdAt?: string | null;
  finishedAt?: string | null;
  errorMessage?: string | null;
};

export type ExportBatchResult = {
  successCount: number;
  failed?: Array<{ id?: string; message?: string }>;
};

export type ExportCleanupResult = { cleaned?: number };

export type ExportAuditUser = {
  id: string;
  username?: string | null;
  realName?: string | null;
  userType?: string | null;
};

export type ExportPermissionSnapshot = {
  userType?: string | null;
  capturedAt?: string | null;
};

export type ExportDownloadAudit = {
  id: string;
  downloadedAt?: string | null;
  downloadedBy?: ExportAuditUser | null;
  type: string;
  taskStatus: string;
  permissionSnapshot?: ExportPermissionSnapshot | null;
  fileUrl?: string | null;
};
