<template><AiSummaryDialog ref="dialog" kind="student" /></template>

<script setup lang="ts">
import { ref } from 'vue';
import AiSummaryDialog from './AiSummaryDialog.vue';
import type { StudentSummaryScope } from '../composables/useAiSummaryDialog';

const dialog = ref<InstanceType<typeof AiSummaryDialog>>();
defineExpose({
  open: (id: string, name: string, scope: StudentSummaryScope = {}) => dialog.value?.open(id, name, scope),
});
</script>
