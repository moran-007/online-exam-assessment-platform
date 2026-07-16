<template><AiSummaryDialog ref="dialog" kind="exam" /></template>

<script setup lang="ts">
import { ref } from 'vue';
import AiSummaryDialog from './AiSummaryDialog.vue';

const dialog = ref<InstanceType<typeof AiSummaryDialog>>();
defineExpose({ open: (id: string, name: string) => dialog.value?.open(id, name) });
</script>
