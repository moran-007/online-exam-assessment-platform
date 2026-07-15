/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- migrated page state is isolated here while domain models are typed incrementally.
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

export function useExportPage(): any {
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
const courses = ref([]);
const classes = ref([]);
const papers = ref([]);
const exams = ref([]);
const tasks = ref([]);
const selectedTasks = ref([]);
const auditLogs = ref([]);
const exporting = ref(false);
const auditVisible = ref(false);
const auditLoading = ref(false);
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const currentUser = getCurrentUser();
const canManageGlobalTasks = ['SUPER_ADMIN', 'ADMIN'].includes(currentUser?.userType);
const canExportFullArchive = currentUser?.userType === 'SUPER_ADMIN';
const paperFilter = reactive({ keyword: '', courseId: '', status: '', sortBy: 'createdAt', sortOrder: 'desc' });
const examFilter = reactive({ keyword: '', courseId: '', classId: '', status: '', sortBy: 'startTime', sortOrder: 'desc' });
const taskFilter = reactive({ type: '', status: '', scope: 'mine' });
const taskPagination = reactive({ page: 1, pageSize: 20, total: 0 });
const auditPagination = reactive({ page: 1, pageSize: 20, total: 0 });
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

async function exportPaper(row, command) {
  const configs = {
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
    paperId: row.id,
    ...config,
  });
}

async function exportExam(row, command) {
  const configs = {
    'results-csv': { type: 'exam_results', format: 'csv', examId: row.id },
    'results-xlsx': { type: 'exam_results', format: 'xlsx', examId: row.id },
    'grading-csv': { type: 'grading', format: 'csv', examId: row.id },
    'paper-pdf': { type: 'paper_document', format: 'pdf', template: 'student', paperId: row.paperId, includeAnswers: false, includeAnalysis: false },
    'paper-teacher-pdf': { type: 'paper_document', format: 'pdf', template: 'teacher', paperId: row.paperId, includeAnswers: true, includeAnalysis: true },
    'paper-answer-book-pdf': { type: 'paper_document', format: 'pdf', template: 'answer_book', paperId: row.paperId, includeAnswers: true, includeAnalysis: true },
    'paper-transfer-csv': { type: 'paper_document', format: 'csv', paperId: row.paperId, includeAnswers: true, includeAnalysis: true },
    'paper-transfer-json': { type: 'paper_document', format: 'json', paperId: row.paperId, includeAnswers: true, includeAnalysis: true },
    'paper-transfer-zip': { type: 'paper_document', format: 'zip', paperId: row.paperId, includeAnswers: true, includeAnalysis: true },
  };
  const config = configs[command];
  if (!config) return;
  if (config.type === 'paper_document' && !config.paperId) {
    ElMessage.error('该考试未关联试卷，无法导出试卷内容');
    return;
  }
  await directExport(config);
}

async function directExport(payload) {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const body = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== ''));
    await createExportTask(body);
    ElMessage.success('导出任务已加入队列，可在导出记录查看进度');
    taskPagination.page = 1;
    await loadTasks();
  } catch (error) {
    ElMessage.error(error.message || '导出失败');
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

async function retryTask(row) {
  await retryExportTask(row.id);
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

async function cancelTask(row) {
  await cancelExportTask(row.id);
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

async function downloadTask(row) {
  const data = await downloadExportTask(row.id);
  const objectUrl = URL.createObjectURL(data.blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = downloadFilename(data.contentDisposition) || `export-${row.id}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function downloadFilename(contentDisposition) {
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

function handleTaskSelectionChange(rows) {
  selectedTasks.value = rows;
}

function canCancel(row) {
  return ['pending', 'processing'].includes(row.status);
}

function canRetry(row) {
  return ['failed', 'expired', 'canceled'].includes(row.status);
}

function canSelectTaskAction(row) {
  return canCancel(row) || canRetry(row);
}

function handlePaperSortChange({ prop, order }) {
  paperFilter.sortBy = prop || 'createdAt';
  paperFilter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  loadPapers();
}

function handleExamSortChange({ prop, order }) {
  examFilter.sortBy = prop || 'startTime';
  examFilter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  loadExams();
}

function handleTaskSize(size) {
  taskPagination.pageSize = size;
  taskPagination.page = 1;
  loadTasks();
}

function handleTaskCurrent(page) {
  taskPagination.page = page;
  loadTasks();
}

function handleAuditSize(size) {
  auditPagination.pageSize = size;
  auditPagination.page = 1;
  loadDownloadAudits();
}

function handleAuditCurrent(page) {
  auditPagination.page = page;
  loadDownloadAudits();
}

function typeLabel(type) {
  return exportTypes.find((item) => item.value === type)?.label ?? type;
}

function statusLabel(status) {
  const map = { success: '成功', failed: '失败', processing: '处理中', pending: '等待中', expired: '已过期', canceled: '已取消' };
  return map[status] ?? status;
}

function paperStatusLabel(value) {
  return entityStatusLabel('paper', value);
}

function paperStatusType(value) {
  return entityStatusTagType('paper', value);
}

function examStatusLabel(value) {
  return entityStatusLabel('exam', value);
}

function examStatusType(value) {
  return entityStatusTagType('exam', value);
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

function auditUserLabel(user) {
  if (!user) return '-';
  return `${user.realName || user.username || user.id}（${user.userType || '-'}）`;
}

function snapshotLabel(snapshot) {
  if (!snapshot) return '-';
  const userType = snapshot.userType || '-';
  const capturedAt = snapshot.capturedAt ? formatDate(snapshot.capturedAt) : '-';
  return `${userType} / ${capturedAt}`;
}

onMounted(loadAll);

return {
  Delete,
  Download,
  ElMessage,
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
  cancelExportTask,
  cancelExportTasks,
  cancelSelectedTasks,
  cancelTask,
  classes,
  cleanupExpired,
  cleanupExpiredExportTasks,
  computed,
  courses,
  createExportTask,
  currentUser,
  directExport,
  downloadExportTask,
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
  getCurrentUser,
  handleAuditCurrent,
  handleAuditSize,
  handleExamSortChange,
  handlePaperSortChange,
  handleTaskCurrent,
  handleTaskSelectionChange,
  handleTaskSize,
  listExportClasses,
  listExportCourses,
  listExportDownloadAudits,
  listExportExams,
  listExportPapers,
  listExportTasks,
  loadAll,
  loadBase,
  loadDownloadAudits,
  loadExams,
  loadPapers,
  loadTasks,
  onMounted,
  openDownloadAudits,
  paperFilter,
  paperStatusLabel,
  paperStatusOptions,
  paperStatusType,
  papers,
  reactive,
  ref,
  retryExportTask,
  retryExportTasks,
  retrySelectedTasks,
  retryTask,
  scheduleTaskPolling,
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
  useExportTaskPolling,
  useResponsiveColumns,
};
}
