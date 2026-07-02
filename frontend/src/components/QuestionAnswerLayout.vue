<template>
  <div :class="['question-answer-layout', `is-${mode}`, { 'is-framed': framed }]">
    <section class="question-answer-statement">
      <slot name="statement" />
    </section>
    <section class="question-answer-panel">
      <slot name="answer" />
    </section>
  </div>
</template>

<script setup>
defineProps({
  mode: {
    type: String,
    default: 'side',
    validator: (value) => ['side', 'stack'].includes(value),
  },
  framed: {
    type: Boolean,
    default: false,
  },
});
</script>
