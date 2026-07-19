import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getCurrentUser } from '../../../api';
import {
  createAiConfiguration,
  generateAiSummary,
  listAiConfigurations,
  listAiPresets,
  removeAiConfiguration,
  testAiConfiguration,
  updateAiConfiguration,
} from '../api';
import type { AiProviderConfig, AiProviderPreset, AiTokenQuotaDto, CreateAiProviderConfig } from '../models';

type AiConfigForm = CreateAiProviderConfig & { id: string };

const emptyForm = (scope: 'system' | 'personal'): AiConfigForm => ({
  id: '', name: '', provider: 'custom', baseUrl: '', model: '', apiKey: '',
  scope, enabled: true, isDefault: false, timeoutMs: 30_000, maxTokens: undefined, monthlyTokenBudget: undefined,
  inputCostPerMillion: 0, outputCostPerMillion: 0,
});

export function useAiSettingsPage() {
  const canCreateSystem = getCurrentUser()?.userType === 'SUPER_ADMIN';
  const defaultScope = canCreateSystem ? 'system' : 'personal';
  const loading = ref(false);
  const saving = ref(false);
  const testingId = ref('');
  const dialogVisible = ref(false);
  const configurations = ref<AiProviderConfig[]>([]);
  const presets = ref<AiProviderPreset[]>([]);
  const selectedPresetProvider = ref('');
  const form = reactive<AiConfigForm>(emptyForm(defaultScope));
  const summaryForm = reactive<{ configId: string; content: string; instruction: string; maxTokens?: number }>({
    configId: '', content: '', instruction: '', maxTokens: undefined,
  });
  const summaryResult = ref('');
  const summaryMeta = ref('');
  const summaryLoading = ref(false);
  const activeConfigurations = computed(() => configurations.value.filter((item) => item.enabled));
  const summaryOutputLimitHint = computed(() => {
    const selected = activeConfigurations.value.find((item) => item.id === summaryForm.configId)
      ?? activeConfigurations.value.find((item) => item.isDefault)
      ?? activeConfigurations.value[0];
    const requested = optionalOutputLimit(summaryForm.maxTokens).maxTokens;
    return outputLimitHint(selected?.maxTokens, requested);
  });

  async function load() {
    loading.value = true;
    try {
      [presets.value, configurations.value] = await Promise.all([listAiPresets(), listAiConfigurations()]);
      if (!summaryForm.configId) {
        summaryForm.configId = configurations.value.find((item) => item.isDefault && item.enabled)?.id
          || activeConfigurations.value[0]?.id || '';
      }
    } catch (error: unknown) {
      ElMessage.error(message(error, 'AI 配置加载失败'));
    } finally {
      loading.value = false;
    }
  }

  function applyPreset(provider: string) {
    const preset = presets.value.find((item) => item.provider === provider);
    if (!preset) return;
    Object.assign(form, {
      name: `${preset.name} 配置`, provider: preset.provider, baseUrl: preset.baseUrl, model: preset.model,
    });
  }

  function openCreate(preset?: AiProviderPreset) {
    Object.assign(form, emptyForm(defaultScope));
    selectedPresetProvider.value = preset?.provider || '';
    if (preset) applyPreset(preset.provider);
    dialogVisible.value = true;
  }

  function openEdit(value: unknown) {
    const row = configFrom(value);
    Object.assign(form, {
      id: row.id, name: row.name, provider: row.provider, baseUrl: row.baseUrl, model: row.model,
      scope: row.scope,
      apiKey: '', enabled: row.enabled, isDefault: row.isDefault, timeoutMs: row.timeoutMs,
      maxTokens: row.maxTokens ?? undefined,
      monthlyTokenBudget: row.monthlyTokenBudget ?? undefined,
      inputCostPerMillion: row.inputCostPerMillion,
      outputCostPerMillion: row.outputCostPerMillion,
    });
    selectedPresetProvider.value = presets.value.some((item) => item.provider === row.provider) ? row.provider : '';
    dialogVisible.value = true;
  }

  async function save() {
    if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim() || (!form.id && !form.apiKey.trim())) {
      ElMessage.warning('请填写名称、Base URL、模型和 API Key');
      return;
    }
    const configuredMaxTokens = optionalOutputLimit(form.maxTokens).maxTokens ?? null;
    if (form.maxTokens !== undefined && form.maxTokens !== null && configuredMaxTokens === null) {
      ElMessage.warning('模型配置输出上限必须是 1–8192 之间的整数');
      return;
    }
    saving.value = true;
    try {
      const body = {
        name: form.name.trim(), provider: form.provider.trim(), baseUrl: form.baseUrl.trim(), model: form.model.trim(),
        ...(!form.id ? { scope: form.scope } : {}),
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        enabled: form.enabled, isDefault: form.isDefault,
        timeoutMs: Number(form.timeoutMs), maxTokens: configuredMaxTokens,
        inputCostPerMillion: Number(form.inputCostPerMillion || 0),
        outputCostPerMillion: Number(form.outputCostPerMillion || 0),
        ...(form.monthlyTokenBudget ? { monthlyTokenBudget: Number(form.monthlyTokenBudget) } : {}),
        ...(form.id && !form.monthlyTokenBudget ? { monthlyTokenBudget: null } : {}),
      };
      if (form.id) await updateAiConfiguration(form.id, body);
      else await createAiConfiguration(body as CreateAiProviderConfig);
      form.apiKey = '';
      dialogVisible.value = false;
      ElMessage.success('AI 配置已保存');
      await load();
    } catch (error: unknown) {
      ElMessage.error(message(error, 'AI 配置保存失败'));
    } finally {
      saving.value = false;
    }
  }

  async function testConnection(value: unknown) {
    const row = configFrom(value);
    testingId.value = row.id;
    try {
      const result = await testAiConfiguration(row.id);
      ElMessage.success(`${result.message}（${result.durationMs}ms，${result.usage.totalTokens} tokens，${formatTokenQuota(result.tokenQuota)}）`);
      await load();
    } catch (error: unknown) {
      ElMessage.error(message(error, 'AI 连接测试失败'));
      await load();
    } finally {
      testingId.value = '';
    }
  }

  async function remove(value: unknown) {
    const row = configFrom(value);
    try {
      await ElMessageBox.confirm(`确认删除 AI 配置“${row.name}”？`, '删除 AI 配置', { type: 'warning' });
      await removeAiConfiguration(row.id);
      ElMessage.success('AI 配置已删除');
      if (summaryForm.configId === row.id) summaryForm.configId = '';
      await load();
    } catch (error: unknown) {
      if (error !== 'cancel') ElMessage.error(message(error, 'AI 配置删除失败'));
    }
  }

  async function summarize() {
    if (!summaryForm.content.trim()) {
      ElMessage.warning('请先填写待总结内容');
      return;
    }
    summaryLoading.value = true;
    summaryResult.value = '';
    try {
      const result = await generateAiSummary({
        configId: summaryForm.configId || undefined,
        content: summaryForm.content.trim(),
        instruction: summaryForm.instruction.trim() || undefined,
        ...optionalOutputLimit(summaryForm.maxTokens),
      });
      summaryResult.value = result.summary;
      const limit = result.outputLimitTokens === null ? '未显式限制' : `${result.outputLimitTokens} Token`;
      summaryMeta.value = `${result.provider} / ${result.model} · 供应商输出上限 ${limit} · ${result.durationMs}ms · 输入 ${result.usage.promptTokens} / 输出 ${result.usage.completionTokens} / 合计 ${result.usage.totalTokens} tokens · ${formatTokenQuota(result.tokenQuota)}`;
    } catch (error: unknown) {
      ElMessage.error(message(error, 'AI 总结生成失败'));
    } finally {
      summaryLoading.value = false;
    }
  }

  onMounted(load);
  return {
    activeConfigurations, applyPreset, canCreateSystem, configurations, dialogVisible, form, formatTokenQuota, load, loading,
    openCreate, openEdit, presets, remove, save, saving, selectedPresetProvider, summarize,
    summaryForm, summaryLoading, summaryMeta, summaryOutputLimitHint, summaryResult, testConnection, testingId,
  };
}

export function formatTokenQuota(quota: AiTokenQuotaDto) {
  const gap = quota.usageComplete ? '' : `，${quota.unreportedCalls} 次用量未报告`;
  const reserved = quota.reservedTokens ? `，保守预留 ${quota.reservedTokens}` : '';
  if (quota.remainingTokens === null) return `已用 ${quota.usedTokens}${reserved}，本地预算不限${gap}`;
  return `已用 ${quota.usedTokens}${reserved}，剩余 ${quota.remainingTokens}${gap}`;
}

function message(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function configFrom(value: unknown) {
  if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') {
    throw new Error('AI 配置格式无效');
  }
  return value as AiProviderConfig;
}

function optionalOutputLimit(value: unknown): { maxTokens?: number } {
  if (value === undefined || value === null || value === '') return {};
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 && normalized <= 8192 ? { maxTokens: normalized } : {};
}

function outputLimitHint(configured: number | null | undefined, requested: number | undefined) {
  if (requested !== undefined && configured !== null && configured !== undefined) {
    return `实际不超过 ${Math.min(requested, configured)} Token（配置上限 ${configured}）`;
  }
  if (requested !== undefined) return `本次向供应商设置 ${requested} Token 上限`;
  if (configured !== null && configured !== undefined) return `使用配置上限 ${configured} Token`;
  return '不向供应商发送输出上限；用量未报告时按 8192 Token 估算预留';
}
