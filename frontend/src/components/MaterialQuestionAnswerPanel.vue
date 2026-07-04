<template>
  <div class="material-answer-panel">
    <el-alert
      class="material-answer-hint"
      type="info"
      :closable="false"
      show-icon
      title="材料/组合题按子题作答，全部完成后统一提交；客观子题自动判分，主观/项目类子题进入待批改状态。"
    />

    <div v-if="children.length" class="material-answer-children">
      <section
        v-for="(child, index) in children"
        :key="childKey(child, index)"
        class="material-answer-child"
      >
        <div class="material-answer-child-head">
          <div>
            <strong>{{ index + 1 }}. {{ childQuestion(child).title || `子题 ${index + 1}` }}</strong>
            <div class="muted">
              {{ questionTypeLabel(childQuestion(child).type) }} · {{ childScore(child) }} 分
            </div>
          </div>
          <el-tag v-if="childResult(child)" :type="resultTagType(childResult(child))">
            {{ resultLabel(childResult(child)) }}
          </el-tag>
        </div>

        <MarkdownRenderer
          class="material-answer-child-statement"
          :source="childQuestion(child).content || ''"
          :public-question-id="childPublicQuestionId(child)"
          :asset-access-token="childAssetAccessToken(child)"
        />

        <QuestionAnswerHost
          :model-value="childAnswer(child)"
          :question="childQuestion(child)"
          :type="childQuestion(child).type"
          :rows="rowsFor(childQuestion(child).type)"
          :show-correct="showCorrect || Boolean(childResult(child))"
          :public-question-id="childPublicQuestionId(child)"
          :asset-access-token="childAssetAccessToken(child)"
          @update:model-value="(value) => updateChildAnswer(child, value)"
        />

        <el-alert
          v-if="childResult(child)"
          class="material-child-result"
          :title="`${childResult(child).message || resultLabel(childResult(child))}，得分 ${formatScore(childResult(child).score)} / ${formatScore(childResult(child).totalScore)}`"
          :type="resultAlertType(childResult(child))"
          show-icon
          :closable="false"
        />
        <AnswerFeedback v-if="childResult(child)" :result="childResult(child)" />
      </section>
    </div>

    <el-empty v-else description="该材料/组合题尚未配置子题" />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import AnswerFeedback from './AnswerFeedback.vue';
import MarkdownRenderer from './MarkdownRenderer.vue';
import QuestionAnswerHost from './QuestionAnswerHost.vue';
import { isObjectiveQuestionType, questionTypeLabel } from '../question-engine/registry';

const props = defineProps({
  material: { type: Object, required: true },
  modelValue: { type: Object, default: () => ({}) },
  results: { type: Object, default: () => ({}) },
  rows: { type: Number, default: 8 },
  showCorrect: { type: Boolean, default: false },
  publicQuestionId: { type: String, default: '' },
  assetAccessToken: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const children = computed(() => (Array.isArray(props.material?.children) ? props.material.children : []));

function childQuestion(child) {
  const question = child?.question || child?.snapshot || child || {};
  return {
    ...question,
    id: question.id || question.questionId || child?.questionId,
    questionId: question.questionId || question.id || child?.questionId,
    defaultScore: childScore(child),
  };
}

function childKey(child, index) {
  return childQuestion(child).questionId || childQuestion(child).id || `${index}`;
}

function childScore(child) {
  const explicit = Number(child?.score);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const questionScore = Number((child?.question || child?.snapshot || child || {}).defaultScore);
  return Number.isFinite(questionScore) && questionScore > 0 ? questionScore : 0;
}

function childAnswer(child) {
  const id = childKey(child, 0);
  return props.modelValue?.[id] || {};
}

function childResult(child) {
  const id = childKey(child, 0);
  return props.results?.[id] || null;
}

function updateChildAnswer(child, value) {
  const id = childKey(child, 0);
  emit('update:modelValue', {
    ...(props.modelValue || {}),
    [id]: value || {},
  });
}

function childPublicQuestionId(child) {
  const question = childQuestion(child);
  return question.id || question.questionId || child?.questionId || props.publicQuestionId;
}

function childAssetAccessToken(child) {
  const question = childQuestion(child);
  return child?.assetAccessToken || question.assetAccessToken || props.assetAccessToken;
}

function rowsFor(type) {
  return isObjectiveQuestionType(type) ? 5 : props.rows;
}

function resultLabel(result) {
  if (!result) return '';
  if (result.isCorrect === true) return '正确';
  if (result.isCorrect === false) return '错误';
  if (result.status === 'manual_needed') return '待批改';
  return '已提交';
}

function resultTagType(result) {
  if (result?.isCorrect === true) return 'success';
  if (result?.isCorrect === false) return 'danger';
  return 'warning';
}

function resultAlertType(result) {
  if (result?.isCorrect === true) return 'success';
  if (result?.isCorrect === false) return 'error';
  return 'warning';
}

function formatScore(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Number(numberValue.toFixed(2)) : 0;
}
</script>

<style scoped>
.material-answer-panel {
  display: grid;
  gap: 14px;
}

.material-answer-hint {
  margin-bottom: 2px;
}

.material-answer-children {
  display: grid;
  gap: 16px;
}

.material-answer-child {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: var(--el-bg-color);
}

.material-answer-child-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.material-answer-child-statement {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
}

.material-child-result {
  margin-top: 2px;
}
</style>
