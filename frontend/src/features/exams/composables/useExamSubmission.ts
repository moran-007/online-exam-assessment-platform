import { ElMessage, ElMessageBox } from 'element-plus';
import type { ComputedRef } from 'vue';
import type { Router } from 'vue-router';
import { submitStudentAttempt } from '../api';
import type { useExamTakingState } from './useExamTakingState';

type State = ReturnType<typeof useExamTakingState>;
type SubmitOptions = { skipConfirm?: boolean; auto?: boolean };
type SaveAll = (options?: {
  silent?: boolean; finalizeEndedAttempt?: boolean; keepalive?: boolean; swallow?: boolean;
}) => Promise<{ finalized?: boolean } | null>;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useExamSubmission(options: {
  state: State;
  router: Router;
  totalCount: ComputedRef<number>;
  answeredCount: ComputedRef<number>;
  flaggedCount: ComputedRef<number>;
  remainingMs: ComputedRef<number>;
  isSimulating: ComputedRef<boolean>;
  simulateStudentId: ComputedRef<string>;
  saveAll: SaveAll;
}) {
  const {
    state, router, totalCount, answeredCount, flaggedCount, remainingMs,
    isSimulating, simulateStudentId, saveAll,
  } = options;

  function resultQuery() {
    return isSimulating.value ? `?simulateStudentId=${simulateStudentId.value}` : '';
  }

  async function finalizeRemoteEndedAttempt() {
    if (state.submitted.value || !state.attemptId.value) return;
    state.autoSubmitting.value = true;
    const result = await saveAll({ silent: true, finalizeEndedAttempt: true, swallow: true });
    state.submitted.value = true;
    ElMessage.warning(result?.finalized
      ? '考试已结束，已保存当前页面答案并交卷'
      : '考试已结束，系统已提交当前答卷');
    await router.push(`/student/attempts/${state.attemptId.value}/result${resultQuery()}`);
  }

  async function submit(submitOptions: SubmitOptions = {}) {
    if (state.submitted.value || state.autoSubmitting.value) return;
    const { skipConfirm = false, auto = false } = submitOptions;
    const unanswered = totalCount.value - answeredCount.value;
    const flaggedText = flaggedCount.value ? `，其中 ${flaggedCount.value} 题已标疑` : '';
    if (!skipConfirm) {
      await ElMessageBox.confirm(
        `还有 ${unanswered} 题未作答${flaggedText}。提交后不能继续修改答案。`,
        '确认提交',
        { type: 'warning' },
      );
    }
    state.autoSubmitting.value = true;
    try {
      await saveAll({ silent: auto, finalizeEndedAttempt: auto || remainingMs.value <= 0 });
      const result = await submitStudentAttempt(
        state.attemptId.value,
        isSimulating.value ? simulateStudentId.value : undefined,
      );
      state.submitted.value = true;
      ElMessage.success(auto ? '考试时间已到，系统已自动交卷' : '已提交');
      await router.push(`/student/attempts/${result.attemptId || state.attemptId.value}/result${resultQuery()}`);
    } finally {
      if (!state.submitted.value) state.autoSubmitting.value = false;
    }
  }

  async function autoSubmitExam() {
    if (state.submitted.value || state.autoSubmitting.value || !state.attemptId.value) return;
    try {
      ElMessage.error('考试时间已到，正在自动交卷');
      await submit({ skipConfirm: true, auto: true });
    } catch (error: unknown) {
      state.autoSubmitting.value = false;
      ElMessage.error(errorMessage(error, '自动交卷失败，请手动提交'));
    }
  }

  return { finalizeRemoteEndedAttempt, submit, autoSubmitExam };
}
