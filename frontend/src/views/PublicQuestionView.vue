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

    <el-dialog v-model="practiceVisible" title="题目作答" :width="detail?.type === 'programming' ? '1180px' : '780px'">
      <template v-if="detail">
        <div class="paper-preview-head">
          <div>
            <h2>{{ detail.title }}</h2>
            <span class="muted">{{ detail.courseName }} · {{ typeLabel(detail.type) }} · {{ detail.defaultScore }} 分</span>
          </div>
          <el-tag type="success">公开</el-tag>
        </div>

        <template v-if="detail.type === 'programming'">
          <div class="programming-exam-split programming-practice-split">
            <div class="programming-statement">
              <MarkdownRenderer :source="detail.content" />
            </div>
            <div class="programming-code-panel">
              <div class="programming-toolbar">
                <span class="programming-language-label">语言</span>
                <el-select v-model="answer.language" style="width: 170px">
                  <el-option
                    v-for="language in languageOptionsFor(detail)"
                    :key="language"
                    :label="languageLabel(language)"
                    :value="language"
                  />
                </el-select>
                <el-tag v-if="detail.programmingRef?.domainId" type="info">
                  域：{{ detail.programmingRef.domainName || detail.programmingRef.domainId }}
                </el-tag>
                <el-tag v-if="detail.programmingRef?.externalProblemId" type="success">
                  {{ detail.programmingRef.externalProblemId }}
                </el-tag>
                <el-button :disabled="!detail.programmingRef?.externalProblemUrl" @click="openHydroProblem(detail)">打开 Hydro</el-button>
              </div>
              <el-alert
                v-if="programmingResult"
                class="code-submit-feedback"
                :type="programmingResult.status === 'accepted' ? 'success' : 'info'"
                :closable="false"
                show-icon
              >
                <template #title>{{ programmingResult.status === 'accepted' ? '判题通过' : 'Hydro 结果' }}</template>
                <div class="code-submit-meta">
                  <span>状态：{{ programmingResult.status }}</span>
                  <span>语言：{{ languageLabel(programmingResult.language) }}</span>
                  <span v-if="programmingResult.externalSubmissionId">Hydro提交：{{ programmingResult.externalSubmissionId }}</span>
                  <span v-if="programmingResult.score !== null && programmingResult.score !== undefined">得分：{{ programmingResult.score }}</span>
                </div>
                <div v-if="programmingResult.message" class="code-submit-message">{{ programmingResult.message }}</div>
              </el-alert>
              <CodeAnswerEditor
                v-model="answer.code"
                :language="answer.language"
                :rows="18"
              />
            </div>
          </div>
        </template>

        <template v-else>
          <MarkdownRenderer :source="detail.content" />

          <el-radio-group
            v-if="['single_choice', 'true_false'].includes(detail.type)"
            v-model="answer.selectedOptionIds[0]"
            class="answer-options"
          >
            <el-radio v-for="option in detail.options" :key="option.optionId" :label="option.optionId" class="answer-option">
              <span class="option-choice">
                <strong>{{ option.label }}.</strong>
                <MarkdownRenderer :source="option.content" />
              </span>
            </el-radio>
          </el-radio-group>

          <el-checkbox-group v-else-if="detail.type === 'multiple_choice'" v-model="answer.selectedOptionIds" class="answer-options">
            <el-checkbox v-for="option in detail.options" :key="option.optionId" :label="option.optionId" class="answer-option">
              <span class="option-choice">
                <strong>{{ option.label }}.</strong>
                <MarkdownRenderer :source="option.content" />
              </span>
            </el-checkbox>
          </el-checkbox-group>

          <FillBlankAnswerInputs
            v-else-if="detail.type === 'fill_blank'"
            v-model="answer.blanks"
            :count="blankCountFor(detail)"
          />
          <el-input v-else v-model="answer.text" class="answer-input" type="textarea" :rows="5" placeholder="填写答案" />

          <el-alert
            v-if="result"
            :title="`${result.message}，得分 ${result.score} / ${result.totalScore}`"
            :type="result.isCorrect ? 'success' : result.isCorrect === false ? 'error' : 'warning'"
            show-icon
            :closable="false"
            class="batch-alert"
          />
          <AnswerFeedback :result="result" />
        </template>
      </template>
      <template #footer>
        <el-button @click="practiceVisible = false">关闭</el-button>
        <el-button :icon="Delete" @click="clearAnswer">清空</el-button>
        <el-button
          type="primary"
          :icon="Check"
          :loading="programmingSubmitLoading"
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
import FillBlankAnswerInputs from '../components/FillBlankAnswerInputs.vue';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';
import { useResponsiveColumns } from '../composables/useResponsiveColumns';

const router = useRouter();
const { showMediumColumns } = useResponsiveColumns();
const typeOptions = [
  { label: '单选题', value: 'single_choice' },
  { label: '多选题', value: 'multiple_choice' },
  { label: '判断题', value: 'true_false' },
  { label: '填空题', value: 'fill_blank' },
  { label: '简答题', value: 'short_answer' },
  { label: '编程题', value: 'programming' },
];
const items = ref([]);
const selectedRows = ref([]);
const detail = ref(null);
const result = ref(null);
const programmingResult = ref(null);
const programmingSubmitLoading = ref(false);
const practiceVisible = ref(false);
const answer = reactive(emptyAnswer());
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
  result.value = await api(`/questions/${detail.value.id}/check-answer`, {
    method: 'POST',
    body: payloadForAnswer(),
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
  result.value = null;
  programmingResult.value = null;
}

function payloadForAnswer() {
  if (answer.selectedOptionIds.filter(Boolean).length) {
    return { selectedOptionIds: answer.selectedOptionIds.filter(Boolean) };
  }
  if (answer.blanks.some((blank) => String(blank.value ?? '').trim())) {
    return { blanks: answer.blanks };
  }
  if (String(answer.text ?? '').trim()) {
    return { text: answer.text };
  }
  return {};
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
  programmingSubmitLoading.value = true;
  try {
    const response = await api(`/hydro/questions/${detail.value.id}/submit-code`, {
      method: 'POST',
      body: {
        language: answer.language || languageOptionsFor(detail.value)[0],
        code: answer.code,
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

function openHydroProblem(question) {
  const url = question?.programmingRef?.externalProblemUrl;
  if (!url) {
    ElMessage.warning('该题尚未配置 Hydro 链接');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function typeLabel(value) {
  const map = {
    single_choice: '单选题',
    multiple_choice: '多选题',
    true_false: '判断题',
    fill_blank: '填空题',
    short_answer: '简答题',
    programming: '编程题',
    material: '材料题',
    file_upload: '文件上传题',
    scratch_project: 'Scratch 项目题',
    arduino_project: 'Arduino 项目题',
  };
  return map[value] ?? value;
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
  });
  load();
});

onUnmounted(() => {
  unsubscribeSession?.();
});
</script>
