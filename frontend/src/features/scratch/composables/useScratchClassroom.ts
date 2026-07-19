import { reactive, ref, type Ref } from 'vue';
import { ElMessage, ElMessageBox, type UploadFile } from 'element-plus';
import {
  archiveScratchAssignment,
  createScratchAssignment,
  createScratchTemplate,
  downloadScratchVersion,
  getScratchWork,
  listScratchTemplates,
  listSessionScratchAssignments,
  publishScratchAssignment,
  retryScratchJudge,
  reviewScratchWork,
  type JudgeMode,
  type ScratchAssignmentView,
  type ScratchWorkView,
} from '../api';

export function useScratchClassroom(sessionId: Ref<string>) {
  const loading = ref(false);
  const saving = ref(false);
  const templates = ref<Awaited<ReturnType<typeof listScratchTemplates>>>([]);
  const assignments = ref<ScratchAssignmentView[]>([]);
  const templateProject = ref<File | null>(null);
  const templateForm = reactive({ title: '', description: '' });
  const assignmentForm = reactive({
    templateId: '', title: '', statementMd: '', maxScore: 100, judgeMode: 'manual' as JudgeMode,
  });
  const workVisible = ref(false);
  const work = ref<ScratchWorkView | null>(null);
  const reviewForm = reactive<{ score?: number; comment: string }>({ score: undefined, comment: '' });

  async function load() {
    if (!sessionId.value) return;
    loading.value = true;
    try {
      [templates.value, assignments.value] = await Promise.all([
        listScratchTemplates(),
        listSessionScratchAssignments(sessionId.value),
      ]);
      const activeTemplates = templates.value.filter((item) => item.status === 'active');
      if (!activeTemplates.some((item) => item.id === assignmentForm.templateId)) {
        assignmentForm.templateId = activeTemplates[0]?.id || '';
      }
    } finally {
      loading.value = false;
    }
  }

  function selectTemplateProject(file: UploadFile) {
    templateProject.value = file.raw ?? null;
    if (!templateForm.title) templateForm.title = file.name.replace(/\.sb3$/i, '');
  }

  async function addTemplate() {
    if (!templateProject.value || !templateForm.title.trim()) {
      ElMessage.warning('请填写模板名称并选择 .sb3 文件');
      return;
    }
    saving.value = true;
    try {
      const created = await createScratchTemplate({
        title: templateForm.title.trim(),
        description: templateForm.description.trim() || undefined,
        project: templateProject.value,
      });
      templateProject.value = null;
      Object.assign(templateForm, { title: '', description: '' });
      await load();
      assignmentForm.templateId = created.id;
      ElMessage.success('Scratch 模板已创建');
    } finally {
      saving.value = false;
    }
  }

  async function addAssignment() {
    if (!assignmentForm.templateId || !assignmentForm.title.trim()) {
      ElMessage.warning('请选择模板并填写任务名称');
      return;
    }
    saving.value = true;
    try {
      await createScratchAssignment(sessionId.value, {
        templateId: assignmentForm.templateId,
        title: assignmentForm.title.trim(),
        statementMd: assignmentForm.statementMd.trim() || undefined,
        maxScore: assignmentForm.maxScore,
        judgeMode: assignmentForm.judgeMode,
      });
      Object.assign(assignmentForm, { title: '', statementMd: '', maxScore: 100, judgeMode: 'manual' });
      await load();
      ElMessage.success('Scratch 任务已绑定到课次');
    } finally {
      saving.value = false;
    }
  }

  async function publish(assignment: ScratchAssignmentView) {
    await ElMessageBox.confirm('发布后班级学生即可创建和提交作品。', '发布 Scratch 任务', { type: 'warning' });
    await publishScratchAssignment(assignment.id);
    await load();
    ElMessage.success('Scratch 任务已发布');
  }

  async function archive(assignment: ScratchAssignmentView) {
    await ElMessageBox.confirm('归档不会删除历史作品与批阅记录。', '归档 Scratch 任务', { type: 'warning' });
    await archiveScratchAssignment(assignment.id);
    await load();
    ElMessage.success('Scratch 任务已归档');
  }

  async function openWork(id: string) {
    work.value = await getScratchWork(id);
    const latest = work.value.reviews[0];
    Object.assign(reviewForm, { score: latest?.score ?? undefined, comment: latest?.comment ?? '' });
    workVisible.value = true;
  }

  async function review() {
    if (!work.value) return;
    if (reviewForm.score === undefined && !reviewForm.comment.trim()) {
      ElMessage.warning('评分或点评至少填写一项');
      return;
    }
    saving.value = true;
    try {
      work.value = await reviewScratchWork(work.value.id, {
        score: reviewForm.score,
        comment: reviewForm.comment.trim() || undefined,
      });
      await load();
      ElMessage.success('批阅已保存为一条新的历史记录');
    } finally {
      saving.value = false;
    }
  }

  async function retryJudge(id: string) {
    await retryScratchJudge(id);
    if (work.value) work.value = await getScratchWork(work.value.id);
    ElMessage.success('已安排重新判定');
  }

  return {
    addAssignment, addTemplate, archive, assignmentForm, assignments, downloadScratchVersion, load, loading,
    openWork, publish, review, reviewForm, retryJudge, saving, selectTemplateProject, templateForm,
    templateProject, templates, work, workVisible,
  };
}
