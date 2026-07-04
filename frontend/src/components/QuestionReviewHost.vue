<template>
  <div class="question-review-host">
    <div v-if="hasOptions" class="review-options">
      <div v-for="option in options" :key="optionId(option)" :class="optionClass(option)">
        <strong>{{ optionLabel(option) }}.</strong>
        <MarkdownRenderer
          :source="option.content || ''"
          :public-question-id="publicQuestionId"
          :asset-access-token="assetAccessToken"
        />
        <span v-if="isSelectedOption(option)" class="answer-mark">学生选择</span>
        <span v-if="isCorrectOption(option)" class="answer-mark success">正确答案</span>
      </div>
    </div>

    <div v-if="showStudentAnswer" class="review-answer-block">
      <strong>{{ studentLabel }}</strong>
      <pre v-if="answerCode" class="review-code"><code>{{ answerCode }}</code></pre>
      <pre v-else>{{ displayAnswer(answer, false) }}</pre>
    </div>

    <div v-if="showReference" class="review-answer-block reference">
      <strong>{{ referenceLabel }}</strong>
      <pre>{{ displayAnswer(correctAnswer, true) }}</pre>
    </div>

    <el-alert
      v-if="isMaterial"
      type="info"
      :closable="false"
      title="材料/组合题按子题独立作答与计分，父题作为大题说明或材料容器展示"
    />
    <el-alert v-else-if="!definition" type="warning" :closable="false" title="该题型尚未注册，当前按原始答案只读展示" />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import MarkdownRenderer from './MarkdownRenderer.vue';
import { isMaterialQuestionType, normalizeQuestionType, questionTypeDefinition } from '../question-engine/registry';

const props = defineProps({
  question: { type: Object, required: true },
  answer: { type: Object, default: null },
  correctAnswer: { type: Object, default: null },
  type: { type: String, default: '' },
  showCorrect: { type: Boolean, default: false },
  showReference: { type: Boolean, default: false },
  showStudentAnswer: { type: Boolean, default: true },
  studentLabel: { type: String, default: '学生作答' },
  referenceLabel: { type: String, default: '参考答案' },
  publicQuestionId: { type: String, default: '' },
  assetAccessToken: { type: String, default: '' },
});

const normalizedType = computed(() => normalizeQuestionType(props.type || props.question.type || ''));
const definition = computed(() => questionTypeDefinition(normalizedType.value));
const isMaterial = computed(() => isMaterialQuestionType(normalizedType.value));
const options = computed(() => props.question.options || []);
const hasOptions = computed(() => options.value.length > 0);
const selectedOptionIds = computed(() => props.answer?.selectedOptionIds ?? []);
const correctOptionIds = computed(() => props.correctAnswer?.correctOptionIds ?? []);
const answerCode = computed(() => props.answer?.code || props.answer?.extra?.code || '');

function optionId(option) {
  return option.optionId || option.id || option.value;
}

function optionLabel(option) {
  return option.label || option.optionKey || option.key || '';
}

function optionText(id) {
  const option = options.value.find((item) => optionId(item) === id);
  return option ? `${optionLabel(option)}. ${option.content}` : id;
}

function isSelectedOption(option) {
  return selectedOptionIds.value.includes(optionId(option));
}

function isCorrectOption(option) {
  return props.showCorrect && (correctOptionIds.value.includes(optionId(option)) || option.isCorrect);
}

function optionClass(option) {
  return {
    'review-option': true,
    selected: isSelectedOption(option),
    correct: isCorrectOption(option),
    wrong: isSelectedOption(option) && props.showCorrect && !isCorrectOption(option),
  };
}

function displayAnswer(value, reference) {
  const target = value || {};
  if (target.selectedOptionIds?.length) return target.selectedOptionIds.map(optionText).join('\n');
  if (target.correctOptionIds?.length) return target.correctOptionIds.map(optionText).join('\n');
  if (target.blanks?.length) {
    return target.blanks.map((blank) => {
      const content = reference ? blank.answers?.join(' / ') : blank.value ?? '';
      return `第 ${blank.index} 空：${content}`;
    }).join('\n');
  }
  if (target.reference) return target.reference;
  if (target.text) return target.text;
  if (target.fileName || target.fileUrl) return target.fileName || target.fileUrl;
  if (target.extra?.code) return target.extra.code;
  return Object.keys(target).length ? JSON.stringify(target, null, 2) : reference ? '待人工批改' : '未作答';
}
</script>

<style scoped>
.question-review-host {
  display: grid;
  gap: 12px;
}

.review-options {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.review-option {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 8px;
  align-items: start;
  padding: 10px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.review-option.selected {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.review-option.correct {
  border-color: var(--el-color-success-light-5);
  background: var(--el-color-success-light-9);
}

.review-option.wrong {
  border-color: var(--el-color-danger-light-5);
  background: var(--el-color-danger-light-9);
}

.answer-mark {
  white-space: nowrap;
  color: var(--el-color-primary);
  font-size: 12px;
}

.answer-mark.success {
  color: var(--el-color-success);
}

.review-answer-block {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}

.review-answer-block.reference {
  background: var(--el-color-success-light-9);
}

.review-answer-block pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.review-code {
  max-height: 360px;
  overflow: auto;
}
</style>
