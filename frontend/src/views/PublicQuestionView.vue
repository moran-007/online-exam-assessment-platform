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
            small
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

    <el-dialog v-model="practiceVisible" title="题目作答" width="780px">
      <template v-if="detail">
        <div class="paper-preview-head">
          <div>
            <h2>{{ detail.title }}</h2>
            <span class="muted">{{ detail.courseName }} · {{ typeLabel(detail.type) }} · {{ detail.defaultScore }} 分</span>
          </div>
          <el-tag type="success">公开</el-tag>
        </div>

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

        <el-input v-else-if="detail.type === 'fill_blank'" v-model="answer.blanks[0].value" class="answer-input" placeholder="填写答案" />
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
      <template #footer>
        <el-button @click="practiceVisible = false">关闭</el-button>
        <el-button :icon="Delete" @click="clearAnswer">清空</el-button>
        <el-button type="primary" :icon="Check" @click="checkAnswer">提交作答</el-button>
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

function emptyAnswer() {
  return {
    selectedOptionIds: [],
    blanks: [{ index: 1, value: '' }],
    text: '',
  };
}

function clearAnswer() {
  Object.assign(answer, emptyAnswer());
  result.value = null;
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
