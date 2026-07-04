<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">题库</h1>
      <div class="toolbar">
        <el-input
          v-model="filter.keyword"
          clearable
          placeholder="题目关键词"
          style="width: 200px"
          @keyup.enter="loadFirstPage"
          @clear="loadFirstPage"
        />
        <el-select v-model="filter.type" clearable placeholder="题型" style="width: 140px" @change="loadFirstPage">
          <el-option v-for="type in typeOptions" :key="type.value" :label="type.label" :value="type.value" />
        </el-select>
        <el-select v-model="filter.difficulty" clearable placeholder="难度" style="width: 120px" @change="loadFirstPage">
          <el-option v-for="level in [1, 2, 3, 4, 5]" :key="level" :label="`${level} 星`" :value="level" />
        </el-select>
        <el-button :icon="Search" @click="loadFirstPage">查询</el-button>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button
          v-if="canBatchAddWrong"
          type="success"
          :icon="Check"
          :disabled="!selectedQuestionIds.length"
          @click="batchAddWrongQuestions"
        >
          加入错题本
        </el-button>
      </div>
    </div>

    <div class="question-list-only">
      <div class="panel question-table-panel">
        <el-table
          class="question-list-table"
          :data="items"
          height="100%"
          :default-sort="{ prop: filter.sortBy, order: filter.sortOrder === 'asc' ? 'ascending' : 'descending' }"
          highlight-current-row
          @row-click="selectQuestion"
          @selection-change="handleSelectionChange"
          @sort-change="handleQuestionSortChange"
        >
          <el-table-column v-if="canBatchAddWrong" type="selection" width="48" />
          <el-table-column prop="title" label="题目" min-width="260" sortable="custom">
            <template #default="{ row }">
              <div class="question-title-cell">
                <strong>{{ row.title }}</strong>
              </div>
            </template>
          </el-table-column>
          <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="150" />
          <el-table-column prop="type" label="题型" width="110" sortable="custom">
            <template #default="{ row }">{{ typeLabel(row.type) }}</template>
          </el-table-column>
          <el-table-column prop="difficulty" label="难度" width="82" sortable="custom" />
          <el-table-column v-if="showMediumColumns" prop="defaultScore" label="分值" width="82" sortable="custom" />
          <el-table-column v-if="showMediumColumns" label="知识点" min-width="170">
            <template #default="{ row }">
              <el-tag
                v-for="point in row.knowledgePoints || []"
                :key="point.id"
                size="small"
                type="success"
                effect="plain"
                class="clickable-tag"
                @click.stop="filterByKnowledgePoint(point)"
              >
                {{ point.name }}
              </el-tag>
              <span v-if="!(row.knowledgePoints || []).length" class="muted">-</span>
            </template>
          </el-table-column>
          <el-table-column v-if="showMediumColumns" label="标签" min-width="170">
            <template #default="{ row }">
              <el-tag
                v-for="tag in row.tags || []"
                :key="tag.id"
                size="small"
                effect="plain"
                class="clickable-tag"
                @click.stop="filterByTag(tag)"
              >
                {{ tag.name }}
              </el-tag>
              <span v-if="!(row.tags || []).length" class="muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <el-button size="small" :icon="View" @click.stop="selectQuestion(row)">答题</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="table-footer">
          <span class="muted">共 {{ pagination.total }} 道可见题目</span>
          <el-pagination
            v-model:current-page="pagination.page"
            v-model:page-size="pagination.pageSize"
            background
            size="small"
            :pager-count="5"
            layout="sizes, prev, pager, next"
            :page-sizes="pageSizes"
            :total="pagination.total"
            @size-change="handleSizeChange"
            @current-change="handleCurrentChange"
          />
        </div>
      </div>
    </div>

    <el-dialog v-model="practiceVisible" title="题目作答" :width="practiceDialogWidth">
      <template v-if="detail">
        <div class="paper-preview-head answer-dialog-head">
          <div>
            <h2>{{ detail.title }}</h2>
            <span class="muted">{{ detail.courseName }} · {{ typeLabel(detail.type) }} · {{ detail.defaultScore }} 分</span>
          </div>
          <div class="toolbar">
            <el-radio-group v-model="answerLayout" size="small" class="answer-layout-toggle">
              <el-radio-button label="side">左右</el-radio-button>
              <el-radio-button label="stack">上下</el-radio-button>
            </el-radio-group>
            <el-tag type="success">公开</el-tag>
          </div>
        </div>

        <QuestionAnswerLayout :mode="answerLayout" framed>
          <template #statement>
            <MarkdownRenderer
              :source="detail.content"
              :public-question-id="detail.id"
              :asset-access-token="detail.assetAccessToken"
            />
          </template>

          <template #answer>
            <div class="question-answer-body">
              <div v-if="detail.type === 'programming'" class="programming-answer">
                <ProgrammingToolbarShell :summary="languageLabel(answer.language)">
                  <template #badge>
                    <el-tag v-if="!matchedHydroAccounts.length" type="warning" size="small">无账号</el-tag>
                  </template>
                  <template #default="{ close }">
                  <div class="programming-toolbar">
                    <span class="programming-language-label">语言</span>
                    <el-select v-model="answer.language" style="width: 170px" @change="close">
                      <el-option
                        v-for="language in languageOptionsFor(detail)"
                        :key="language"
                        :label="languageLabel(language)"
                        :value="language"
                      />
                    </el-select>
                    <el-tag v-if="detail.programmingRef?.platformBaseUrl || detail.programmingRef?.externalProblemUrl" type="info">
                      来源：{{ hydroSourceLabel(detail.programmingRef) }}
                    </el-tag>
                    <el-tag v-if="detail.programmingRef?.domainId" type="info">
                      域：{{ detail.programmingRef.domainName || detail.programmingRef.domainId }}
                    </el-tag>
                    <el-tag v-if="detail.programmingRef?.externalProblemId" type="success">
                      {{ detail.programmingRef.externalProblemId }}
                    </el-tag>
                    <span class="programming-language-label">账号</span>
                    <el-select
                      v-model="selectedHydroAccountId"
                      :disabled="!matchedHydroAccounts.length"
                      placeholder="选择提交账号"
                      style="width: 230px"
                      @change="close"
                    >
                      <el-option
                        v-for="account in matchedHydroAccounts"
                        :key="account.id"
                        :label="hydroAccountLabel(account)"
                        :value="account.id"
                      />
                    </el-select>
                    <el-tag v-if="!matchedHydroAccounts.length" type="warning">无同站点账号</el-tag>
                    <el-button :disabled="!detail.programmingRef?.externalProblemUrl" @click="close(); openHydroProblem(detail)">打开 Hydro</el-button>
                  </div>
                  </template>
                </ProgrammingToolbarShell>
                <el-alert
                  v-if="programmingResult"
                  class="code-submit-feedback"
                  :type="programmingFeedbackType(programmingResult)"
                  :closable="false"
                  show-icon
                >
                  <template #title>{{ programmingFeedbackTitle(programmingResult) }}</template>
                  <div class="code-submit-meta">
                    <span>状态：{{ programmingResult.status }}</span>
                    <span>语言：{{ languageLabel(programmingResult.language) }}</span>
                    <span v-if="programmingResult.externalSubmissionId">Hydro提交：{{ programmingResult.externalSubmissionId }}</span>
                    <span v-if="programmingResult.score !== null && programmingResult.score !== undefined">
                      得分：{{ programmingResult.score }} / {{ programmingResult.maxScore || detail.defaultScore || '-' }}
                    </span>
                    <span v-if="programmingResult.totalTestCaseCount">
                      测试点：{{ programmingResult.passedTestCaseCount }} / {{ programmingResult.totalTestCaseCount }}
                    </span>
                  </div>
                  <div v-if="programmingResult.message" class="code-submit-message">{{ programmingResult.message }}</div>
                </el-alert>
                <CodeAnswerEditor
                  v-model="answer.code"
                  :language="answer.language"
                  :language-label="languageLabel(answer.language)"
                  :rows="18"
                />
              </div>
              <MaterialQuestionAnswerPanel
                v-else-if="detail.type === 'material'"
                :model-value="childAnswers"
                :results="childResults"
                :material="detail"
                :rows="18"
                :public-question-id="detail.id"
                :asset-access-token="detail.assetAccessToken"
                @update:model-value="mergeChildAnswers"
              />
              <QuestionAnswerHost
                v-else
                :model-value="answer"
                :question="detail"
                :type="detail.type"
                :rows="isObjectiveQuestionType(detail.type) ? 5 : 18"
                :public-question-id="detail.id"
                :asset-access-token="detail.assetAccessToken"
                @update:model-value="mergeAnswer"
              />
            </div>
          </template>
        </QuestionAnswerLayout>

        <el-alert
          v-if="detail.type !== 'programming' && result"
          :title="`${result.message}，得分 ${result.score} / ${result.totalScore}`"
          :type="result.isCorrect ? 'success' : result.isCorrect === false ? 'error' : 'warning'"
          show-icon
          :closable="false"
          class="batch-alert"
        />
        <AnswerFeedback v-if="detail.type !== 'programming'" :result="result" />
      </template>
      <template #footer>
        <el-button @click="practiceVisible = false">关闭</el-button>
        <el-button :icon="Delete" @click="clearAnswer">清空</el-button>
        <el-button
          type="primary"
          :icon="Check"
          :loading="programmingSubmitLoading"
          :disabled="detail?.type === 'programming' && getToken() && !selectedHydroAccountId"
          @click="detail?.type === 'programming' ? submitProgrammingAnswer() : checkAnswer()"
        >
          {{ detail?.type === 'programming' ? '提交 Hydro 评测' : '提交作答' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Check, Delete, Refresh, Search, View } from '@element-plus/icons-vue';
import { api, buildQuery, getCurrentUser, getToken, onSessionChange } from '../api';
import AnswerFeedback from '../components/AnswerFeedback.vue';
import CodeAnswerEditor from '../components/CodeAnswerEditor.vue';
import MaterialQuestionAnswerPanel from '../components/MaterialQuestionAnswerPanel.vue';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';
import ProgrammingToolbarShell from '../components/ProgrammingToolbarShell.vue';
import QuestionAnswerHost from '../components/QuestionAnswerHost.vue';
import QuestionAnswerLayout from '../components/QuestionAnswerLayout.vue';
import { useResponsiveColumns } from '../composables/useResponsiveColumns';
import { isObjectiveQuestionType, questionTypeLabel, registeredQuestionTypes } from '../question-engine/registry';

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
const answer = reactive(emptyAnswer());
const childAnswers = reactive({});
const childResults = reactive({});
const user = ref(getCurrentUser());
const filter = reactive({
  keyword: '',
  type: '',
  difficulty: '',
  tagId: '',
  knowledgePointId: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
});
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const pageSizes = [20, 50, 100];
const canBatchAddWrong = computed(() => user.value?.userType === 'STUDENT');
const selectedQuestionIds = computed(() => selectedRows.value.map((row) => row.id));
const practiceDialogWidth = computed(() => (answerLayout.value === 'side' ? '1180px' : '860px'));
const matchedHydroAccounts = computed(() => matchedHydroAccountsFor(detail.value));
let unsubscribeSession = null;

async function load() {
  const data = await api(
    `/questions/public/list${buildQuery({
      page: pagination.page,
      pageSize: pagination.pageSize,
      keyword: filter.keyword,
      type: filter.type,
      difficulty: filter.difficulty,
      tagId: filter.tagId,
      knowledgePointId: filter.knowledgePointId,
      sortBy: filter.sortBy,
      sortOrder: filter.sortOrder,
    })}`,
  );
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
  detail.value = await api(`/questions/public/${row.id}`);
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

  const batchResult = await api('/student/wrong-questions/batch', {
    method: 'POST',
    body: { items: selectedQuestionIds.value.map((questionId) => ({ questionId })) },
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
  result.value = await api(`/questions/${detail.value.id}/check-answer`, {
    method: 'POST',
    body: payloadForAnswer(answer),
  });
}

function emptyAnswer(question = null) {
  return {
    selectedOptionIds: [],
    blanks: blankAnswerList(question),
    text: '',
    code: '',
    language: languageOptionsFor(question)[0] || 'cc.cc17o2',
  };
}

function clearAnswer() {
  Object.assign(answer, emptyAnswer(detail.value));
  resetChildState();
  if (detail.value?.type === 'material') {
    for (const child of materialChildren(detail.value)) {
      childAnswers[materialChildId(child)] = emptyAnswer(materialChildQuestion(child));
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

function payloadForAnswer(answerValue) {
  if (answerValue?.selectedOptionIds?.filter(Boolean).length) {
    return { selectedOptionIds: answerValue.selectedOptionIds.filter(Boolean) };
  }
  if (answerValue?.blanks?.some((blank) => String(blank.value ?? '').trim())) {
    return { blanks: answerValue.blanks };
  }
  if (String(answerValue?.text ?? '').trim()) {
    return { text: answerValue.text };
  }
  if (String(answerValue?.code ?? '').trim()) {
    return {
      text: answerValue.code,
      code: answerValue.code,
      language: answerValue.language || 'cc.cc17o2',
    };
  }
  return {};
}

function resetChildState() {
  Object.keys(childAnswers).forEach((key) => delete childAnswers[key]);
  Object.keys(childResults).forEach((key) => delete childResults[key]);
}

function materialChildren(question) {
  return Array.isArray(question?.children) ? question.children : [];
}

function materialChildQuestion(child) {
  const question = child?.question || child?.snapshot || child || {};
  return {
    ...question,
    id: question.id || question.questionId || child?.questionId,
    questionId: question.questionId || question.id || child?.questionId,
    defaultScore: materialChildScore(child),
  };
}

function materialChildId(child) {
  const question = materialChildQuestion(child);
  return question.questionId || question.id || child?.questionId;
}

function materialChildScore(child) {
  const explicit = Number(child?.score);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const fallback = Number((child?.question || child?.snapshot || child || {}).defaultScore);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

function hasAnswer(answerValue) {
  return Boolean(
    answerValue?.selectedOptionIds?.filter(Boolean).length
    || answerValue?.blanks?.some((blank) => String(blank.value ?? '').trim())
    || String(answerValue?.text ?? '').trim()
    || String(answerValue?.code ?? '').trim(),
  );
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
    const response = await api(`/questions/${childId}/check-answer`, {
      method: 'POST',
      body: payloadForAnswer(childAnswers[childId] || {}),
    });
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

function scaleMaterialChildResult(childResult, targetScore) {
  const sourceTotal = Number(childResult?.totalScore);
  const score = Number(childResult?.score);
  if (!Number.isFinite(sourceTotal) || sourceTotal <= 0 || !Number.isFinite(score)) {
    return { ...childResult, score: 0, totalScore: targetScore };
  }
  if (Math.abs(sourceTotal - targetScore) < 0.0001) return childResult;
  return {
    ...childResult,
    score: roundScore((score / sourceTotal) * targetScore),
    totalScore: targetScore,
  };
}

function roundScore(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Number(numberValue.toFixed(2)) : 0;
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
    const response = await api(`/hydro/questions/${detail.value.id}/submit-code`, {
      method: 'POST',
      body: {
        language: answer.language || languageOptionsFor(detail.value)[0],
        code: answer.code,
        accountId: selectedHydroAccountId.value,
      },
    });
    programmingResult.value = response;
    ElMessage.success(response.message || '代码已提交到 Hydro');
  } catch (error) {
    ElMessage.error(error.message || 'Hydro 提交失败');
  } finally {
    programmingSubmitLoading.value = false;
  }
}

function languageOptionsFor(question) {
  const languages = question?.programmingRef?.languages || [];
  return languages.length ? languages : ['cc.cc17o2', 'py.py3', 'java'];
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
    java: 'Java',
    c: 'C',
    cc: 'C++',
    pas: 'Pascal',
  };
  return labels[language] ?? language;
}

function programmingFeedbackType(result) {
  if (!isProgrammingFinal(result)) return 'info';
  return isFullProgrammingScore(result) ? 'success' : 'error';
}

function programmingFeedbackTitle(result) {
  if (!isProgrammingFinal(result)) return '等待 Hydro 评测';
  return isFullProgrammingScore(result) ? '全部测试点通过' : '部分测试点未通过';
}

function isProgrammingFinal(result) {
  return Boolean(result) && !['pending', 'judging'].includes(result.status);
}

function isFullProgrammingScore(result) {
  const passed = Number(result?.passedTestCaseCount);
  const total = Number(result?.totalTestCaseCount);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(passed)) return passed === total;
  const rate = Number(result?.scoreRate);
  if (Number.isFinite(rate)) return rate >= 1;
  const score = Number(result?.score);
  const maxScore = Number(result?.maxScore);
  if (Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0) return score >= maxScore;
  if (result?.isCorrect === true) return true;
  if (result?.isCorrect === false) return false;
  return result?.status === 'accepted';
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
    const data = await api('/hydro/my/accounts');
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

function typeLabel(value) {
  return questionTypeLabel(value);
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
</script>
