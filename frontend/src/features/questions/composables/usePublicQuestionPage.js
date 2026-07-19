import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getCurrentUser, getToken, onSessionChange } from '../../../api';
import { useResponsiveColumns } from '../../../composables/useResponsiveColumns';
import {
  hydroAccountLabel,
  languageLabel,
  languageOptionsFor,
  programmingRefBaseUrl,
  sameHydroBaseUrl,
  shortHost,
} from '../../../question-engine/answer-utils';
import { isObjectiveQuestionType, questionTypeLabel, registeredQuestionTypes } from '../../../question-engine/registry';
import { listMyHydroAccounts, submitHydroPracticeCode } from '../../hydro/api';
import { addWrongQuestionsBatch } from '../../papers/api';
import { checkQuestionAnswer, getPublicQuestion, listPublicQuestions } from '../api';
import {
  emptyQuestionAnswer,
  hasAnswer,
  materialChildId,
  materialChildQuestion,
  materialChildScore,
  materialChildren,
  payloadForAnswer,
  programmingFeedbackTitle,
  programmingFeedbackType,
  roundScore,
  scaleMaterialChildResult,
} from './publicQuestionAnswer';

export function usePublicQuestionPage() {
  const router = useRouter();
  const { showMediumColumns } = useResponsiveColumns();
  const typeOptions = registeredQuestionTypes().map((type) => ({ label: type.label, value: type.code }));
  const items = ref([]);
  const selectedRows = ref([]);
  const detail = ref(null);
  const result = ref(null);
  const programmingResult = ref(null);
  const programmingSubmitLoading = ref(false);
  const practiceVisible = ref(false);
  const answerLayout = ref('side');
  const hydroAccounts = ref([]);
  const selectedHydroAccountId = ref('');
  const answer = reactive(emptyQuestionAnswer());
  const childAnswers = reactive({});
  const childResults = reactive({});
  const user = ref(getCurrentUser());
  const filter = reactive({
    keyword: '', type: '', difficulty: '', tagId: '', knowledgePointId: '',
    sortBy: 'createdAt', sortOrder: 'desc',
  });
  const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
  const pageSizes = [20, 50, 100];
  const canBatchAddWrong = computed(() => user.value?.userType === 'STUDENT');
  const selectedQuestionIds = computed(() => selectedRows.value.map((row) => row.id));
  const practiceDialogWidth = computed(() => (answerLayout.value === 'side' ? '1180px' : '860px'));
  const matchedHydroAccounts = computed(() => matchedHydroAccountsFor(detail.value));
  let unsubscribeSession = null;

  async function load() {
    const data = await listPublicQuestions({
      page: pagination.page,
      pageSize: pagination.pageSize,
      keyword: filter.keyword || undefined,
      type: filter.type || undefined,
      difficulty: filter.difficulty || undefined,
      tagId: filter.tagId || undefined,
      knowledgePointId: filter.knowledgePointId || undefined,
      sortBy: filter.sortBy,
      sortOrder: filter.sortOrder,
    });
    items.value = data.items;
    pagination.page = data.page;
    pagination.pageSize = data.pageSize;
    pagination.total = data.total;
  }

  function loadFirstPage() {
    pagination.page = 1;
    return load();
  }

  function handleQuestionSortChange({ prop, order }) {
    filter.sortBy = prop || 'createdAt';
    filter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
    return loadFirstPage();
  }

  async function filterByTag(tag) {
    filter.tagId = tag.id;
    await loadFirstPage();
  }

  async function filterByKnowledgePoint(point) {
    filter.knowledgePointId = point.id;
    await loadFirstPage();
  }

  function handleSizeChange(size) {
    pagination.pageSize = size;
    pagination.page = 1;
    load();
  }

  function handleCurrentChange(page) {
    pagination.page = page;
    load();
  }

  async function selectQuestion(row) {
    detail.value = await getPublicQuestion(row.id);
    clearAnswer();
    await prepareHydroAccountSelection(detail.value);
    practiceVisible.value = true;
  }

  function handleSelectionChange(rows) {
    selectedRows.value = rows;
  }

  async function batchAddWrongQuestions() {
    if (!getToken()) {
      ElMessage.warning('请先登录后再加入错题本');
      router.push('/login');
      return;
    }
    if (!canBatchAddWrong.value) {
      ElMessage.warning('仅学生账号可以加入个人错题本');
      return;
    }
    if (!selectedQuestionIds.value.length) {
      ElMessage.warning('请选择题目');
      return;
    }

    const batchResult = await addWrongQuestionsBatch({
      items: selectedQuestionIds.value.map((questionId) => ({ questionId })),
    });
    const failedText = batchResult.failed?.length ? `，${batchResult.failed.length} 道失败` : '';
    ElMessage.success(`已加入 ${batchResult.successCount} 道题${failedText}`);
  }

  async function checkAnswer() {
    if (!getToken()) {
      ElMessage.warning('请先登录后再作答');
      router.push('/login');
      return;
    }
    if (detail.value?.type === 'material') {
      await checkMaterialAnswer();
      return;
    }
    result.value = await checkQuestionAnswer(detail.value.id, payloadForAnswer(answer));
  }

  function clearAnswer() {
    Object.assign(answer, emptyQuestionAnswer(detail.value));
    resetChildState();
    if (detail.value?.type === 'material') {
      for (const child of materialChildren(detail.value)) {
        childAnswers[materialChildId(child)] = emptyQuestionAnswer(materialChildQuestion(child));
      }
    }
    result.value = null;
    programmingResult.value = null;
  }

  function mergeAnswer(nextAnswer) {
    Object.assign(answer, nextAnswer || {});
  }

  function mergeChildAnswers(value) {
    Object.keys(childAnswers).forEach((key) => delete childAnswers[key]);
    Object.entries(value || {}).forEach(([key, childAnswer]) => {
      childAnswers[key] = childAnswer || {};
    });
  }

  function resetChildState() {
    Object.keys(childAnswers).forEach((key) => delete childAnswers[key]);
    Object.keys(childResults).forEach((key) => delete childResults[key]);
  }

  async function checkMaterialAnswer() {
    const children = materialChildren(detail.value);
    if (!children.length) {
      ElMessage.warning('该材料/组合题尚未配置子题');
      return;
    }
    const missingIndex = children.findIndex((child) => !hasAnswer(childAnswers[materialChildId(child)]));
    if (missingIndex >= 0) {
      ElMessage.warning(`请先完成第 ${missingIndex + 1} 道子题`);
      return;
    }

    const results = [];
    Object.keys(childResults).forEach((key) => delete childResults[key]);
    for (const child of children) {
      const childId = materialChildId(child);
      const response = await checkQuestionAnswer(childId, payloadForAnswer(childAnswers[childId] || {}));
      const scaled = scaleMaterialChildResult(response, materialChildScore(child));
      childResults[childId] = scaled;
      results.push(scaled);
    }

    const score = roundScore(results.reduce((sum, item) => sum + Number(item.score || 0), 0));
    const totalScore = roundScore(children.reduce((sum, child) => sum + materialChildScore(child), 0));
    const hasWrong = results.some((item) => item.isCorrect === false);
    const hasPending = results.some((item) => item.isCorrect === null || item.status === 'manual_needed');
    result.value = {
      isCorrect: hasPending ? null : !hasWrong,
      score,
      totalScore,
      status: hasPending ? 'manual_needed' : 'auto_graded',
      message: hasPending ? '材料/组合题已提交，部分子题待批改' : hasWrong ? '材料/组合题存在错误' : '材料/组合题回答正确',
      details: results.map((item, index) => ({
        childIndex: index + 1,
        questionId: materialChildId(children[index]),
        score: item.score,
        totalScore: item.totalScore,
        isCorrect: item.isCorrect,
        status: item.status,
      })),
    };
  }

  async function submitProgrammingAnswer() {
    if (!getToken()) {
      ElMessage.warning('请先登录后再作答');
      router.push('/login');
      return;
    }
    if (!String(answer.code ?? '').trim()) {
      ElMessage.warning('请先填写代码');
      return;
    }
    if (!selectedHydroAccountId.value) {
      ElMessage.warning('请选择当前题目来源站点下的提交账号');
      return;
    }
    programmingSubmitLoading.value = true;
    try {
      const response = await submitHydroPracticeCode(detail.value.id, {
        language: answer.language || languageOptionsFor(detail.value)[0],
        code: answer.code,
        accountId: selectedHydroAccountId.value,
      });
      programmingResult.value = response;
      ElMessage.success(response.message || '代码已提交到 Hydro');
    } catch (error) {
      ElMessage.error(error.message || 'Hydro 提交失败');
    } finally {
      programmingSubmitLoading.value = false;
    }
  }

  function openHydroProblem(question) {
    const url = question?.programmingRef?.externalProblemUrl;
    if (!url) {
      ElMessage.warning('该题尚未配置 Hydro 链接');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function loadHydroAccounts() {
    if (!getToken()) {
      hydroAccounts.value = [];
      return;
    }
    try {
      const data = await listMyHydroAccounts();
      hydroAccounts.value = data.items ?? data ?? [];
    } catch {
      hydroAccounts.value = [];
    }
  }

  async function prepareHydroAccountSelection(question) {
    selectedHydroAccountId.value = '';
    if (question?.type !== 'programming') return;
    await loadHydroAccounts();
    selectedHydroAccountId.value = defaultHydroAccountId(question);
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

  function hydroSourceLabel(ref) {
    const host = shortHost(programmingRefBaseUrl(ref));
    const domain = ref?.domainName || ref?.domainId || 'system';
    return [host, domain && domain !== 'system' ? domain : 'system'].filter(Boolean).join(' / ');
  }

  function typeLabel(value) {
    return questionTypeLabel(value);
  }

  onMounted(() => {
    unsubscribeSession = onSessionChange(() => {
      user.value = getCurrentUser();
      hydroAccounts.value = [];
      selectedHydroAccountId.value = '';
    });
    load();
  });

  onUnmounted(() => {
    unsubscribeSession?.();
  });

  return {
    showMediumColumns, typeOptions, items, detail, result, programmingResult,
    programmingSubmitLoading, practiceVisible, answerLayout, selectedHydroAccountId,
    answer, childAnswers, childResults, filter, pagination, pageSizes, canBatchAddWrong,
    selectedQuestionIds, practiceDialogWidth, matchedHydroAccounts, load, loadFirstPage,
    handleQuestionSortChange, filterByTag, filterByKnowledgePoint, handleSizeChange,
    handleCurrentChange, selectQuestion, handleSelectionChange, batchAddWrongQuestions,
    checkAnswer, clearAnswer, mergeAnswer, mergeChildAnswers, submitProgrammingAnswer,
    openHydroProblem, hydroSourceLabel, typeLabel, getToken, isObjectiveQuestionType,
    languageOptionsFor, languageLabel, hydroAccountLabel, programmingFeedbackType,
    programmingFeedbackTitle,
  };
}
