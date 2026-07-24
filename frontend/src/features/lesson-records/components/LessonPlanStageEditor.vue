<template>
  <section class="stage-editor">
    <div class="stage-editor__head">
      <div>
        <h3>环节编排</h3>
        <p class="muted">环节名称与分钟数独立保存；拖动左侧手柄可调整顺序。</p>
      </div>
      <div class="stage-editor__metrics" aria-live="polite">
        <span>总课时<strong>{{ totalMinutes }}</strong>分钟</span>
        <span>已分配<strong>{{ allocatedMinutes }}</strong>分钟</span>
        <span :class="{ danger: remainingMinutes < 0, warning: remainingMinutes > 0, success: remainingMinutes === 0 }">
          {{ remainingMinutes >= 0 ? '未分配' : '超出' }}<strong>{{ Math.abs(remainingMinutes) }}</strong>分钟
        </span>
      </div>
      <div class="stage-editor__tools">
        <el-button @click="toggleAll">{{ allExpanded ? '全部收起' : '全部展开' }}</el-button>
        <el-button type="primary" plain :disabled="allocatingTime" @click="addStage">新增环节</el-button>
      </div>
    </div>

    <el-alert
      v-if="remainingMinutes !== 0"
      :title="remainingMinutes > 0
        ? `还有 ${remainingMinutes} 分钟未分配，请调整环节时间。`
        : `环节时间已超出总课时 ${Math.abs(remainingMinutes)} 分钟，请调整。`"
      :type="remainingMinutes > 0 ? 'warning' : 'error'"
      :closable="false"
      show-icon
    />
    <el-alert
      v-else
      title="环节时间与总课时一致"
      type="success"
      :closable="false"
      show-icon
    />

    <div class="stage-time-bar" role="group" aria-label="教学环节时间分配">
      <span class="stage-time-bar__label">时间分配</span>
      <span class="stage-time-bar__manual">
        <el-tag size="small" effect="plain">自由分配</el-tag>
        直接修改每个环节的分钟数
      </span>
      <span class="stage-time-bar__spacer" />
      <el-button :disabled="allocatingTime || !modelValue.length" @click="$emit('allocate-time', 'PROPORTIONAL')">
        按当前比例适配
      </el-button>
      <el-button
        type="primary"
        plain
        :loading="allocatingTime"
        :disabled="!modelValue.length"
        @click="$emit('allocate-time', 'AI')"
      >
        AI 自动分配
      </el-button>
    </div>

    <div class="stage-preset-bar">
      <span class="stage-preset-bar__label">流程预设</span>
      <el-select
        :model-value="selectedPresetId"
        clearable
        filterable
        placeholder="选择预设编排"
        class="stage-preset-select"
        :disabled="allocatingTime"
        @update:model-value="$emit('select-preset', String($event || ''))"
      >
        <el-option
          v-for="preset in processPresets"
          :key="preset.id"
          :label="`${preset.source === 'SYSTEM' ? '系统' : '个人'} · ${preset.name}`"
          :value="preset.id"
        />
      </el-select>
      <el-button :disabled="allocatingTime || !selectedPresetId" @click="$emit('apply-preset', selectedPresetId || '')">应用</el-button>
      <el-button :disabled="allocatingTime" @click="$emit('save-preset')">保存当前编排</el-button>
      <el-button
        v-if="selectedPreset?.canManage"
        type="danger"
        link
        :disabled="allocatingTime"
        @click="$emit('remove-preset', selectedPreset.id)"
      >
        删除预设
      </el-button>
      <span class="stage-preset-bar__spacer" />
      <el-switch
        :model-value="preserveStructure"
        active-text="AI 保持当前环节名称、顺序和时间"
        :disabled="allocatingTime"
        @update:model-value="$emit('update:preserve-structure', Boolean($event))"
      />
    </div>

    <div v-if="modelValue.length" class="stage-list">
      <article
        v-for="(stage, index) in modelValue"
        :key="stage.id"
        class="stage-card"
        :class="{ 'is-dragging': draggingIndex === index }"
        @dragover.prevent
        @drop="dropStage(index)"
      >
        <header class="stage-card__head">
          <button
            class="stage-drag-handle"
            type="button"
            :draggable="!allocatingTime"
            :disabled="allocatingTime"
            aria-label="拖拽排序"
            title="拖拽排序"
            @dragstart="startDrag(index)"
            @dragend="draggingIndex = -1"
          >
            ⋮⋮
          </button>
          <strong class="stage-index">{{ chineseOrdinal(index) }}、</strong>
          <el-input v-model="stage.title" class="stage-title-input" placeholder="环节名称" :disabled="allocatingTime" />
          <span class="stage-duration-wrap">
            <el-input-number
              v-model="stage.duration"
              :min="1"
              :max="totalMinutes"
              :precision="0"
              controls-position="right"
              :disabled="allocatingTime"
              :aria-label="`${stage.title || `第 ${index + 1} 个环节`}预计时间`"
              @change="markManualAllocation"
            />
            <span>分钟</span>
            <small class="stage-duration-ratio">{{ stageRatio(stage.duration) }}</small>
          </span>
          <div class="stage-card__actions">
            <el-button
              link
              type="primary"
              :loading="regeneratingId === stage.id"
              title="填写修改意见后重新生成"
              @click="$emit('regenerate', stage)"
            >
              AI 修改
            </el-button>
            <el-button link :disabled="allocatingTime" @click="copyStage(index)">复制</el-button>
            <el-button link @click="toggleStage(stage.id)">{{ isExpanded(stage.id) ? '收起' : '展开' }}</el-button>
            <el-button link type="danger" :disabled="allocatingTime" @click="removeStage(index)">删除</el-button>
          </div>
        </header>

        <div v-show="isExpanded(stage.id)" class="stage-card__body">
          <el-form-item label="教师活动">
            <el-input v-model="stage.teacherActivity" type="textarea" :rows="3" placeholder="教师讲解、提问、示范、巡视与反馈" />
          </el-form-item>
          <el-form-item label="学生活动">
            <el-input v-model="stage.studentActivity" type="textarea" :rows="3" placeholder="观察、思考、讨论、练习、展示等" />
          </el-form-item>
          <div class="stage-advanced-toggle wide">
            <span class="muted">可选：核心问题、评价方式、设计意图、教学资源</span>
            <el-button link type="primary" @click="toggleAdvanced(stage.id)">{{ isAdvancedExpanded(stage.id) ? '收起更多' : '更多设置' }}</el-button>
          </div>
          <div v-show="isAdvancedExpanded(stage.id)" class="stage-advanced-fields wide">
            <el-form-item label="核心问题" class="wide">
              <el-input v-model="stage.coreQuestion" type="textarea" :rows="2" placeholder="需要明确核心问题时填写，可使用公式或 Markdown" />
            </el-form-item>
            <el-form-item label="评价方式">
              <el-input v-model="stage.assessment" type="textarea" :rows="2" placeholder="提问、观察量表、作品评价、出口检测等" />
            </el-form-item>
            <el-form-item label="设计意图">
              <el-input v-model="stage.designIntent" type="textarea" :rows="2" placeholder="需要说明环节目的时填写" />
            </el-form-item>
            <el-form-item label="教学资源（可选）" class="wide">
              <el-input v-model="stage.resources" type="textarea" :rows="2" placeholder="课件、实验器材、学习单、代码文件等" />
            </el-form-item>
          </div>
        </div>
      </article>
    </div>
    <el-empty v-else description="尚未设置教学环节">
      <el-button type="primary" @click="addStage">新增第一个环节</el-button>
    </el-empty>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import {
  createTeachingProcessStage,
  teachingProcessDuration,
  type TeachingProcessStage,
} from '../composables/useLessonPlanCatalog';
import type { LessonPlanProcessPreset } from '../api';

const props = defineProps<{
  modelValue: TeachingProcessStage[];
  totalMinutes: number;
  regeneratingId?: string;
  processPresets?: LessonPlanProcessPreset[];
  selectedPresetId?: string;
  preserveStructure?: boolean;
  allocatingTime?: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: TeachingProcessStage[]];
  regenerate: [stage: TeachingProcessStage];
  'select-preset': [id: string];
  'apply-preset': [id: string];
  'save-preset': [];
  'remove-preset': [id: string];
  'update:preserve-structure': [value: boolean];
  'allocate-time': [strategy: 'PROPORTIONAL' | 'AI'];
}>();
const expanded = reactive<Record<string, boolean>>({});
const advancedExpanded = reactive<Record<string, boolean>>({});
const draggingIndex = ref(-1);
const allocatedMinutes = computed(() => teachingProcessDuration(props.modelValue));
const remainingMinutes = computed(() => props.totalMinutes - allocatedMinutes.value);
const allExpanded = computed(() => props.modelValue.every((stage) => isExpanded(stage.id)));
const selectedPreset = computed(() => props.processPresets?.find((item) => item.id === props.selectedPresetId));

function addStage() {
  const stage = createTeachingProcessStage();
  expanded[stage.id] = true;
  emit('update:modelValue', [...props.modelValue, stage]);
}

function copyStage(index: number) {
  const source = props.modelValue[index];
  const copy = createTeachingProcessStage({ ...source, title: `${source.title}（副本）` });
  const next = [...props.modelValue];
  next.splice(index + 1, 0, copy);
  expanded[copy.id] = true;
  emit('update:modelValue', next);
}

function removeStage(index: number) {
  emit('update:modelValue', props.modelValue.filter((_, current) => current !== index));
}

function startDrag(index: number) {
  draggingIndex.value = index;
}

function dropStage(targetIndex: number) {
  if (draggingIndex.value < 0 || draggingIndex.value === targetIndex) return;
  const next = [...props.modelValue];
  const [stage] = next.splice(draggingIndex.value, 1);
  next.splice(targetIndex, 0, stage);
  draggingIndex.value = -1;
  emit('update:modelValue', next);
}

function isExpanded(id: string) {
  return expanded[id] === true;
}

function toggleStage(id: string) {
  expanded[id] = !isExpanded(id);
}

function toggleAll() {
  const next = !allExpanded.value;
  props.modelValue.forEach((stage) => { expanded[stage.id] = next; });
}

function isAdvancedExpanded(id: string) {
  return advancedExpanded[id] === true;
}

function toggleAdvanced(id: string) {
  advancedExpanded[id] = !isAdvancedExpanded(id);
}

function markManualAllocation() {
  emit('select-preset', '');
  emit('update:preserve-structure', true);
}

function stageRatio(duration: number) {
  if (!props.totalMinutes) return '—';
  const percentage = (duration / props.totalMinutes) * 100;
  return `${percentage >= 10 ? percentage.toFixed(0) : percentage.toFixed(1)}%`;
}

function chineseOrdinal(index: number) {
  return ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][index] || String(index + 1);
}
</script>

<style scoped>
.stage-editor { display: grid; gap: 14px; }
.stage-editor__head { display: grid; grid-template-columns: minmax(220px, 1fr) auto auto; align-items: center; gap: 16px; }
.stage-editor__head h3, .stage-editor__head p { margin: 0; }
.stage-editor__head h3 { color: #24364d; font-size: 16px; }
.stage-editor__head p { margin-top: 4px; }
.stage-editor__metrics { display: flex; align-items: stretch; gap: 8px; }
.stage-editor__metrics > span {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 7px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: #fff;
  white-space: nowrap;
  font-size: 12px;
}
.stage-editor__metrics strong { font-size: 18px; color: #1f2937; }
.stage-editor__metrics .warning { border-color: #e6a23c; background: #fdf6ec; }
.stage-editor__metrics .danger { border-color: #f56c6c; background: #fef0f0; }
.stage-editor__metrics .success { border-color: #67c23a; background: #f0f9eb; }
.stage-editor__tools { display: flex; gap: 8px; }
.stage-list { display: grid; gap: 12px; }
.stage-time-bar,
.stage-preset-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  border: 1px solid #dbe5f1;
  border-radius: 9px;
  background: #f8fafc;
}
.stage-time-bar {
  border-color: #cfe0f5;
  background: linear-gradient(90deg, #f2f7ff 0%, #f8fbff 100%);
}
.stage-time-bar__label { color: #244873; font-size: 13px; font-weight: 700; white-space: nowrap; }
.stage-time-bar__manual { display: flex; align-items: center; gap: 7px; color: #64748b; font-size: 12px; }
.stage-time-bar__spacer { flex: 1; }
.stage-preset-bar__label { color: #405168; font-size: 13px; font-weight: 600; white-space: nowrap; }
.stage-preset-select { width: 250px; }
.stage-preset-bar__spacer { flex: 1; }
.stage-card {
  overflow: hidden;
  border: 1px solid #dce5f0;
  border-radius: 11px;
  background: #fff;
  box-shadow: 0 3px 12px rgb(15 23 42 / 4%);
  transition: border-color .2s, box-shadow .2s, transform .2s;
}
.stage-card:hover { border-color: #b7cff0; box-shadow: 0 7px 20px rgb(37 99 235 / 8%); }
.stage-card.is-dragging { opacity: .55; border-style: dashed; }
.stage-card__head {
  display: grid;
  grid-template-columns: 34px auto minmax(180px, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 58px;
  padding: 10px 14px;
  background: linear-gradient(90deg, #f8fbff 0%, #fff 100%);
}
.stage-drag-handle {
  width: 28px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  cursor: grab;
  font-size: 18px;
}
.stage-drag-handle:hover { border-color: #cbd9ea; background: #eef5ff; color: #337ecc; }
.stage-drag-handle:active { cursor: grabbing; }
.stage-index { white-space: nowrap; }
.stage-duration-wrap { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.stage-duration-wrap :deep(.el-input-number) { width: 116px; }
.stage-duration-ratio {
  min-width: 38px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}
.stage-card__actions { display: flex; align-items: center; white-space: nowrap; }
.stage-card__body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 18px;
  padding: 16px 18px 3px;
  border-top: 1px solid #edf1f6;
  background: #fff;
}
.stage-card__body :deep(.el-form-item__label) { color: #405168; font-weight: 600; }
.stage-card__body .wide { grid-column: 1 / -1; }
.stage-advanced-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;
  margin: -2px 0 10px;
  padding: 4px 10px;
  border: 1px dashed #d7e1ee;
  border-radius: 8px;
  background: #f8fafc;
}
.stage-advanced-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 18px;
}
.stage-advanced-fields .wide { grid-column: 1 / -1; }
@media (max-width: 980px) {
  .stage-editor__head { grid-template-columns: 1fr; }
  .stage-editor__metrics { flex-wrap: wrap; }
  .stage-card__head { grid-template-columns: 30px auto minmax(150px, 1fr) auto; }
  .stage-card__actions { grid-column: 3 / -1; justify-content: flex-end; }
  .stage-time-bar, .stage-preset-bar { align-items: flex-start; flex-wrap: wrap; }
  .stage-time-bar__spacer,
  .stage-preset-bar__spacer { display: none; }
}
@media (max-width: 720px) {
  .stage-preset-select { width: 100%; }
  .stage-card__body { grid-template-columns: 1fr; }
  .stage-card__body .wide { grid-column: auto; }
  .stage-advanced-fields { grid-template-columns: 1fr; }
  .stage-advanced-fields .wide { grid-column: auto; }
  .stage-card__head { grid-template-columns: 28px auto minmax(0, 1fr); }
  .stage-duration-wrap, .stage-card__actions { grid-column: 3; justify-content: flex-start; flex-wrap: wrap; }
}
</style>
