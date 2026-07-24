import { reactive, ref, type Ref } from 'vue';
import { ElMessage, ElMessageBox, type UploadFile } from 'element-plus';
import {
  getLessonRecord,
  listLessonRecordVersions,
  openLessonAsset,
  publishLessonRecord,
  removeLessonAsset,
  saveLessonRecordDraft,
  submitLessonRecord,
  uploadLessonAsset,
  type LessonAssetView,
  type LessonRecordDetail,
  type LessonRecordVersionView,
} from '../api';
import {
  hasLessonRecordDraftConflict,
  isMessageBoxDismissal,
  nonEmptyLessonRecordDraft,
} from './lessonRecordDraft';

export function useLessonRecordEditor(sessionId: Ref<string>, changed: () => void) {
  const loading = ref(false);
  const saving = ref(false);
  const detail = ref<LessonRecordDetail | null>(null);
  const versions = ref<LessonRecordVersionView[]>([]);
  const uploadFile = ref<File | null>(null);
  const uploadForm = reactive({ audience: 'LEARNER' as 'INTERNAL' | 'LEARNER', title: '', note: '' });
  const form = reactive(emptyForm());

  async function load() {
    if (!sessionId.value) return;
    loading.value = true;
    try {
      detail.value = await getLessonRecord(sessionId.value);
      Object.assign(form, editableRecordFields(detail.value.record));
      versions.value = detail.value.record ? await listLessonRecordVersions(sessionId.value) : [];
    } finally {
      loading.value = false;
    }
  }

  async function save() {
    saving.value = true;
    try {
      detail.value = await saveLessonRecordDraft(sessionId.value, { ...form });
      Object.assign(form, editableRecordFields(detail.value.record));
      await refreshVersions();
      ElMessage.success('教学记录草稿已保存');
      changed();
    } finally {
      saving.value = false;
    }
  }

  async function submit() {
    if (!await confirmRecordAction('提交后进入待发布状态；继续编辑会自动退回草稿。', '提交教学记录')) return;
    detail.value = await submitLessonRecord(sessionId.value);
    Object.assign(form, editableRecordFields(detail.value.record));
    await refreshVersions();
    ElMessage.success('教学记录已提交');
    changed();
  }

  async function publish() {
    if (!await confirmRecordAction('发布后学生与已关联家长可查看公开字段和公开附件。', '发布教学记录')) return;
    detail.value = await publishLessonRecord(sessionId.value);
    Object.assign(form, editableRecordFields(detail.value.record));
    await refreshVersions();
    ElMessage.success('教学记录已发布，通知已发送');
    changed();
  }

  async function upload() {
    if (!uploadFile.value) {
      ElMessage.warning('请先选择附件');
      return;
    }
    await uploadLessonAsset(sessionId.value, uploadFile.value, {
      audience: uploadForm.audience,
      title: uploadForm.title.trim() || undefined,
      note: uploadForm.note.trim() || undefined,
    });
    uploadFile.value = null;
    Object.assign(uploadForm, { audience: 'LEARNER', title: '', note: '' });
    await load();
    ElMessage.success('附件已上传，记录已退回草稿');
    changed();
  }

  function selectFile(file: UploadFile) {
    uploadFile.value = file.raw ?? null;
    if (!uploadForm.title) uploadForm.title = file.name;
  }

  async function removeAsset(asset: LessonAssetView) {
    if (!await confirmRecordAction(`确认移除附件“${asset.title || asset.fileName}”吗？`, '移除附件')) return;
    await removeLessonAsset(sessionId.value, asset.id);
    await load();
    ElMessage.success('附件已移除，记录已退回草稿');
    changed();
  }

  async function refreshVersions() {
    versions.value = await listLessonRecordVersions(sessionId.value);
  }

  async function applyAiDraft(content: Record<string, unknown>) {
    await applyRecordDraft(aiLessonFields(content), {
      confirmMessage: 'AI 草稿会覆盖对应的非空教学记录字段，是否继续？',
      confirmTitle: '应用课堂助手草稿',
      successMessage: 'AI 内容已应用到本地草稿，请检查后点击“保存草稿”',
    });
  }

  async function applyLessonPlanDraft(content: Record<string, unknown>) {
    return applyRecordDraft(content, {
      confirmMessage: '预填会覆盖已有的对应公开字段，是否继续？',
      confirmTitle: '按教案预填',
      successMessage: '教案内容已分别预填到公开草稿，请按实际上课调整',
    });
  }

  async function applyPublicAiDraft(content: Record<string, unknown>) {
    return applyRecordDraft(content, {
      confirmMessage: 'AI 生成内容会覆盖对应的非空公开字段，是否继续？',
      confirmTitle: '应用课后公开草稿',
      successMessage: 'AI 已将课后内容分别填入家长/学生可见字段，请检查后保存草稿',
    });
  }

  async function applyRecordDraft(
    content: Record<string, unknown>,
    options: { confirmMessage: string; confirmTitle: string; successMessage: string },
  ) {
    const replacement = nonEmptyLessonRecordDraft(content);
    if (!Object.keys(replacement).length) {
      ElMessage.warning('没有可应用的非空教学记录内容');
      return false;
    }
    if (hasLessonRecordDraftConflict(form, replacement)
      && !await confirmRecordAction(options.confirmMessage, options.confirmTitle)) {
      return false;
    }
    Object.assign(form, replacement);
    ElMessage.success(options.successMessage);
    return true;
  }

  return {
    applyAiDraft, applyLessonPlanDraft, applyPublicAiDraft, detail, form, load, loading,
    openLessonAsset, publish, removeAsset, save, saving,
    selectFile, submit, upload, uploadFile, uploadForm, versions,
  };
}

async function confirmRecordAction(message: string, title: string) {
  try {
    await ElMessageBox.confirm(message, title, { type: 'warning' });
    return true;
  } catch (reason) {
    if (isMessageBoxDismissal(reason)) return false;
    throw reason;
  }
}

function aiLessonFields(content: Record<string, unknown>) {
  const headline = claimText(content.headline);
  const overview = claimList(content.overview);
  const strengths = claimList(content.strengths);
  const risks = claimList(content.risks);
  const actions = claimList(content.actions);
  const needsReview = claimList(content.needsReview);
  return {
    publicTeachingContent: overview.join('\n'),
    publicLearningGoal: headline,
    publicClassPerformance: strengths.join('\n'),
    publicHomework: actions[0] ?? '',
    publicNextPlan: actions.slice(1).join('\n'),
    internalTeachingNotes: [...risks, ...needsReview].join('\n'),
  };
}

function claimText(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  const text = (value as { text?: unknown }).text;
  return typeof text === 'string' ? text.trim() : '';
}

function claimList(value: unknown) {
  return Array.isArray(value) ? value.map(claimText).filter(Boolean) : [];
}

function emptyForm() {
  return {
    internalTeachingNotes: '',
    internalClassPerformance: '',
    publicTeachingContent: '',
    publicLearningGoal: '',
    publicClassPerformance: '',
    publicHomework: '',
    publicNextPlan: '',
    publicMaterials: '',
  };
}

function editableRecordFields(record: unknown) {
  const result = emptyForm();
  const source = record && typeof record === 'object' ? record as Record<string, unknown> : {};
  for (const key of Object.keys(result) as Array<keyof typeof result>) {
    result[key] = typeof source[key] === 'string' ? source[key] : '';
  }
  return result;
}
