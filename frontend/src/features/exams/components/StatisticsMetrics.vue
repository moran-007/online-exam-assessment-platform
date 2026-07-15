<template>
  <div class="metric-row statistics-metric-row">
    <div v-for="metric in metrics" :key="metric.label" class="metric">
      <span>{{ metric.label }}</span>
      <strong>{{ metric.value }}</strong>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  overview: {
    submittedAttempts?: number;
    averageScore?: number;
    maxScore?: number;
    pendingManual?: number;
    activeWrongQuestions?: number;
    gradedCount?: number;
  };
  hydroSummary: { metrics?: { pendingCount?: number } };
}>();

const metrics = computed(() => [
  { label: '提交次数', value: props.overview.submittedAttempts },
  { label: '平均分', value: props.overview.averageScore },
  { label: '最高分', value: props.overview.maxScore },
  { label: '待批改', value: props.overview.pendingManual },
  { label: '判题待回写', value: props.hydroSummary.metrics?.pendingCount || 0 },
  { label: '活跃错题', value: props.overview.activeWrongQuestions },
  { label: '已批改', value: props.overview.gradedCount },
]);
</script>
