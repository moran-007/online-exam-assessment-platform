import { ElMessage } from 'element-plus';
import { nextTick, type ComputedRef } from 'vue';
import type { Router } from 'vue-router';
import type { ExamQuestion, ExamQuestionEntry } from '../models';
import type { useExamTakingState } from './useExamTakingState';

type State = ReturnType<typeof useExamTakingState>;
type NumberButtonClasses = Record<string, boolean>;

function resultRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function useExamNavigation(options: {
  state: State;
  router: Router;
  flatQuestions: ComputedRef<ExamQuestionEntry[]>;
  totalCount: ComputedRef<number>;
  currentQuestionId: ComputedRef<string>;
  isAnswered: (questionId: string) => boolean;
  emptyAnswer: () => { selectedOptionIds: string[]; blanks: Array<{ index: number; value: string }>; text: string; code: string; language: string };
  blankAnswerList: (question?: ExamQuestion | null) => Array<{ index: number; value: string }>;
  languageOptionsFor: (question: ExamQuestion) => string[];
}) {
  const {
    state, router, flatQuestions, totalCount, currentQuestionId, isAnswered,
    emptyAnswer, blankAnswerList, languageOptionsFor,
  } = options;

  function clearAnswer(questionId: string) {
    if (!state.answers[questionId]) return;
    const question = flatQuestions.value.find((entry) => entry.question.questionId === questionId)?.question;
    Object.assign(state.answers[questionId], {
      ...emptyAnswer(),
      blanks: blankAnswerList(question),
      language: question ? languageOptionsFor(question)[0] || 'cc.cc17o2' : 'cc.cc17o2',
    });
    ElMessage.success('已清除答案');
  }

  function clearCurrentAnswer() {
    if (currentQuestionId.value) clearAnswer(currentQuestionId.value);
  }

  function isFlagged(questionId: string) {
    return Boolean(state.flagged[questionId]);
  }

  function toggleFlag(questionId: string) {
    if (!questionId) return;
    if (state.flagged[questionId]) delete state.flagged[questionId];
    else state.flagged[questionId] = true;
    persistFlags();
  }

  function toggleCurrentFlag() {
    toggleFlag(currentQuestionId.value);
  }

  function exitSimulation() {
    void router.push('/exams');
  }

  function flagStorageKey() {
    return `exam-flags:${state.attemptId.value}`;
  }

  function loadFlags() {
    Object.keys(state.flagged).forEach((key) => delete state.flagged[key]);
    if (!state.attemptId.value) return;
    const raw = localStorage.getItem(flagStorageKey());
    let stored: Record<string, unknown> = {};
    try {
      stored = raw ? resultRecord(JSON.parse(raw) as unknown) : {};
    } catch {
      localStorage.removeItem(flagStorageKey());
    }
    Object.entries(stored).forEach(([questionId, value]) => {
      if (value) state.flagged[questionId] = true;
    });
  }

  function persistFlags() {
    if (state.attemptId.value) localStorage.setItem(flagStorageKey(), JSON.stringify(state.flagged));
  }

  function numberButtonClass(entry: ExamQuestionEntry): NumberButtonClasses {
    const questionId = entry.question.questionId;
    return {
      'question-nav-item': true,
      current: entry.index === state.currentIndex.value,
      answered: isAnswered(questionId),
      unanswered: !isAnswered(questionId),
      flagged: isFlagged(questionId),
    };
  }

  function numberTitle(entry: ExamQuestionEntry) {
    const status = isAnswered(entry.question.questionId) ? '已答' : '未答';
    const flag = isFlagged(entry.question.questionId) ? '，有疑问' : '';
    return `第 ${entry.index + 1} 题：${status}${flag}`;
  }

  function goQuestion(index: number) {
    if (index < 0 || index >= totalCount.value) return;
    state.currentIndex.value = index;
    void nextTick(() => {
      document.querySelector('.exam-main')?.scrollTo({ top: 0 });
      document.querySelector('.exam-question .question-answer-statement')?.scrollTo({ top: 0 });
      document.querySelector('.exam-question .question-answer-panel')?.scrollTo({ top: 0 });
    });
  }

  function toggleAside() {
    state.asideCollapsed.value = !state.asideCollapsed.value;
    localStorage.setItem('exam-aside-collapsed', String(state.asideCollapsed.value));
  }

  return {
    clearAnswer, clearCurrentAnswer, isFlagged, toggleFlag, toggleCurrentFlag,
    exitSimulation, flagStorageKey, loadFlags, persistFlags, numberButtonClass,
    numberTitle, goQuestion, toggleAside,
  };
}
