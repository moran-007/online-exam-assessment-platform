import { computed, type Ref } from 'vue';

type ExamClock = {
  durationMinutes?: number;
  endTime?: string;
  serverTime?: string;
} | null;

export function useExamCountdown(
  exam: Ref<ExamClock>,
  attemptStartedAt: Ref<string>,
  serverOffsetMs: Ref<number>,
  clockNow: Ref<number>,
) {
  const serverNowMs = computed(() => clockNow.value - serverOffsetMs.value);
  const deadlineMs = computed(() => {
    if (!exam.value) return serverNowMs.value;
    const started = new Date(attemptStartedAt.value || exam.value.serverTime || Date.now()).getTime();
    const attemptEnd = started + Number(exam.value.durationMinutes || 0) * 60 * 1000;
    const examEnd = new Date(exam.value.endTime || attemptEnd).getTime();
    return Math.min(attemptEnd, examEnd);
  });
  const remainingMs = computed(() => Math.max(0, deadlineMs.value - serverNowMs.value));

  return { serverNowMs, deadlineMs, remainingMs };
}
