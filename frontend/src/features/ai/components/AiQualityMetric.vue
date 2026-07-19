<template><div class="quality-metric"><span>{{ label }}</span><strong>{{ value }}</strong></div></template>
<script setup lang="ts">defineProps<{ label: string; value: string | number }>();</script>
<style scoped>
.quality-metric { padding: 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-fill-color-light); }
.quality-metric span { display: block; color: var(--el-text-color-secondary); font-size: 12px; }
.quality-metric strong { display: block; margin-top: 5px; font-size: 20px; }
</style>
