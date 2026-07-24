import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getCurrentUser } from '../../../api';
import {
  createAiConfiguration,
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
  const userType = getCurrentUser()?.userType;
  const userPermissions = new Set(getCurrentUser()?.permissions ?? []);
  const canCreateSystem = userType === 'SUPER_ADMIN';
  const canManageSummaryPresets = ['SUPER_ADMIN', 'ADMIN'].includes(userType ?? '');
  const canReadQuality = userType === 'SUPER_ADMIN' || userPermissions.has('ai.quality.read');
  const defaultScope = canCreateSystem ? 'system' : 'personal';
  const loading = ref(false);
  const saving = ref(false);
  const testingId = ref('');
  const dialogVisible = ref(false);
  const configurations = ref<AiProviderConfig[]>([]);
  const presets = ref<AiProviderPreset[]>([]);
  const selectedPresetProvider = ref('');
  const form = reactive<AiConfigForm>(emptyForm(defaultScope));
  const modelOptions = computed(() => [...new Set([
    ...configurations.value.filter((item) => item.provider === form.provider).map((item) => item.model),
    ...presets.value.filter((item) => item.provider === form.provider).flatMap((item) => item.models),
  ].filter(Boolean))]);
  async function load() {
    loading.value = true;
    try {
      [presets.value, configurations.value] = await Promise.all([listAiPresets(), listAiConfigurations()]);
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
      await load();
    } catch (error: unknown) {
      if (error !== 'cancel') ElMessage.error(message(error, 'AI 配置删除失败'));
    }
  }

  onMounted(load);
  return {
    applyPreset, canCreateSystem, canManageSummaryPresets, canReadQuality, configurations, dialogVisible, form, formatTokenQuota, load, loading,
    modelOptions,
    openCreate, openEdit, presets, remove, save, saving, selectedPresetProvider, testConnection, testingId,
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
