import { computed, nextTick, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { generateAiSummary, listAiConfigurations } from '../api';
import type { AiProviderConfig, AiTokenQuotaDto } from '../models';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

export function useAiChatAssistant() {
  const visible = ref(false);
  const loadingConfigurations = ref(false);
  const sending = ref(false);
  const configurations = ref<AiProviderConfig[]>([]);
  const messages = ref<ChatMessage[]>([]);
  const resultRef = ref<HTMLElement>();
  const meta = ref('');
  const form = reactive<{ configId: string; content: string; instruction: string; maxTokens?: number }>({
    configId: '', content: '', instruction: '', maxTokens: undefined,
  });
  const activeConfigurations = computed(() => configurations.value.filter((item) => item.enabled));
  const outputLimitHint = computed(() => {
    const selected = activeConfigurations.value.find((item) => item.id === form.configId)
      ?? preferredConfiguration(activeConfigurations.value);
    return describeOutputLimit(selected?.maxTokens, optionalOutputLimit(form.maxTokens).maxTokens);
  });

  async function open() {
    visible.value = true;
    if (configurations.value.length) {
      await scrollToBottom();
      return;
    }
    loadingConfigurations.value = true;
    try {
      configurations.value = await listAiConfigurations();
      form.configId = preferredConfiguration(activeConfigurations.value)?.id ?? '';
      if (!activeConfigurations.value.length) ElMessage.warning('尚未配置可用的 AI 模型');
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, 'AI 模型配置加载失败'));
    } finally {
      loadingConfigurations.value = false;
    }
  }

  async function send() {
    const question = form.content.trim();
    if (!question) {
      ElMessage.warning('请先输入问题');
      return;
    }
    if (!activeConfigurations.value.length) {
      ElMessage.warning('尚未配置可用的 AI 模型');
      return;
    }
    sending.value = true;
    const history = messages.value.slice(-20).map((item) => ({ ...item }));
    messages.value.push({ role: 'user', content: question });
    form.content = '';
    await scrollToBottom();
    try {
      const result = await generateAiSummary({
        configId: form.configId || undefined,
        content: question,
        instruction: form.instruction.trim() || undefined,
        history,
        ...optionalOutputLimit(form.maxTokens),
      });
      messages.value.push({ role: 'assistant', content: result.summary });
      const limit = result.outputLimitTokens === null ? '未显式限制' : `${result.outputLimitTokens} Token`;
      const sourcePreview = result.contextSources?.slice(0, 2)
        .map((item) => `${({ paper: '试卷', question: '题目', class: '班级', student: '学生', teacher: '教师', schedule: '排课', exam: '考试' } as Record<string, string>)[item.type] || '数据'}《${item.name}》`).join('、');
      const sourceRemainder = Math.max((result.contextSources?.length || 0) - 2, 0);
      const sources = sourcePreview ? ` · 已读取 ${sourcePreview}${sourceRemainder ? ` 等 ${result.contextSources.length} 项` : ''}` : '';
      const answerPolicy = result.directAnswerAllowed ? '允许直接答案' : '仅提供思路';
      const knowledgePolicy = result.generalKnowledgeAllowed ? '通用知识' : '仅平台内容';
      meta.value = `${result.provider} / ${result.model} · ${answerPolicy} · ${knowledgePolicy}${sources} · 输出上限 ${limit} · ${result.durationMs}ms · 输入 ${result.usage.promptTokens} / 输出 ${result.usage.completionTokens} / 合计 ${result.usage.totalTokens} tokens · ${formatTokenQuota(result.tokenQuota)}`;
      await scrollToBottom();
    } catch (error: unknown) {
      messages.value.pop();
      form.content = question;
      ElMessage.error(errorMessage(error, 'AI 问答失败'));
    } finally {
      sending.value = false;
    }
  }

  function clear() {
    messages.value = [];
    meta.value = '';
  }

  async function scrollToBottom() {
    await nextTick();
    const element = resultRef.value;
    if (element) element.scrollTop = element.scrollHeight;
  }

  return {
    activeConfigurations, clear, form, loadingConfigurations, messages, meta, open, outputLimitHint,
    resultRef, send, sending, visible,
  };
}

function preferredConfiguration(configurations: AiProviderConfig[]) {
  return configurations.find((item) => item.scope === 'personal' && item.isDefault)
    ?? configurations.find((item) => item.isDefault)
    ?? configurations.find((item) => item.scope === 'personal')
    ?? configurations[0];
}

function optionalOutputLimit(value: unknown): { maxTokens?: number } {
  if (value === undefined || value === null || value === '') return {};
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 && normalized <= 8192 ? { maxTokens: normalized } : {};
}

function describeOutputLimit(configured: number | null | undefined, requested: number | undefined) {
  if (requested !== undefined && configured !== null && configured !== undefined) {
    return `实际不超过 ${Math.min(requested, configured)} Token（配置上限 ${configured}）`;
  }
  if (requested !== undefined) return `本次向供应商设置 ${requested} Token 上限`;
  if (configured !== null && configured !== undefined) return `使用配置上限 ${configured} Token`;
  return '不向供应商发送输出上限；用量未报告时按 8192 Token 估算预留';
}

function formatTokenQuota(quota: AiTokenQuotaDto) {
  const gap = quota.usageComplete ? '' : `，${quota.unreportedCalls} 次用量未报告`;
  const reserved = quota.reservedTokens ? `，保守预留 ${quota.reservedTokens}` : '';
  if (quota.remainingTokens === null) return `已用 ${quota.usedTokens}${reserved}，本地预算不限${gap}`;
  return `已用 ${quota.usedTokens}${reserved}，剩余 ${quota.remainingTokens}${gap}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
