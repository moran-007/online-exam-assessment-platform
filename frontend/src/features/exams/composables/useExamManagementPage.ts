/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- migrated page state is isolated here while domain models are typed incrementally.
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Check, DataAnalysis, Edit, Plus, Refresh, Search, User, View } from '@element-plus/icons-vue';
import { getCurrentUser } from '../../../api';
import { useResponsiveColumns } from '../../../composables/useResponsiveColumns';
import {
  bulkUpdateManagedExams,
  createManagedExam,
  endManagedExam,
  getAnnouncementReads,
  getManagedExamResults,
  listExamClasses,
  listExamCourses,
  listExamPapers,
  listExamStudents,
  listManagedExams,
  publishManagedExam,
  remindAnnouncementUnread,
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

export function useExamManagementPage(): any {
const router = useRouter();
const route = useRoute();
const courses = ref([]);
const classes = ref([]);
const papers = ref([]);
const exams = ref([]);
const results = ref([]);
const students = ref([]);
const selectedStudentId = ref('');
const selectedExam = ref(null);
const selectedExamRows = ref([]);
const bulkStatus = ref('');
const examFormVisible = ref(false);
const examPreviewVisible = ref(false);
const rankingVisible = ref(false);
const announcementReadsVisible = ref(false);
const announcementReadReport = ref(null);
const announcementReadsLoading = ref(false);
const announcementRemindLoading = ref(false);
const announcementUnreadOnly = ref(false);
const editingId = ref('');
const editingOriginalStatus = ref('');
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const examFilter = reactive({
  keyword: '',
  courseId: '',
  classId: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
});
const examStatusTab = ref('running');
const examPagination = reactive({ page: 1, pageSize: 20, total: 0 });
const pageSizes = [20, 50, 100];
const form = reactive(baseForm());
const currentUser = ref(getCurrentUser());
const statusOptions = examStatusOptions;
const canOverrideLockedExam = computed(() => ['SUPER_ADMIN', 'ADMIN'].includes(currentUser.value?.userType));
const canSaveCore = computed(() => canOverrideLockedExam.value || !['running', 'ended'].includes(editingOriginalStatus.value));
const selectedExamIds = computed(() => selectedExamRows.value.map((row) => row.id));
const selectedPaper = computed(() => papers.value.find((paper) => paper.id === form.paperId) ?? null);
const paperDurationHint = computed(() =>
  selectedPaper.value ? `试卷答题时长 ${selectedPaper.value.durationMinutes || 0} 分钟，可在此处调整本场考试时长` : '',
);
const announcementUnreadItems = computed(() => (announcementReadReport.value?.items ?? []).filter((item) => !item.read));
const announcementReadItems = computed(() =>
  announcementUnreadOnly.value ? announcementUnreadItems.value : announcementReadReport.value?.items ?? [],
);
const formStatusDescription = computed(() => statusDescription('exam', form.status));
const selectedExamStatusDescription = computed(() =>
  selectedExam.value ? statusDescription('exam', selectedExam.value.status) : '',
);

function baseForm() {
  const current = new Date();
  const durationMinutes = 30;
  return {
    name: '',
    courseId: '',
    classId: '',
    paperId: '',
    startTime: current,
    endTime: examEndFrom(current, durationMinutes),
    durationMinutes,
    attemptLimit: 1,
    announcement: '',
    resultVisibility: defaultResultVisibility(),
    status: 'draft',
  };
}

function defaultResultVisibility() {
  return {
    questionScore: true,
    content: false,
    studentAnswer: false,
    correctness: false,
    correctAnswer: false,
    analysis: false,
  };
}

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

function handleExamSortChange({ prop, order }) {
  examFilter.sortBy = prop || 'createdAt';
  examFilter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  return loadFirstExamPage();
}

function handleExamSizeChange(size) {
  examPagination.pageSize = size;
  examPagination.page = 1;
  loadAll();
}

function handleExamCurrentChange(page) {
  examPagination.page = page;
  loadAll();
}

async function saveExam() {
  alignExamEndTime();
  const targetTab = editingId.value ? examTabForStatus(form.status, form.startTime, form.endTime) : 'draft';
  const payload = {
    ...form,
    startTime: form.startTime.toISOString(),
    endTime: form.endTime.toISOString(),
    antiCheatConfig: { resultVisibility: { ...form.resultVisibility } },
  };
  delete payload.resultVisibility;
  if (!payload.classId) {
    if (editingId.value) payload.classId = null;
    else delete payload.classId;
  }
  if (!editingId.value) delete payload.status;

  try {
    await (editingId.value
      ? updateManagedExam(editingId.value, payload)
      : createManagedExam(payload));
    ElMessage.success(editingId.value ? '考试已保存' : '已创建');
    examStatusTab.value = targetTab;
    examFormVisible.value = false;
    resetForm();
    await loadAll();
  } catch (error) {
    ElMessage.error(error.message);
  }
}

function editExam(row) {
  selectedExam.value = row;
  editingId.value = row.id;
  editingOriginalStatus.value = row.status || '';
  Object.assign(form, {
    name: row.name,
    courseId: row.courseId,
    classId: row.classId || '',
    paperId: row.paperId,
    startTime: new Date(row.startTime),
    endTime: examEndFrom(row.startTime, row.durationMinutes),
    durationMinutes: row.durationMinutes,
    attemptLimit: row.attemptLimit,
    announcement: row.announcement || '',
    resultVisibility: { ...defaultResultVisibility(), ...(row.resultVisibility || {}) },
    status: ['running', 'ended'].includes(row.status) ? row.status : row.status || 'draft',
  });
  examFormVisible.value = true;
}

function resetForm() {
  editingId.value = '';
  editingOriginalStatus.value = '';
  const firstPaper = papers.value[0] ?? null;
  const nextForm = {
    ...baseForm(),
    courseId: courses.value[0]?.id || '',
    classId: '',
    paperId: firstPaper?.id || '',
    durationMinutes: firstPaper?.durationMinutes || baseForm().durationMinutes,
    resultVisibility: defaultResultVisibility(),
  };
  nextForm.endTime = examEndFrom(nextForm.startTime, nextForm.durationMinutes);
  Object.assign(form, nextForm);
}

function handlePaperChange() {
  if (editingId.value) return;
  if (selectedPaper.value?.durationMinutes) {
    form.durationMinutes = selectedPaper.value.durationMinutes;
    alignExamEndTime();
  }
}

function examEndFrom(startTime, durationMinutes) {
  const start = startTime instanceof Date ? startTime : new Date(startTime || Date.now());
  const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
  const duration = Math.max(1, Math.round(Number(durationMinutes) || 1));
  return new Date(safeStart.getTime() + duration * 60 * 1000);
}

function alignExamEndTime() {
  form.endTime = examEndFrom(form.startTime, form.durationMinutes);
}

function examTabForStatus(status, startTime, endTime) {
  if (status === 'draft' || status === 'archived') return status;
  const nowTime = Date.now();
  const start = new Date(startTime || nowTime).getTime();
  const end = new Date(endTime || nowTime).getTime();
  if (status === 'ended' || end <= nowTime) return 'ended';
  if (status === 'scheduled' && start > nowTime) return 'scheduled';
  if (status === 'running' || status === 'scheduled') return 'running';
  return 'running';
}

function closeExamForm() {
  examFormVisible.value = false;
  resetForm();
}

function openCreateExam() {
  resetForm();
  examFormVisible.value = true;
}

function previewExam(row) {
  if (!row?.id) return;
  selectedExam.value = row;
  examPreviewVisible.value = true;
}

async function publish(row) {
  try {
    const result = await publishManagedExam(row.id);
    ElMessage.success(`考试状态已更新为${statusLabel(result.status || 'scheduled')}`);
    await loadAll();
  } catch (error) {
    ElMessage.error(error.message);
  }
}

async function unpublish(row) {
  try {
    await unpublishManagedExam(row.id);
    ElMessage.success('已取消发布');
    await loadAll();
  } catch (error) {
    ElMessage.error(error.message);
  }
}

async function saveStatusOnly() {
  if (!editingId.value) return;
  await changeStatus({ id: editingId.value }, form.status);
  examFormVisible.value = false;
  resetForm();
}

function handleSelectionChange(rows) {
  selectedExamRows.value = rows;
}

async function changeStatus(row, status) {
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
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message);
    }
  }
}

async function endExam(row) {
  await ElMessageBox.confirm(
    `确认立即结束考试“${row.name || ''}”？系统会提交所有进行中的答卷，并将考试结束时间更新为当前时间。`,
    '结束考试',
    { type: 'warning', confirmButtonText: '立即结束', cancelButtonText: '取消' },
  );
  const result = await endManagedExam(row.id);
  ElMessage.success(`考试已结束，已处理 ${result.finalizedAttemptCount || 0} 份进行中答卷`);
  await loadAll();
}

function handleExamCommand(row, command) {
  const handlers = {
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
  handlers[command]?.();
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
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message);
    }
  }
}

async function removeExam(row) {
  try {
    await ElMessageBox.confirm(`确认删除考试“${row.name}”？已有提交记录的考试不能删除。`, '删除考试', { type: 'warning' });
    await removeManagedExam(row.id);
    ElMessage.success('已删除');
    await loadAll();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message ?? '已取消');
    }
  }
}

function simulate(row) {
  if (!selectedStudentId.value) {
    ElMessage.error('请先选择模拟学生');
    return;
  }
  router.push(`/student/exams/${row.id}?simulateStudentId=${selectedStudentId.value}`);
}

function trial(row) {
  router.push(`/papers/${row.paperId}/answer?mode=trial&examId=${row.id}`);
}

async function loadResults(row) {
  selectedExam.value = row;
  const data = await getManagedExamResults(row.id, { pageSize: 100 });
  results.value = data.items;
}

async function openRanking(row = selectedExam.value || exams.value[0]) {
  if (!row?.id) {
    ElMessage.warning('请先选择考试');
    return;
  }
  await loadResults(row);
  rankingVisible.value = true;
}

async function openAnnouncementReads(row = selectedExam.value || exams.value[0]) {
  if (!row?.id) {
    ElMessage.warning('请先选择考试');
    return;
  }
  selectedExam.value = row;
  announcementReadsLoading.value = true;
  try {
    announcementReadReport.value = await getAnnouncementReads(row.id);
    announcementUnreadOnly.value = false;
    announcementReadsVisible.value = true;
  } catch (error) {
    ElMessage.error(error.message || '公告阅读统计加载失败');
  } finally {
    announcementReadsLoading.value = false;
  }
}

async function sendAnnouncementReminder() {
  if (!announcementReadReport.value?.examId) return;
  try {
    await ElMessageBox.confirm(
      `将给 ${announcementUnreadItems.value.length} 名未读学生生成站内提醒，是否继续？`,
      '发送公告阅读提醒',
      { type: 'warning', confirmButtonText: '发送提醒', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  announcementRemindLoading.value = true;
  try {
    const result = await remindAnnouncementUnread(announcementReadReport.value.examId);
    ElMessage.success(`已生成 ${result.createdCount} 条提醒，跳过 ${result.skippedCount} 条已有提醒`);
  } catch (error) {
    ElMessage.error(error.message || '发送提醒失败');
  } finally {
    announcementRemindLoading.value = false;
  }
}

function exportAnnouncementUnreadCsv() {
  const rows = announcementUnreadItems.value;
  if (!rows.length) {
    ElMessage.warning('当前没有未读学生');
    return;
  }
  const header = ['学生', '账号', '是否进入考试', '是否提交', '考试'];
  const lines = [
    header,
    ...rows.map((row) => [
      row.realName || row.username,
      row.username,
      row.entered ? '已进入' : '未进入',
      row.submitted ? '已提交' : '未提交',
      announcementReadReport.value?.examName || '',
    ]),
  ].map((line) => line.map(csvCell).join(','));
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${announcementReadReport.value?.examName || '考试公告'}-未读名单.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function statusLabel(value) {
  return getStatusLabel('exam', value);
}

function statusType(value) {
  return statusTagType('exam', value);
}

function attemptStatusLabel(value) {
  return getStatusLabel('attempt', value);
}

function attemptStatusType(value) {
  return statusTagType('attempt', value);
}

function examStatusTargets(row) {
  return statusTransitionOptions('exam', row?.status);
}

function examStatusActionText(currentStatus, targetStatus) {
  const key = `${currentStatus}->${targetStatus}`;
  const map = {
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

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

watch(
  () => [form.startTime, form.durationMinutes],
  () => {
    if (examFormVisible.value) alignExamEndTime();
  },
);

onMounted(loadAll);

return {
  Check,
  DataAnalysis,
  Edit,
  ElMessage,
  ElMessageBox,
  Plus,
  Refresh,
  Search,
  User,
  View,
  alignExamEndTime,
  announcementReadItems,
  announcementReadReport,
  announcementReadsLoading,
  announcementReadsVisible,
  announcementRemindLoading,
  announcementUnreadItems,
  announcementUnreadOnly,
  attemptStatusLabel,
  attemptStatusType,
  baseForm,
  bulkStatus,
  bulkUpdateManagedExams,
  bulkUpdateStatus,
  canOverrideLockedExam,
  canSaveCore,
  changeStatus,
  classes,
  closeExamForm,
  computed,
  courses,
  createManagedExam,
  csvCell,
  currentUser,
  defaultResultVisibility,
  editExam,
  editingId,
  editingOriginalStatus,
  endExam,
  endManagedExam,
  examEndFrom,
  examFilter,
  examFormVisible,
  examPagination,
  examPreviewVisible,
  examStatusActionText,
  examStatusOptions,
  examStatusTab,
  examStatusTargets,
  examTabForStatus,
  exams,
  exportAnnouncementUnreadCsv,
  form,
  formStatusDescription,
  formatDateTime,
  getAnnouncementReads,
  getCurrentUser,
  getManagedExamResults,
  getStatusLabel,
  handleExamCommand,
  handleExamCurrentChange,
  handleExamSizeChange,
  handleExamSortChange,
  handlePaperChange,
  handleSelectionChange,
  listExamClasses,
  listExamCourses,
  listExamPapers,
  listExamStudents,
  listManagedExams,
  loadAll,
  loadFirstExamPage,
  loadResults,
  onMounted,
  openAnnouncementReads,
  openCreateExam,
  openRanking,
  pageSizes,
  paperDurationHint,
  papers,
  previewExam,
  publish,
  publishManagedExam,
  rankingVisible,
  reactive,
  ref,
  remindAnnouncementUnread,
  removeExam,
  removeManagedExam,
  resetForm,
  results,
  route,
  router,
  saveExam,
  saveStatusOnly,
  selectedExam,
  selectedExamIds,
  selectedExamRows,
  selectedExamStatusDescription,
  selectedPaper,
  selectedStudentId,
  sendAnnouncementReminder,
  showLowColumns,
  showMediumColumns,
  simulate,
  statusDescription,
  statusLabel,
  statusOptions,
  statusTagType,
  statusTransitionOptions,
  statusType,
  students,
  trial,
  unpublish,
  unpublishManagedExam,
  updateManagedExam,
  useResponsiveColumns,
  useRoute,
  useRouter,
  watch,
};
}
