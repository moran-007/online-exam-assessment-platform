import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { activateAiSummaryPreset, listAiSummaryPresets, reviseAiSummaryPreset } from '../api';
import type { AiSummaryPreset } from '../models';

const TYPE_LABELS: Record<string, string> = {
  EXAM: '考试总结',
  STUDENT: '学生阶段总结',
  CLASS: '班级总结',
  PARENT_REPORT: '家长报告',
  LESSON: '课堂助手',
};

export function useAiSummaryPresets() {
  const loading = ref(false);
  const saving = ref(false);
  const activatingId = ref('');
  const dialogVisible = ref(false);
  const presets = ref<AiSummaryPreset[]>([]);
  const editing = ref<AiSummaryPreset | null>(null);
  const form = reactive({ systemPrompt: '', changeReason: '', activate: true });
  const activeCount = computed(() => presets.value.filter((item) => item.enabled).length);

  async function load() {
    loading.value = true;
    try {
      presets.value = await listAiSummaryPresets();
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, '总结预设加载失败'));
    } finally {
      loading.value = false;
    }
  }

  function openEdit(value: unknown) {
    const row = presetFrom(value);
    editing.value = row;
    Object.assign(form, { systemPrompt: row.systemPrompt, changeReason: '', activate: true });
    dialogVisible.value = true;
  }

  async function save() {
    if (!editing.value || !form.systemPrompt.trim() || !form.changeReason.trim()) {
      ElMessage.warning('请填写系统提示词和变更原因');
      return;
    }
    saving.value = true;
    try {
      const created = await reviseAiSummaryPreset(editing.value.id, {
        systemPrompt: form.systemPrompt.trim(),
        changeReason: form.changeReason.trim(),
        activate: form.activate,
      });
      dialogVisible.value = false;
      ElMessage.success(`已创建 ${created.code} v${created.version}${created.enabled ? ' 并启用' : ' 草稿'}`);
      await load();
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, '总结预设保存失败'));
    } finally {
      saving.value = false;
    }
  }

  async function activate(value: unknown) {
    const row = presetFrom(value);
    if (row.enabled) return;
    const confirmed = await ElMessageBox.confirm(
      `启用 ${typeLabel(row.summaryType)} v${row.version} 后，新生成任务将使用该版本。历史任务不受影响。`,
      '切换总结预设',
      { type: 'warning' },
    ).then(() => true).catch(() => false);
    if (!confirmed) return;
    activatingId.value = row.id;
    try {
      await activateAiSummaryPreset(row.id);
      ElMessage.success('总结预设已切换');
      await load();
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, '总结预设启用失败'));
    } finally {
      activatingId.value = '';
    }
  }

  onMounted(load);
  return {
    activate, activatingId, activeCount, dialogVisible, editing, form, load, loading,
    openEdit, presets, save, saving, typeLabel,
  };
}

function typeLabel(type: string) {
  return TYPE_LABELS[type] ?? type;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function presetFrom(value: unknown) {
  if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') {
    throw new Error('AI 总结预设格式无效');
  }
  return value as AiSummaryPreset;
}
