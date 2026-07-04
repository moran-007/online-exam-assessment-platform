<template>
  <div class="question-answer-host">
    <div class="programming-toolbar">
      <span class="programming-language-label">作答</span>
      <el-tag>{{ definition?.label || '未知题型' }}</el-tag>
    </div>

    <el-radio-group
      v-if="['single_choice', 'true_false'].includes(normalizedType)"
      :model-value="singleValue"
      class="answer-options"
      @update:model-value="updateSingle"
    >
      <el-radio
        v-for="option in options"
        :key="optionId(option)"
        :label="optionId(option)"
        :class="['answer-option', showCorrect && option.isCorrect ? 'answer-correct' : '']"
      >
        <span class="option-choice">
          <strong>{{ optionLabel(option) }}.</strong>
          <MarkdownRenderer :source="option.content || ''" />
        </span>
      </el-radio>
    </el-radio-group>

    <el-checkbox-group
      v-else-if="normalizedType === 'multiple_choice'"
      :model-value="answer.selectedOptionIds || []"
      class="answer-options"
      @update:model-value="updateSelected"
    >
      <el-checkbox
        v-for="option in options"
        :key="optionId(option)"
        :label="optionId(option)"
        :class="['answer-option', showCorrect && option.isCorrect ? 'answer-correct' : '']"
      >
        <span class="option-choice">
          <strong>{{ optionLabel(option) }}.</strong>
          <MarkdownRenderer :source="option.content || ''" />
        </span>
      </el-checkbox>
    </el-checkbox-group>

    <FillBlankAnswerInputs
      v-else-if="normalizedType === 'fill_blank'"
      :model-value="answer.blanks || []"
      :count="blankCount"
      @update:model-value="updateBlanks"
    />

    <el-input
      v-else-if="definition && normalizedType !== 'material'"
      :model-value="answer.text || ''"
      class="answer-input subjective-answer-input"
      type="textarea"
      :rows="rows"
      placeholder="填写答案"
      @update:model-value="updateText"
    />

    <el-alert v-else-if="normalizedType === 'material'" type="info" :closable="false" title="材料容器不直接作答，请完成其子题" />
    <el-alert v-else type="warning" :closable="false" title="该题型尚未注册，当前仅支持只读查看" />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import FillBlankAnswerInputs from './FillBlankAnswerInputs.vue';
import MarkdownRenderer from './MarkdownRenderer.vue';
import { questionTypeDefinition } from '../question-engine/registry';

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
  question: { type: Object, required: true },
  type: { type: String, default: '' },
  rows: { type: Number, default: 6 },
  showCorrect: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);
const normalizedType = computed(() => String(props.type || props.question.type || '').replaceAll('-', '_').toLowerCase());
const definition = computed(() => questionTypeDefinition(normalizedType.value));
const answer = computed(() => props.modelValue || {});
const options = computed(() => props.question.options || []);
const singleValue = computed(() => answer.value.selectedOptionIds?.[0] || '');
const blankCount = computed(() => {
  const explicit = Number(props.question.blankCount);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return Math.max(1, props.question.answer?.blanks?.length || answer.value.blanks?.length || 1);
});

function update(patch) { emit('update:modelValue', { ...answer.value, ...patch }); }
function updateSingle(value) { update({ selectedOptionIds: value ? [value] : [] }); }
function updateSelected(value) { update({ selectedOptionIds: value || [] }); }
function updateBlanks(value) { update({ blanks: value || [] }); }
function updateText(value) { update({ text: value || '' }); }
function optionId(option) { return option.optionId || option.id || option.value; }
function optionLabel(option) { return option.label || option.optionKey || option.key || ''; }
</script>
