<template>
  <div ref="root" class="programming-toolbar-shell" :class="{ 'is-open': open }">
    <button
      type="button"
      class="programming-toolbar-trigger"
      :aria-expanded="String(open)"
      @click.stop="toggle"
    >
      <span>{{ title }}</span>
      <strong>{{ summary }}</strong>
      <slot name="badge" />
    </button>
    <div v-if="open" class="programming-toolbar-popover">
      <slot :close="close" />
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';

defineProps({
  title: {
    type: String,
    default: '提交设置',
  },
  summary: {
    type: String,
    default: '',
  },
});

const root = ref(null);
const open = ref(false);

function toggle() {
  open.value = !open.value;
}

function close() {
  open.value = false;
}

function handleDocumentClick(event) {
  const target = event.target;
  if (root.value?.contains(target)) return;
  if (target?.closest?.('.el-popper, .el-select-dropdown')) return;
  close();
}

function handleKeydown(event) {
  if (event.key === 'Escape') close();
}

watch(open, (visible) => {
  const method = visible ? 'addEventListener' : 'removeEventListener';
  document[method]('click', handleDocumentClick);
  document[method]('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('keydown', handleKeydown);
});
</script>
