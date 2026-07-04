<template>
  <slot v-if="definition" :definition="definition" />
  <el-alert v-else type="warning" :closable="false" title="未注册题型只能只读展示，不能编辑" />
</template>

<script setup>
import { computed } from 'vue';
import { questionTypeDefinition } from '../question-engine/registry';
const props = defineProps({ type: { type: String, required: true } });
const definition = computed(() => questionTypeDefinition(props.type));
</script>
