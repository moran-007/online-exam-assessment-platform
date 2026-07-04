<template>
  <div class="page grading-workbench">
    <div class="page-head">
      <div>
        <h1 class="page-title">批改</h1>
        <p class="muted">按题型批量处理，或按学生逐题批改</p>
      </div>
      <div class="toolbar grading-filters">
        <el-input v-model="filter.keyword" clearable placeholder="考试/题目关键词" @keyup.enter="loadFirstPage" @clear="loadFirstPage" />
        <el-select v-model="filter.examId" clearable filterable placeholder="考试" @change="loadFirstPage">
          <el-option v-for="exam in exams" :key="exam.id" :label="exam.name" :value="exam.id" />
        </el-select>
        <el-select v-model="filter.questionType" clearable placeholder="题型" @change="loadFirstPage">
          <el-option v-for="item in questionTypes" :key="item.value" :label="item.label" :value="item.value" />
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
        <el-button type="warning" :disabled="!filter.examId" @click="openRegradeDialog">试算重判</el-button>
      </div>
    </div>

    <div class="batch-actions">
      <span class="muted">已选 {{ selectedRows.length }} 条</span>
      <el-button :icon="Check" :disabled="!selectedRows.length" @click="batchGrade('full')">选中判满分</el-button>
      <el-button :icon="Close" :disabled="!selectedRows.length" @click="batchGrade('zero')">选中判零分</el-button>
      <span class="muted">批量操作仅允许同一题型</span>
    </div>

    <div class="panel library-table-panel">
      <el-table
        ref="tableRef"
        :data="items"
        row-key="id"
        height="100%"
        highlight-current-row
        class="question-list-table grading-table"
        :default-sort="{ prop: filter.sortBy, order: filter.sortOrder === 'asc' ? 'ascending' : 'descending' }"
        @selection-change="selectedRows = $event"
        @row-click="openAttempt"
        @sort-change="handleSort"
      >
        <el-table-column type="selection" width="44" reserve-selection />
        <el-table-column prop="studentName" label="学生" width="130" />
        <el-table-column prop="questionTitle" label="题目" min-width="180" show-overflow-tooltip sortable="custom" />
        <el-table-column prop="questionType" label="题型" width="105">
          <template #default="{ row }">{{ questionTypeLabel(row.questionType) }}</template>
        </el-table-column>
        <el-table-column label="学生答案" min-width="300">
          <template #default="{ row }">
            <pre class="table-answer">{{ formatAnswerPayload(row.studentAnswer, row, '未作答') }}</pre>
          </template>
        </el-table-column>
        <el-table-column prop="score" label="得分" width="90" sortable="custom">
          <template #default="{ row }">{{ row.score }} / {{ row.maxScore }}</template>
        </el-table-column>
        <el-table-column prop="status" label="结果" width="110" sortable="custom">
          <template #default="{ row }">
            <el-tag :type="answerStatusTagType(row.status)">{{ answerResultLabel(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="快捷批改" width="174" fixed="right">
          <template #default="{ row }">
            <el-button-group>
              <el-button size="small" :icon="Check" @click.stop="quickGrade(row, 'full')">满分</el-button>
              <el-button size="small" :icon="Close" @click.stop="quickGrade(row, 'zero')">零分</el-button>
              <el-button size="small" :icon="Edit" title="逐题批改" @click.stop="openAttempt(row)" />
            </el-button-group>
          </template>
        </el-table-column>
      </el-table>
      <div class="table-footer">
        <span class="muted">共 {{ pagination.total }} 条记录</span>
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

    <el-drawer
      v-model="drawerVisible"
      :title="attemptDetail ? `批改：${attemptDetail.student.name}` : '逐题批改'"
      size="min(820px, 96vw)"
      destroy-on-close
    >
      <div v-if="attemptDetail && currentQuestion" class="grading-drawer">
        <div class="detail-summary">
          <div>
            <strong>{{ attemptDetail.exam.name }}</strong>
            <span class="muted">{{ attemptDetail.exam.courseName }} · {{ attemptDetail.exam.paperName }}</span>
          </div>
          <el-tag effect="plain">{{ currentQuestionIndex + 1 }} / {{ reviewQuestions.length }}</el-tag>
        </div>

        <div class="continuous-nav">
          <el-button :icon="ArrowLeft" :disabled="reviewQuestions.length < 2" @click="moveQuestion(-1)">上一题</el-button>
          <div>
            <strong>{{ currentQuestion.title }}</strong>
            <span class="muted">{{ questionTypeLabel(currentQuestion.type) }} · {{ currentQuestion.score }} / {{ currentQuestion.maxScore }} 分</span>
          </div>
          <el-button :icon="ArrowRight" :disabled="reviewQuestions.length < 2" @click="moveQuestion(1)">下一题</el-button>
        </div>

        <div class="grading-question">
          <MarkdownRenderer :source="currentQuestion.content || ''" />
          <div class="answer-box">
            <strong>学生作答</strong>
            <pre>{{ formatStudentAnswer(currentQuestion) }}</pre>
          </div>
          <div v-if="hasReferenceAnswer(currentQuestion)" class="answer-box soft">
            <strong>参考答案</strong>
            <pre>{{ formatReferenceAnswer(currentQuestion) }}</pre>
          </div>
          <div v-if="currentQuestion.analysis" class="answer-box soft">
            <strong>解析</strong>
            <MarkdownRenderer :source="currentQuestion.analysis" />
          </div>
        </div>

        <div class="grading-form continuous-grade-form">
          <div v-if="currentQuestion.rubric?.length" class="rubric-editor">
            <div v-for="criterion in currentQuestion.rubric" :key="criterion.id" class="rubric-row">
              <span>{{ criterion.name }}（{{ criterion.maxScore }} 分）</span>
              <el-input-number v-model="criterion.score" :min="0" :max="criterion.maxScore" :step="0.5" />
              <el-input v-model="criterion.comment" placeholder="维度评语，可选" />
            </div>
            <strong>量表合计：{{ rubricTotal(currentQuestion) }} / {{ currentQuestion.maxScore }} 分</strong>
          </div>
          <el-input-number v-else v-model="currentQuestion.nextScore" :min="0" :max="currentQuestion.maxScore" :step="0.5" />
          <el-input v-model="currentQuestion.nextComment" placeholder="批改意见，可选" />
          <el-button type="primary" :icon="Check" :loading="saving" @click="saveGrade">
            保存并批改下一题
          </el-button>
        </div>
      </div>
      <el-empty v-else description="这份试卷没有待批改题目" />
    </el-drawer>

    <el-dialog v-model="regradeVisible" title="试算重判" width="620px" destroy-on-close>
      <el-form label-width="110px">
        <el-form-item label="规则来源">
          <el-select v-model="regradeForm.ruleSource" style="width: 100%">
            <el-option label="考试快照规则（推荐）" value="snapshot" />
            <el-option label="题目最新规则" value="latest" />
          </el-select>
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="regradeForm.reason" type="textarea" :rows="2" placeholder="记录本次重判原因" />
        </el-form-item>
      </el-form>
      <el-alert type="warning" :closable="false" title="试算不会修改正式成绩；确认时若答案或成绩已变化，服务端会拒绝覆盖。" />
      <el-descriptions v-if="regradePreview" :column="2" border class="regrade-summary">
        <el-descriptions-item label="扫描答案">{{ regradePreview.summary.scannedCount }}</el-descriptions-item>
        <el-descriptions-item label="可自动重判">{{ regradePreview.summary.gradableCount }}</el-descriptions-item>
        <el-descriptions-item label="分数变化">{{ regradePreview.summary.changedCount }}</el-descriptions-item>
        <el-descriptions-item label="总分差值">{{ regradePreview.summary.scoreDelta }}</el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button @click="cancelRegrade">取消</el-button>
        <el-button :loading="regradeLoading" @click="previewRegrade">生成试算</el-button>
        <el-button type="primary" :disabled="!regradePreview" :loading="regradeLoading" @click="confirmRegrade">确认应用</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, ArrowRight, Check, Close, Edit, Refresh, Search } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';

const questionTypes = [
  { label: '填空题', value: 'fill_blank' },
  { label: '简答题', value: 'short_answer' },
  { label: '编程题', value: 'programming' },
  { label: '材料题', value: 'material' },
  { label: '文件上传题', value: 'file_upload' },
];
const reviewStatuses = ['manual_needed', 'manual_graded', 'judge_pending', 'judge_done'];
const pendingStatuses = ['manual_needed', 'judge_pending'];
const filter = reactive({ keyword: '', examId: '', questionType: '', status: 'pending', sortBy: 'updatedAt', sortOrder: 'desc' });
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const items = ref([]);
const exams = ref([]);
const selectedRows = ref([]);
const tableRef = ref(null);
const drawerVisible = ref(false);
const attemptDetail = ref(null);
const currentQuestionId = ref('');
const saving = ref(false);
const regradeVisible = ref(false);
const regradeLoading = ref(false);
const regradePreview = ref(null);
const regradeForm = reactive({ ruleSource: 'snapshot', reason: '' });

const reviewQuestions = computed(() =>
  (attemptDetail.value?.questions ?? []).filter((question) => question.answerRecordId && reviewStatuses.includes(question.status)),
);
const currentQuestionIndex = computed(() => Math.max(0, reviewQuestions.value.findIndex((item) => item.questionId === currentQuestionId.value)));
const currentQuestion = computed(() => reviewQuestions.value[currentQuestionIndex.value] ?? null);

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
  selectedRows.value = [];
  tableRef.value?.clearSelection();
}

function loadFirstPage() {
  pagination.page = 1;
  return load();
}

async function fetchAttempt(attemptId) {
  const detail = await api(`/grading/attempts/${attemptId}`);
  detail.questions = detail.questions.map((question) => ({
    ...question,
    nextScore: question.score,
    nextComment: question.manualComment || '',
    rubric: normalizedRubric(question),
  }));
  return detail;
}

async function openAttempt(row) {
  attemptDetail.value = await fetchAttempt(row.attemptId);
  const matching = reviewQuestions.value.find((question) => question.questionId === row.questionId);
  currentQuestionId.value = matching?.questionId ?? reviewQuestions.value.find((question) => pendingStatuses.includes(question.status))?.questionId ?? reviewQuestions.value[0]?.questionId ?? '';
  drawerVisible.value = true;
}

async function saveGrade() {
  const question = currentQuestion.value;
  if (!question?.answerRecordId || saving.value) return;
  saving.value = true;
  try {
    const attemptId = attemptDetail.value.attemptId;
    const oldQuestionId = question.questionId;
    await api(`/grading/answers/${question.answerRecordId}`, {
      method: 'PATCH',
      body: question.rubric?.length
        ? {
            rubricScores: question.rubric.map((item) => ({ criterionId: item.id, score: item.score, comment: item.comment })),
            comment: question.nextComment,
          }
        : { score: question.nextScore, comment: question.nextComment },
    });
    attemptDetail.value = await fetchAttempt(attemptId);
    const all = reviewQuestions.value;
    const oldIndex = Math.max(0, all.findIndex((item) => item.questionId === oldQuestionId));
    const next = [...all.slice(oldIndex + 1), ...all.slice(0, oldIndex + 1)].find((item) => pendingStatuses.includes(item.status));
    if (next) {
      currentQuestionId.value = next.questionId;
      ElMessage.success('已保存，已切换到下一道待批题');
    } else {
      await api(`/grading/attempts/${attemptId}/finish`, { method: 'POST' });
      drawerVisible.value = false;
      ElMessage.success('整份试卷已完成批改');
    }
    await load();
  } finally {
    saving.value = false;
  }
}

function moveQuestion(step) {
  const questions = reviewQuestions.value;
  if (questions.length < 2) return;
  const nextIndex = (currentQuestionIndex.value + step + questions.length) % questions.length;
  currentQuestionId.value = questions[nextIndex].questionId;
}

function normalizedRubric(question) {
  const raw = Array.isArray(question.scoringRule?.rubric) ? question.scoringRule.rubric : [];
  if (!raw.length) return [];
  const sourceTotal = raw.reduce((sum, item) => sum + Math.max(0, Number(item.maxScore || 0)), 0);
  if (!sourceTotal) return [];
  const existing = new Map((question.rubricScores || []).map((item) => [item.criterionId, item]));
  let allocated = 0;
  return raw.map((item, index) => {
    const maxScore = index === raw.length - 1
      ? Math.round((Number(question.maxScore) - allocated + Number.EPSILON) * 100) / 100
      : Math.round(((Number(item.maxScore || 0) / sourceTotal) * Number(question.maxScore) + Number.EPSILON) * 100) / 100;
    allocated += maxScore;
    const previous = existing.get(String(item.id));
    return {
      id: String(item.id),
      name: String(item.name || item.id),
      maxScore,
      score: Number(previous?.score || 0),
      comment: previous?.comment || '',
    };
  });
}

function rubricTotal(question) {
  return Math.round(((question.rubric || []).reduce((sum, item) => sum + Number(item.score || 0), 0) + Number.EPSILON) * 100) / 100;
}

function openRegradeDialog() {
  regradePreview.value = null;
  regradeForm.ruleSource = 'snapshot';
  regradeForm.reason = '';
  regradeVisible.value = true;
}

async function previewRegrade() {
  regradeLoading.value = true;
  try {
    regradePreview.value = await api('/grading/regrade-runs/preview', {
      method: 'POST',
      body: { examId: filter.examId, ruleSource: regradeForm.ruleSource, reason: regradeForm.reason },
    });
    ElMessage.success('试算完成，正式成绩尚未改变');
  } finally {
    regradeLoading.value = false;
  }
}

async function confirmRegrade() {
  if (!regradePreview.value) return;
  await ElMessageBox.confirm('确认将试算结果写入正式成绩吗？该操作会保留完整历史。', '确认重判');
  regradeLoading.value = true;
  try {
    await api(`/grading/regrade-runs/${regradePreview.value.id}/confirm`, { method: 'POST' });
    regradeVisible.value = false;
    ElMessage.success('重判结果已应用');
    await load();
  } finally {
    regradeLoading.value = false;
  }
}

async function cancelRegrade() {
  if (regradePreview.value) {
    await api(`/grading/regrade-runs/${regradePreview.value.id}/cancel`, { method: 'POST' });
  }
  regradeVisible.value = false;
}

async function batchGrade(mode) {
  if (!selectedRows.value.length) return;
  const types = new Set(selectedRows.value.map((row) => row.questionType));
  if (types.size > 1) {
    ElMessage.warning('请只选择同一题型的答案');
    return;
  }
  const label = mode === 'full' ? '满分' : '零分';
  await ElMessageBox.confirm(`确定将选中的 ${selectedRows.value.length} 份答案批量判为${label}吗？`, '批量批改');
  await api('/grading/answers/batch', {
    method: 'POST',
    body: { answerRecordIds: selectedRows.value.map((row) => row.id), mode },
  });
  ElMessage.success(`已批改 ${selectedRows.value.length} 份答案`);
  await load();
}

async function quickGrade(row, mode) {
  await api('/grading/answers/batch', { method: 'POST', body: { answerRecordIds: [row.id], mode } });
  ElMessage.success(mode === 'full' ? '已判满分' : '已判零分');
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
  if (answer.selectedOptionIds?.length) return answer.selectedOptionIds.map((id) => formatOption(question, id)).join('\n');
  if (answer.correctOptionIds?.length) return answer.correctOptionIds.map((id) => formatOption(question, id)).join('\n');
  if (answer.blanks?.length) {
    return answer.blanks.map((blank) => `第 ${blank.index} 空：${blank.value ?? blank.answers?.join(' / ') ?? ''}`).join('\n');
  }
  if (answer.code) return answer.code;
  if (answer.text) return answer.text;
  if (answer.reference) return answer.reference;
  if (answer.fileName || answer.fileUrl) return answer.fileName || answer.fileUrl;
  return JSON.stringify(answer, null, 2);
}

function formatOption(question, optionId) {
  const option = question.options?.find((item) => (item.optionId ?? item.id) === optionId);
  return option ? `${option.label ?? option.optionKey}. ${option.content}` : optionId;
}

function hasReferenceAnswer(question) {
  return question.referenceAnswer && Object.keys(question.referenceAnswer).length > 0;
}

function answerResultLabel(row) {
  if (row.isCorrect === true) return '正确';
  if (row.isCorrect === false) return '错误';
  return answerStatusLabel(row.status);
}

function answerStatusLabel(status) {
  return {
    manual_needed: '待批改',
    manual_graded: '已批改',
    judge_pending: '待评测',
    judge_done: '评测完成',
  }[status] ?? status;
}

function answerStatusTagType(status) {
  if (['manual_graded', 'judge_done'].includes(status)) return 'success';
  if (pendingStatuses.includes(status)) return 'warning';
  return 'info';
}

function questionTypeLabel(type) {
  return {
    fill_blank: '填空题',
    short_answer: '简答题',
    programming: '编程题',
    material: '材料题',
    file_upload: '文件上传题',
  }[type] ?? type;
}

onMounted(load);
</script>

<style scoped>
.grading-workbench { min-width: 0; }
.grading-filters { flex-wrap: wrap; }
.grading-filters .el-input { width: 210px; }
.grading-filters .el-select { width: 160px; }
.batch-actions { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.table-answer { overflow: hidden; margin: 0; max-height: 56px; white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; }
.detail-summary, .continuous-nav { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.detail-summary > div, .continuous-nav > div { display: grid; gap: 4px; min-width: 0; }
.continuous-nav { margin: 16px 0; padding: 12px 0; border-block: 1px solid var(--el-border-color-lighter); }
.continuous-nav > div { flex: 1; text-align: center; }
.grading-question { min-width: 0; }
.answer-box { margin-top: 16px; padding: 14px 0; border-top: 1px solid var(--el-border-color-lighter); }
.answer-box pre { overflow: auto; max-height: 360px; margin: 8px 0 0; padding: 12px; background: var(--el-fill-color-light); white-space: pre-wrap; overflow-wrap: anywhere; font-family: Consolas, Monaco, monospace; }
.answer-box.soft { color: var(--el-text-color-regular); }
.continuous-grade-form { position: sticky; bottom: 0; display: grid; grid-template-columns: minmax(150px, 1fr) minmax(180px, 1fr) auto; gap: 10px; padding: 14px 0 4px; background: var(--el-bg-color); }
.rubric-editor { display: grid; gap: 10px; }
.rubric-row { display: grid; grid-template-columns: minmax(120px, 1fr) 130px minmax(160px, 1fr); gap: 8px; align-items: center; }
.regrade-summary { margin-top: 16px; }
@media (max-width: 760px) {
  .batch-actions { flex-wrap: wrap; }
  .continuous-grade-form { grid-template-columns: 1fr; }
  .continuous-nav .el-button span { display: none; }
}
</style>
