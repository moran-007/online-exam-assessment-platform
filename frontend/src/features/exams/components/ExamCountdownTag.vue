<template>
  <el-tag :type="tagType">剩余 {{ text }}</el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ remainingMs: number }>();

const text = computed(() => {
  const seconds = Math.max(0, Math.floor(props.remainingMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`;
});
const tagType = computed(() => {
  if (props.remainingMs <= 60 * 1000) return 'danger';
  if (props.remainingMs <= 10 * 60 * 1000) return 'warning';
  return 'success';
});
</script>
