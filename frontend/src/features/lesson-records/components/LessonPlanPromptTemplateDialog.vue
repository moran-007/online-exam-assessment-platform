<template>
  <el-dialog
    :model-value="modelValue"
    title="教案生成指令模板"
    width="min(1040px, 96vw)"
    top="4vh"
    class="lesson-plan-prompt-dialog"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-alert
      title="模板只控制课型、教学风格和内容详略。JSON 字段、课时合计及最低详细度由系统固定，避免自定义指令破坏教案结构。"
      type="info"
      :closable="false"
      show-icon
    />
    <div v-loading="loading" class="prompt-template-layout">
      <aside class="prompt-template-list">
        <div class="prompt-template-list__head">
          <div>
            <strong>可用模板</strong>
            <span>{{ templates.length }} 个</span>
          </div>
          <el-button type="primary" link @click="startCreate">新建个人模板</el-button>
        </div>
        <el-scrollbar height="480px">
          <button
            v-for="item in templates"
            :key="item.id"
            type="button"
            class="prompt-template-card"
            :class="{ active: item.id === activeId }"
            @click="choose(item)"
          >
            <span class="prompt-template-card__title">{{ item.name }}</span>
            <el-tag :type="item.source === 'SYSTEM' ? 'info' : 'success'" size="small" effect="plain">
              {{ item.source === 'SYSTEM' ? '系统' : '个人' }}
            </el-tag>
            <small>{{ compactPreview(item.templateContent) }}</small>
          </button>
        </el-scrollbar>
      </aside>

      <section class="prompt-template-editor">
        <template v-if="mode !== 'view'">
          <div class="prompt-template-editor__head">
            <div>
              <strong>{{ mode === 'create' ? '新建个人模板' : '编辑个人模板' }}</strong>
              <span>保存后可在教案生成栏直接切换</span>
            </div>
          </div>
          <el-form label-position="top">
            <el-form-item label="模板名称">
              <el-input v-model="form.name" maxlength="80" show-word-limit placeholder="例如：初中数学讲练结合详案" />
            </el-form-item>
            <el-form-item label="生成指令">
              <el-input
                v-model="form.templateContent"
                type="textarea"
                :rows="16"
                maxlength="6000"
                show-word-limit
                placeholder="说明适用课型、教学风格、希望重点展开的内容，以及教师活动和学生活动的写法。"
              />
            </el-form-item>
            <el-form-item label="输出长度">
              <div class="prompt-token-setting">
                <el-radio-group v-model="form.limitMode">
                  <el-radio value="AUTO">自动（不额外限制）</el-radio>
                  <el-radio value="CUSTOM">手动设置</el-radio>
                </el-radio-group>
                <el-input-number
                  v-if="form.limitMode === 'CUSTOM'"
                  v-model="form.maxTokens"
                  :min="512"
                  :max="8192"
                  :step="256"
                  :precision="0"
                  controls-position="right"
                />
                <small>
                  {{ form.limitMode === 'AUTO'
                    ? '不在教案模板中设置输出上限，仍受模型自身及 AI 配置约束。'
                    : '若高于所选模型配置，生成前会再次确认。' }}
                </small>
              </div>
            </el-form-item>
          </el-form>
          <div class="prompt-template-editor__actions">
            <el-button @click="cancelEdit">取消</el-button>
            <el-button type="primary" :loading="saving" @click="saveTemplate">保存并使用</el-button>
          </div>
        </template>

        <template v-else-if="activeTemplate">
          <div class="prompt-template-editor__head">
            <div>
              <strong>{{ activeTemplate.name }}</strong>
              <span>{{ activeTemplate.canManage ? '仅当前教师可见和修改' : '只读模板，可复制后修改' }}</span>
            </div>
            <el-tag :type="activeTemplate.source === 'SYSTEM' ? 'info' : 'success'" effect="plain">
              {{ activeTemplate.source === 'SYSTEM' ? '系统模板' : '个人模板' }}
            </el-tag>
          </div>
          <p class="prompt-template-limit">
            输出长度：
            <strong>{{ activeTemplate.maxTokens ? `${activeTemplate.maxTokens} Token` : '自动（不额外限制）' }}</strong>
          </p>
          <div class="prompt-template-content">{{ activeTemplate.templateContent }}</div>
          <div class="prompt-template-editor__actions">
            <el-button
              v-if="!activeTemplate.canManage"
              @click="startCopy(activeTemplate)"
            >
              复制为个人模板
            </el-button>
            <template v-else>
              <el-button @click="startEdit(activeTemplate)">编辑</el-button>
              <el-button type="danger" plain :loading="removing" @click="removeTemplate(activeTemplate)">删除</el-button>
            </template>
            <el-button type="primary" @click="useTemplate(activeTemplate)">使用此模板</el-button>
          </div>
        </template>

        <el-empty v-else description="请选择模板或新建个人模板" />
      </section>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  createLessonPlanPromptTemplate,
  removeLessonPlanPromptTemplate,
  updateLessonPlanPromptTemplate,
  type LessonPlanPromptTemplate,
} from '../api';

const props = withDefaults(defineProps<{
  modelValue: boolean;
  templates: LessonPlanPromptTemplate[];
  selectedId: string;
  loading?: boolean;
}>(), {
  loading: false,
});
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  select: [id: string];
  saved: [template: LessonPlanPromptTemplate];
  removed: [id: string];
}>();

const activeId = ref('');
const mode = ref<'view' | 'create' | 'edit'>('view');
const editingId = ref('');
const saving = ref(false);
const removing = ref(false);
const form = reactive({
  name: '',
  templateContent: '',
  limitMode: 'AUTO' as 'AUTO' | 'CUSTOM',
  maxTokens: 6000,
});
const activeTemplate = computed(() => props.templates.find((item) => item.id === activeId.value));

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return;
    activeId.value = props.selectedId || props.templates[0]?.id || '';
    mode.value = 'view';
  },
);
watch(
  () => props.selectedId,
  (id) => {
    if (mode.value === 'view' && id) activeId.value = id;
  },
);

function choose(template: LessonPlanPromptTemplate) {
  activeId.value = template.id;
  mode.value = 'view';
}

function startCreate() {
  editingId.value = '';
  Object.assign(form, { name: '', templateContent: '', limitMode: 'AUTO', maxTokens: 6000 });
  mode.value = 'create';
}

function startCopy(template: LessonPlanPromptTemplate) {
  editingId.value = '';
  Object.assign(form, {
    name: `${template.name}（个人）`.slice(0, 80),
    templateContent: template.templateContent,
    limitMode: template.maxTokens ? 'CUSTOM' : 'AUTO',
    maxTokens: template.maxTokens || 6000,
  });
  mode.value = 'create';
}

function startEdit(template: LessonPlanPromptTemplate) {
  editingId.value = template.id;
  Object.assign(form, {
    name: template.name,
    templateContent: template.templateContent,
    limitMode: template.maxTokens ? 'CUSTOM' : 'AUTO',
    maxTokens: template.maxTokens || 6000,
  });
  mode.value = 'edit';
}

function cancelEdit() {
  mode.value = 'view';
  activeId.value ||= props.selectedId || props.templates[0]?.id || '';
}

async function saveTemplate() {
  const name = form.name.trim();
  const templateContent = form.templateContent.trim();
  if (!name || !templateContent) return ElMessage.warning('请填写模板名称和生成指令');
  if (templateContent.length < 30) return ElMessage.warning('生成指令过于简略，请至少说明课型、教学风格或内容要求');
  const maxTokens = form.limitMode === 'CUSTOM' ? Math.floor(Number(form.maxTokens)) : null;
  if (maxTokens !== null && (maxTokens < 512 || maxTokens > 8192)) {
    return ElMessage.warning('手动输出长度必须在 512—8192 Token 之间');
  }
  saving.value = true;
  try {
    const result = editingId.value
      ? await updateLessonPlanPromptTemplate(editingId.value, { name, templateContent, maxTokens })
      : await createLessonPlanPromptTemplate({ name, templateContent, maxTokens });
    emit('saved', result);
    emit('select', result.id);
    activeId.value = result.id;
    mode.value = 'view';
    ElMessage.success('个人生成模板已保存并选用');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '生成模板保存失败');
  } finally {
    saving.value = false;
  }
}

async function removeTemplate(template: LessonPlanPromptTemplate) {
  const confirmed = await ElMessageBox.confirm(
    `确认删除个人模板“${template.name}”？`,
    '删除生成模板',
    { type: 'warning' },
  ).then(() => true).catch(() => false);
  if (!confirmed) return;
  removing.value = true;
  try {
    await removeLessonPlanPromptTemplate(template.id);
    emit('removed', template.id);
    activeId.value = props.templates.find((item) => item.id !== template.id)?.id || '';
    mode.value = 'view';
    ElMessage.success('个人生成模板已删除');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '生成模板删除失败');
  } finally {
    removing.value = false;
  }
}

function useTemplate(template: LessonPlanPromptTemplate) {
  emit('select', template.id);
  emit('update:modelValue', false);
  ElMessage.success(`已选用“${template.name}”`);
}

function compactPreview(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 54 ? `${normalized.slice(0, 54)}…` : normalized;
}
</script>

<style scoped>
:global(.lesson-plan-prompt-dialog) { max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; }
:global(.lesson-plan-prompt-dialog .el-dialog__body) { min-height: 0; overflow: hidden; padding-top: 12px; }
.prompt-template-layout {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  min-height: 510px;
  margin-top: 12px;
  overflow: hidden;
  border: 1px solid #dfe7f2;
  border-radius: 12px;
  background: #f8fafc;
}
.prompt-template-list { min-width: 0; padding: 14px 10px; border-right: 1px solid #dfe7f2; background: #fff; }
.prompt-template-list__head,
.prompt-template-list__head > div,
.prompt-template-editor__head,
.prompt-template-editor__actions {
  display: flex;
  align-items: center;
}
.prompt-template-list__head { justify-content: space-between; padding: 0 6px 10px; }
.prompt-template-list__head > div { gap: 8px; }
.prompt-template-list__head span,
.prompt-template-editor__head span { color: #718096; font-size: 12px; }
.prompt-template-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px 8px;
  width: calc(100% - 8px);
  margin: 4px;
  padding: 11px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.prompt-template-card:hover { background: #f5f8fc; }
.prompt-template-card.active { border-color: #9dc5ff; background: #edf5ff; box-shadow: 0 3px 12px rgb(37 99 235 / 7%); }
.prompt-template-card__title { overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.prompt-template-card small {
  display: -webkit-box;
  grid-column: 1 / -1;
  overflow: hidden;
  color: #718096;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.prompt-template-editor { min-width: 0; padding: 18px; background: #fbfcfe; }
.prompt-template-editor__head { justify-content: space-between; gap: 12px; min-height: 34px; margin-bottom: 12px; }
.prompt-template-editor__head > div { display: grid; gap: 3px; }
.prompt-template-content {
  height: 390px;
  overflow-y: auto;
  padding: 14px 16px;
  border: 1px solid #d8e0eb;
  border-radius: 9px;
  background: #fff;
  color: #334155;
  line-height: 1.72;
  white-space: pre-wrap;
}
.prompt-template-limit { margin: 0 0 8px; color: #64748b; font-size: 12px; }
.prompt-token-setting { display: grid; gap: 8px; width: 100%; }
.prompt-token-setting small { color: #718096; line-height: 1.45; }
.prompt-template-editor__actions { justify-content: flex-end; gap: 8px; margin-top: 14px; }
@media (max-width: 760px) {
  :global(.lesson-plan-prompt-dialog .el-dialog__body) { overflow-y: auto; }
  .prompt-template-layout { grid-template-columns: 1fr; overflow: visible; }
  .prompt-template-list { border-right: 0; border-bottom: 1px solid #dfe7f2; }
  .prompt-template-content { height: 300px; }
}
</style>
