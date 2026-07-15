import { ElMessage } from 'element-plus';
import { onMounted, onUnmounted, watch, type ComputedRef } from 'vue';
import { saveStudentAnswers } from '../api';
import type { ExamQuestionEntry } from '../models';
import type { useExamTakingState } from './useExamTakingState';

type State = ReturnType<typeof useExamTakingState>;
type SaveOptions = {
  silent?: boolean;
  finalizeEndedAttempt?: boolean;
  keepalive?: boolean;
  swallow?: boolean;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useExamAutosave(options: {
  state: State;
  flatQuestions: ComputedRef<ExamQuestionEntry[]>;
  isSimulating: ComputedRef<boolean>;
  simulateStudentId: ComputedRef<string>;
  payloadFor: (questionId: string) => Record<string, unknown>;
}) {
  const { state, flatQuestions, isSimulating, simulateStudentId, payloadFor } = options;
  let autosaveTimer: number | null = null;
  let autosaveInterval: number | null = null;
  let saveInFlight = false;
  let pendingAutosave = false;

  function savePayload(finalizeEndedAttempt = false): Parameters<typeof saveStudentAnswers>[1] {
    return {
      answers: flatQuestions.value.map((entry) => ({
        questionId: entry.question.questionId,
        answer: payloadFor(entry.question.questionId),
      })),
      finalizeEndedAttempt,
    };
  }

  async function saveAll(saveOptions: SaveOptions = {}) {
    const { silent = false, finalizeEndedAttempt = false, keepalive = false, swallow = false } = saveOptions;
    if (!state.attemptId.value || state.submitted.value) return null;
    try {
      const result = await saveStudentAnswers(
        state.attemptId.value,
        savePayload(finalizeEndedAttempt),
        isSimulating.value ? simulateStudentId.value : undefined,
        keepalive,
      );
      state.answersDirty.value = false;
      if (!silent) ElMessage.success('已保存');
      return result;
    } catch (error: unknown) {
      if (!silent) ElMessage.error(errorMessage(error, '保存失败'));
      if (!swallow) throw error;
      return null;
    }
  }

  function scheduleAutosave() {
    if (!state.attemptId.value || state.submitted.value || state.autoSubmitting.value) return;
    state.answersDirty.value = true;
    if (autosaveTimer) window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => void flushAutosave(), 1800);
  }

  function startAutosave() {
    if (autosaveInterval) window.clearInterval(autosaveInterval);
    autosaveInterval = window.setInterval(() => void flushAutosave(), 8000);
  }

  async function flushAutosave(flushOptions: Pick<SaveOptions, 'keepalive'> = {}) {
    if (!state.attemptId.value || state.submitted.value || state.autoSubmitting.value || !state.answersDirty.value) return null;
    if (saveInFlight) {
      pendingAutosave = true;
      return null;
    }
    saveInFlight = true;
    try {
      return await saveAll({ silent: true, swallow: true, ...flushOptions });
    } finally {
      saveInFlight = false;
      if (pendingAutosave) {
        pendingAutosave = false;
        void flushAutosave(flushOptions);
      }
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') void flushAutosave({ keepalive: true });
  }

  function handlePageHide() {
    if (!state.answersDirty.value || !state.attemptId.value || state.submitted.value) return;
    void saveAll({ silent: true, keepalive: true, swallow: true });
  }

  watch(state.answers, () => {
    if (!state.answersHydrating.value) scheduleAutosave();
  }, { deep: true });

  onMounted(() => {
    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
  });

  onUnmounted(() => {
    if (autosaveTimer) window.clearTimeout(autosaveTimer);
    if (autosaveInterval) window.clearInterval(autosaveInterval);
    window.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('beforeunload', handlePageHide);
  });

  return { savePayload, saveAll, scheduleAutosave, startAutosave, flushAutosave };
}
