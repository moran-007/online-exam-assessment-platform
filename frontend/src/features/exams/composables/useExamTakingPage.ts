import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ArrowRight, Check, Close, Delete, Expand, Flag, Fold, Link, Refresh, Upload } from '@element-plus/icons-vue';
import { enterStudentExam, getStudentAttempt } from '../api';
import { useExamCountdown } from './useExamCountdown';
import { useExamTakingState } from './useExamTakingState';
import { useExamAnswers } from './useExamAnswers';
import { useExamProgrammingSubmission } from './useExamProgrammingSubmission';
import { useExamNavigation } from './useExamNavigation';
import { useExamAutosave } from './useExamAutosave';
import { useExamSubmission } from './useExamSubmission';
import { useExamRuntime } from './useExamRuntime';
import type { HydroSubmissionResult } from '../../hydro/models';
import type {
  ExamAttemptView,
  ExamQuestion,
  ExamQuestionEntry,
  MaterialContext,
  ProgrammingSubmissionFeedback,
  ProgrammingSubmissionResult,
} from '../models';

export function useExamTakingPage() {
  const route = useRoute();
  const router = useRouter();
  const state = useExamTakingState();
  const simulateStudentId = computed(() => String(route.query.simulateStudentId || ''));
  const isSimulating = computed(() => Boolean(simulateStudentId.value));

  const flatQuestions = computed<ExamQuestionEntry[]>(() => {
    let index = 0;
    const flatten = (
      question: ExamQuestion,
      sectionTitle: string,
      materialContext: MaterialContext | null = null,
    ): ExamQuestionEntry[] => {
      const children = Array.isArray(question.children) ? question.children : [];
      if (children.length) {
        const context = { title: question.title, content: question.content };
        return children.flatMap((child) => flatten(child, sectionTitle, context));
      }
      return [{ question, sectionTitle, materialContext, index: index++ }];
    };
    return state.paper.sections.flatMap((section) =>
      section.questions.flatMap((question) => flatten(question, section.title)),
    );
  });

  const totalCount = computed(() => flatQuestions.value.length);
  const currentEntry = computed(() => flatQuestions.value[state.currentIndex.value] ?? null);
  const currentQuestionId = computed(() => currentEntry.value?.question.questionId ?? '');
  const visibleEntries = computed(() => (currentEntry.value ? [currentEntry.value] : []));
  const visibleEntriesReady = computed(() =>
    visibleEntries.value.every((entry) => Boolean(state.answers[entry.question.questionId])),
  );
  const { remainingMs } = useExamCountdown(
    state.exam,
    state.attemptStartedAt,
    state.serverOffsetMs,
    state.clockNow,
  );

  function buildSubmissionFeedback(
    result: ProgrammingSubmissionResult | HydroSubmissionResult,
    fallbackType: ProgrammingSubmissionFeedback['type'] = 'info',
  ) {
    return programming.buildSubmissionFeedback(result, fallbackType);
  }

  function defaultHydroAccountId(question: ExamQuestion) {
    return programming.defaultHydroAccountId(question);
  }

  const answerOps = useExamAnswers({
    state,
    flatQuestions,
    buildSubmissionFeedback,
    defaultHydroAccountId,
  });
  const programming = useExamProgrammingSubmission({
    state,
    languageOptionsFor: answerOps.languageOptionsFor,
  });
  const answeredCount = computed(() =>
    flatQuestions.value.filter((entry) => answerOps.isAnswered(entry.question.questionId)).length,
  );
  const flaggedCount = computed(() =>
    flatQuestions.value.filter((entry) => Boolean(state.flagged[entry.question.questionId])).length,
  );
  const progressPercent = computed(() =>
    totalCount.value ? Math.round((answeredCount.value / totalCount.value) * 100) : 0,
  );
  const navigation = useExamNavigation({
    state,
    router,
    flatQuestions,
    totalCount,
    currentQuestionId,
    isAnswered: answerOps.isAnswered,
    emptyAnswer: answerOps.emptyAnswer,
    blankAnswerList: answerOps.blankAnswerList,
    languageOptionsFor: answerOps.languageOptionsFor,
  });
  const autosave = useExamAutosave({
    state,
    flatQuestions,
    isSimulating,
    simulateStudentId,
    payloadFor: answerOps.payloadFor,
  });
  const submission = useExamSubmission({
    state,
    router,
    totalCount,
    answeredCount,
    flaggedCount,
    remainingMs,
    isSimulating,
    simulateStudentId,
    saveAll: autosave.saveAll,
  });
  const runtime = useExamRuntime({
    state,
    remainingMs,
    isSimulating,
    simulateStudentId,
    finalizeRemoteEndedAttempt: submission.finalizeRemoteEndedAttempt,
    autoSubmitExam: submission.autoSubmitExam,
  });

  async function load() {
    const entered = await enterStudentExam(
      String(route.params.examId),
      isSimulating.value ? simulateStudentId.value : undefined,
    );
    state.attemptId.value = entered.attemptId;
    let data: ExamAttemptView = entered;
    if (!entered.answers) {
      data = await getStudentAttempt(
        entered.attemptId,
        isSimulating.value ? simulateStudentId.value : undefined,
      );
    }

    state.exam.value = data.exam;
    state.attemptStartedAt.value = data.attemptStartedAt || data.exam?.serverTime || new Date().toISOString();
    state.serverOffsetMs.value = Date.now() - new Date(data.exam?.serverTime || Date.now()).getTime();
    await programming.loadHydroAccounts();
    state.answersHydrating.value = true;
    try {
      state.paper.sections = Array.isArray(data.paper?.sections) ? data.paper.sections : [];
      answerOps.resetAnswers();
      answerOps.applySavedAnswers(data.answers ?? []);
    } finally {
      state.answersHydrating.value = false;
    }
    state.answersDirty.value = false;
    navigation.loadFlags();
    runtime.startClock();
    runtime.startStatusPolling();
    autosave.startAutosave();
  }

  onMounted(() => void load());

  return {
    ArrowLeft, ArrowRight, Check, Close, Delete, Expand, Flag, Fold, Link, Refresh, Upload,
    route, router, ...state, ...answerOps, ...programming, ...navigation, ...autosave,
    ...submission, ...runtime, simulateStudentId, isSimulating, flatQuestions, totalCount,
    currentEntry, currentQuestionId, visibleEntries, visibleEntriesReady, answeredCount,
    flaggedCount, progressPercent, remainingMs, load,
  };
}
