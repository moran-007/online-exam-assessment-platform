import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  createExamSummary,
  listAiConfigurations,
  listExamSummaryHistory,
  previewExamSummaryDataset,
  publishExamSummary,
  regenerateExamSummary,
  reviewExamSummary,
  revokeExamSummary,
  updateExamSummary,
} from '../api';
import type {
  AiProviderConfig,
  AiStructuredSummaryContent,
  AiSummaryLifecycleRecord,
  ExamSummaryDatasetPreview,
  ExamSummaryTask,
} from '../models';
import {
  emptyExamSummaryEditor,
  examSummaryContentFromEditor,
  populateExamSummaryEditor,
} from './exam-summary-editor';

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useExamAiSummaryDialog() {
  const visible = ref(false);
  const loading = ref(false);
  const working = ref(false);
  const examId = ref('');
  const examName = ref('');
  const selectedConfigId = ref('');
  const requestedMaxTokens = ref(1200);
  const preview = ref<ExamSummaryDatasetPreview | null>(null);
  const configs = ref<AiProviderConfig[]>([]);
  const history = ref<AiSummaryLifecycleRecord[]>([]);
  const active = ref<AiSummaryLifecycleRecord | null>(null);
  const lastTask = ref<ExamSummaryTask | null>(null);
  const original = ref<AiStructuredSummaryContent | null>(null);
  const editor = reactive(emptyExamSummaryEditor());

  const enabledConfigs = computed(() => configs.value.filter((item) => item.enabled));
  const canEdit = computed(() => active.value && active.value.reviewStatus !== 'published');
  const canReview = computed(() => ['draft', 'in_review'].includes(active.value?.reviewStatus ?? ''));
  const canPublish = computed(() => active.value?.reviewStatus === 'approved');
  const canRevoke = computed(() => active.value?.reviewStatus === 'published');

  async function open(id: string, name: string) {
    examId.value = id;
    examName.value = name;
    visible.value = true;
    loading.value = true;
    lastTask.value = null;
    try {
      const [dataset, availableConfigs, records] = await Promise.all([
        previewExamSummaryDataset(id),
        listAiConfigurations(),
        listExamSummaryHistory(id),
      ]);
      preview.value = dataset;
      configs.value = availableConfigs;
      history.value = records;
      selectSummary(records[0] ?? null);
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, 'AI 考试总结数据加载失败'));
    } finally {
      loading.value = false;
    }
  }

  function selectSummary(summary: AiSummaryLifecycleRecord | null) {
    active.value = summary;
    original.value = populateExamSummaryEditor(editor, summary?.content ?? null);
  }

  async function generate() {
    if (lastTask.value?.status === 'failed' && !await confirm(
      '上一次调用失败。再次尝试会产生新的模型请求和 Token 用量，是否继续？',
      '确认再次调用模型',
    )) return;
    await execute('生成考试总结', async () => {
      lastTask.value = await createExamSummary({
        examId: examId.value,
        configId: selectedConfigId.value || undefined,
        maxTokens: requestedMaxTokens.value,
      });
      if (lastTask.value.summary) await refresh(lastTask.value.summary.id);
      if (lastTask.value.status === 'failed') throw new Error(lastTask.value.sanitizedError || '模型生成失败');
      ElMessage.success(lastTask.value.cacheHit ? '已复用相同输入的总结' : '考试总结草稿已生成');
    });
  }

  async function save() {
    if (!active.value || !editor.headline.trim()) {
      ElMessage.warning('总结标题不能为空');
      return;
    }
    await execute('保存草稿', async () => {
      const updated = await updateExamSummary(active.value!.id, contentFromEditor());
      await refresh(updated.id);
      ElMessage.success('草稿已保存，旧审核状态已清除');
    });
  }

  async function review() {
    if (!active.value) return;
    await execute('审核总结', async () => {
      const updated = await reviewExamSummary(active.value!.id);
      await refresh(updated.id);
      ElMessage.success('人工审核已通过');
    });
  }

  async function publish() {
    if (!active.value) return;
    if (!await confirm('发布后，参加本场考试的学生可以查看该总结。', '确认发布')) return;
    await execute('发布总结', async () => {
      const updated = await publishExamSummary(active.value!.id);
      await refresh(updated.id);
      ElMessage.success('考试总结已发布');
    });
  }

  async function revoke() {
    if (!active.value) return;
    if (!await confirm('撤回后，学生端将立即不可见。', '确认撤回')) return;
    await execute('撤回总结', async () => {
      const updated = await revokeExamSummary(active.value!.id);
      await refresh(updated.id);
      ElMessage.success('考试总结已撤回');
    });
  }

  async function regenerate() {
    if (!active.value) return;
    if (!await confirm('重新生成会发起一次新的模型调用并记录 Token。', '确认重新生成')) return;
    await execute('重新生成', async () => {
      lastTask.value = await regenerateExamSummary(active.value!.id, {
        configId: selectedConfigId.value || undefined,
        maxTokens: requestedMaxTokens.value,
      });
      if (lastTask.value.summary) await refresh(lastTask.value.summary.id);
      if (lastTask.value.status === 'failed') throw new Error(lastTask.value.sanitizedError || '重新生成失败');
      ElMessage.success('新的总结草稿已生成');
    });
  }

  async function refresh(selectedId?: string) {
    history.value = await listExamSummaryHistory(examId.value);
    selectSummary(history.value.find((item) => item.id === selectedId) ?? history.value[0] ?? null);
  }

  function contentFromEditor(): Record<string, unknown> {
    const fallback = original.value?.headline.evidenceRefs
      ?? (active.value?.evidence[0]?.refId ? [active.value.evidence[0].refId] : []);
    return examSummaryContentFromEditor(editor, original.value, fallback) as unknown as Record<string, unknown>;
  }

  async function execute(label: string, operation: () => Promise<void>) {
    if (working.value) return;
    working.value = true;
    try {
      await operation();
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, `${label}失败`));
    } finally {
      working.value = false;
    }
  }

  return {
    active, canEdit, canPublish, canReview, canRevoke, editor, enabledConfigs, examName,
    generate, history, lastTask, loading, open, preview, publish, regenerate, review, revoke,
    requestedMaxTokens, save, selectSummary, selectedConfigId, visible, working,
  };
}

async function confirm(message: string, title: string) {
  return ElMessageBox.confirm(message, title, { type: 'warning' }).then(() => true).catch(() => false);
}
