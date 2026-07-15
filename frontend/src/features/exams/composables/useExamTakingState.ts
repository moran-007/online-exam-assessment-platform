import { reactive, ref } from 'vue';
import type { HydroAccountView } from '../../hydro/models';
import type {
  ExamAnswerDraft,
  ExamTakingExam,
  ExamTakingPaper,
  ProgrammingSubmissionFeedback,
} from '../models';

export function useExamTakingState() {
  const exam = ref<ExamTakingExam | null>(null);
  const paper = reactive<ExamTakingPaper>({ sections: [] });
  const attemptId = ref('');
  const attemptStartedAt = ref('');
  const serverOffsetMs = ref(0);
  const clockNow = ref(Date.now());
  const answers = reactive<Record<string, ExamAnswerDraft>>({});
  const flagged = reactive<Record<string, boolean>>({});
  const codeSubmitLoading = reactive<Record<string, boolean>>({});
  const codeSubmitFeedback = reactive<Record<string, ProgrammingSubmissionFeedback>>({});
  const selectedHydroAccountIds = reactive<Record<string, string>>({});
  const currentIndex = ref(0);
  const answerLayout = ref('side');
  const asideCollapsed = ref(localStorage.getItem('exam-aside-collapsed') === 'true');
  const hydroAccounts = ref<HydroAccountView[]>([]);
  const autoSubmitting = ref(false);
  const submitted = ref(false);
  const answersDirty = ref(false);
  const answersHydrating = ref(false);

  return {
    exam, paper, attemptId, attemptStartedAt, serverOffsetMs, clockNow, answers,
    flagged, codeSubmitLoading, codeSubmitFeedback, selectedHydroAccountIds,
    currentIndex, answerLayout, asideCollapsed, hydroAccounts, autoSubmitting,
    submitted, answersDirty, answersHydrating,
  };
}
