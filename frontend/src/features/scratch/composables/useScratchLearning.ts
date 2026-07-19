import { reactive, ref, type Ref } from 'vue';
import { ElMessage, ElMessageBox, type UploadFile } from 'element-plus';
import {
  createScratchWork,
  downloadScratchTemplate,
  downloadScratchVersion,
  getScratchWork,
  listStudentScratchAssignments,
  saveScratchWorkVersion,
  submitScratchWork,
  type ScratchAssignmentView,
  type ScratchWorkView,
} from '../api';

export function useScratchLearning(studentId: Ref<string>, readonly: Ref<boolean>) {
  const loading = ref(false);
  const saving = ref(false);
  const assignments = ref<ScratchAssignmentView[]>([]);
  const workVisible = ref(false);
  const work = ref<ScratchWorkView | null>(null);
  const project = ref<File | null>(null);
  const form = reactive({ note: '', submitNote: '' });

  async function load() {
    if (!studentId.value) return;
    loading.value = true;
    try {
      assignments.value = await listStudentScratchAssignments(studentId.value);
    } finally {
      loading.value = false;
    }
  }

  async function openAssignment(assignment: ScratchAssignmentView) {
    const existing = assignment.works[0];
    if (existing) {
      work.value = await getScratchWork(existing.id);
    } else if (!readonly.value) {
      work.value = await createScratchWork(assignment.id, assignment.title);
      await load();
    } else {
      work.value = null;
    }
    Object.assign(form, { note: '', submitNote: '' });
    project.value = null;
    workVisible.value = true;
  }

  function selectProject(file: UploadFile) {
    project.value = file.raw ?? null;
  }

  async function saveVersion() {
    if (!work.value || !project.value) {
      ElMessage.warning('请先选择 .sb3 作品文件');
      return;
    }
    saving.value = true;
    try {
      work.value = await saveScratchWorkVersion(work.value.id, {
        project: project.value,
        note: form.note.trim() || undefined,
      });
      project.value = null;
      form.note = '';
      await load();
      ElMessage.success('已保存新版本，历史版本不会被覆盖');
    } finally {
      saving.value = false;
    }
  }

  async function submit() {
    if (!work.value) return;
    await ElMessageBox.confirm('提交会固化当前版本；之后再次保存仍会产生新版本。', '提交 Scratch 作品', { type: 'warning' });
    saving.value = true;
    try {
      work.value = await submitScratchWork(work.value.id, form.submitNote.trim() || undefined);
      form.submitNote = '';
      await load();
      ElMessage.success('Scratch 作品已提交');
    } finally {
      saving.value = false;
    }
  }

  return {
    assignments, downloadScratchTemplate, downloadScratchVersion, form, load, loading, openAssignment, project,
    saveVersion, saving, selectProject, submit, work, workVisible,
  };
}
