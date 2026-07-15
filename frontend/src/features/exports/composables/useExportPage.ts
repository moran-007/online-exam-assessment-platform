import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Delete, Download, Refresh, Search } from '@element-plus/icons-vue';
import { getCurrentUser } from '../../../api';
import { useResponsiveColumns } from '../../../composables/useResponsiveColumns';
import { useExportTaskPolling } from '../composables/useExportTaskPolling';
import {
  cancelExportTask,
  cancelExportTasks,
  cleanupExpiredExportTasks,
  createExportTask,
  downloadExportTask,
  listExportClasses,
  listExportCourses,
  listExportDownloadAudits,
  listExportExams,
  listExportPapers,
  listExportTasks,
  retryExportTask,
  retryExportTasks,
} from '../api';
import {
  examStatusOptions,
  paperStatusOptions,
  statusLabel as entityStatusLabel,
  statusTagType as entityStatusTagType,
} from '../../../statusMeta';
import type {
  ClassOption,
  CourseOption,
  ExamSummary,
  ExportAuditUser,
  ExportDownloadAudit,
  ExportPermissionSnapshot,
  ExportTask,
  PaperSummary,
} from '../models';

type CurrentUser = { userType?: string | null };
type PaperFilter = { keyword: string; courseId: string; status: string; sortBy: string; sortOrder: 'asc' | 'desc' };
type ExamFilter = PaperFilter & { classId: string };
type TaskFilter = { type: string; status: string; scope: 'mine' | 'all' };
type Pagination = { page: number; pageSize: number; total: number };
type SortChange = { prop?: string | null; order?: 'ascending' | 'descending' | null };
type ExportCreatePayload = Parameters<typeof createExportTask>[0];
type PaperExportConfig = Omit<ExportCreatePayload, 'type' | 'paperId'>;

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('记录格式无效');
  return value as Record<string, unknown>;
}

function entityId(value: unknown) {
  const id = recordValue(value).id;
  if (typeof id !== 'string' || !id) throw new Error('记录缺少 ID');
  return id;
}

function taskFrom(value: unknown): ExportTask {
  const row = recordValue(value);
  if (typeof row.id !== 'string' || typeof row.type !== 'string' || typeof row.status !== 'string') {
    throw new Error('导出任务格式无效');
  }
  return row as ExportTask;
}

export function useExportPage() {
const exportTypes = [
  { label: '考试成绩', value: 'exam_results' },
  { label: '批改记录', value: 'grading' },
  { label: '题库', value: 'question_bank' },
  { label: '试卷库', value: 'papers' },
  { label: '试卷文档', value: 'paper_document' },
  { label: '错题导出', value: 'wrong_questions' },
  { label: '班级', value: 'classes' },
  { label: '统计分析', value: 'statistics' },
  { label: '全量资源包', value: 'full_archive' },
];

const activeTab = ref('papers');
const courses = ref<CourseOption[]>([]);
const classes = ref<ClassOption[]>([]);
const papers = ref<PaperSummary[]>([]);
const exams = ref<ExamSummary[]>([]);
const tasks = ref<ExportTask[]>([]);
const selectedTasks = ref<ExportTask[]>([]);
const auditLogs = ref<ExportDownloadAudit[]>([]);
const exporting = ref(false);
const auditVisible = ref(false);
const auditLoading = ref(false);
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const currentUser = getCurrentUser() as CurrentUser | null;
const canManageGlobalTasks = ['SUPER_ADMIN', 'ADMIN'].includes(currentUser?.userType ?? '');
const canExportFullArchive = currentUser?.userType === 'SUPER_ADMIN';
const paperFilter = reactive<PaperFilter>({ keyword: '', courseId: '', status: '', sortBy: 'createdAt', sortOrder: 'desc' });
const examFilter = reactive<ExamFilter>({ keyword: '', courseId: '', classId: '', status: '', sortBy: 'startTime', sortOrder: 'desc' });
const taskFilter = reactive<TaskFilter>({ type: '', status: '', scope: 'mine' });
const taskPagination = reactive<Pagination>({ page: 1, pageSize: 20, total: 0 });
const auditPagination = reactive<Pagination>({ page: 1, pageSize: 20, total: 0 });
const selectedTaskIds = computed(() => selectedTasks.value.filter(canCancel).map((task) => task.id));
const selectedRetryTaskIds = computed(() => selectedTasks.value.filter(canRetry).map((task) => task.id));
const { schedule: scheduleTaskPolling } = useExportTaskPolling(tasks, loadTasks);

async function loadBase() {
  const [coursePage, classPage] = await Promise.all([
    listExportCourses(),
    listExportClasses(),
  ]);
  courses.value = coursePage.items;
  classes.value = classPage.items;
}

async function loadPapers() {
  const data = await listExportPapers({
      pageSize: 100,
      keyword: paperFilter.keyword || undefined,
      courseId: paperFilter.courseId || undefined,
      status: paperFilter.status || undefined,
      sortBy: paperFilter.sortBy,
      sortOrder: paperFilter.sortOrder,
    });
  papers.value = data.items;
}

async function loadExams() {
  const data = await listExportExams({
      pageSize: 100,
      keyword: examFilter.keyword || undefined,
      courseId: examFilter.courseId || undefined,
      classId: examFilter.classId || undefined,
      status: examFilter.status || undefined,
      sortBy: examFilter.sortBy,
      sortOrder: examFilter.sortOrder,
    });
  exams.value = data.items;
}

async function loadTasks() {
  if (!canManageGlobalTasks && taskFilter.scope === 'all') {
    taskFilter.scope = 'mine';
  }
  const data = await listExportTasks({
      page: taskPagination.page,
      pageSize: taskPagination.pageSize,
      type: taskFilter.type || undefined,
      status: taskFilter.status || undefined,
      scope: taskFilter.scope,
    });
  tasks.value = data.items;
  taskPagination.page = data.page;
  taskPagination.pageSize = data.pageSize;
  taskPagination.total = data.total;
  scheduleTaskPolling();
}

async function loadAll() {
  await Promise.all([loadBase(), loadPapers(), loadExams(), loadTasks()]);
}

async function exportPaper(row: unknown, command: string) {
  const configs: Record<string, PaperExportConfig> = {
    'student-pdf': { format: 'pdf', template: 'student', includeAnswers: false, includeAnalysis: false },
    'teacher-pdf': { format: 'pdf', template: 'teacher', includeAnswers: true, includeAnalysis: true },
    'answer-book-pdf': { format: 'pdf', template: 'answer_book', includeAnswers: true, includeAnalysis: true },
    'teacher-docx': { format: 'docx', template: 'teacher', includeAnswers: true, includeAnalysis: true },
    'answer-book-docx': { format: 'docx', template: 'answer_book', includeAnswers: true, includeAnalysis: true },
    'transfer-csv': { format: 'csv', includeAnswers: true, includeAnalysis: true },
    'transfer-xlsx': { format: 'xlsx', includeAnswers: true, includeAnalysis: true },
    'transfer-json': { format: 'json', includeAnswers: true, includeAnalysis: true },
    'transfer-zip': { format: 'zip', includeAnswers: true, includeAnalysis: true },
  };
  const config = configs[command];
  if (!config) return;
  await directExport({
    type: 'paper_document',
    paperId: entityId(row),
    ...config,
  });
}

async function exportExam(row: unknown, command: string) {
  const exam = recordValue(row) as ExamSummary;
  const paperId = exam.paperId ?? undefined;
  const configs: Record<string, ExportCreatePayload> = {
    'results-csv': { type: 'exam_results', format: 'csv', examId: entityId(row) },
    'results-xlsx': { type: 'exam_results', format: 'xlsx', examId: entityId(row) },
    'grading-csv': { type: 'grading', format: 'csv', examId: entityId(row) },
    'paper-pdf': { type: 'paper_document', format: 'pdf', template: 'student', paperId, includeAnswers: false, includeAnalysis: false },
    'paper-teacher-pdf': { type: 'paper_document', format: 'pdf', template: 'teacher', paperId, includeAnswers: true, includeAnalysis: true },
    'paper-answer-book-pdf': { type: 'paper_document', format: 'pdf', template: 'answer_book', paperId, includeAnswers: true, includeAnalysis: true },
    'paper-transfer-csv': { type: 'paper_document', format: 'csv', paperId, includeAnswers: true, includeAnalysis: true },
    'paper-transfer-json': { type: 'paper_document', format: 'json', paperId, includeAnswers: true, includeAnalysis: true },
    'paper-transfer-zip': { type: 'paper_document', format: 'zip', paperId, includeAnswers: true, includeAnalysis: true },
  };
  const config = configs[command];
  if (!config) return;
  if (config.type === 'paper_document' && !config.paperId) {
    ElMessage.error('该考试未关联试卷，无法导出试卷内容');
    return;
  }
  await directExport(config);
}

async function directExport(payload: ExportCreatePayload) {
  if (exporting.value) return;
  exporting.value = true;
  try {
    await createExportTask(payload);
    ElMessage.success('导出任务已加入队列，可在导出记录查看进度');
    taskPagination.page = 1;
    await loadTasks();
  } catch (error: unknown) {
    ElMessage.error(error instanceof Error ? error.message : '导出失败');
  } finally {
    exporting.value = false;
  }
}

async function exportFullArchive() {
  await directExport({
    type: 'full_archive',
    format: 'zip',
    includeAnswers: true,
    includeAnalysis: true,
  });
}

async function retryTask(row: unknown) {
  await retryExportTask(taskFrom(row).id);
  ElMessage.success('已重新加入导出队列');
  await loadTasks();
}

async function retrySelectedTasks() {
  if (!selectedRetryTaskIds.value.length) {
    ElMessage.warning('请选择失败、过期或已取消任务');
    return;
  }
  const result = await retryExportTasks(selectedRetryTaskIds.value);
  const failedText = result.failed?.length ? `，${result.failed.length} 个失败` : '';
  ElMessage.success(`已重试 ${result.successCount} 个任务${failedText}`);
  selectedTasks.value = [];
  await loadTasks();
}

async function cancelTask(row: unknown) {
  await cancelExportTask(taskFrom(row).id);
  ElMessage.success('已取消导出任务');
  await loadTasks();
}

async function cancelSelectedTasks() {
  if (!selectedTaskIds.value.length) {
    ElMessage.warning('请选择等待中或处理中任务');
    return;
  }
  const result = await cancelExportTasks(selectedTaskIds.value);
  const failedText = result.failed?.length ? `，${result.failed.length} 个失败` : '';
  ElMessage.success(`已取消 ${result.successCount} 个任务${failedText}`);
  selectedTasks.value = [];
  await loadTasks();
}

async function cleanupExpired() {
  const result = await cleanupExpiredExportTasks();
  ElMessage.success(`已清理 ${result.cleaned || 0} 个过期导出任务`);
  await loadTasks();
}

async function downloadTask(row: unknown) {
  const task = taskFrom(row);
  const data = await downloadExportTask(task.id);
  const objectUrl = URL.createObjectURL(data.blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = downloadFilename(data.contentDisposition) || `export-${task.id}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function downloadFilename(contentDisposition: string) {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition || '')?.[1];
  if (!encoded) return '';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

async function openDownloadAudits() {
  auditVisible.value = true;
  auditPagination.page = 1;
  await loadDownloadAudits();
}

async function loadDownloadAudits() {
  if (!auditVisible.value) return;
  auditLoading.value = true;
  try {
    const data = await listExportDownloadAudits({
        page: auditPagination.page,
        pageSize: auditPagination.pageSize,
      });
    auditLogs.value = data.items;
    auditPagination.page = data.page;
    auditPagination.pageSize = data.pageSize;
    auditPagination.total = data.total;
  } finally {
    auditLoading.value = false;
  }
}

function handleTaskSelectionChange(rows: ExportTask[]) {
  selectedTasks.value = rows;
}

function canCancel(row: unknown) {
  const status = recordValue(row).status;
  return typeof status === 'string' && ['pending', 'processing'].includes(status);
}

function canRetry(row: unknown) {
  const status = recordValue(row).status;
  return typeof status === 'string' && ['failed', 'expired', 'canceled'].includes(status);
}

function canSelectTaskAction(row: unknown) {
  return canCancel(row) || canRetry(row);
}

function handlePaperSortChange({ prop, order }: SortChange) {
  paperFilter.sortBy = prop || 'createdAt';
  paperFilter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  loadPapers();
}

function handleExamSortChange({ prop, order }: SortChange) {
  examFilter.sortBy = prop || 'startTime';
  examFilter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  loadExams();
}

function handleTaskSize(size: number) {
  taskPagination.pageSize = size;
  taskPagination.page = 1;
  loadTasks();
}

function handleTaskCurrent(page: number) {
  taskPagination.page = page;
  loadTasks();
}

function handleAuditSize(size: number) {
  auditPagination.pageSize = size;
  auditPagination.page = 1;
  loadDownloadAudits();
}

function handleAuditCurrent(page: number) {
  auditPagination.page = page;
  loadDownloadAudits();
}

function typeLabel(type: string) {
  return exportTypes.find((item) => item.value === type)?.label ?? type;
}

function statusLabel(status: string) {
  const map: Record<string, string> = { success: '成功', failed: '失败', processing: '处理中', pending: '等待中', expired: '已过期', canceled: '已取消' };
  return map[status] ?? status;
}

function paperStatusLabel(value: string) {
  return entityStatusLabel('paper', value);
}

function paperStatusType(value: string) {
  return entityStatusTagType('paper', value);
}

function examStatusLabel(value: string) {
  return entityStatusLabel('exam', value);
}

function examStatusType(value: string) {
  return entityStatusTagType('exam', value);
}

function formatDate(value?: string | Date | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

function auditUserLabel(user?: ExportAuditUser | null) {
  if (!user) return '-';
  return `${user.realName || user.username || user.id}（${user.userType || '-'}）`;
}

function snapshotLabel(snapshot?: ExportPermissionSnapshot | null) {
  if (!snapshot) return '-';
  const userType = snapshot.userType || '-';
  const capturedAt = snapshot.capturedAt ? formatDate(snapshot.capturedAt) : '-';
  return `${userType} / ${capturedAt}`;
}

onMounted(loadAll);

return {
  Delete,
  Download,
  Refresh,
  Search,
  activeTab,
  auditLoading,
  auditLogs,
  auditPagination,
  auditUserLabel,
  auditVisible,
  canCancel,
  canExportFullArchive,
  canManageGlobalTasks,
  canRetry,
  canSelectTaskAction,
  cancelSelectedTasks,
  cancelTask,
  classes,
  cleanupExpired,
  courses,
  directExport,
  downloadFilename,
  downloadTask,
  entityStatusLabel,
  entityStatusTagType,
  examFilter,
  examStatusLabel,
  examStatusOptions,
  examStatusType,
  exams,
  exportExam,
  exportFullArchive,
  exportPaper,
  exportTypes,
  exporting,
  formatDate,
  handleAuditCurrent,
  handleAuditSize,
  handleExamSortChange,
  handlePaperSortChange,
  handleTaskCurrent,
  handleTaskSelectionChange,
  handleTaskSize,
  loadAll,
  loadExams,
  loadPapers,
  loadTasks,
  openDownloadAudits,
  paperFilter,
  paperStatusLabel,
  paperStatusOptions,
  paperStatusType,
  papers,
  retrySelectedTasks,
  retryTask,
  selectedRetryTaskIds,
  selectedTaskIds,
  selectedTasks,
  showLowColumns,
  showMediumColumns,
  snapshotLabel,
  statusLabel,
  taskFilter,
  taskPagination,
  tasks,
  typeLabel,
};
}
