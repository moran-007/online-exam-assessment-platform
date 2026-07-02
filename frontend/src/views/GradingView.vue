<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">主观题批改</h1>
      <div class="toolbar">
        <el-input v-model="filter.keyword" clearable placeholder="考试/题目关键词" @keyup.enter="loadFirstPage" @clear="loadFirstPage" />
        <el-select v-model="filter.examId" clearable filterable placeholder="考试" @change="loadFirstPage">
          <el-option v-for="exam in exams" :key="exam.id" :label="exam.name" :value="exam.id" />
        </el-select>
        <el-select v-model="filter.status" clearable placeholder="批改状态" @change="loadFirstPage">
          <el-option label="待处理" value="pending" />
          <el-option label="已完成" value="graded" />
          <el-option label="待人工批改" value="manual_needed" />
          <el-option label="已人工批改" value="manual_graded" />
          <el-option label="待外部评测" value="judge_pending" />
          <el-option label="评测完成" value="judge_done" />
        </el-select>
        <el-button :icon="Search" @click="loadFirstPage">查询</el-button>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
      </div>
    </div>

    <div class="panel library-table-panel">
      <el-table
        :data="items"
        height="100%"
        highlight-current-row
        class="question-list-table"
        :default-sort="{ prop: filter.sortBy, order: filter.sortOrder === 'asc' ? 'ascending' : 'descending' }"
        @row-click="openAttempt"
        @sort-change="handleSort"
      >
        <el-table-column prop="questionTitle" label="题目" min-width="220" show-overflow-tooltip sortable="custom" />
        <el-table-column v-if="showMediumColumns" prop="examName" label="考试" min-width="180" show-overflow-tooltip />
        <el-table-column v-if="showMediumColumns" prop="studentName" label="学生" width="140" />
        <el-table-column v-if="showLowColumns" prop="questionType" label="题型" width="120" />
        <el-table-column prop="score" label="得分" width="90" sortable="custom">
          <template #default="{ row }">{{ row.score }} / {{ row.maxScore }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="110" sortable="custom">
          <template #default="{ row }">
            <el-tag :type="answerStatusTagType(row.status)">
              {{ answerStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110">
          <template #default="{ row }">
            <el-button size="small" :icon="Edit" @click.stop="openAttempt(row)">批改</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="table-footer">
        <span class="muted">共 {{ pagination.total }} 条待处理记录</span>
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          background
          size="small"
          layout="sizes, prev, pager, next"
          :page-sizes="[20, 50, 100]"
          :total="pagination.total"
          @size-change="handleSize"
          @current-change="handleCurrent"
        />
      </div>
    </div>

    <el-drawer v-model="drawerVisible" :title="attemptDetail ? `批改：${attemptDetail.exam.examName}` : '批改'" size="780px" destroy-on-close>
      <div v-if="attemptDetail" class="grading-drawer">
        <div class="detail-summary">
          <strong>{{ attemptDetail.student.name }}</strong>
          <span class="muted">{{ attemptDetail.student.username }} · {{ attemptDetail.exam.courseName }}</span>
          <el-tag :type="attemptStatusType(attemptDetail.status)" effect="plain">
            {{ statusLabel(attemptDetail.status) }}
          </el-tag>
        </div>
        <el-collapse v-model="activeQuestionIds">
          <el-collapse-item
            v-for="question in attemptDetail.questions"
            :key="question.questionId"
            :name="question.questionId"
          >
            <template #title>
              <span class="collapse-title">{{ question.title }}</span>
              <el-tag size="small" :type="answerStatusTagType(question.status)">
                {{ question.score }} / {{ question.maxScore }}
              </el-tag>
            </template>
            <div class="grading-question">
              <MarkdownRenderer :source="question.content" />
              <div class="answer-box">
                <strong>学生作答</strong>
                <pre>{{ formatStudentAnswer(question) }}</pre>
              </div>
              <div v-if="question.referenceAnswer && Object.keys(question.referenceAnswer).length" class="answer-box soft">
                <strong>参考答案</strong>
                <pre>{{ formatReferenceAnswer(question) }}</pre>
              </div>
              <div v-if="question.analysis" class="answer-box soft">
                <strong>解析</strong>
                <MarkdownRenderer :source="question.analysis" />
              </div>
              <div class="grading-form">
                <el-input-number v-model="question.nextScore" :min="0" :max="question.maxScore" :step="0.5" />
                <el-input v-model="question.nextComment" placeholder="批改意见，可选" />
                <el-button
                  type="primary"
                  :icon="Check"
                  :disabled="!question.answerRecordId"
                  @click="saveGrade(question)"
                >
                  {{ isJudgeStatus(question.status) ? '保存评测' : '保存批改' }}
                </el-button>
              </div>
            </div>
          </el-collapse-item>
        </el-collapse>
      </div>
      <el-empty v-else description="请选择一条记录" />
    </el-drawer>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Check, Edit, Refresh, Search } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';
import { useResponsiveColumns } from '../composables/useResponsiveColumns';
import { statusLabel as attemptStatusLabel, statusTagType } from '../statusMeta';

const filter = reactive({ keyword: '', examId: '', status: 'pending', sortBy: 'updatedAt', sortOrder: 'desc' });
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const items = ref([]);
const exams = ref([]);
const drawerVisible = ref(false);
const attemptDetail = ref(null);
const activeQuestionIds = ref([]);

async function load() {
  const [examPage, page] = await Promise.all([
    api('/exams?pageSize=100&sortBy=createdAt&sortOrder=desc'),
    api(`/grading/answers${buildQuery({ ...filter, page: pagination.page, pageSize: pagination.pageSize })}`),
  ]);
  exams.value = examPage.items;
  items.value = page.items;
  pagination.page = page.page;
  pagination.pageSize = page.pageSize;
  pagination.total = page.total;
}

function loadFirstPage() {
  pagination.page = 1;
  return load();
}

async function openAttempt(row) {
  const detail = await api(`/grading/attempts/${row.attemptId}`);
  detail.questions = detail.questions.map((question) => ({
    ...question,
    nextScore: question.score,
    nextComment: question.manualComment || '',
  }));
  attemptDetail.value = detail;
  activeQuestionIds.value = detail.questions
    .filter((question) => ['manual_needed', 'manual_graded', 'judge_pending', 'judge_done'].includes(question.status))
    .map((question) => question.questionId);
  drawerVisible.value = true;
}

async function saveGrade(question) {
  await api(`/grading/answers/${question.answerRecordId}`, {
    method: 'PATCH',
    body: { score: question.nextScore, comment: question.nextComment },
  });
  ElMessage.success('批改已保存');
  await openAttempt({ attemptId: attemptDetail.value.attemptId });
  await load();
}

function handleSort({ prop, order }) {
  filter.sortBy = prop || 'updatedAt';
  filter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  loadFirstPage();
}

function handleSize(size) {
  pagination.pageSize = size;
  pagination.page = 1;
  load();
}

function handleCurrent(page) {
  pagination.page = page;
  load();
}

function formatStudentAnswer(question) {
  return formatAnswerPayload(question.studentAnswer, question, '未作答');
}

function formatReferenceAnswer(question) {
  return formatAnswerPayload(question.referenceAnswer, question, '暂无参考答案');
}

function formatAnswerPayload(answer, question, emptyText) {
  if (!answer || !Object.keys(answer).length) return emptyText;
  if (answer.selectedOptionIds?.length) {
    return answer.selectedOptionIds.map((optionId) => formatOption(question, optionId)).join('\n');
  }
  if (answer.correctOptionIds?.length) {
    return answer.correctOptionIds.map((optionId) => formatOption(question, optionId)).join('\n');
  }
  if (answer.blanks?.length) {
    return answer.blanks
      .map((blank) => {
        const value = blank.value ?? blank.answers?.join(' / ') ?? '';
        return `第 ${blank.index} 空：${value}`;
      })
      .join('\n');
  }
  if (answer.text) return answer.text;
  if (answer.reference) return answer.reference;
  return JSON.stringify(answer, null, 2);
}

function formatOption(question, optionId) {
  const option = question.options?.find((item) => (item.optionId ?? item.id) === optionId);
  if (!option) return optionId;
  return `${option.label ?? option.optionKey}. ${option.content}`;
}

function answerStatusLabel(status) {
  const map = {
    manual_needed: '待人工批改',
    manual_graded: '已人工批改',
    judge_pending: '待外部评测',
    judge_done: '评测完成',
    auto_graded: '自动判分',
    submitted: '已提交',
    saved: '已保存',
  };
  return map[status] ?? status;
}

function answerStatusTagType(status) {
  if (['manual_graded', 'judge_done', 'auto_graded'].includes(status)) return 'success';
  if (['judge_pending', 'manual_needed'].includes(status)) return 'warning';
  return 'info';
}

function isJudgeStatus(status) {
  return ['judge_pending', 'judge_done'].includes(status);
}

function statusLabel(status) {
  return attemptStatusLabel('attempt', status);
}

function attemptStatusType(status) {
  return statusTagType('attempt', status);
}

onMounted(load);
</script>
