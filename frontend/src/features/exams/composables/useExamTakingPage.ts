/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- migrated page state is isolated here while domain models are typed incrementally.
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, ArrowRight, Check, Close, Delete, Expand, Flag, Fold, Link, Refresh, Upload } from '@element-plus/icons-vue';
import {
  enterStudentExam,
  getStudentAttempt,
  saveStudentAnswers,
  submitStudentAttempt,
} from '../api';
import {
  getHydroSubmission,
  listMyHydroAccounts,
  submitHydroAttemptCode,
} from '../../hydro/api';
import { useExamCountdown } from '../composables/useExamCountdown';

export function useExamTakingPage(): any {
const route = useRoute();
const router = useRouter();
const exam = ref(null);
const paper = reactive({ sections: [] });
const attemptId = ref('');
const attemptStartedAt = ref('');
const serverOffsetMs = ref(0);
const clockNow = ref(Date.now());
const answers = reactive({});
const flagged = reactive({});
const codeSubmitLoading = reactive({});
const codeSubmitFeedback = reactive({});
const selectedHydroAccountIds = reactive({});
const currentIndex = ref(0);
const answerLayout = ref('side');
const asideCollapsed = ref(localStorage.getItem('exam-aside-collapsed') === 'true');
const hydroAccounts = ref([]);
const autoSubmitting = ref(false);
const submitted = ref(false);
const simulateStudentId = computed(() => String(route.query.simulateStudentId || ''));
const isSimulating = computed(() => Boolean(simulateStudentId.value));
let clockTimer = null;
let statusTimer = null;
let autosaveTimer = null;
let autosaveInterval = null;
let answersHydrating = false;
let saveInFlight = false;
let pendingAutosave = false;
const answersDirty = ref(false);
const warnedThresholds = new Set();
const objectiveQuestionTypes = new Set(['single_choice', 'multiple_choice', 'true_false', 'fill_blank']);

const flatQuestions = computed(() => {
  let index = 0;
  const flatten = (question, sectionTitle, materialContext = null) => {
    const children = Array.isArray(question.children) ? question.children : [];
    if (children.length) {
      const context = { title: question.title, content: question.content };
      return children.flatMap((child) => flatten(child, sectionTitle, context));
    }
    return [{ question, sectionTitle, materialContext, index: index++ }];
  };
  return paper.sections.flatMap((section) =>
    section.questions.flatMap((question) => flatten(question, section.title)),
  );
});

const totalCount = computed(() => flatQuestions.value.length);
const currentEntry = computed(() => flatQuestions.value[currentIndex.value] ?? null);
const currentQuestionId = computed(() => currentEntry.value?.question.questionId ?? '');
const visibleEntries = computed(() => (currentEntry.value ? [currentEntry.value] : []));
const visibleEntriesReady = computed(() =>
  visibleEntries.value.every((entry) => Boolean(answers[entry.question.questionId])),
);
const answeredCount = computed(() => flatQuestions.value.filter((entry) => isAnswered(entry.question.questionId)).length);
const flaggedCount = computed(() => flatQuestions.value.filter((entry) => isFlagged(entry.question.questionId)).length);
const progressPercent = computed(() => (totalCount.value ? Math.round((answeredCount.value / totalCount.value) * 100) : 0));
const { remainingMs } = useExamCountdown(
  exam,
  attemptStartedAt,
  serverOffsetMs,
  clockNow,
);

watch(
  answers,
  () => {
    if (!answersHydrating) {
      scheduleAutosave();
    }
  },
  { deep: true },
);

async function load() {
  const entered = await enterStudentExam(
    String(route.params.examId),
    isSimulating.value ? simulateStudentId.value : undefined,
  );
  attemptId.value = entered.attemptId;
  let data = entered;

  if (!entered.answers) {
    data = await getStudentAttempt(entered.attemptId, isSimulating.value ? simulateStudentId.value : undefined);
  }

  exam.value = data.exam;
  attemptStartedAt.value = data.attemptStartedAt || data.exam?.serverTime || new Date().toISOString();
  serverOffsetMs.value = Date.now() - new Date(data.exam?.serverTime || Date.now()).getTime();
  const nextSections = Array.isArray(data.paper?.sections) ? data.paper.sections : [];
  await loadHydroAccounts();
  answersHydrating = true;
  try {
    paper.sections = nextSections;
    resetAnswers();
    applySavedAnswers(data.answers ?? []);
  } finally {
    answersHydrating = false;
  }
  answersDirty.value = false;
  loadFlags();
  startClock();
  startStatusPolling();
  startAutosave();
}

function emptyAnswer() {
  return {
    selectedOptionIds: [],
    blanks: [{ index: 1, value: '' }],
    text: '',
    code: '',
    language: 'cc.cc17o2',
  };
}

function resetAnswers() {
  Object.keys(answers).forEach((key) => delete answers[key]);
  Object.keys(selectedHydroAccountIds).forEach((key) => delete selectedHydroAccountIds[key]);
  for (const entry of flatQuestions.value) {
    answers[entry.question.questionId] = {
      ...emptyAnswer(),
      blanks: blankAnswerList(entry.question),
      language: languageOptionsFor(entry.question)[0] || 'cc.cc17o2',
    };
    if (entry.question.type === 'programming') {
      selectedHydroAccountIds[entry.question.questionId] = defaultHydroAccountId(entry.question);
    }
  }
}

function applySavedAnswers(savedAnswers) {
  for (const saved of savedAnswers) {
    if (!answers[saved.questionId]) continue;
    const answer = saved.answer ?? {};
    answers[saved.questionId].selectedOptionIds = Array.isArray(answer.selectedOptionIds)
      ? answer.selectedOptionIds.filter(Boolean)
      : [];
    const question = flatQuestions.value.find((entry) => entry.question.questionId === saved.questionId)?.question;
    answers[saved.questionId].blanks = blankAnswerList(question, answer.blanks);
    answers[saved.questionId].text = typeof answer.text === 'string' ? answer.text : '';
    answers[saved.questionId].code = typeof answer.code === 'string' ? answer.code : typeof answer.text === 'string' ? answer.text : '';
    answers[saved.questionId].language =
      typeof answer.language === 'string' ? answer.language : question ? languageOptionsFor(question)[0] || 'cc.cc17o2' : 'cc.cc17o2';
    if (['judge_pending', 'judge_done'].includes(saved.status) || saved.autoResult?.latestSubmissionId) {
      codeSubmitFeedback[saved.questionId] = buildSubmissionFeedback(
        {
          submissionId: saved.autoResult?.latestSubmissionId || answer.hydro?.submissionId || '',
          externalSubmissionId: saved.autoResult?.externalSubmissionId || answer.hydro?.externalSubmissionId || '',
          status: saved.autoResult?.status || (saved.status === 'judge_done' ? 'accepted' : 'pending'),
          isCorrect: saved.isCorrect,
          score: saved.score,
          maxScore: question?.score ?? saved.autoResult?.maxScore ?? 0,
          passedTestCaseCount: saved.autoResult?.passedTestCaseCount,
          totalTestCaseCount: saved.autoResult?.totalTestCaseCount,
          scoreRate: saved.autoResult?.scoreRate,
          language: answers[saved.questionId].language,
          mode: answer.hydro?.mode || saved.autoResult?.mode || 'direct',
          problemUrl: saved.autoResult?.problemUrl || answer.hydro?.problemUrl || '',
          recordUrl: saved.autoResult?.recordUrl || saved.autoResult?.result?.recordUrl || '',
          message: saved.autoResult?.message || (saved.status === 'judge_done' ? '判题结果已同步' : '等待 Hydro 判题结果'),
        },
        saved.isCorrect === true ? 'success' : 'info',
      );
    }
  }
}

function isAnswered(questionId) {
  const answer = answers[questionId];
  if (!answer) return false;
  if (answer.selectedOptionIds?.filter(Boolean).length) return true;
  if (answer.blanks?.some((blank) => String(blank.value ?? '').trim())) return true;
  if (String(answer.code ?? '').trim()) return true;
  if (String(answer.text ?? '').trim()) return true;
  return false;
}

function isFlagged(questionId) {
  return Boolean(flagged[questionId]);
}

function payloadFor(questionId) {
  const answer = answers[questionId];
  if (!answer) return {};
  if (answer.selectedOptionIds?.filter(Boolean).length) {
    return { selectedOptionIds: answer.selectedOptionIds.filter(Boolean) };
  }
  if (answer.blanks?.some((blank) => String(blank.value ?? '').trim())) {
    return { blanks: answer.blanks };
  }
  if (String(answer.code ?? '').trim()) {
    return {
      text: answer.code,
      code: answer.code,
      language: answer.language || 'cc.cc17o2',
    };
  }
  if (String(answer.text ?? '').trim()) {
    return { text: answer.text };
  }
  return {};
}

function languageOptionsFor(question) {
  const languages = question.programmingRef?.languages || [];
  return languages.length ? languages : ['cc.cc17o2', 'py.py3', 'java'];
}

function isSplitQuestion(type) {
  return !objectiveQuestionTypes.has(type);
}

function blankCountFor(question) {
  const explicit = Number(question?.blankCount);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const answerBlanks = question?.answer?.blanks;
  if (Array.isArray(answerBlanks) && answerBlanks.length) return answerBlanks.length;
  return Math.max(1, countBlankMarkers(question?.content));
}

function blankAnswerList(question, existing = []) {
  const source = Array.isArray(existing) ? existing : [];
  const count = Math.max(blankCountFor(question), ...source.map((blank) => Number(blank?.index) || 0), 1);
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

function typeLabel(value) {
  const map = {
    single_choice: '单选题',
    multiple_choice: '多选题',
    true_false: '判断题',
    fill_blank: '填空题',
    short_answer: '简答题',
    programming: '编程题',
    material: '材料/组合题',
    file_upload: '文件上传题',
    scratch_project: 'Scratch 项目题',
    arduino_project: 'Arduino 项目题',
  };
  return map[value] ?? value;
}

function questionMetaLabel(entry) {
  const questionType = typeLabel(entry.question.type);
  const sectionTitle = String(entry.sectionTitle || '').trim();
  if (!sectionTitle || sectionTitle === questionType) return questionType;
  if (['客观题', '主观题'].includes(sectionTitle)) return questionType;
  return `${questionType} · ${sectionTitle}`;
}

function languageLabel(language) {
  const labels = {
    'cc.cc17o2': 'C++17(O2)',
    'cc.cc17': 'C++17',
    'cc.cc14o2': 'C++14(O2)',
    'cc.cc14': 'C++14',
    'cc.cc11o2': 'C++11(O2)',
    'cc.cc11': 'C++11',
    'py.py3': 'Python 3',
    'py.py2': 'Python 2',
    'cc.cc20o2': 'C++20(O2)',
    'cc.cc20': 'C++20',
    cpp17: 'C++17',
    python3: 'Python 3',
    java: 'Java',
    c: 'C',
    cc: 'C++',
    pas: 'Pascal',
  };
  return labels[language] ?? language;
}

function openHydroProblem(question) {
  const url = question.programmingRef?.externalProblemUrl;
  if (!url) {
    ElMessage.warning('该题尚未配置 Hydro 链接');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function loadHydroAccounts() {
  try {
    const data = await listMyHydroAccounts();
    hydroAccounts.value = data.items ?? data ?? [];
  } catch {
    hydroAccounts.value = [];
  }
}

function defaultHydroAccountId(question) {
  const matched = matchedHydroAccountsFor(question);
  const boundAccountId = question?.programmingRef?.accountId;
  return matched.find((account) => account.id === boundAccountId)?.id || matched[0]?.id || '';
}

function matchedHydroAccountsFor(question) {
  const targetBaseUrl = programmingRefBaseUrl(question?.programmingRef);
  if (!targetBaseUrl) return [];
  return hydroAccounts.value.filter(
    (account) => account.bindStatus === 'bound' && sameHydroBaseUrl(account.platformBaseUrl, targetBaseUrl),
  );
}

function programmingRefBaseUrl(ref) {
  const raw = ref?.platformBaseUrl || baseUrlFromProblemUrl(ref?.externalProblemUrl);
  return raw ? normalizeBaseUrl(raw) : '';
}

function baseUrlFromProblemUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, '');
}

function shortHost(value) {
  try {
    return new URL(normalizeBaseUrl(value)).host;
  } catch {
    return String(value || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}

function sameHydroBaseUrl(left, right) {
  const leftHost = canonicalHost(left);
  const rightHost = canonicalHost(right);
  return Boolean(leftHost && rightHost && leftHost === rightHost);
}

function canonicalHost(value) {
  return shortHost(value).toLowerCase().replace(/^www\./, '');
}

function hydroAccountLabel(account) {
  return `${account.loginUsername || account.hydroUsername || 'Hydro账号'} · ${shortHost(account.platformBaseUrl)}`;
}

function hydroSourceLabel(ref) {
  const host = shortHost(programmingRefBaseUrl(ref));
  const domain = ref?.domainName || ref?.domainId || 'system';
  return [host, domain && domain !== 'system' ? domain : 'system'].filter(Boolean).join(' / ');
}

async function submitCode(entry) {
  const question = entry.question;
  const answer = answers[question.questionId];
  const accountId = selectedHydroAccountIds[question.questionId];
  if (!attemptId.value || !answer) return;
  if (!String(answer.code ?? '').trim()) {
    ElMessage.warning('请先填写代码');
    return;
  }
  if (!accountId) {
    ElMessage.warning('请选择当前题目来源站点下的提交账号');
    return;
  }

  codeSubmitLoading[question.questionId] = true;
  try {
    const result = await submitHydroAttemptCode(attemptId.value, question.questionId, {
        language: answer.language || languageOptionsFor(question)[0],
        code: answer.code,
        accountId,
    });
    codeSubmitFeedback[question.questionId] = buildSubmissionFeedback(result, 'success');
    ElMessage.success(result.message || '代码已提交');
  } catch (error) {
    codeSubmitFeedback[question.questionId] = {
      type: 'error',
      title: '代码提交失败',
      message: error.message || '代码提交失败',
      status: '',
      language: answer.language,
      externalSubmissionId: '',
      score: null,
      submissionId: '',
    };
    ElMessage.error(error.message || '代码提交失败');
  } finally {
    codeSubmitLoading[question.questionId] = false;
  }
}

async function refreshSubmission(questionId) {
  const feedback = codeSubmitFeedback[questionId];
  if (!feedback?.submissionId) return;
  codeSubmitLoading[questionId] = true;
  try {
    const detail = await getHydroSubmission(feedback.submissionId);
    codeSubmitFeedback[questionId] = buildSubmissionFeedback(detail, detail.isCorrect === true ? 'success' : 'info');
    ElMessage.success('判题结果已刷新');
  } catch (error) {
    ElMessage.error(error.message || '刷新失败');
  } finally {
    codeSubmitLoading[questionId] = false;
  }
}

function buildSubmissionFeedback(result, fallbackType = 'info') {
  const status = result.status || '';
  const final = !['pending', 'judging'].includes(status);
  const detail = result.result || {};
  const passedTestCaseCount = result.passedTestCaseCount ?? detail.passedTestCaseCount ?? null;
  const totalTestCaseCount = result.totalTestCaseCount ?? detail.totalTestCaseCount ?? null;
  const score = result.score ?? null;
  const maxScore = result.maxScore ?? 0;
  const scoreRate = result.scoreRate ?? detail.scoreRate ?? null;
  const isFullScore = isFullProgrammingScore({
    isCorrect: result.isCorrect,
    score,
    maxScore,
    passedTestCaseCount,
    totalTestCaseCount,
    scoreRate,
    status,
  });
  return {
    type: isFullScore ? 'success' : final ? 'error' : fallbackType,
    title: result.mode === 'manual' ? '本地提交已记录' : isFullScore ? '全部测试点通过' : final ? '部分测试点未通过' : '等待 Hydro 评测',
    message: result.message || '',
    status,
    language: result.language || '',
    externalSubmissionId: result.externalSubmissionId || '',
    score,
    maxScore,
    passedTestCaseCount,
    totalTestCaseCount,
    scoreRate,
    isCorrect: final ? isFullScore : null,
    submissionId: result.submissionId || '',
    problemUrl: result.problemUrl || '',
    recordUrl: result.recordUrl || '',
  };
}

function isFullProgrammingScore(result) {
  const passed = Number(result.passedTestCaseCount);
  const total = Number(result.totalTestCaseCount);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(passed)) {
    return passed === total;
  }
  const rate = Number(result.scoreRate);
  if (Number.isFinite(rate)) return rate >= 1;
  const score = Number(result.score);
  const maxScore = Number(result.maxScore);
  if (Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0) {
    return score >= maxScore;
  }
  if (result.isCorrect === true) return true;
  if (result.isCorrect === false) return false;
  return result.status === 'accepted';
}

function clearAnswer(questionId) {
  if (!answers[questionId]) return;
  const question = flatQuestions.value.find((entry) => entry.question.questionId === questionId)?.question;
  Object.assign(answers[questionId], {
    ...emptyAnswer(),
    blanks: blankAnswerList(question),
    language: question ? languageOptionsFor(question)[0] || 'cc.cc17o2' : 'cc.cc17o2',
  });
  ElMessage.success('已清除答案');
}

function clearCurrentAnswer() {
  if (currentQuestionId.value) {
    clearAnswer(currentQuestionId.value);
  }
}

function toggleFlag(questionId) {
  if (!questionId) return;
  if (flagged[questionId]) {
    delete flagged[questionId];
  } else {
    flagged[questionId] = true;
  }
  persistFlags();
}

function toggleCurrentFlag() {
  toggleFlag(currentQuestionId.value);
}

function exitSimulation() {
  router.push('/exams');
}

function flagStorageKey() {
  return `exam-flags:${attemptId.value}`;
}

function loadFlags() {
  Object.keys(flagged).forEach((key) => delete flagged[key]);
  if (!attemptId.value) return;
  const raw = localStorage.getItem(flagStorageKey());
  const stored = raw ? JSON.parse(raw) : {};
  Object.entries(stored).forEach(([questionId, value]) => {
    if (value) flagged[questionId] = true;
  });
}

function persistFlags() {
  if (!attemptId.value) return;
  localStorage.setItem(flagStorageKey(), JSON.stringify(flagged));
}

function numberButtonClass(entry) {
  const questionId = entry.question.questionId;
  return {
    'question-nav-item': true,
    current: entry.index === currentIndex.value,
    answered: isAnswered(questionId),
    unanswered: !isAnswered(questionId),
    flagged: isFlagged(questionId),
  };
}

function numberTitle(entry) {
  const status = isAnswered(entry.question.questionId) ? '已答' : '未答';
  const flag = isFlagged(entry.question.questionId) ? '，有疑问' : '';
  return `第 ${entry.index + 1} 题：${status}${flag}`;
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

function toggleAside() {
  asideCollapsed.value = !asideCollapsed.value;
  localStorage.setItem('exam-aside-collapsed', String(asideCollapsed.value));
}

function savePayload(finalizeEndedAttempt = false) {
  return {
    answers: flatQuestions.value.map((entry) => ({
      questionId: entry.question.questionId,
      answer: payloadFor(entry.question.questionId),
    })),
    finalizeEndedAttempt,
  };
}

async function saveAll(options = {}) {
  const { silent = false, finalizeEndedAttempt = false, keepalive = false, swallow = false } = options;
  if (!attemptId.value || submitted.value) return null;

  const body = savePayload(finalizeEndedAttempt);
  try {
    const result = await saveStudentAnswers(
      attemptId.value,
      body,
      isSimulating.value ? simulateStudentId.value : undefined,
      keepalive,
    );
    answersDirty.value = false;
    if (!silent) ElMessage.success('已保存');
    return result;
  } catch (error) {
    if (!silent) ElMessage.error(error.message || '保存失败');
    if (!swallow) throw error;
    return null;
  }
}

function scheduleAutosave() {
  if (!attemptId.value || submitted.value || autoSubmitting.value) return;
  answersDirty.value = true;
  if (autosaveTimer) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    void flushAutosave();
  }, 1800);
}

function startAutosave() {
  if (autosaveInterval) window.clearInterval(autosaveInterval);
  autosaveInterval = window.setInterval(() => {
    void flushAutosave();
  }, 8000);
}

async function flushAutosave(options = {}) {
  if (!attemptId.value || submitted.value || autoSubmitting.value || !answersDirty.value) return null;
  if (saveInFlight) {
    pendingAutosave = true;
    return null;
  }

  saveInFlight = true;
  try {
    return await saveAll({ silent: true, swallow: true, ...options });
  } finally {
    saveInFlight = false;
    if (pendingAutosave) {
      pendingAutosave = false;
      void flushAutosave(options);
    }
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    void flushAutosave({ keepalive: true });
  }
}

function handlePageHide() {
  if (!answersDirty.value || !attemptId.value || submitted.value) return;
  void saveAll({ silent: true, keepalive: true, swallow: true });
}

async function finalizeRemoteEndedAttempt() {
  if (submitted.value || !attemptId.value) return;

  autoSubmitting.value = true;
  const result = await saveAll({
    silent: true,
    finalizeEndedAttempt: true,
    swallow: true,
  });
  submitted.value = true;
  ElMessage.warning(result?.finalized ? '考试已结束，已保存当前页面答案并交卷' : '考试已结束，系统已提交当前答卷');
  const query = isSimulating.value ? `?simulateStudentId=${simulateStudentId.value}` : '';
  router.push(`/student/attempts/${attemptId.value}/result${query}`);
}

async function submit(options = {}) {
  if (submitted.value || autoSubmitting.value) return;
  const { skipConfirm = false, auto = false } = options;
  const unanswered = totalCount.value - answeredCount.value;
  const flaggedText = flaggedCount.value ? `，其中 ${flaggedCount.value} 题已标疑` : '';
  if (!skipConfirm) {
    await ElMessageBox.confirm(`还有 ${unanswered} 题未作答${flaggedText}。提交后不能继续修改答案。`, '确认提交', { type: 'warning' });
  }
  autoSubmitting.value = true;
  try {
    await saveAll({ silent: auto, finalizeEndedAttempt: auto || remainingMs.value <= 0 });
    const result = await submitStudentAttempt(
      attemptId.value,
      isSimulating.value ? simulateStudentId.value : undefined,
    );
    submitted.value = true;
    ElMessage.success(auto ? '考试时间已到，系统已自动交卷' : '已提交');
    const query = isSimulating.value ? `?simulateStudentId=${simulateStudentId.value}` : '';
    router.push(`/student/attempts/${result.attemptId || attemptId.value}/result${query}`);
  } finally {
    if (!submitted.value) autoSubmitting.value = false;
  }
}

async function autoSubmitExam() {
  if (submitted.value || autoSubmitting.value || !attemptId.value) return;
  try {
    ElMessage.error('考试时间已到，正在自动交卷');
    await submit({ skipConfirm: true, auto: true });
  } catch (error) {
    autoSubmitting.value = false;
    ElMessage.error(error.message || '自动交卷失败，请手动提交');
  }
}

function startClock() {
  if (clockTimer) window.clearInterval(clockTimer);
  checkTimeWarnings();
  clockTimer = window.setInterval(() => {
    clockNow.value = Date.now();
    checkTimeWarnings();
  }, 1000);
}

function startStatusPolling() {
  if (statusTimer) window.clearInterval(statusTimer);
  statusTimer = window.setInterval(refreshAttemptStatus, 10_000);
}

async function refreshAttemptStatus() {
  if (!attemptId.value || submitted.value || autoSubmitting.value) return;
  try {
    const data = await getStudentAttempt(
      attemptId.value,
      isSimulating.value ? simulateStudentId.value : undefined,
    );
    if (data.exam) {
      exam.value = data.exam;
      serverOffsetMs.value = Date.now() - new Date(data.exam.serverTime || Date.now()).getTime();
    }
    if (data.status && data.status !== 'in_progress') {
      await finalizeRemoteEndedAttempt();
    }
  } catch {
    // Keep local countdown/save behavior active; explicit save/submit actions will show any actionable error.
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
    autoSubmitExam();
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

onMounted(() => {
  window.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('beforeunload', handlePageHide);
  void load();
});

onUnmounted(() => {
  if (clockTimer) window.clearInterval(clockTimer);
  if (statusTimer) window.clearInterval(statusTimer);
  if (autosaveTimer) window.clearTimeout(autosaveTimer);
  if (autosaveInterval) window.clearInterval(autosaveInterval);
  window.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('pagehide', handlePageHide);
  window.removeEventListener('beforeunload', handlePageHide);
});

return {
  ArrowLeft,
  ArrowRight,
  Check,
  Close,
  Delete,
  ElMessage,
  ElMessageBox,
  Expand,
  Flag,
  Fold,
  Link,
  Refresh,
  Upload,
  answerLayout,
  answeredCount,
  answers,
  answersDirty,
  answersHydrating,
  applySavedAnswers,
  asideCollapsed,
  attemptId,
  attemptStartedAt,
  autoSubmitExam,
  autoSubmitting,
  autosaveInterval,
  autosaveTimer,
  baseUrlFromProblemUrl,
  blankAnswerList,
  blankCountFor,
  buildSubmissionFeedback,
  canonicalHost,
  checkTimeWarnings,
  clearAnswer,
  clearCurrentAnswer,
  clockNow,
  clockTimer,
  codeSubmitFeedback,
  codeSubmitLoading,
  computed,
  countBlankMarkers,
  currentEntry,
  currentIndex,
  currentQuestionId,
  defaultHydroAccountId,
  emptyAnswer,
  enterStudentExam,
  exam,
  exitSimulation,
  finalizeRemoteEndedAttempt,
  flagStorageKey,
  flagged,
  flaggedCount,
  flatQuestions,
  flushAutosave,
  formatDuration,
  getHydroSubmission,
  getStudentAttempt,
  goQuestion,
  handlePageHide,
  handleVisibilityChange,
  hydroAccountLabel,
  hydroAccounts,
  hydroSourceLabel,
  isAnswered,
  isFlagged,
  isFullProgrammingScore,
  isSimulating,
  isSplitQuestion,
  languageLabel,
  languageOptionsFor,
  listMyHydroAccounts,
  load,
  loadFlags,
  loadHydroAccounts,
  matchedHydroAccountsFor,
  nextTick,
  normalizeBaseUrl,
  numberButtonClass,
  numberTitle,
  objectiveQuestionTypes,
  onMounted,
  onUnmounted,
  openHydroProblem,
  paper,
  payloadFor,
  pendingAutosave,
  persistFlags,
  programmingRefBaseUrl,
  progressPercent,
  questionMetaLabel,
  reactive,
  ref,
  refreshAttemptStatus,
  refreshSubmission,
  remainingMs,
  resetAnswers,
  route,
  router,
  sameHydroBaseUrl,
  saveAll,
  saveInFlight,
  savePayload,
  saveStudentAnswers,
  scheduleAutosave,
  selectedHydroAccountIds,
  serverOffsetMs,
  shortHost,
  simulateStudentId,
  startAutosave,
  startClock,
  startStatusPolling,
  statusTimer,
  submit,
  submitCode,
  submitHydroAttemptCode,
  submitStudentAttempt,
  submitted,
  toggleAside,
  toggleCurrentFlag,
  toggleFlag,
  totalCount,
  typeLabel,
  useExamCountdown,
  useRoute,
  useRouter,
  visibleEntries,
  visibleEntriesReady,
  warnedThresholds,
  watch,
};
}
