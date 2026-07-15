import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Check, DataAnalysis, Edit, Plus, Refresh, Search, User, View } from '@element-plus/icons-vue';
import { useResponsiveColumns } from '../../../composables/useResponsiveColumns';
import {
  bulkUpdateManagedExams,
  endManagedExam,
  getManagedExamResults,
  listExamClasses,
  listExamCourses,
  listExamPapers,
  listExamStudents,
  listManagedExams,
  publishManagedExam,
  removeManagedExam,
  unpublishManagedExam,
  updateManagedExam,
} from '../api';
import {
  examStatusOptions,
  statusDescription,
  statusLabel as getStatusLabel,
  statusTagType,
  statusTransitionOptions,
} from '../../../statusMeta';
import type {
  ExamPaperOption,
  ExamResultRow,
  ExamStudentOption,
  ManagedExam,
  NamedOption,
} from '../models';
import { useExamAnnouncements } from './useExamAnnouncements';
import { useExamEditor } from './useExamEditor';

type ExamFilter = { keyword: string; courseId: string; classId: string; sortBy: string; sortOrder: 'asc' | 'desc' };
type Pagination = { page: number; pageSize: number; total: number };
type SortChange = { prop?: string | null; order?: 'ascending' | 'descending' | null };
type BulkStatus = Parameters<typeof bulkUpdateManagedExams>[0]['status'];
type StatusOption = {
  label: string;
  value: string;
  type: 'info' | 'primary' | 'success' | 'warning' | 'danger';
  description: string;
};

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('记录格式无效');
  return value as Record<string, unknown>;
}

function managedExamFrom(value: unknown) {
  const row = recordValue(value);
  if (typeof row.id !== 'string') throw new Error('考试记录格式无效');
  return {
    ...row,
    name: typeof row.name === 'string' ? row.name : '',
  } as unknown as ManagedExam;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useExamManagementPage() {
const router = useRouter();
const route = useRoute();
const courses = ref<NamedOption[]>([]);
const classes = ref<NamedOption[]>([]);
const papers = ref<ExamPaperOption[]>([]);
const exams = ref<ManagedExam[]>([]);
const results = ref<ExamResultRow[]>([]);
const students = ref<ExamStudentOption[]>([]);
const selectedStudentId = ref('');
const selectedExam = ref<ManagedExam | null>(null);
const selectedExamRows = ref<ManagedExam[]>([]);
const bulkStatus = ref<BulkStatus | ''>('');
const examPreviewVisible = ref(false);
const rankingVisible = ref(false);
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const examFilter = reactive<ExamFilter>({
  keyword: '',
  courseId: '',
  classId: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
});
const examStatusTab = ref('running');
const examPagination = reactive<Pagination>({ page: 1, pageSize: 20, total: 0 });
const pageSizes = [20, 50, 100];
const statusOptions = examStatusOptions as StatusOption[];
const selectedExamIds = computed(() => selectedExamRows.value.map((row) => row.id));
const announcements = useExamAnnouncements({ exams, selectedExam, normalizeExam: managedExamFrom });
const { openAnnouncementReads } = announcements;
const editor = useExamEditor({
  courses,
  papers,
  selectedExam,
  examStatusTab,
  normalizeExam: managedExamFrom,
  reload: () => loadAll(),
});
const { alignExamEndTime, editExam, editingId, examFormVisible, form, resetForm, selectedPaper } = editor;
const selectedExamStatusDescription = computed(() =>
  selectedExam.value ? statusDescription('exam', selectedExam.value.status) : '',
);

async function loadAll() {
  const [coursePage, classPage, paperPage, examPage, studentList] = await Promise.all([
    listExamCourses(),
    listExamClasses(),
    listExamPapers(),
    listManagedExams({
        page: examPagination.page,
        pageSize: examPagination.pageSize,
        keyword: examFilter.keyword || undefined,
        courseId: examFilter.courseId || undefined,
        classId: examFilter.classId || undefined,
        status: examStatusTab.value,
        sortBy: examFilter.sortBy,
        sortOrder: examFilter.sortOrder,
      }),
    listExamStudents(),
  ]);
  courses.value = coursePage.items;
  classes.value = classPage.items;
  papers.value = paperPage.items;
  exams.value = examPage.items;
  examPagination.page = examPage.page;
  examPagination.pageSize = examPage.pageSize;
  examPagination.total = examPage.total;
  students.value = studentList;
  selectedStudentId.value = selectedStudentId.value || students.value[0]?.id || '';
  form.courseId = form.courseId || courses.value[0]?.id || '';
  form.paperId = form.paperId || papers.value[0]?.id || '';
  if (!editingId.value && selectedPaper.value && form.durationMinutes === 30) {
    form.durationMinutes = selectedPaper.value.durationMinutes || form.durationMinutes;
    alignExamEndTime();
  }

  const focusExamId = String(route.query.focusExamId || '');
  if (focusExamId) {
    const focusExam = exams.value.find((exam) => exam.id === focusExamId);
    if (focusExam) {
      previewExam(focusExam);
      ElMessage.info('已定位到相关考试');
    } else if (examPagination.pageSize < 100 || examFilter.keyword || examFilter.courseId || examFilter.classId || examStatusTab.value !== 'running') {
      Object.assign(examFilter, { keyword: '', courseId: '', classId: '', sortBy: 'createdAt', sortOrder: 'desc' });
      examStatusTab.value = 'running';
      Object.assign(examPagination, { page: 1, pageSize: 100 });
      await loadAll();
    }
  }
}

function loadFirstExamPage() {
  examPagination.page = 1;
  return loadAll();
}

function handleExamSortChange({ prop, order }: SortChange) {
  examFilter.sortBy = prop || 'createdAt';
  examFilter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  return loadFirstExamPage();
}

function handleExamSizeChange(size: number) {
  examPagination.pageSize = size;
  examPagination.page = 1;
  loadAll();
}

function handleExamCurrentChange(page: number) {
  examPagination.page = page;
  loadAll();
}

function previewExam(value: unknown) {
  const row = managedExamFrom(value);
  selectedExam.value = row;
  examPreviewVisible.value = true;
}

async function publish(value: unknown) {
  const row = managedExamFrom(value);
  try {
    const result = await publishManagedExam(row.id);
    ElMessage.success(`考试状态已更新为${statusLabel(result.status || 'scheduled')}`);
    await loadAll();
  } catch (error: unknown) {
    ElMessage.error(errorMessage(error, '发布失败'));
  }
}

async function unpublish(value: unknown) {
  const row = managedExamFrom(value);
  try {
    await unpublishManagedExam(row.id);
    ElMessage.success('已取消发布');
    await loadAll();
  } catch (error: unknown) {
    ElMessage.error(errorMessage(error, '取消发布失败'));
  }
}

async function saveStatusOnly() {
  if (!editingId.value) return;
  await changeStatus({ id: editingId.value }, form.status);
  examFormVisible.value = false;
  resetForm();
}

function handleSelectionChange(rows: ManagedExam[]) {
  selectedExamRows.value = rows;
}

async function changeStatus(value: unknown, status: string) {
  const row = managedExamFrom(value);
  try {
    if (status === 'archived') {
      await ElMessageBox.confirm(
        '归档后考试会从日常安排中收起，成绩和记录仍保留。需要重新维护时可恢复为草稿。',
        '归档考试',
        { type: 'warning', confirmButtonText: '归档', cancelButtonText: '取消' },
      );
    }
    if (status === 'ended') {
      await endExam(row);
      return;
    }
    await updateManagedExam(row.id, { status });
    ElMessage.success(`状态已更新为${statusLabel(status)}`);
    await loadAll();
  } catch (error: unknown) {
    if (error !== 'cancel') {
      ElMessage.error(errorMessage(error, '状态更新失败'));
    }
  }
}

async function endExam(value: unknown) {
  const row = managedExamFrom(value);
  await ElMessageBox.confirm(
    `确认立即结束考试“${row.name || ''}”？系统会提交所有进行中的答卷，并将考试结束时间更新为当前时间。`,
    '结束考试',
    { type: 'warning', confirmButtonText: '立即结束', cancelButtonText: '取消' },
  );
  const result = await endManagedExam(row.id);
  ElMessage.success(`考试已结束，已处理 ${result.finalizedAttemptCount || 0} 份进行中答卷`);
  await loadAll();
}

function handleExamCommand(value: unknown, command: string) {
  const row = managedExamFrom(value);
  const handlers: Record<string, () => void | Promise<void>> = {
    edit: () => editExam(row),
    trial: () => trial(row),
    ranking: () => openRanking(row),
    announcementReads: () => openAnnouncementReads(row),
    publish: () => publish(row),
    unpublish: () => unpublish(row),
    start: () => changeStatus(row, 'running'),
    end: () => changeStatus(row, 'ended'),
    simulate: () => simulate(row),
    delete: () => removeExam(row),
  };
  if (command?.startsWith('status:')) return changeStatus(row, command.slice('status:'.length));
  return handlers[command]?.();
}

async function bulkUpdateStatus() {
  if (!selectedExamIds.value.length || !bulkStatus.value) {
    ElMessage.warning('请选择考试和目标状态');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `确认将 ${selectedExamIds.value.length} 个考试批量设置为“${statusLabel(bulkStatus.value)}”？`,
      '批量更新考试状态',
      {
        type: 'warning',
        confirmButtonText: '批量更新',
        cancelButtonText: '取消',
      },
    );
    const result = await bulkUpdateManagedExams({ ids: selectedExamIds.value, status: bulkStatus.value });
    const failedText = result.failed?.length ? `，${result.failed.length} 个失败` : '';
    ElMessage.success(`已更新 ${result.successCount} 个考试${failedText}`);
    selectedExamRows.value = [];
    await loadAll();
  } catch (error: unknown) {
    if (error !== 'cancel') {
      ElMessage.error(errorMessage(error, '批量更新失败'));
    }
  }
}

async function removeExam(value: unknown) {
  const row = managedExamFrom(value);
  try {
    await ElMessageBox.confirm(`确认删除考试“${row.name}”？已有提交记录的考试不能删除。`, '删除考试', { type: 'warning' });
    await removeManagedExam(row.id);
    ElMessage.success('已删除');
    await loadAll();
  } catch (error: unknown) {
    if (error !== 'cancel') {
      ElMessage.error(errorMessage(error, '删除失败'));
    }
  }
}

function simulate(value: unknown) {
  const row = managedExamFrom(value);
  if (!selectedStudentId.value) {
    ElMessage.error('请先选择模拟学生');
    return;
  }
  router.push(`/student/exams/${row.id}?simulateStudentId=${selectedStudentId.value}`);
}

function trial(value: unknown) {
  const row = managedExamFrom(value);
  router.push(`/papers/${row.paperId}/answer?mode=trial&examId=${row.id}`);
}

async function loadResults(value: unknown) {
  const row = managedExamFrom(value);
  selectedExam.value = row;
  const data = await getManagedExamResults(row.id, { pageSize: 100 });
  results.value = data.items;
}

async function openRanking(value: unknown = selectedExam.value || exams.value[0]) {
  if (!value) {
    ElMessage.warning('请先选择考试');
    return;
  }
  const row = managedExamFrom(value);
  await loadResults(row);
  rankingVisible.value = true;
}

function statusLabel(value: string) {
  return getStatusLabel('exam', value);
}

function statusType(value: string) {
  return statusTagType('exam', value);
}

function attemptStatusLabel(value: string) {
  return getStatusLabel('attempt', value);
}

function attemptStatusType(value: string) {
  return statusTagType('attempt', value);
}

function examStatusTargets(value: unknown) {
  const row = recordValue(value);
  return statusTransitionOptions('exam', typeof row.status === 'string' ? row.status : undefined);
}

function examStatusActionText(currentStatus: string, targetStatus: string) {
  const key = `${currentStatus}->${targetStatus}`;
  const map: Record<string, string> = {
    'draft->scheduled': '安排考试',
    'draft->running': '直接开始',
    'draft->archived': '归档考试',
    'scheduled->draft': '转回草稿',
    'scheduled->running': '开始考试',
    'scheduled->ended': '结束考试',
    'scheduled->archived': '归档考试',
    'running->ended': '结束考试',
    'ended->running': '重新启动考试',
    'ended->archived': '归档考试',
    'archived->draft': '恢复草稿',
  };
  return map[key] ?? `设为${statusLabel(targetStatus)}`;
}

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

onMounted(loadAll);

return {
  Check,
  DataAnalysis,
  Edit,
  Plus,
  Refresh,
  Search,
  User,
  View,
  ...announcements,
  ...editor,
  attemptStatusLabel,
  attemptStatusType,
  bulkStatus,
  bulkUpdateStatus,
  changeStatus,
  classes,
  courses,
  examFilter,
  examPagination,
  examPreviewVisible,
  examStatusActionText,
  examStatusTab,
  examStatusTargets,
  exams,
  formatDateTime,
  handleExamCommand,
  handleExamCurrentChange,
  handleExamSizeChange,
  handleExamSortChange,
  handleSelectionChange,
  loadAll,
  loadFirstExamPage,
  openRanking,
  pageSizes,
  papers,
  previewExam,
  rankingVisible,
  results,
  saveStatusOnly,
  selectedExam,
  selectedExamIds,
  selectedExamRows,
  selectedExamStatusDescription,
  selectedStudentId,
  showLowColumns,
  showMediumColumns,
  simulate,
  statusLabel,
  statusOptions,
  statusType,
  students,
  trial,
};
}
