<template>
  <div class="fill-blank-inputs">
    <label v-for="blank in normalizedBlanks" :key="blank.index" class="fill-blank-input">
      <span>第 {{ blank.index }} 空</span>
      <el-input
        :model-value="blank.value"
        :placeholder="`填写第 ${blank.index} 空`"
        @update:model-value="(value) => updateBlank(blank.index, value)"
      />
    </label>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: {
    type: Array,
    default: () => [],
  },
  count: {
    type: Number,
    default: 1,
  },
});

const emit = defineEmits(['update:modelValue']);

const normalizedBlanks = computed(() => normalizeBlanks(props.modelValue, props.count));

function updateBlank(index, value) {
  emit(
    'update:modelValue',
    normalizedBlanks.value.map((blank) => (blank.index === index ? { ...blank, value } : blank)),
  );
}

function normalizeBlanks(value, count) {
  const source = Array.isArray(value) ? value : [];
  const maxIndex = Math.max(
    1,
    Number(count) || 1,
    ...source.map((blank) => Number(blank?.index) || 0),
  );
  return Array.from({ length: maxIndex }, (_, offset) => {
    const index = offset + 1;
    const existing = source.find((blank) => Number(blank?.index) === index);
    return {
      index,
      value: existing?.value ?? '',
    };
  });
}
</script>
