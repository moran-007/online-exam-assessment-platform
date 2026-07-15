import { computed, reactive, ref, watch, type Ref } from 'vue';
import { ElMessage } from 'element-plus';
import { getCurrentUser } from '../../../api';
import { statusDescription } from '../../../statusMeta';
import { createManagedExam, updateManagedExam } from '../api';
import type { ExamPaperOption, ExamResultVisibility, ManagedExam, NamedOption } from '../models';

type ExamForm = {
  name: string;
  courseId: string;
  classId: string;
  paperId: string;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  attemptLimit: number;
  announcement: string;
  resultVisibility: ExamResultVisibility;
  status: string;
};

type ExamEditorContext = {
  courses: Ref<NamedOption[]>;
  papers: Ref<ExamPaperOption[]>;
  selectedExam: Ref<ManagedExam | null>;
  examStatusTab: Ref<string>;
  normalizeExam: (value: unknown) => ManagedExam;
  reload: () => Promise<void>;
};

function defaultResultVisibility(): ExamResultVisibility {
  return {
    questionScore: true,
    content: false,
    studentAnswer: false,
    correctness: false,
    correctAnswer: false,
    analysis: false,
  };
}

function examEndFrom(startTime: string | Date | null | undefined, durationMinutes: number) {
  const start = startTime instanceof Date ? startTime : new Date(startTime || Date.now());
  const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
  const duration = Math.max(1, Math.round(Number(durationMinutes) || 1));
  return new Date(safeStart.getTime() + duration * 60 * 1000);
}

function baseForm(): ExamForm {
  const startTime = new Date();
  const durationMinutes = 30;
  return {
    name: '',
    courseId: '',
    classId: '',
    paperId: '',
    startTime,
    endTime: examEndFrom(startTime, durationMinutes),
    durationMinutes,
    attemptLimit: 1,
    announcement: '',
    resultVisibility: defaultResultVisibility(),
    status: 'draft',
  };
}

function examTabForStatus(status: string, startTime: string | Date, endTime: string | Date) {
  if (status === 'draft' || status === 'archived') return status;
  const nowTime = Date.now();
  const start = new Date(startTime || nowTime).getTime();
  const end = new Date(endTime || nowTime).getTime();
  if (status === 'ended' || end <= nowTime) return 'ended';
  if (status === 'scheduled' && start > nowTime) return 'scheduled';
  return 'running';
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useExamEditor(context: ExamEditorContext) {
  const examFormVisible = ref(false);
  const editingId = ref('');
  const editingOriginalStatus = ref('');
  const form = reactive(baseForm());
  const currentUser = ref(getCurrentUser() as { userType?: string | null } | null);
  const canOverrideLockedExam = computed(() => ['SUPER_ADMIN', 'ADMIN'].includes(currentUser.value?.userType ?? ''));
  const canSaveCore = computed(() => canOverrideLockedExam.value || !['running', 'ended'].includes(editingOriginalStatus.value));
  const selectedPaper = computed(() => context.papers.value.find((paper) => paper.id === form.paperId) ?? null);
  const paperDurationHint = computed(() =>
    selectedPaper.value ? `试卷答题时长 ${selectedPaper.value.durationMinutes || 0} 分钟，可在此处调整本场考试时长` : '',
  );
  const formStatusDescription = computed(() => statusDescription('exam', form.status));

  function alignExamEndTime() {
    form.endTime = examEndFrom(form.startTime, form.durationMinutes);
  }

  function resetForm() {
    editingId.value = '';
    editingOriginalStatus.value = '';
    const firstPaper = context.papers.value[0] ?? null;
    const nextForm = {
      ...baseForm(),
      courseId: context.courses.value[0]?.id || '',
      paperId: firstPaper?.id || '',
      durationMinutes: firstPaper?.durationMinutes || 30,
    };
    nextForm.endTime = examEndFrom(nextForm.startTime, nextForm.durationMinutes);
    Object.assign(form, nextForm);
  }

  function editExam(value: unknown) {
    const row = context.normalizeExam(value);
    context.selectedExam.value = row;
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

  async function saveExam() {
    alignExamEndTime();
    const targetTab = editingId.value ? examTabForStatus(form.status, form.startTime, form.endTime) : 'draft';
    const payload = {
      name: form.name,
      courseId: form.courseId,
      paperId: form.paperId,
      startTime: form.startTime.toISOString(),
      endTime: form.endTime.toISOString(),
      durationMinutes: form.durationMinutes,
      attemptLimit: form.attemptLimit,
      announcement: form.announcement,
      antiCheatConfig: { resultVisibility: { ...form.resultVisibility } },
    };
    try {
      if (editingId.value) {
        await updateManagedExam(editingId.value, { ...payload, classId: form.classId || null, status: form.status });
      } else {
        await createManagedExam({ ...payload, classId: form.classId || undefined });
      }
      ElMessage.success(editingId.value ? '考试已保存' : '已创建');
      context.examStatusTab.value = targetTab;
      examFormVisible.value = false;
      resetForm();
      await context.reload();
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, '考试保存失败'));
    }
  }

  function handlePaperChange() {
    if (editingId.value || !selectedPaper.value?.durationMinutes) return;
    form.durationMinutes = selectedPaper.value.durationMinutes;
    alignExamEndTime();
  }

  function closeExamForm() {
    examFormVisible.value = false;
    resetForm();
  }

  function openCreateExam() {
    resetForm();
    examFormVisible.value = true;
  }

  watch(
    () => [form.startTime, form.durationMinutes],
    () => {
      if (examFormVisible.value) alignExamEndTime();
    },
  );

  return {
    alignExamEndTime,
    canOverrideLockedExam,
    canSaveCore,
    closeExamForm,
    editExam,
    editingId,
    examFormVisible,
    form,
    formStatusDescription,
    handlePaperChange,
    openCreateExam,
    paperDurationHint,
    resetForm,
    saveExam,
    selectedPaper,
  };
}
