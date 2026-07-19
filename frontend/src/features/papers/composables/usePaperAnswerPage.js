import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getCurrentUser } from '../../../api';
import { listMyHydroAccounts, submitHydroPracticeCode } from '../../hydro/api';
import {
  hydroAccountLabel,
  languageLabel as sharedLanguageLabel,
  languageOptionsFor,
  programmingRefBaseUrl,
  sameHydroBaseUrl,
} from '../../../question-engine/answer-utils';
import { addWrongQuestionsBatch, previewPaper } from '../api';

const OBJECTIVE_QUESTION_TYPES = new Set(['single_choice', 'multiple_choice', 'true_false', 'fill_blank']);
const LANGUAGE_ALIASES = { cpp17: 'C++17', python3: 'Python 3' };

export function usePaperAnswerPage() {
  const route = useRoute();
  const router = useRouter();
  const paper = ref(null);
  const answers = reactive({});
  const codeSubmitLoading = reactive({});
  const codeSubmitFeedback = reactive({});
  const selectedHydroAccountIds = reactive({});
  const hydroAccounts = ref([]);
  const submitted = ref(false);
  const addingWrongQuestions = ref(false);
  const currentIndex = ref(0);
  const answerLayout = ref('side');
  const currentUser = getCurrentUser();
  const isStudent = computed(() => currentUser?.userType === 'STUDENT');
  const returnPath = computed(() => {
    const explicit = Array.isArray(route.query.return) ? route.query.return[0] : route.query.return;
    return explicit || (isStudent.value ? '/student/papers' : '/papers');
  });
  const returnButtonText = computed(() => (isStudent.value ? '返回试卷题库' : '返回试卷'));
  const practiceSubtitle = computed(() => {
    const prefix = isStudent.value ? '试卷练习' : 'trial/test 试答';
    return `${prefix} · 不计入正式成绩 · ${totalCount.value} 题 · ${paper.value?.durationMinutes ?? 0} 分钟`;
  });

  const displaySections = computed(() => {
    if (!paper.value) return [];
    const sections = (paper.value.sections ?? [])
      .filter((section) => section.questions?.length)
      .map((section) => ({ title: section.title, questions: section.questions }));
    if (paper.value.questions?.length) {
      sections.push({ title: '未分区题目', questions: paper.value.questions });
    }
    return sections;
  });

  const flatQuestions = computed(() => {
    let index = 0;
    const flatten = (question, snapshot, sectionTitle, materialContext = null) => {
      const children = Array.isArray(snapshot.children) ? snapshot.children : [];
      if (children.length) {
        const context = { title: snapshot.title, content: snapshot.content };
        return children.flatMap((child) => {
          const childQuestion = {
            ...child,
            id: child.paperQuestionId || child.questionId,
            questionSnapshotJson: child.snapshot || {},
          };
          return flatten(childQuestion, child.snapshot || {}, sectionTitle, context);
        });
      }
      return [{ question, snapshot, sectionTitle, materialContext, index: index++, result: gradeQuestion(question) }];
    };
    return displaySections.value.flatMap((section) =>
      section.questions.flatMap((question) => flatten(question, question.questionSnapshotJson ?? {}, section.title)),
    );
  });
  const totalCount = computed(() => flatQuestions.value.length);
  const currentEntry = computed(() => flatQuestions.value[currentIndex.value] ?? null);
  const visibleEntries = computed(() => (currentEntry.value ? [currentEntry.value] : []));
  const answeredCount = computed(() => flatQuestions.value.filter((entry) => isAnswered(entry.question.questionId)).length);
  const progressPercent = computed(() => (totalCount.value ? Math.round((answeredCount.value / totalCount.value) * 100) : 0));
  const correctCount = computed(() => submitted.value ? flatQuestions.value.filter((entry) => entry.result?.isCorrect).length : 0);
  const pendingReviewCount = computed(() => (
    submitted.value ? flatQuestions.value.filter((entry) => entry.result?.isCorrect === null).length : 0
  ));
  const autoCheckedCount = computed(() => Math.max(0, totalCount.value - pendingReviewCount.value));
  const totalPossibleScore = computed(() => flatQuestions.value.reduce((sum, entry) => sum + Number(entry.question.score || 0), 0));
  const earnedScore = computed(() => flatQuestions.value.reduce((sum, entry) => sum + Number(entry.result?.score || 0), 0));
  const allCorrect = computed(() => totalCount.value > 0 && pendingReviewCount.value === 0 && correctCount.value === totalCount.value);
  const resultSummaryType = computed(() => (pendingReviewCount.value ? 'warning' : allCorrect.value ? 'success' : 'danger'));
  const resultSummaryText = computed(() => {
    if (!submitted.value) return '';
    if (pendingReviewCount.value) {
      return `${formatScore(earnedScore.value)} / ${formatScore(totalPossibleScore.value)} 分，${autoCheckedCount.value} 题已自动评测，${pendingReviewCount.value} 题待评测或自评`;
    }
    return `${formatScore(earnedScore.value)} / ${formatScore(totalPossibleScore.value)} 分`;
  });
  const wrongEntries = computed(() => (
    submitted.value
      ? flatQuestions.value.filter((entry) => entry.result?.isCorrect === false && entry.question.questionId)
      : []
  ));
  const manualWrongEntries = computed(() => wrongEntries.value.filter((entry) => entry.snapshot.type !== 'programming'));

  async function load() {
    const [paperData] = await Promise.all([
      previewPaper(String(route.params.paperId), isStudent.value),
      loadHydroAccounts(),
    ]);
    paper.value = paperData;
    resetAnswers();
  }

  function resetAnswers() {
    Object.keys(answers).forEach((key) => delete answers[key]);
    Object.keys(codeSubmitFeedback).forEach((key) => delete codeSubmitFeedback[key]);
    Object.keys(selectedHydroAccountIds).forEach((key) => delete selectedHydroAccountIds[key]);
    for (const entry of flatQuestions.value) {
      answers[entry.question.questionId] = emptyAnswer(entry.snapshot);
      if (entry.snapshot.type === 'programming') {
        selectedHydroAccountIds[entry.question.questionId] = defaultHydroAccountId(entry.snapshot);
      }
    }
    currentIndex.value = Math.min(currentIndex.value, Math.max(totalCount.value - 1, 0));
  }

  function emptyAnswer(snapshot = null) {
    return {
      selectedOptionIds: [],
      blanks: blankAnswerList(snapshot),
      text: '',
      code: '',
      language: languageOptionsFor(snapshot)[0] || 'cc.cc17o2',
    };
  }

  function clearAll() {
    resetAnswers();
    currentIndex.value = 0;
    submitted.value = false;
  }

  function clearAnswer(questionId) {
    if (!answers[questionId]) return;
    const snapshot = flatQuestions.value.find((entry) => entry.question.questionId === questionId)?.snapshot;
    Object.assign(answers[questionId], emptyAnswer(snapshot));
    delete codeSubmitFeedback[questionId];
    submitted.value = false;
  }

  async function submit() {
    const pendingProgrammingEntries = flatQuestions.value.filter(
      (entry) => entry.snapshot.type === 'programming'
        && String(answers[entry.question.questionId]?.code || '').trim()
        && codeSubmitFeedback[entry.question.questionId]?.isCorrect === undefined,
    );
    if (pendingProgrammingEntries.length) {
      await Promise.allSettled(pendingProgrammingEntries.map((entry) => submitPracticeCode(entry, true)));
    }
    submitted.value = true;
  }

  async function addWrongQuestionsToBook() {
    const items = manualWrongEntries.value
      .filter((entry) => entry.question.questionId)
      .map((entry) => ({
        questionId: entry.question.questionId,
        answer: answerPayload(entry.snapshot, answers[entry.question.questionId]),
        score: Number(entry.result?.score || 0),
        totalScore: Number(entry.question.score || 0),
      }));
    if (!items.length) {
      ElMessage.warning('当前没有可加入错题本的题目');
      return;
    }

    addingWrongQuestions.value = true;
    try {
      const result = await addWrongQuestionsBatch({ items });
      const failedText = result.failed?.length ? `，${result.failed.length} 道失败` : '';
      ElMessage.success(`已加入 ${result.successCount} 道错题${failedText}`);
    } catch (error) {
      ElMessage.error(error.message || '加入错题本失败');
    } finally {
      addingWrongQuestions.value = false;
    }
  }

  function isAnswered(questionId) {
    const answer = answers[questionId];
    if (!answer) return false;
    return Boolean(
      answer.selectedOptionIds?.filter(Boolean).length
        || answer.blanks?.some((blank) => String(blank.value ?? '').trim())
        || String(answer.code ?? '').trim()
        || String(answer.text ?? '').trim(),
    );
  }

  function gradeQuestion(paperQuestion) {
    const snapshot = paperQuestion.questionSnapshotJson ?? {};
    const answer = answers[paperQuestion.questionId] ?? emptyAnswer(snapshot);
    if (snapshot.type === 'programming') {
      const feedback = codeSubmitFeedback[paperQuestion.questionId];
      if (!feedback || feedback.isCorrect === null || feedback.isCorrect === undefined) return { isCorrect: null };
      return {
        isCorrect: feedback.isCorrect,
        score: feedback.score,
        maxScore: feedback.maxScore,
        passedTestCaseCount: feedback.passedTestCaseCount,
        totalTestCaseCount: feedback.totalTestCaseCount,
      };
    }
    if (['single_choice', 'multiple_choice', 'true_false'].includes(snapshot.type)) {
      const selected = new Set(answer.selectedOptionIds?.filter(Boolean) ?? []);
      const correct = new Set((snapshot.options ?? []).filter((option) => option.isCorrect).map(optionIdFor));
      const isCorrect = selected.size === correct.size && [...selected].every((optionId) => correct.has(optionId));
      return { isCorrect, score: isCorrect ? Number(paperQuestion.score || 0) : 0, maxScore: Number(paperQuestion.score || 0) };
    }
    if (snapshot.type === 'fill_blank') {
      const rules = snapshot.answer?.blanks ?? [];
      if (!rules.length) return { isCorrect: null };
      const isCorrect = rules.every((rule) => {
        const submittedValue = answer.blanks?.find((blank) => Number(blank.index) === Number(rule.index))?.value ?? '';
        const normalized = rule.ignoreCase ? submittedValue.trim().toLowerCase() : submittedValue.trim();
        return (rule.answers ?? []).some((item) => (rule.ignoreCase ? item.trim().toLowerCase() : item.trim()) === normalized);
      });
      return { isCorrect, score: isCorrect ? Number(paperQuestion.score || 0) : 0, maxScore: Number(paperQuestion.score || 0) };
    }
    return { isCorrect: null };
  }

  function resultTagType(result) {
    if (result?.isCorrect === true) return 'success';
    if (result?.isCorrect === false) return 'danger';
    return 'warning';
  }

  function resultLabel(result) {
    if (result?.score !== null && result?.score !== undefined) return `${result.score} / ${result.maxScore} 分`;
    if (result?.isCorrect === true) return '正确';
    if (result?.isCorrect === false) return '错误';
    return '待自评';
  }

  function answerPayload(snapshot, answer = {}) {
    if (['single_choice', 'multiple_choice', 'true_false'].includes(snapshot?.type)) {
      return { selectedOptionIds: (answer.selectedOptionIds || []).filter(Boolean) };
    }
    if (snapshot?.type === 'fill_blank') return { blanks: answer.blanks || [] };
    if (snapshot?.type === 'programming') return { language: answer.language || '', code: answer.code || '' };
    return { text: answer.text || '' };
  }

  function formatScore(value) {
    const numeric = Number(value || 0);
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function numberTitle(entry) {
    const status = isAnswered(entry.question.questionId) ? '已答' : '未答';
    const result = submitted.value ? `，${resultLabel(entry.result)}` : '';
    return `第 ${entry.index + 1} 题：${status}${result}`;
  }

  function goQuestion(index) {
    if (index < 0 || index >= totalCount.value) return;
    currentIndex.value = index;
    nextTick(() => {
      document.querySelector('.exam-main')?.scrollTo({ top: 0 });
      document.querySelector('.exam-question .question-answer-statement')?.scrollTo({ top: 0 });
      document.querySelector('.exam-question .question-answer-panel')?.scrollTo({ top: 0 });
    });
  }

  async function loadHydroAccounts() {
    try {
      const data = await listMyHydroAccounts();
      hydroAccounts.value = data.items ?? data ?? [];
    } catch {
      hydroAccounts.value = [];
    }
  }

  async function submitPracticeCode(entry, silent = false) {
    const questionId = entry.question.questionId;
    const answer = answers[questionId];
    const accountId = selectedHydroAccountIds[questionId];
    if (!String(answer?.code || '').trim()) {
      if (!silent) ElMessage.warning('请先填写代码');
      return;
    }
    if (!accountId) {
      if (!silent) ElMessage.warning('请选择当前题目来源站点下的提交账号');
      return;
    }

    codeSubmitLoading[questionId] = true;
    try {
      const result = await submitHydroPracticeCode(questionId, {
        language: answer.language,
        code: answer.code,
        accountId,
      });
      codeSubmitFeedback[questionId] = buildSubmissionFeedback(result);
      if (!silent) ElMessage.success(result.message || '评测完成');
    } catch (error) {
      codeSubmitFeedback[questionId] = {
        type: 'error', title: '评测失败', status: 'failed', score: null,
        maxScore: Number(entry.question.score || 0), isCorrect: null,
        message: error.message || 'Hydro 提交失败',
      };
      if (!silent) ElMessage.error(error.message || 'Hydro 提交失败');
    } finally {
      codeSubmitLoading[questionId] = false;
    }
  }

  function buildSubmissionFeedback(result) {
    const final = !['pending', 'judging'].includes(result.status);
    const isCorrect = final ? Boolean(result.isCorrect) : null;
    return {
      type: !final ? 'info' : isCorrect ? 'success' : 'error',
      title: !final ? '等待 Hydro 评测' : isCorrect ? '全部测试点通过' : '部分测试点未通过',
      status: result.status || '', score: result.score ?? null, maxScore: result.maxScore ?? 0,
      passedTestCaseCount: result.passedTestCaseCount ?? null,
      totalTestCaseCount: result.totalTestCaseCount ?? null,
      scoreRate: result.scoreRate ?? null, isCorrect, recordUrl: result.recordUrl || '',
      wrongQuestionAdded: Boolean(result.wrongQuestionAdded),
    };
  }

  function matchedHydroAccountsFor(snapshot) {
    const target = programmingRefBaseUrl(snapshot?.programmingRef);
    if (!target) return [];
    return hydroAccounts.value.filter((account) => account.bindStatus === 'bound' && sameHydroBaseUrl(account.platformBaseUrl, target));
  }

  function defaultHydroAccountId(snapshot) {
    const matched = matchedHydroAccountsFor(snapshot);
    const preferred = snapshot?.programmingRef?.accountId;
    return matched.find((account) => account.id === preferred)?.id || matched[0]?.id || '';
  }

  function languageLabel(language) {
    return sharedLanguageLabel(language, LANGUAGE_ALIASES);
  }

  function openHydroProblem(snapshot) {
    const url = snapshot?.programmingRef?.externalProblemUrl;
    if (!url) {
      ElMessage.warning('该题尚未配置 Hydro 链接');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function isSplitQuestion(type) {
    return !OBJECTIVE_QUESTION_TYPES.has(type);
  }

  function optionIdFor(option) {
    return option?.id ?? option?.optionId ?? option?.optionKey ?? '';
  }

  function blankCountFor(snapshot) {
    const answerBlanks = snapshot?.answer?.blanks;
    if (Array.isArray(answerBlanks) && answerBlanks.length) return answerBlanks.length;
    return Math.max(1, countBlankMarkers(snapshot?.content));
  }

  function blankAnswerList(snapshot, existing = []) {
    const source = Array.isArray(existing) ? existing : [];
    const count = Math.max(blankCountFor(snapshot), ...source.map((blank) => Number(blank?.index) || 0), 1);
    return Array.from({ length: count }, (_, index) => {
      const blankIndex = index + 1;
      const current = source.find((blank) => Number(blank?.index) === blankIndex);
      return { index: blankIndex, value: current?.value ?? '' };
    });
  }

  function countBlankMarkers(content) {
    const matches = String(content || '').match(/_{3,}|\(\s*\)|（\s*）|\[\s*\]/g);
    return matches?.length || 1;
  }

  onMounted(load);

  return {
    router, paper, answers, codeSubmitLoading, codeSubmitFeedback, selectedHydroAccountIds,
    submitted, addingWrongQuestions, currentIndex, answerLayout, isStudent, returnPath,
    returnButtonText, practiceSubtitle, flatQuestions, totalCount, visibleEntries, answeredCount,
    progressPercent, resultSummaryType, resultSummaryText, manualWrongEntries, clearAll,
    clearAnswer, submit, addWrongQuestionsToBook, isAnswered, resultTagType, resultLabel,
    numberTitle, goQuestion, submitPracticeCode, matchedHydroAccountsFor, openHydroProblem,
    isSplitQuestion, languageOptionsFor, languageLabel, hydroAccountLabel,
  };
}
