<template>
  <div v-if="result" class="answer-feedback">
    <div class="answer-feedback-grid">
      <div v-if="studentAnswerText" :class="['answer-feedback-card', studentCardClass]">
        <span>你的答案</span>
        <MarkdownRenderer :source="studentAnswerText" />
      </div>
      <div v-if="referenceAnswerText" class="answer-feedback-card success">
        <span>{{ referenceTitle }}</span>
        <MarkdownRenderer :source="referenceAnswerText" />
      </div>
      <div v-if="result.answerExplanation" class="answer-feedback-card">
        <span>判定规则</span>
        <MarkdownRenderer :source="result.answerExplanation" />
      </div>
    </div>

    <div v-if="result.options?.length" class="paper-option-list">
      <div v-for="option in result.options" :key="option.optionId" :class="optionClass(option)">
        <strong>{{ option.label }}.</strong>
        <MarkdownRenderer :source="option.content" />
        <div class="result-option-tags">
          <span v-if="option.isCorrect" class="answer-mark success">正确答案</span>
          <span v-if="selectedOptionIds.includes(option.optionId)" :class="['answer-mark', option.isCorrect ? 'success' : 'danger']">
            你的选择
          </span>
        </div>
      </div>
    </div>

    <div v-if="result.analysis" class="paper-analysis">
      <strong>解析</strong>
      <MarkdownRenderer :source="result.analysis" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import MarkdownRenderer from './MarkdownRenderer.vue';

const props = defineProps({
  result: {
    type: Object,
    default: null,
  },
});

const selectedOptionIds = computed(() => props.result?.studentAnswer?.selectedOptionIds ?? []);
const studentAnswerText = computed(() => props.result?.studentAnswerText || '');
const referenceAnswerText = computed(() => props.result?.referenceAnswerText || props.result?.correctAnswerText || '');
const referenceTitle = computed(() => (props.result?.isCorrect === null ? '参考答案' : '正确答案'));
const studentCardClass = computed(() => {
  if (props.result?.isCorrect === true) return 'success';
  if (props.result?.isCorrect === false) return 'danger';
  return '';
});

function optionClass(option) {
  const selected = selectedOptionIds.value.includes(option.optionId);
  return {
    'paper-option': true,
    correct: option.isCorrect,
    wrong: selected && !option.isCorrect,
    selected,
  };
}
</script>
