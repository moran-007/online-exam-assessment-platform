<template>
  <div
    v-if="!visible"
    ref="launcherRef"
    class="ai-chat-launcher"
    :class="{ compact: !launcherExpanded }"
    :style="launcherStyle"
    @mouseenter="launcherExpanded = true"
    @mouseleave="launcherExpanded = false"
    @pointerdown="startDrag($event, 'launcher')"
    @click="handleLauncherClick"
  >
    <el-button type="primary" round :icon="ChatDotRound" aria-label="问 AI">
      <span v-if="launcherExpanded">问 AI</span>
    </el-button>
  </div>

  <section
    v-if="visible"
    ref="panelRef"
    class="ai-chat-window"
    :class="{ minimized }"
    :style="panelStyle"
    aria-label="AI 助手"
  >
    <header class="ai-chat-window-head" @pointerdown="startDrag($event, 'panel')">
      <div class="ai-chat-window-title">
        <el-icon><ChatDotRound /></el-icon>
        <div><strong>AI 助手</strong><span v-if="!minimized">支持连续对话与 Markdown</span></div>
      </div>
      <div class="ai-chat-window-actions">
        <el-tooltip :content="minimized ? '展开' : '收起'" placement="bottom">
          <el-button circle text :icon="minimized ? FullScreen : Minus" :aria-label="minimized ? '展开 AI 助手' : '收起 AI 助手'" @click="minimized = !minimized" />
        </el-tooltip>
        <el-tooltip content="隐藏为悬浮入口" placement="bottom">
          <el-button circle text :icon="Close" aria-label="关闭 AI 助手" @click="closeAssistant" />
        </el-tooltip>
      </div>
    </header>

    <div v-show="!minimized" v-loading="loadingConfigurations" class="ai-chat-shell">
      <div class="ai-chat-head">
        <span>可按角色权限回答通用知识并检索平台数据；未授权直接答案时只提供解题思路</span>
        <el-button :disabled="!messages.length" @click="clear">清空对话</el-button>
      </div>

      <AiModelSelector v-model="form.configId" :configurations="activeConfigurations" />
      <el-input v-model="form.instruction" maxlength="500" show-word-limit placeholder="补充背景或回答要求（可选）" />

      <div ref="resultRef" class="ai-chat-messages">
        <div v-if="!messages.length" class="ai-chat-empty">
          <el-icon><ChatDotRound /></el-icon>
          <strong>有什么问题都可以在这里问</strong>
          <span>可询问通用知识、输入题目内容或试卷名称；平台事实只依据实时查询结果回答</span>
        </div>
        <div v-for="(message, index) in messages" :key="index" class="ai-chat-message" :class="message.role">
          <strong>{{ message.role === 'user' ? '你' : 'AI' }}</strong>
          <MarkdownRenderer :source="message.content" />
        </div>
        <div v-if="sending" class="ai-chat-loading muted">AI 正在回答…</div>
      </div>

      <div class="ai-chat-composer">
        <el-input
          v-model="form.content"
          type="textarea"
          :rows="3"
          maxlength="20000"
          show-word-limit
          resize="none"
          placeholder="输入问题，支持 Markdown、代码块和数学公式；Ctrl + Enter 发送"
          @keydown.ctrl.enter.prevent="send"
        />
        <div class="ai-chat-actions">
          <span class="muted">输出上限</span>
          <el-input-number v-model="form.maxTokens" :min="1" :max="8192" placeholder="自动" />
          <el-button v-if="form.maxTokens !== undefined" link @click="form.maxTokens = undefined">恢复自动</el-button>
          <span class="muted ai-chat-limit">{{ outputLimitHint }}</span>
          <el-button type="primary" :loading="sending" @click="send">发送问题</el-button>
        </div>
        <div v-if="meta" class="ai-chat-meta muted">{{ meta }}</div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ChatDotRound, Close, FullScreen, Minus } from '@element-plus/icons-vue';
import MarkdownRenderer from '../../../components/MarkdownRenderer.vue';
import { useAiChatAssistant } from '../composables/useAiChatAssistant';
import AiModelSelector from './AiModelSelector.vue';

type FloatingTarget = 'launcher' | 'panel';
type FloatingPoint = { x: number; y: number };

const {
  activeConfigurations, clear, form, loadingConfigurations, messages, meta, open, outputLimitHint,
  resultRef, send, sending, visible,
} = useAiChatAssistant();
const minimized = ref(false);
const launcherExpanded = ref(false);
const launcherRef = ref<HTMLElement>();
const panelRef = ref<HTMLElement>();
const launcherPosition = reactive<FloatingPoint>({ x: 0, y: 0 });
const panelPosition = reactive<FloatingPoint>({ x: 0, y: 0 });
const launcherStyle = computed(() => ({ top: `${launcherPosition.y}px` }));
const panelStyle = computed(() => ({ left: `${panelPosition.x}px`, top: `${panelPosition.y}px` }));
let dragState: { target: FloatingTarget; offsetX: number; offsetY: number; startY: number; moved: boolean } | null = null;
let suppressLauncherClick = false;

onMounted(() => {
  restorePositions();
  window.addEventListener('resize', clampPositions);
  document.addEventListener('pointerdown', closeOnOutsidePointer);
});

onBeforeUnmount(() => {
  stopDrag();
  window.removeEventListener('resize', clampPositions);
  document.removeEventListener('pointerdown', closeOnOutsidePointer);
});

watch(minimized, () => void nextTick(() => clampPosition('panel')));
watch(launcherExpanded, () => void nextTick(() => clampPosition('launcher')));

async function openAssistant() {
  minimized.value = false;
  await open();
  await nextTick();
  clampPosition('panel');
}

function closeAssistant() {
  visible.value = false;
  minimized.value = false;
}

function handleLauncherClick() {
  if (suppressLauncherClick) return;
  void openAssistant();
}

function closeOnOutsidePointer(event: PointerEvent) {
  if (!visible.value || dragState) return;
  const target = event.target as Node | null;
  if (target && panelRef.value?.contains(target)) return;
  closeAssistant();
}

function startDrag(event: PointerEvent, target: FloatingTarget) {
  if (target === 'panel' && (event.target as HTMLElement).closest('button')) return;
  const element = target === 'launcher' ? launcherRef.value : panelRef.value;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  dragState = { target, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, startY: event.clientY, moved: false };
  element.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', drag);
  window.addEventListener('pointerup', stopDrag, { once: true });
}

function drag(event: PointerEvent) {
  if (!dragState) return;
  if (Math.abs(event.clientY - dragState.startY) > 4) dragState.moved = true;
  const position = dragState.target === 'launcher' ? launcherPosition : panelPosition;
  if (dragState.target === 'panel') position.x = event.clientX - dragState.offsetX;
  position.y = event.clientY - dragState.offsetY;
  clampPosition(dragState.target);
}

function stopDrag() {
  if (dragState) {
    savePosition(dragState.target);
    if (dragState.target === 'launcher' && dragState.moved) {
      suppressLauncherClick = true;
      window.setTimeout(() => { suppressLauncherClick = false; }, 0);
    }
  }
  dragState = null;
  window.removeEventListener('pointermove', drag);
}

function restorePositions() {
  const launcher = storedPosition('smart-assessment-ai-launcher-position');
  const panel = storedPosition('smart-assessment-ai-panel-position');
  Object.assign(launcherPosition, { x: 0, y: launcher?.y ?? Math.max(72, window.innerHeight - 78) });
  const panelWidth = Math.min(760, window.innerWidth - 32);
  Object.assign(panelPosition, panel ?? { x: Math.max(16, (window.innerWidth - panelWidth) / 2), y: 76 });
  void nextTick(clampPositions);
}

function clampPositions() {
  clampPosition('launcher');
  clampPosition('panel');
}

function clampPosition(target: FloatingTarget) {
  const element = target === 'launcher' ? launcherRef.value : panelRef.value;
  const position = target === 'launcher' ? launcherPosition : panelPosition;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  if (target === 'panel') position.x = Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8));
  position.y = Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8));
}

function storedPosition(key: string): FloatingPoint | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null') as Partial<FloatingPoint> | null;
    return Number.isFinite(value?.x) && Number.isFinite(value?.y) ? { x: Number(value?.x), y: Number(value?.y) } : null;
  } catch {
    return null;
  }
}

function savePosition(target: FloatingTarget) {
  const key = target === 'launcher' ? 'smart-assessment-ai-launcher-position' : 'smart-assessment-ai-panel-position';
  const value = target === 'launcher' ? launcherPosition : panelPosition;
  localStorage.setItem(key, JSON.stringify({ x: Math.round(value.x), y: Math.round(value.y) }));
}
</script>

<style scoped>
.ai-chat-launcher { position: fixed; right: 0; z-index: 5000; display: flex; align-items: center; gap: 0; height: 44px; overflow: hidden; border-radius: 10px 0 0 10px; background: color-mix(in srgb, var(--el-color-primary) 86%, transparent); box-shadow: 0 8px 24px rgb(64 158 255 / 22%); opacity: .74; backdrop-filter: blur(8px); user-select: none; touch-action: none; transition: opacity .16s ease, box-shadow .16s ease; }
.ai-chat-launcher:hover { opacity: 1; box-shadow: 0 12px 32px rgb(64 158 255 / 30%); }
.ai-chat-launcher .el-button { height: 44px; margin: 0; border: 0; border-radius: 0; background: transparent; color: #fff; box-shadow: none; }
.ai-chat-launcher .el-button:hover { background: rgb(255 255 255 / 14%); color: #fff; }
.ai-chat-launcher.compact { gap: 0; }
.ai-chat-launcher.compact .el-button { width: 38px; padding: 0; }
.ai-chat-launcher { cursor: ns-resize; }
.ai-chat-launcher:active, .ai-chat-window-head:active { cursor: grabbing; }
.ai-chat-window { position: fixed; z-index: 5100; width: min(760px, calc(100vw - 32px)); height: min(680px, calc(100vh - 32px)); max-height: calc(100vh - 16px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgb(229 234 241 / 88%); border-radius: 14px; background: color-mix(in srgb, var(--el-bg-color) 96%, transparent); box-shadow: 0 18px 55px rgb(15 23 42 / 24%); backdrop-filter: blur(14px); }
.ai-chat-window.minimized { width: min(360px, calc(100vw - 16px)); height: 52px; }
.ai-chat-window-head { flex: none; height: 52px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--el-border-color-lighter); background: var(--el-bg-color); cursor: grab; user-select: none; touch-action: none; }
.ai-chat-window.minimized .ai-chat-window-head { border-bottom: 0; }
.ai-chat-window-title { min-width: 0; display: flex; align-items: center; gap: 9px; }
.ai-chat-window-title > .el-icon { color: var(--el-color-primary); font-size: 21px; }
.ai-chat-window-title > div { min-width: 0; display: flex; align-items: baseline; gap: 9px; }
.ai-chat-window-title span { color: var(--el-text-color-secondary); font-size: 12px; white-space: nowrap; }
.ai-chat-window-actions { display: flex; flex: none; }
.ai-chat-shell { flex: 1; min-height: 0; display: grid; grid-template-rows: auto auto auto minmax(180px, 1fr) auto; gap: 10px; padding: 12px 16px 16px; }
.ai-chat-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.ai-chat-head > span { color: var(--el-text-color-secondary); font-size: 13px; }
.ai-chat-messages { min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding: 14px; border-radius: 8px; background: var(--el-fill-color-light); }
.ai-chat-empty { height: 100%; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--el-text-color-secondary); text-align: center; }
.ai-chat-empty .el-icon { font-size: 38px; color: var(--el-color-primary); }
.ai-chat-message { width: fit-content; max-width: 88%; min-width: 0; margin-bottom: 12px; padding: 10px 12px; border-radius: 10px; background: var(--el-bg-color); overflow: hidden; }
.ai-chat-message.user { margin-left: auto; background: var(--el-color-primary-light-9); }
.ai-chat-message > strong { display: block; margin-bottom: 5px; font-size: 12px; color: var(--el-text-color-secondary); }
.ai-chat-message :deep(.markdown-body) { min-width: 0; }
.ai-chat-message :deep(.markdown-body > :first-child) { margin-top: 0; }
.ai-chat-message :deep(.markdown-body > :last-child) { margin-bottom: 0; }
.ai-chat-message :deep(.code-block), .ai-chat-message :deep(.math-block) { max-width: 100%; }
.ai-chat-loading { padding: 8px 0; }
.ai-chat-composer { display: grid; gap: 8px; }
.ai-chat-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.ai-chat-limit { flex: 1; min-width: 220px; }
.ai-chat-meta { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 700px) {
  .ai-chat-window { width: calc(100vw - 16px); height: calc(100vh - 16px); }
  .ai-chat-window-title span, .ai-chat-head > span { display: none; }
  .ai-chat-shell { padding: 10px; }
  .ai-chat-message { max-width: 94%; }
  .ai-chat-actions .ai-chat-limit { display: none; }
}
</style>
