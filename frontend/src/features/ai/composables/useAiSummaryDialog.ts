import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  createExamSummary,
  createStudentSummary,
  listAiConfigurations,
  listExamSummaryHistory,
  listStudentSummaryHistory,
  previewExamSummaryDataset,
  previewStudentSummaryDataset,
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
  AiSummaryTask,
  ExamSummaryDatasetPreview,
  StudentSummaryDatasetPreview,
} from '../models';
import { emptySummaryEditor, populateSummaryEditor, summaryContentFromEditor } from './summary-editor';

export type AiSummaryKind = 'exam' | 'student';
export type StudentSummaryScope = { courseId?: string; examIds?: string[]; from?: string; to?: string };
type SummaryPreview = ExamSummaryDatasetPreview | StudentSummaryDatasetPreview;

export function useAiSummaryDialog(kind: AiSummaryKind) {
  const visible = ref(false);
  const loading = ref(false);
  const working = ref(false);
  const subjectId = ref('');
  const subjectName = ref('');
  const scope = ref<StudentSummaryScope>({});
  const selectedConfigId = ref('');
  const requestedMaxTokens = ref<number | undefined>(undefined);
  const preview = ref<SummaryPreview | null>(null);
  const configs = ref<AiProviderConfig[]>([]);
  const history = ref<AiSummaryLifecycleRecord[]>([]);
  const active = ref<AiSummaryLifecycleRecord | null>(null);
  const lastTask = ref<AiSummaryTask | null>(null);
  const original = ref<AiStructuredSummaryContent | null>(null);
  const editor = reactive(emptySummaryEditor());

  const enabledConfigs = computed(() => configs.value.filter((item) => item.enabled));
  const canEdit = computed(() => active.value && active.value.reviewStatus !== 'published');
  const canReview = computed(() => ['draft', 'in_review'].includes(active.value?.reviewStatus ?? ''));
  const canPublish = computed(() => active.value?.reviewStatus === 'approved');
  const canRevoke = computed(() => active.value?.reviewStatus === 'published');
  const selectedConfiguration = computed(() => enabledConfigs.value.find((item) => item.id === selectedConfigId.value)
    ?? enabledConfigs.value.find((item) => item.isDefault)
    ?? enabledConfigs.value[0]);
  const effectiveOutputLimit = computed(() => {
    const configured = selectedConfiguration.value?.maxTokens;
    const requested = optionalOutputLimit(requestedMaxTokens.value).maxTokens;
    if (!configured) return requested ?? null;
    return Math.min(requested ?? configured, configured);
  });
  const outputLimitHint = computed(() => {
    const selected = selectedConfiguration.value;
    const requested = optionalOutputLimit(requestedMaxTokens.value).maxTokens;
    if (!selected) return requested ? `本次要求 ${requested} Token` : '自动使用默认模型配置上限';
    return requested
      ? `实际不超过 ${effectiveOutputLimit.value} Token（配置上限 ${selected.maxTokens}）`
      : `自动使用配置上限 ${selected.maxTokens} Token`;
  });

  async function open(id: string, name: string, nextScope: StudentSummaryScope = {}) {
    subjectId.value = id;
    subjectName.value = name;
    scope.value = { ...nextScope };
    visible.value = true;
    loading.value = true;
    lastTask.value = null;
    try {
      const [dataset, availableConfigs, records] = await Promise.all([
        loadPreview(),
        listAiConfigurations(),
        loadHistory(),
      ]);
      preview.value = dataset;
      configs.value = availableConfigs;
      history.value = records;
      selectSummary(records[0] ?? null);
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, `AI ${kindLabel()}总结数据加载失败`));
    } finally {
      loading.value = false;
    }
  }

  function selectSummary(summary: AiSummaryLifecycleRecord | null) {
    active.value = summary;
    original.value = populateSummaryEditor(editor, summary?.content ?? null);
  }

  async function generate() {
    if (lastTask.value?.status === 'failed' && !await confirm(
      `上一次调用失败。再次尝试会按当前 ${effectiveOutputLimit.value ?? '自动'} Token 上限发起新请求并产生用量，是否继续？`,
      '确认再次调用模型',
    )) return;
    await execute(`生成${kindLabel()}总结`, async () => {
      lastTask.value = await createTask();
      if (lastTask.value.summary) await refresh(lastTask.value.summary.id);
      if (lastTask.value.status === 'failed') throw new Error(lastTask.value.sanitizedError || '模型生成失败');
      ElMessage.success(lastTask.value.cacheHit ? '已复用相同输入的总结' : `${kindLabel()}总结草稿已生成`);
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
    const message = kind === 'student'
      ? '发布后，仅该学生本人可以查看此阶段总结。'
      : '发布后，参加本场考试的学生可以查看该总结。';
    if (!await confirm(message, '确认发布')) return;
    await execute('发布总结', async () => {
      const updated = await publishExamSummary(active.value!.id);
      await refresh(updated.id);
      ElMessage.success(`${kindLabel()}总结已发布`);
    });
  }

  async function revoke() {
    if (!active.value || !await confirm('撤回后，学生端将立即不可见。', '确认撤回')) return;
    await execute('撤回总结', async () => {
      const updated = await revokeExamSummary(active.value!.id);
      await refresh(updated.id);
      ElMessage.success(`${kindLabel()}总结已撤回`);
    });
  }

  async function regenerate() {
    if (!active.value || !await confirm(
      `重新生成会按当前 ${effectiveOutputLimit.value ?? '自动'} Token 上限发起新模型调用并记录用量。`,
      '确认重新生成',
    )) return;
    await execute('重新生成', async () => {
      lastTask.value = await regenerateExamSummary(active.value!.id, {
        configId: selectedConfigId.value || undefined,
        ...optionalOutputLimit(requestedMaxTokens.value),
      });
      if (lastTask.value.summary) await refresh(lastTask.value.summary.id);
      if (lastTask.value.status === 'failed') throw new Error(lastTask.value.sanitizedError || '重新生成失败');
      ElMessage.success('新的总结草稿已生成');
    });
  }

  function loadPreview() {
    return kind === 'exam'
      ? previewExamSummaryDataset(subjectId.value)
      : previewStudentSummaryDataset(subjectId.value, scope.value);
  }

  function loadHistory() {
    return kind === 'exam'
      ? listExamSummaryHistory(subjectId.value)
      : listStudentSummaryHistory(subjectId.value);
  }

  function createTask() {
    const options = {
      configId: selectedConfigId.value || undefined,
      ...optionalOutputLimit(requestedMaxTokens.value),
    };
    return kind === 'exam'
      ? createExamSummary({ examId: subjectId.value, ...options })
      : createStudentSummary({ studentId: subjectId.value, ...scope.value, ...options });
  }

  async function refresh(selectedId?: string) {
    history.value = await loadHistory();
    selectSummary(history.value.find((item) => item.id === selectedId) ?? history.value[0] ?? null);
  }

  function contentFromEditor(): Record<string, unknown> {
    const fallback = original.value?.headline.evidenceRefs
      ?? (active.value?.evidence[0]?.refId ? [active.value.evidence[0].refId] : []);
    const schemaVersion = original.value?.schemaVersion ?? `${kind}-summary-output/v1`;
    return summaryContentFromEditor(editor, original.value, fallback, schemaVersion) as unknown as Record<string, unknown>;
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

  function kindLabel() {
    return kind === 'student' ? '学生阶段' : '考试';
  }

  return {
    active, canEdit, canPublish, canReview, canRevoke, editor, effectiveOutputLimit, enabledConfigs,
    generate, history, kind, lastTask, loading, open, outputLimitHint, preview, publish, regenerate,
    requestedMaxTokens, review, revoke, save, selectSummary, selectedConfigId, subjectName, visible, working,
  };
}

function optionalOutputLimit(value: unknown): { maxTokens?: number } {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? { maxTokens: normalized } : {};
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function confirm(message: string, title: string) {
  return ElMessageBox.confirm(message, title, { type: 'warning' }).then(() => true).catch(() => false);
}
