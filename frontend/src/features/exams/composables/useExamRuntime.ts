import { ElMessage } from 'element-plus';
import { onUnmounted, type ComputedRef } from 'vue';
import { getStudentAttempt } from '../api';
import type { useExamTakingState } from './useExamTakingState';

type State = ReturnType<typeof useExamTakingState>;

export function useExamRuntime(options: {
  state: State;
  remainingMs: ComputedRef<number>;
  isSimulating: ComputedRef<boolean>;
  simulateStudentId: ComputedRef<string>;
  finalizeRemoteEndedAttempt: () => Promise<void>;
  autoSubmitExam: () => Promise<void>;
}) {
  const {
    state, remainingMs, isSimulating, simulateStudentId,
    finalizeRemoteEndedAttempt, autoSubmitExam,
  } = options;
  let clockTimer: number | null = null;
  let statusTimer: number | null = null;
  const warnedThresholds = new Set<number>();

  function startClock() {
    if (clockTimer) window.clearInterval(clockTimer);
    checkTimeWarnings();
    clockTimer = window.setInterval(() => {
      state.clockNow.value = Date.now();
      checkTimeWarnings();
    }, 1000);
  }

  function startStatusPolling() {
    if (statusTimer) window.clearInterval(statusTimer);
    statusTimer = window.setInterval(() => void refreshAttemptStatus(), 10_000);
  }

  async function refreshAttemptStatus() {
    if (!state.attemptId.value || state.submitted.value || state.autoSubmitting.value) return;
    try {
      const data = await getStudentAttempt(
        state.attemptId.value,
        isSimulating.value ? simulateStudentId.value : undefined,
      );
      if (data.exam) {
        state.exam.value = data.exam;
        state.serverOffsetMs.value = Date.now() - new Date(data.exam.serverTime || Date.now()).getTime();
      }
      if (data.status && data.status !== 'in_progress') await finalizeRemoteEndedAttempt();
    } catch {
      // Local countdown and autosave remain active; explicit actions surface actionable errors.
    }
  }

  function checkTimeWarnings() {
    const thresholds = [10 * 60 * 1000, 5 * 60 * 1000, 60 * 1000];
    for (const threshold of thresholds) {
      if (remainingMs.value <= threshold && remainingMs.value > 0 && !warnedThresholds.has(threshold)) {
        warnedThresholds.add(threshold);
        ElMessage.warning(`答题剩余 ${formatDuration(remainingMs.value)}`);
        return;
      }
    }
    if (remainingMs.value <= 0 && !warnedThresholds.has(0)) {
      warnedThresholds.add(0);
      void autoSubmitExam();
    }
  }

  function formatDuration(ms: number) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours) return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  onUnmounted(() => {
    if (clockTimer) window.clearInterval(clockTimer);
    if (statusTimer) window.clearInterval(statusTimer);
  });

  return { startClock, startStatusPolling, refreshAttemptStatus, checkTimeWarnings, formatDuration };
}
