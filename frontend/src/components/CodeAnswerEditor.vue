<template>
  <div
    class="code-answer-editor"
    :class="{ 'is-focused': focused, 'is-disabled': disabled || readonly }"
    :style="editorStyle"
  >
    <div class="code-answer-editor__toolbar">
      <span class="code-answer-editor__meta">{{ displayLanguageLabel }}</span>
      <div class="code-answer-editor__tools" aria-label="代码工具">
        <button type="button" title="插入常用模板" :disabled="!canEdit" @click="insertTemplate">&lt;/&gt;</button>
        <button type="button" title="整理缩进和空白" :disabled="!canEdit" @click="formatCode">{ }</button>
        <button type="button" title="注释/取消注释（Ctrl+/）" :disabled="!canEdit" @click="toggleEditorComment">//</button>
      </div>
      <div class="code-answer-editor__font-tools" aria-label="代码字号">
        <button type="button" title="减小字号" :disabled="fontSize <= minFontSize" @click="changeFontSize(-1)">A-</button>
        <span>{{ fontSize }}px</span>
        <button type="button" title="增大字号" :disabled="fontSize >= maxFontSize" @click="changeFontSize(1)">A+</button>
      </div>
    </div>

    <div ref="editorHost" class="code-answer-editor__host" :aria-label="ariaLabel"></div>
  </div>
</template>

<script setup>
import { basicSetup } from 'codemirror';
import { indentWithTab, deleteTrailingWhitespace, toggleComment } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { indentRange, indentUnit } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as editorPlaceholder } from '@codemirror/view';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

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

const editorHost = ref(null);
const editorView = shallowRef(null);
const focused = ref(false);
const minFontSize = 12;
const maxFontSize = 22;
const fontSize = ref(readStoredFontSize());
const languageCompartment = new Compartment();
const readonlyCompartment = new Compartment();
const editableCompartment = new Compartment();
const placeholderCompartment = new Compartment();

const canEdit = computed(() => !props.disabled && !props.readonly);
const normalizedLanguage = computed(() => normalizeLanguage(props.language));
const normalizedLanguageLabel = computed(() => (normalizedLanguage.value || 'text').toUpperCase());
const displayLanguageLabel = computed(() => props.languageLabel || normalizedLanguageLabel.value);
const editorHeight = computed(() => {
  const rows = Math.max(8, Number(props.rows) || 18);
  return `${Math.round(rows * 24 + 24)}px`;
});
const editorStyle = computed(() => ({
  '--code-editor-height': editorHeight.value,
  '--code-editor-font-size': `${fontSize.value}px`,
}));

onMounted(() => {
  if (!editorHost.value) return;

  editorView.value = new EditorView({
    parent: editorHost.value,
    state: EditorState.create({
      doc: props.modelValue || '',
      extensions: [
        basicSetup,
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        languageCompartment.of(languageExtension()),
        readonlyCompartment.of(EditorState.readOnly.of(!canEdit.value)),
        editableCompartment.of(EditorView.editable.of(canEdit.value)),
        placeholderCompartment.of(editorPlaceholder(props.placeholder)),
        keymap.of([
          indentWithTab,
          { key: 'Mod-/', run: toggleComment },
          { key: 'Shift-Alt-f', run: formatEditorView },
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          emit('update:modelValue', update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          focus: () => {
            focused.value = true;
          },
          blur: () => {
            focused.value = false;
          },
        }),
      ],
    }),
  });
});

watch(
  () => props.modelValue,
  (value) => {
    const view = editorView.value;
    if (!view) return;
    const nextValue = value || '';
    const currentValue = view.state.doc.toString();
    if (nextValue === currentValue) return;

    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: nextValue },
    });
  },
);

watch(
  () => props.language,
  () => reconfigure(languageCompartment, languageExtension()),
);

watch(
  () => props.placeholder,
  (value) => reconfigure(placeholderCompartment, editorPlaceholder(value || '')),
);

watch(
  [() => props.disabled, () => props.readonly],
  () => {
    reconfigure(readonlyCompartment, EditorState.readOnly.of(!canEdit.value));
    reconfigure(editableCompartment, EditorView.editable.of(canEdit.value));
  },
);

onBeforeUnmount(() => {
  editorView.value?.destroy();
  editorView.value = null;
});

function reconfigure(compartment, extension) {
  const view = editorView.value;
  if (!view) return;
  view.dispatch({ effects: compartment.reconfigure(extension) });
}

function insertTemplate() {
  const view = editorView.value;
  if (!view || !canEdit.value) return;
  const template = templateForLanguage();
  const cursor = view.state.selection.main;
  const prefix = view.state.doc.length && cursor.from > 0 ? '\n' : '';
  const text = `${prefix}${template}`;
  view.dispatch({
    changes: { from: cursor.from, to: cursor.to, insert: text },
    selection: { anchor: cursor.from + text.length },
    scrollIntoView: true,
  });
  view.focus();
}

function formatCode() {
  const view = editorView.value;
  if (!view || !canEdit.value) return;
  formatEditorView(view);
  view.focus();
}

function toggleEditorComment() {
  const view = editorView.value;
  if (!view || !canEdit.value) return;
  toggleComment(view);
  view.focus();
}

function formatEditorView(view) {
  deleteTrailingWhitespace(view);
  const changes = indentRange(view.state, 0, view.state.doc.length);
  if (!changes.empty) {
    view.dispatch({ changes, scrollIntoView: true });
  }
  return true;
}

function changeFontSize(step) {
  fontSize.value = clampFontSize(fontSize.value + step);
  localStorage.setItem('code-answer-font-size', String(fontSize.value));
  nextTick(() => {
    editorView.value?.requestMeasure();
    editorView.value?.focus();
  });
}

function readStoredFontSize() {
  return clampFontSize(Number(localStorage.getItem('code-answer-font-size')) || 15);
}

function clampFontSize(value) {
  return Math.min(maxFontSize, Math.max(minFontSize, Math.round(value)));
}

function languageExtension() {
  switch (normalizedLanguage.value) {
    case 'python':
      return python();
    case 'java':
      return java();
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'go':
      return go();
    case 'rust':
      return rust();
    case 'c':
    case 'cpp':
      return cpp();
    default:
      return [];
  }
}

function templateForLanguage() {
  const language = normalizedLanguage.value;
  if (language === 'python') return 'print("Hello,World!")\n';
  if (language === 'java') {
    return [
      'public class Main {',
      '  public static void main(String[] args) {',
      '    System.out.println("Hello,World!");',
      '  }',
      '}',
      '',
    ].join('\n');
  }
  if (language === 'c') {
    return ['#include <stdio.h>', '', 'int main(void) {', '  printf("Hello,World!\\n");', '  return 0;', '}', ''].join('\n');
  }
  return ['#include <bits/stdc++.h>', 'using namespace std;', '', 'int main() {', '  cout << "Hello,World!" << endl;', '  return 0;', '}', ''].join('\n');
}

function normalizeLanguage(language) {
  const raw = String(language || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.includes('python') || raw.startsWith('py.')) return 'python';
  if (raw.includes('java') && !raw.includes('javascript')) return 'java';
  if (raw.includes('typescript') || raw === 'ts' || raw.endsWith('.ts')) return 'typescript';
  if (raw.includes('javascript') || raw === 'js' || raw.endsWith('.js')) return 'javascript';
  if (raw.includes('c++') || raw.includes('cpp') || raw.startsWith('cc.') || raw === 'cc') return 'cpp';
  if (raw === 'c' || raw.includes('gcc') || raw.startsWith('c.')) return 'c';
  if (raw.includes('go')) return 'go';
  if (raw.includes('rust') || raw === 'rs') return 'rust';
  if (raw.includes('pas') || raw.includes('delphi')) return '';
  return raw.replace(/[^a-z0-9_+-]/g, '');
}
</script>

<style scoped>
.code-answer-editor {
  min-height: 0;
  margin-top: 14px;
  border: 1px solid #d9e2ec;
  border-radius: 8px;
  background: #f8fafc;
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
  min-height: 40px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  padding: 7px 10px;
  border-bottom: 1px solid #d9e2ec;
  background: linear-gradient(180deg, #ffffff, #f8fafc);
}

.code-answer-editor__meta {
  min-width: 0;
  overflow: hidden;
  color: #334155;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code-answer-editor__tools,
.code-answer-editor__font-tools {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
}

.code-answer-editor__tools button,
.code-answer-editor__font-tools button {
  min-width: 32px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease;
}

.code-answer-editor__tools button:hover:not(:disabled),
.code-answer-editor__font-tools button:hover:not(:disabled) {
  border-color: var(--accent);
  background: #eef6ff;
  color: var(--accent);
}

.code-answer-editor__tools button:disabled,
.code-answer-editor__font-tools button:disabled {
  cursor: not-allowed;
  color: #a7b0bc;
  background: #f4f6f8;
}

.code-answer-editor__host {
  min-height: 260px;
}

.code-answer-editor__host :deep(.cm-editor) {
  height: var(--code-editor-height);
  min-height: 260px;
  max-height: min(62vh, 640px);
  resize: vertical;
  overflow: hidden;
  background: #fbfdff;
  color: #0f172a;
  font-size: var(--code-editor-font-size);
}

.code-answer-editor__host :deep(.cm-scroller) {
  overflow: auto;
  font-family: "Cascadia Code", Consolas, "SFMono-Regular", monospace;
  line-height: 1.6;
}

.code-answer-editor__host :deep(.cm-content) {
  min-height: 100%;
  padding: 12px 0;
  caret-color: #111827;
}

.code-answer-editor__host :deep(.cm-line) {
  padding: 0 12px;
}

.code-answer-editor__host :deep(.cm-gutters) {
  border-right: 1px solid #d9e2ec;
  background: #f1f5f9;
  color: #64748b;
}

.code-answer-editor__host :deep(.cm-activeLine) {
  background: #eef6ff;
}

.code-answer-editor__host :deep(.cm-activeLineGutter) {
  background: #e2eef8;
  color: #1f3f68;
}

.code-answer-editor__host :deep(.cm-selectionBackground),
.code-answer-editor__host :deep(.cm-focused .cm-selectionBackground),
.code-answer-editor__host :deep(.cm-content ::selection) {
  background: rgba(59, 130, 246, 0.22);
}

.code-answer-editor__host :deep(.cm-matchingBracket) {
  outline: 1px solid #38bdf8;
  background: #e0f2fe;
}

.code-answer-editor__host :deep(.cm-tooltip) {
  border: 1px solid #d9e2ec;
  border-radius: 6px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.14);
}

.code-answer-editor__host :deep(.cm-tooltip-autocomplete > ul) {
  max-height: 220px;
  font-family: "Cascadia Code", Consolas, "SFMono-Regular", monospace;
}

@media (max-width: 1100px) {
  .code-answer-editor__toolbar {
    grid-template-columns: 1fr;
  }

  .code-answer-editor__host :deep(.cm-editor) {
    min-height: 320px;
  }
}
</style>
