<template>
  <div
    class="code-answer-editor"
    :class="{ 'is-focused': focused, 'is-disabled': disabled || readonly }"
    :style="editorStyle"
  >
    <div class="code-answer-editor__toolbar">
      <span class="code-answer-editor__meta">{{ displayLanguageLabel }}</span>
      <div class="code-answer-editor__font-tools" aria-label="代码字号">
        <button type="button" title="减小字号" :disabled="fontSize <= minFontSize" @click="changeFontSize(-1)">A-</button>
        <span>{{ fontSize }}px</span>
        <button type="button" title="增大字号" :disabled="fontSize >= maxFontSize" @click="changeFontSize(1)">A+</button>
      </div>
    </div>

    <pre class="code-answer-editor__surface hljs"><code
      ref="editor"
      class="code-answer-editor__code"
      :contenteditable="canEdit ? 'true' : 'false'"
      :data-placeholder="placeholder"
      :aria-label="ariaLabel"
      role="textbox"
      aria-multiline="true"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      autocorrect="off"
      v-html="highlightedCode"
      @blur="focused = false"
      @compositionend="handleCompositionEnd"
      @compositionstart="isComposing = true"
      @focus="focused = true"
      @input="handleInput"
      @keydown="handleKeydown"
      @paste="handlePaste"
    ></code></pre>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.css';

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  language: {
    type: String,
    default: '',
  },
  languageLabel: {
    type: String,
    default: '',
  },
  rows: {
    type: Number,
    default: 18,
  },
  placeholder: {
    type: String,
    default: '在这里编写代码',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  ariaLabel: {
    type: String,
    default: '代码作答编辑器',
  },
});

const emit = defineEmits(['update:modelValue']);

const editor = ref(null);
const focused = ref(false);
const isComposing = ref(false);
const minFontSize = 12;
const maxFontSize = 22;
const fontSize = ref(readStoredFontSize());
let pendingCaretOffset = null;

const canEdit = computed(() => !props.disabled && !props.readonly);
const highlightLanguage = computed(() => normalizeHighlightLanguage(props.language));
const normalizedLanguageLabel = computed(() => (highlightLanguage.value || 'text').toUpperCase());
const displayLanguageLabel = computed(() => props.languageLabel || normalizedLanguageLabel.value);
const editorMinHeight = computed(() => {
  const rows = Math.max(6, Number(props.rows) || 18);
  return `${Math.round(rows * fontSize.value * 1.6 + 24)}px`;
});
const editorStyle = computed(() => ({
  '--code-editor-min-height': editorMinHeight.value,
  '--code-editor-font-size': `${fontSize.value}px`,
}));

const highlightedCode = computed(() => {
  const source = props.modelValue || '';
  const language = highlightLanguage.value;
  if (source && language && hljs.getLanguage(language)) {
    return hljs.highlight(source, { language, ignoreIllegals: true }).value;
  }
  return escapeHtml(source);
});

watch(
  () => [props.modelValue, props.language],
  () => {
    if (!focused.value) return;
    const offset = pendingCaretOffset ?? getCaretOffset();
    nextTick(() => restoreCaretOffset(offset));
  },
);

function handleInput() {
  if (isComposing.value) return;
  pendingCaretOffset = getCaretOffset();
  emit('update:modelValue', currentEditorText());
  nextTick(() => {
    restoreCaretOffset(pendingCaretOffset);
    pendingCaretOffset = null;
  });
}

function handleCompositionEnd() {
  isComposing.value = false;
  handleInput();
}

function handleKeydown(event) {
  if (!canEdit.value) {
    event.preventDefault();
    return;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    insertPlainText('  ');
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    insertPlainText('\n');
  }
}

function handlePaste(event) {
  if (!canEdit.value) return;
  event.preventDefault();
  insertPlainText(event.clipboardData?.getData('text/plain') || '');
}

function insertPlainText(text) {
  const root = editor.value;
  if (!root || !text) return;
  root.focus();
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;

  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  handleInput();
}

function currentEditorText() {
  const text = editor.value?.innerText ?? editor.value?.textContent ?? '';
  return text.replace(/\u00a0/g, ' ');
}

function getCaretOffset() {
  const root = editor.value;
  const selection = window.getSelection();
  if (!root || !selection?.rangeCount) return 0;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.endContainer)) return 0;

  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.endContainer, range.endOffset);
  return before.toString().length;
}

function restoreCaretOffset(offset) {
  const root = editor.value;
  if (!root || offset === null || offset === undefined) return;
  const selection = window.getSelection();
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node = walker.nextNode();

  while (node) {
    const length = node.textContent.length;
    if (remaining <= length) {
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= length;
    node = walker.nextNode();
  }

  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function changeFontSize(step) {
  fontSize.value = clampFontSize(fontSize.value + step);
  localStorage.setItem('code-answer-font-size', String(fontSize.value));
  nextTick(() => {
    if (focused.value) restoreCaretOffset(getCaretOffset());
  });
}

function readStoredFontSize() {
  return clampFontSize(Number(localStorage.getItem('code-answer-font-size')) || 15);
}

function clampFontSize(value) {
  return Math.min(maxFontSize, Math.max(minFontSize, Math.round(value)));
}

function normalizeHighlightLanguage(language) {
  const raw = String(language || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.includes('python') || raw.startsWith('py.')) return 'python';
  if (raw.includes('java') && !raw.includes('javascript')) return 'java';
  if (raw.includes('javascript') || raw === 'js' || raw.endsWith('.js')) return 'javascript';
  if (raw.includes('typescript') || raw === 'ts' || raw.endsWith('.ts')) return 'typescript';
  if (raw.includes('c++') || raw.includes('cpp') || raw.startsWith('cc.') || raw === 'cc') return 'cpp';
  if (raw === 'c' || raw.includes('gcc') || raw.startsWith('c.')) return 'c';
  if (raw.includes('pas') || raw.includes('delphi')) return 'delphi';
  if (raw.includes('go')) return 'go';
  if (raw.includes('rust') || raw === 'rs') return 'rust';
  return raw.replace(/[^a-z0-9_+-]/g, '');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
</script>

<style scoped>
.code-answer-editor {
  min-height: var(--code-editor-min-height);
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f6f8fa;
  overflow: hidden;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.code-answer-editor.is-focused {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(37, 111, 120, 0.14);
}

.code-answer-editor.is-disabled {
  background: #f0f3f6;
}

.code-answer-editor__toolbar {
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid #d5dde5;
  background: #ffffff;
}

.code-answer-editor__meta {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.code-answer-editor__font-tools {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
}

.code-answer-editor__font-tools button {
  min-width: 32px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #ffffff;
  color: var(--text);
  cursor: pointer;
  font: inherit;
}

.code-answer-editor__font-tools button:disabled {
  cursor: not-allowed;
  color: #a7b0bc;
  background: #f4f6f8;
}

.code-answer-editor__surface {
  min-height: var(--code-editor-min-height);
  max-height: min(68vh, 720px);
  margin: 0;
  padding: 12px 14px;
  border: 0;
  background: transparent;
  overflow: auto;
}

.code-answer-editor__code {
  display: block;
  min-width: max-content;
  min-height: calc(var(--code-editor-min-height) - 24px);
  outline: 0;
  color: inherit;
  font-family: "Cascadia Code", Consolas, "SFMono-Regular", monospace;
  font-size: var(--code-editor-font-size);
  line-height: 1.6;
  tab-size: 2;
  white-space: pre;
}

.code-answer-editor__code:empty::before {
  content: attr(data-placeholder);
  color: #95a1af;
  pointer-events: none;
}

@media (max-width: 1100px) {
  .code-answer-editor,
  .code-answer-editor__surface {
    min-height: 320px;
  }
}
</style>
