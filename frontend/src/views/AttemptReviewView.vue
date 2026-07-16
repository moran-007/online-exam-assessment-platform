<template>
  <div class="page attempt-review-page">
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ result.exam?.name || '考试结果' }}</h1>
        <p class="muted">共 {{ result.questionResults.length }} 题，按答题顺序展示</p>
      </div>
      <div class="toolbar">
        <el-tag v-if="simulateStudentId" type="warning">教师模拟学生</el-tag>
        <el-button :icon="Back" @click="goBack">返回</el-button>
      </div>
    </div>

    <div class="metric-row review-metrics">
      <div class="metric"><span>总分</span><strong>{{ displayScore(result.totalScore) }}</strong></div>
      <div class="metric"><span>客观题</span><strong>{{ displayScore(result.objectiveScore) }}</strong></div>
      <div class="metric"><span>主观题</span><strong>{{ displayScore(result.subjectiveScore) }}</strong></div>
      <div class="metric"><span>编程题</span><strong>{{ displayScore(result.judgeScore) }}</strong></div>
      <div class="metric"><span>用时</span><strong>{{ formatDuration(result.durationSeconds) }}</strong></div>
      <div class="metric">
        <span>状态</span>
        <el-tag :type="statusTagType('attempt', result.status)" effect="plain">
          {{ statusLabel('attempt', result.status) }}
        </el-tag>
      </div>
    </div>

    <el-alert
      v-if="result.visibility?.restricted"
      :title="restrictionTitle"
      type="warning"
      show-icon
      :closable="false"
      class="batch-alert"
    />

    <StudentExamSummaryCard v-if="examSummary" :summary="examSummary" />

    <main class="review-list">
      <section v-for="(question, index) in result.questionResults" :key="question.questionId" class="review-question">
        <header class="review-question-head">
          <div class="review-question-title">
            <span class="question-index">第 {{ index + 1 }} 题</span>
            <strong>{{ question.title }}</strong>
          </div>
          <div class="review-question-meta">
            <el-tag effect="plain">{{ questionTypeLabel(question.type) }}</el-tag>
            <el-tag :type="resultTagType(question)">{{ resultText(question) }}</el-tag>
            <strong>{{ displayQuestionScore(question) }}</strong>
          </div>
        </header>

        <div class="review-question-body">
          <MarkdownRenderer v-if="result.visibility?.content" :source="question.content || ''" />
          <p v-else class="muted">题干暂未开放</p>

          <QuestionReviewHost
            v-if="result.visibility?.content || result.visibility?.studentAnswer || result.visibility?.correctAnswer"
            :question="question"
            :answer="result.visibility?.studentAnswer ? question.studentAnswer : null"
            :correct-answer="result.visibility?.correctAnswer ? question.correctAnswer : null"
            :type="question.type"
            :show-correct="Boolean(result.visibility?.correctAnswer)"
            :show-reference="Boolean(result.visibility?.correctAnswer && !question.studentAnswer?.code)"
            :show-student-answer="Boolean(result.visibility?.studentAnswer)"
            student-label="你的作答"
          />

          <div v-if="result.visibility?.analysis" class="review-analysis">
            <strong>解析</strong>
            <MarkdownRenderer :source="question.analysis || '暂无解析'" />
          </div>

          <p v-if="hiddenDetailLabels.length" class="result-locked-note">
            暂未开放：{{ hiddenDetailLabels.join('、') }}
          </p>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { Back } from '@element-plus/icons-vue';
import { useRoute, useRouter } from 'vue-router';
import { getStudentAttemptResult } from '../features/exams/api';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';
import QuestionReviewHost from '../components/QuestionReviewHost.vue';
import { questionTypeLabel } from '../question-engine/registry';
import { statusLabel, statusTagType } from '../statusMeta';
import { listPublishedExamSummaries } from '../features/ai/api';
import StudentExamSummaryCard from '../features/ai/components/StudentExamSummaryCard.vue';

const route = useRoute();
const router = useRouter();
const simulateStudentId = computed(() => String(route.query.simulateStudentId || ''));
const result = reactive({
  exam: null,
  totalScore: null,
  objectiveScore: null,
  subjectiveScore: null,
  judgeScore: null,
  status: '',
  durationSeconds: 0,
  visibility: null,
  questionResults: [],
});
const examSummary = ref(null);

const hiddenDetailLabels = computed(() => {
  const visibility = result.visibility ?? {};
  return [
    ['content', '题干'],
    ['studentAnswer', '作答'],
    ['correctness', '对错结果'],
    ['correctAnswer', '正确答案'],
    ['analysis', '解析'],
  ].filter(([key]) => visibility[key] === false).map(([, label]) => label);
});

const restrictionTitle = computed(() => {
  const reason = result.visibility?.reason || '当前结果按考试设置部分开放';
  return hiddenDetailLabels.value.length ? `${reason}；暂未开放：${hiddenDetailLabels.value.join('、')}` : reason;
});

async function load() {
  const loaded = await getStudentAttemptResult(
    String(route.params.attemptId),
    simulateStudentId.value || undefined,
  );
  Object.assign(result, loaded);
  if (!simulateStudentId.value && loaded.exam?.id) {
    try {
      const summaries = await listPublishedExamSummaries();
      examSummary.value = summaries.find((item) => item.examId === loaded.exam.id) ?? null;
    } catch {
      examSummary.value = null;
    }
  }
}

function goBack() {
  router.push(simulateStudentId.value ? '/exams' : '/student/exams');
}

function displayScore(value) {
  return value === null || value === undefined ? '未开放' : value;
}

function displayQuestionScore(question) {
  return question.studentScore === null || question.studentScore === undefined
    ? `-- / ${question.score}`
    : `${question.studentScore} / ${question.score}`;
}

function formatDuration(seconds) {
  const total = Number(seconds || 0);
  return `${Math.floor(total / 60)}分${total % 60}秒`;
}

function resultText(question) {
  if (!result.visibility?.correctness) return '未开放';
  if (question.isCorrect === true) return '正确';
  if (question.isCorrect === false) return '错误';
  return '待批改';
}

function resultTagType(question) {
  if (!result.visibility?.correctness || question.isCorrect == null) return 'warning';
  return question.isCorrect ? 'success' : 'danger';
}

onMounted(load);
</script>

<style scoped>
.attempt-review-page {
  max-width: 1180px;
  margin: 0 auto;
}

.review-metrics {
  grid-template-columns: repeat(6, minmax(120px, 1fr));
}

.review-list {
  display: grid;
  gap: 16px;
  margin-top: 16px;
}

.review-question {
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: var(--el-bg-color);
}

.review-question-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-extra-light);
}

.review-question-title,
.review-question-meta,
.review-option {
  display: flex;
  align-items: center;
  gap: 10px;
}

.question-index {
  color: var(--el-color-primary);
  white-space: nowrap;
}

.review-question-body {
  padding: 20px;
}

.review-options {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.review-option {
  min-height: 42px;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
}

.review-option.correct { border-color: var(--el-color-success); background: var(--el-color-success-light-9); }
.review-option.wrong { border-color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.review-option :deep(.markdown-body) { flex: 1; }

.review-answer-block,
.review-analysis {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.review-answer-block pre {
  overflow: auto;
  margin: 8px 0 0;
  padding: 12px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: Consolas, Monaco, monospace;
}

.review-code {
  max-height: 420px;
  white-space: pre !important;
}

.answer-mark {
  color: var(--el-color-primary);
  white-space: nowrap;
}

.answer-mark.success { color: var(--el-color-success); }

@media (max-width: 900px) {
  .review-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .review-question-head { align-items: flex-start; flex-direction: column; }
  .review-question-meta { flex-wrap: wrap; }
}
</style>
