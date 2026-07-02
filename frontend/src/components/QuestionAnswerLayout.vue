<template>
  <div
    ref="root"
    :class="['question-answer-layout', `is-${mode}`, { 'is-framed': framed, 'is-resizing': resizing }]"
    :style="layoutStyle"
  >
    <section class="question-answer-statement">
      <slot name="statement" />
    </section>
    <button
      v-if="mode === 'side'"
      class="question-answer-resizer"
      type="button"
      aria-label="调整左右分栏宽度"
      title="拖动调整左右分栏"
      @pointerdown="startResize"
    ></button>
    <section class="question-answer-panel">
      <slot name="answer" />
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';

const props = defineProps({
  mode: {
    type: String,
    default: 'side',
    validator: (value) => ['side', 'stack'].includes(value),
  },
  framed: {
    type: Boolean,
    default: false,
  },
  storageKey: {
    type: String,
    default: 'question-answer-layout-ratio',
  },
});

const root = ref(null);
const resizing = ref(false);
const ratio = ref(readRatio());
const layoutStyle = computed(() => ({
  '--question-answer-left': `${ratio.value}%`,
}));

function startResize(event) {
  if (props.mode !== 'side') return;
  event.preventDefault();
  resizing.value = true;
  window.addEventListener('pointermove', handleResize);
  window.addEventListener('pointerup', stopResize, { once: true });
}

function handleResize(event) {
  const rect = root.value?.getBoundingClientRect();
  if (!rect?.width) return;
  ratio.value = Math.min(72, Math.max(32, ((event.clientX - rect.left) / rect.width) * 100));
}

function stopResize() {
  resizing.value = false;
  localStorage.setItem(props.storageKey, String(Math.round(ratio.value)));
  window.removeEventListener('pointermove', handleResize);
}

function readRatio() {
  const value = Number(localStorage.getItem(props.storageKey));
  return Number.isFinite(value) && value >= 32 && value <= 72 ? value : 54;
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', handleResize);
});
</script>
