<template>
  <div class="question-review-host">
    <QuestionAnswerHost :model-value="answer || {}" :question="question" :type="type" :show-correct="showCorrect" />
  </div>
</template>

<script setup>
import QuestionAnswerHost from './QuestionAnswerHost.vue';
defineProps({
  question: { type: Object, required: true },
  answer: { type: Object, default: () => ({}) },
  type: { type: String, default: '' },
  showCorrect: { type: Boolean, default: false },
});
</script>
