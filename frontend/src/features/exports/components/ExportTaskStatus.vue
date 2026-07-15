<template>
  <el-tag :type="tagType">{{ label }}</el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ExportTaskStatus } from '../models';

const props = defineProps<{ status: ExportTaskStatus | string }>();
const labels: Record<string, string> = {
  success: '成功', failed: '失败', processing: '处理中', pending: '等待中', expired: '已过期', canceled: '已取消',
};
const types: Record<string, 'success' | 'danger' | 'warning' | 'info'> = {
  success: 'success', failed: 'danger', processing: 'warning', pending: 'info', expired: 'info', canceled: 'info',
};
const label = computed(() => labels[props.status] ?? props.status);
const tagType = computed(() => types[props.status] ?? 'info');
</script>
