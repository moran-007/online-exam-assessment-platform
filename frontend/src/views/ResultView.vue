<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">考试结果</h1>
      <div class="toolbar">
        <el-tag v-if="simulateStudentId" type="warning">教师模拟学生</el-tag>
        <el-button :icon="Back" @click="$router.push(simulateStudentId ? '/exams' : '/student/exams')">返回</el-button>
      </div>
    </div>
    <div class="metric-row">
      <div class="metric"><span>总分</span><strong>{{ displayScore(result.totalScore) }}</strong></div>
      <div class="metric"><span>客观题</span><strong>{{ displayScore(result.objectiveScore) }}</strong></div>
      <div class="metric"><span>编程题</span><strong>{{ displayScore(result.judgeScore) }}</strong></div>
      <div class="metric">
        <span>状态</span>
        <div class="metric-status">
          <el-tag :type="statusTagType('attempt', result.status)" effect="plain">
            {{ statusLabel('attempt', result.status) }}
          </el-tag>
        </div>
      </div>
      <div class="metric"><span>用时</span><strong>{{ result.durationSeconds || 0 }}s</strong></div>
    </div>
    <el-alert
      v-if="result.visibility?.restricted"
      :title="restrictionTitle"
      type="warning"
      show-icon
      :closable="false"
      class="batch-alert"
    />
    <div class="panel">
      <el-table :data="result.questionResults" height="560">
        <el-table-column type="expand" width="46">
          <template #default="{ row }">
            <div class="result-detail">
              <MarkdownRenderer v-if="result.visibility?.content" :source="row.content || ''" />
              <el-alert
                v-else
                title="题干暂未开放。"
                type="info"
                show-icon
                :closable="false"
              />
              <div v-if="result.visibility?.content && row.options?.length" class="result-options">
                <div v-for="option in row.options" :key="option.optionId" :class="resultOptionClass(row, option)">
                  <div class="option-choice">
                    <strong>{{ option.label }}.</strong>
                    <MarkdownRenderer :source="option.content" />
                  </div>
                  <div class="result-option-tags">
                    <span v-if="isCorrectOption(row, option)" class="answer-mark success">正确答案</span>
                    <span v-if="isSelectedOption(row, option)" class="answer-mark" :class="isCorrectOption(row, option) ? 'success' : 'danger'">
                      你的选择
                    </span>
                  </div>
                </div>
              </div>
              <div v-if="result.visibility?.studentAnswer || result.visibility?.correctAnswer" class="answer-compare">
                <span v-if="result.visibility?.studentAnswer" :class="['answer-pill', row.isCorrect === false ? 'danger' : 'success']">
                  作答：{{ displayStudentAnswer(row) }}
                </span>
                <span v-if="result.visibility?.correctAnswer" class="answer-pill success">参考：{{ displayCorrectAnswer(row) }}</span>
              </div>
              <div v-if="hiddenDetailLabels.length" class="result-locked-note">
                暂未开放：{{ hiddenDetailLabels.join('、') }}
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="题目" min-width="260">
          <template #default="{ row }">
            <strong>{{ row.title }}</strong>
          </template>
        </el-table-column>
        <el-table-column prop="type" label="题型" width="120" />
        <el-table-column label="得分" width="90">
          <template #default="{ row }">{{ displayScore(row.studentScore) }}</template>
        </el-table-column>
        <el-table-column label="结果" width="100">
          <template #default="{ row }">
            <strong :class="['result-state', resultStateClass(row)]">{{ resultText(row) }}</strong>
          </template>
        </el-table-column>
        <el-table-column label="解析" min-width="300">
          <template #default="{ row }">
            <MarkdownRenderer v-if="result.visibility?.analysis" :source="row.analysis || '暂无解析'" />
            <span v-else class="muted">暂未开放</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive } from 'vue';
import { Back } from '@element-plus/icons-vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';
import { statusLabel, statusTagType } from '../statusMeta';

const route = useRoute();
const simulateStudentId = computed(() => String(route.query.simulateStudentId || ''));
const hiddenDetailLabels = computed(() => {
  const visibility = result.visibility ?? {};
  return [
    ['content', '题干'],
    ['studentAnswer', '作答'],
    ['correctness', '对错结果'],
    ['correctAnswer', '正确答案'],
    ['analysis', '解析'],
  ]
    .filter(([key]) => visibility[key] === false)
    .map(([, label]) => label);
});
const restrictionTitle = computed(() => {
  const reason = result.visibility?.reason || '当前结果按考试设置部分开放';
  return hiddenDetailLabels.value.length
    ? `${reason}；暂未开放：${hiddenDetailLabels.value.join('、')}`
    : reason;
});
const result = reactive({
  totalScore: 0,
  objectiveScore: 0,
  judgeScore: 0,
  status: '',
  durationSeconds: 0,
  visibility: null,
  questionResults: [],
});

async function load() {
  Object.assign(
    result,
    await api(
      simulateStudentId.value
        ? `/student/simulate/attempts/${route.params.attemptId}/result?studentId=${simulateStudentId.value}`
        : `/student/attempts/${route.params.attemptId}/result`,
    ),
  );
}

function resultText(row) {
  if (!result.visibility?.correctness) return '未开放';
  if (row.isCorrect === true) return '正确';
  if (row.isCorrect === false) return '错误';
  return '待批改';
}

function resultStateClass(row) {
  if (!result.visibility?.correctness) return 'warning';
  if (row.isCorrect === true) return 'success';
  if (row.isCorrect === false) return 'danger';
  return 'warning';
}

function displayScore(value) {
  return value === null || value === undefined ? '未开放' : value;
}

function selectedOptionIds(row) {
  return row.studentAnswer?.selectedOptionIds ?? [];
}

function correctOptionIds(row) {
  return row.correctAnswer?.correctOptionIds ?? [];
}

function isSelectedOption(row, option) {
  return Boolean(result.visibility?.studentAnswer) && selectedOptionIds(row).includes(option.optionId);
}

function isCorrectOption(row, option) {
  return Boolean(result.visibility?.correctAnswer) && (correctOptionIds(row).includes(option.optionId) || option.isCorrect);
}

function resultOptionClass(row, option) {
  const selected = isSelectedOption(row, option);
  const correct = isCorrectOption(row, option);
  return {
    'result-option': true,
    correct,
    wrong: selected && !correct,
    selected,
  };
}

function displayStudentAnswer(row) {
  if (row.studentAnswer?.selectedOptionIds?.length) {
    return row.studentAnswer.selectedOptionIds
      .map((optionId) => displayOptionAnswer(row, optionId))
      .join('，');
  }
  if (row.studentAnswer?.blanks?.length) {
    return row.studentAnswer.blanks.map((blank) => blank.value).join('，');
  }
  if (row.studentAnswer?.code) {
    return `${row.studentAnswer.language || '代码'}，${String(row.studentAnswer.code).length} 字符`;
  }
  if (row.studentAnswer?.text) {
    return row.studentAnswer.text;
  }
  if (row.studentAnswer?.extra) {
    return JSON.stringify(row.studentAnswer.extra);
  }
  return '未作答';
}

function displayCorrectAnswer(row) {
  if (row.correctAnswer?.correctOptionIds?.length) {
    return row.correctAnswer.correctOptionIds
      .map((optionId) => displayOptionAnswer(row, optionId))
      .join('，');
  }
  if (row.correctAnswer?.blanks?.length) {
    return row.correctAnswer.blanks
      .map((blank) => blank.answers?.join('/') ?? '')
      .filter(Boolean)
      .join('，');
  }
  if (row.correctAnswer?.reference) {
    return row.correctAnswer.reference;
  }
  if (row.correctAnswer && Object.keys(row.correctAnswer).length) {
    return JSON.stringify(row.correctAnswer);
  }
  return '待人工批改';
}

function displayOptionAnswer(row, optionId) {
  const option = row.options?.find((item) => item.optionId === optionId);
  if (!option) return optionId;
  const content = result.visibility?.content && option.content ? `.${option.content}` : '';
  return `${option.label}${content}`;
}

onMounted(load);
</script>
