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
      Object.assign(form, emptyForm(), detail.value.record ?? {});
      versions.value = detail.value.record ? await listLessonRecordVersions(sessionId.value) : [];
    } finally {
      loading.value = false;
    }
  }

  async function save() {
    saving.value = true;
    try {
      detail.value = await saveLessonRecordDraft(sessionId.value, { ...form });
      Object.assign(form, emptyForm(), detail.value.record ?? {});
      await refreshVersions();
      ElMessage.success('教学记录草稿已保存');
      changed();
    } finally {
      saving.value = false;
    }
  }

  async function submit() {
    await ElMessageBox.confirm('提交后进入待发布状态；继续编辑会自动退回草稿。', '提交教学记录', { type: 'warning' });
    detail.value = await submitLessonRecord(sessionId.value);
    Object.assign(form, emptyForm(), detail.value.record ?? {});
    await refreshVersions();
    ElMessage.success('教学记录已提交');
    changed();
  }

  async function publish() {
    await ElMessageBox.confirm('发布后学生与已关联家长可查看公开字段和公开附件。', '发布教学记录', { type: 'warning' });
    detail.value = await publishLessonRecord(sessionId.value);
    Object.assign(form, emptyForm(), detail.value.record ?? {});
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
    await ElMessageBox.confirm(`确认移除附件“${asset.title || asset.fileName}”吗？`, '移除附件', { type: 'warning' });
    await removeLessonAsset(sessionId.value, asset.id);
    await load();
    ElMessage.success('附件已移除，记录已退回草稿');
    changed();
  }

  async function refreshVersions() {
    versions.value = await listLessonRecordVersions(sessionId.value);
  }

  async function applyAiDraft(content: Record<string, unknown>) {
    const replacement = aiLessonFields(content);
    const willReplace = Object.entries(replacement).some(([key, value]) => value && form[key as keyof typeof form]);
    if (willReplace) {
      await ElMessageBox.confirm('AI 草稿会覆盖对应的非空教学记录字段，是否继续？', '应用课堂助手草稿', {
        type: 'warning',
      });
    }
    Object.assign(form, Object.fromEntries(Object.entries(replacement).filter(([, value]) => value)));
    ElMessage.success('AI 内容已应用到本地草稿，请检查后点击“保存草稿”');
  }

  return {
    applyAiDraft, detail, form, load, loading, openLessonAsset, publish, removeAsset, save, saving,
    selectFile, submit, upload, uploadFile, uploadForm, versions,
  };
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
