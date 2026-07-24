<template>
  <div class="ai-model-selector">
    <el-select v-model="selectedProvider" placeholder="选择模型来源" @change="selectProvider">
      <el-option
        v-for="provider in providerOptions"
        :key="provider"
        :label="providerLabel(provider)"
        :value="provider"
      />
    </el-select>
    <el-select
      :model-value="modelValue"
      :disabled="!selectedProvider"
      placeholder="选择该来源下的模型"
      @update:model-value="selectConfiguration"
    >
      <el-option
        v-for="config in modelConfigurations"
        :key="config.id"
        :label="`${config.model} · ${config.name} · ${config.scope === 'personal' ? '个人' : '系统'}`"
        :value="config.id"
      />
    </el-select>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AiProviderConfig } from '../models';

const props = defineProps<{
  modelValue: string;
  configurations: AiProviderConfig[];
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const selectedProvider = ref('');
const providerOptions = computed(() => [...new Set(props.configurations.map((item) => item.provider))]);
const modelConfigurations = computed(() => props.configurations.filter((item) => item.provider === selectedProvider.value));

watch(
  () => [props.modelValue, props.configurations] as const,
  () => syncSelection(),
  { immediate: true, deep: true },
);

function syncSelection() {
  const selected = props.configurations.find((item) => item.id === props.modelValue);
  if (selected) {
    selectedProvider.value = selected.provider;
    return;
  }
  const fallback = preferredConfiguration(props.configurations);
  selectedProvider.value = fallback?.provider ?? '';
  if (fallback && fallback.id !== props.modelValue) emit('update:modelValue', fallback.id);
  if (!fallback && props.modelValue) emit('update:modelValue', '');
}

function selectProvider(provider: string) {
  const candidates = props.configurations.filter((item) => item.provider === provider);
  const selected = preferredConfiguration(candidates);
  emit('update:modelValue', selected?.id ?? '');
}

function selectConfiguration(value: string) {
  emit('update:modelValue', value);
}

function providerLabel(provider: string) {
  const count = props.configurations.filter((item) => item.provider === provider).length;
  return `${provider}（${count} 个模型配置）`;
}

function preferredConfiguration(configurations: AiProviderConfig[]) {
  return configurations.find((item) => item.scope === 'personal' && item.isDefault)
    ?? configurations.find((item) => item.isDefault)
    ?? configurations.find((item) => item.scope === 'personal')
    ?? configurations[0];
}
</script>

<style scoped>
.ai-model-selector { display: grid; grid-template-columns: minmax(160px, .75fr) minmax(260px, 1.25fr); gap: 10px; min-width: min(520px, 100%); }
@media (max-width: 680px) { .ai-model-selector { grid-template-columns: 1fr; width: 100%; } }
</style>
