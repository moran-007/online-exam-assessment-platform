import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  addStudentWrongQuestion,
  generateStudentWrongQuestionPaper,
  getWrongQuestionEvents,
  getWrongQuestionInsights,
  listWrongQuestions,
  recordWrongQuestionPractice,
  setWrongQuestionStatus,
} from '../../exams/api';
import { checkQuestionAnswer, listPublicQuestions } from '../../questions/api';
import { createWrongQuestionExportTask } from '../../exports/api';
import { useResponsiveColumns } from '../../../composables/useResponsiveColumns';
import { isObjectiveQuestionType, questionTypeLabel } from '../../../question-engine/registry';
import {
  answerPayload,
  emptyAnswer,
  eventLabel,
  formatDateTime,
  formatShortDate,
  languageLabel,
  languageOptionsFor,
  masteryBarWidth,
  masteryLabel,
  sourceLabel,
} from './wrong-question-answer';

export function useWrongQuestionPage() {
  const router = useRouter();
  const { showMediumColumns, showLowColumns } = useResponsiveColumns();
  const items = ref([]);
  const wrongTab = ref('active');
  const candidates = ref([]);
  const candidateKeyword = ref('');
  const selectedCandidateId = ref('');
  const practice = ref(null);
  const practiceVisible = ref(false);
  const practiceResult = ref(null);
  const answerLayout = ref('side');
  const exportVisible = ref(false);
  const traceVisible = ref(false);
  const traceEvents = ref([]);
  const traceTitle = ref('');
  const insights = reactive({ sourceSummary: [], masteryCurve: [], reviewReminders: [], recentEvents: [] });
  const answer = reactive(emptyAnswer());
  const exportForm = reactive({
    format: 'pdf',
    includeAnswers: true,
    includeAnalysis: true,
    includeWrongInfo: true,
  });
  const practiceDialogWidth = computed(() => (answerLayout.value === 'side' ? '1180px' : '860px'));
  const canUseActiveActions = computed(() => wrongTab.value === 'active' && items.value.length > 0);

  async function load() {
    const [wrongItems, insightData] = await Promise.all([
      listWrongQuestions({ mastery: wrongTab.value }),
      getWrongQuestionInsights(),
    ]);
    items.value = wrongItems;
    Object.assign(insights, {
      sourceSummary: insightData.sourceSummary ?? [],
      masteryCurve: insightData.masteryCurve ?? [],
      reviewReminders: insightData.reviewReminders ?? [],
      recentEvents: insightData.recentEvents ?? [],
    });
  }

  async function loadCandidates() {
    const data = await listPublicQuestions({ pageSize: 30, keyword: candidateKeyword.value || undefined });
    candidates.value = data.items;
    selectedCandidateId.value = candidates.value.some((question) => question.id === selectedCandidateId.value)
      ? selectedCandidateId.value
      : candidates.value[0]?.id || '';
  }

  async function addWrongQuestion() {
    if (!selectedCandidateId.value) return;
    await addStudentWrongQuestion({ questionId: selectedCandidateId.value });
    ElMessage.success('已加入错题本');
    await load();
  }

  async function generateWrongPaper() {
    if (!canUseActiveActions.value) return;
    await ElMessageBox.confirm(`将使用当前 ${items.value.length} 道错题生成个人练习卷，生成后可直接试答。`, '错题组卷', {
      type: 'info',
      confirmButtonText: '生成试卷',
      cancelButtonText: '取消',
    });
    const result = await generateStudentWrongQuestionPaper({
      name: `我的错题组卷 ${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}`,
      count: items.value.length,
      random: false,
    });
    ElMessage.success(`已生成 ${result.questionCount} 道题的错题卷`);
    router.push({ path: `/papers/${result.paperId}/answer`, query: { return: '/student/wrong-questions' } });
  }

  async function exportWrongQuestions() {
    const task = await createWrongQuestionExportTask({ type: 'wrong_questions', ...exportForm });
    exportVisible.value = false;
    ElMessage.success(`错题导出任务已加入队列：${task.id?.slice?.(0, 8) ?? ''}，请到导出中心下载`);
  }

  function pickRandom() {
    if (canUseActiveActions.value) openPractice(items.value[Math.floor(Math.random() * items.value.length)]);
  }

  function openPractice(row) {
    practice.value = row;
    practiceVisible.value = true;
    clearPracticeAnswer();
  }

  async function checkPractice() {
    if (!practice.value) return;
    const payload = answerPayload(answer);
    practiceResult.value = await checkQuestionAnswer(practice.value.question.id, payload);
    let recordedResult = null;
    if (practiceResult.value?.isCorrect !== null && practiceResult.value?.isCorrect !== undefined) {
      recordedResult = await recordWrongQuestionPractice(practice.value.question.id, {
        answer: payload,
        isCorrect: Boolean(practiceResult.value.isCorrect),
        score: practiceResult.value.score ?? 0,
        totalScore: practiceResult.value.totalScore ?? practice.value.question.defaultScore ?? 0,
      });
    }
    if (practiceResult.value?.isCorrect) {
      await load();
      if (recordedResult?.mastered) {
        ElMessage.success('已达到掌握规则，题目已进入已掌握');
        practiceVisible.value = false;
        practice.value = null;
      } else {
        ElMessage.success('已记录本次正确练习，后续仍会按复习规则出现');
      }
    } else if (practiceResult.value?.isCorrect === false) {
      await load();
      ElMessage.warning('已记录本次错题练习');
    }
  }

  async function hideWrongQuestion(row) {
    await updateWrongQuestionStatus(row, 'ignored');
    ElMessage.success('已移出错题本');
  }

  function handleWrongCommand(row, command) {
    if (command === 'practice') return openPractice(row);
    if (command === 'events') return showEvents(row);
    if (command === 'master') return markWrongQuestionMastered(row);
    if (command === 'review') return updateWrongQuestionStatus(row, 'reviewing');
    if (command === 'hide') return hideWrongQuestion(row);
  }

  function openReminder(questionId) {
    const row = items.value.find((item) => item.question.id === questionId);
    if (row) openPractice(row);
  }

  async function showEvents(row) {
    traceTitle.value = row.question.title;
    traceEvents.value = await getWrongQuestionEvents(row.question.id);
    traceVisible.value = true;
  }

  async function hideCurrent() {
    if (practice.value) await hideWrongQuestion(practice.value);
  }

  async function markCurrentMastered() {
    if (practice.value) await markWrongQuestionMastered(practice.value);
  }

  async function markWrongQuestionMastered(row) {
    await updateWrongQuestionStatus(row, 'mastered');
    ElMessage.success('已标记为掌握');
  }

  async function updateWrongQuestionStatus(row, masteryStatus) {
    await setWrongQuestionStatus(row.question.id, { masteryStatus });
    items.value = items.value.filter((item) => item.question.id !== row.question.id);
    if (practice.value?.question.id === row.question.id) {
      practice.value = null;
      practiceVisible.value = false;
    }
    await load();
  }

  function clearPracticeAnswer() {
    Object.assign(answer, emptyAnswer(practice.value?.question));
    practiceResult.value = null;
  }

  function mergeAnswer(nextAnswer) {
    Object.assign(answer, nextAnswer || {});
  }

  function openHydroProblem(question) {
    const url = question?.programmingRef?.externalProblemUrl;
    if (!url) return ElMessage.warning('该题尚未配置 Hydro 链接');
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  const barWidth = (value) => masteryBarWidth(value, insights.masteryCurve);

  onMounted(() => Promise.all([load(), loadCandidates()]));

  return {
    addWrongQuestion,
    answer,
    answerLayout,
    barWidth,
    canUseActiveActions,
    candidateKeyword,
    candidates,
    checkPractice,
    clearPracticeAnswer,
    eventLabel,
    exportForm,
    exportVisible,
    exportWrongQuestions,
    formatDateTime,
    formatShortDate,
    generateWrongPaper,
    handleWrongCommand,
    hideCurrent,
    insights,
    isObjectiveQuestionType,
    items,
    languageLabel,
    languageOptionsFor,
    load,
    loadCandidates,
    markCurrentMastered,
    masteryLabel,
    mergeAnswer,
    openHydroProblem,
    openPractice,
    openReminder,
    pickRandom,
    practice,
    practiceDialogWidth,
    practiceResult,
    practiceVisible,
    selectedCandidateId,
    showLowColumns,
    showMediumColumns,
    sourceLabel,
    traceEvents,
    traceTitle,
    traceVisible,
    typeLabel: questionTypeLabel,
    wrongTab,
  };
}
