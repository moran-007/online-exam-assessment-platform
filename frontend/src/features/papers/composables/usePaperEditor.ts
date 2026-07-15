import { ElMessage, ElMessageBox } from 'element-plus';
import type { Router } from 'vue-router';
import { getKnowledgeTree } from '../../platform/api';
import {
  addPaperQuestion,
  addPaperQuestionsByTags,
  movePaperQuestion,
  publishPaper as publishPaperRequest,
  removePaperQuestion,
  updatePaper,
  updatePaperQuestion as updatePaperQuestionRequest,
  updatePaperQuestionSnapshot,
} from '../api';
import { statusLabel } from '../../../statusMeta';
import type { KnowledgeTreeNode, PaperQuestion, PaperQuestionSnapshot } from '../models';
import type { usePaperPageState } from './usePaperPageState';

type State = ReturnType<typeof usePaperPageState>;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function usePaperEditor(options: {
  state: State;
  router: Router;
  canEditSnapshot: { value: boolean };
  snapshotEditTip: { value: string };
  snapshot: (question: PaperQuestion) => PaperQuestionSnapshot;
  paperScopeForStatus: (status: string) => string;
  refreshSelectedPaper: () => Promise<void>;
}) {
  const {
    state, router, canEditSnapshot, snapshotEditTip, snapshot,
    paperScopeForStatus, refreshSelectedPaper,
  } = options;

  async function handleBulkCourseChange() {
    state.bulkForm.knowledgePointIds = [];
    await loadBulkKnowledgeTree();
  }

  async function loadBulkKnowledgeTree() {
    state.bulkKnowledgeTree.value = state.bulkForm.courseId
      ? await getKnowledgeTree(state.bulkForm.courseId) as KnowledgeTreeNode[]
      : [];
  }

  function syncSelectedQuestionScore() {
    const question = state.questions.value.find((item) => item.id === state.addForm.questionId);
    if (question?.defaultScore !== undefined) state.addForm.score = Number(question.defaultScore);
  }

  async function addQuestion() {
    if (!state.selectedPaperId.value || !state.addForm.questionId) {
      ElMessage.error('请选择试卷和题目');
      return;
    }
    await addPaperQuestion(state.selectedPaperId.value, state.addForm);
    ElMessage.success('已加入试卷');
    await refreshSelectedPaper();
  }

  async function addQuestionsByTags() {
    if (!state.selectedPaperId.value) {
      ElMessage.error('请选择试卷');
      return;
    }
    const hasFilter = state.bulkForm.courseId || state.bulkForm.tagIds.length
      || state.bulkForm.knowledgePointIds.length || state.bulkForm.questionType;
    if (!hasFilter) {
      ElMessage.error('请选择课程/大类、标签、知识点或题型中的至少一个条件');
      return;
    }
    const result = await addPaperQuestionsByTags(state.selectedPaperId.value, {
      ...state.bulkForm,
      courseId: state.bulkForm.courseId || undefined,
      questionType: state.bulkForm.questionType || undefined,
      count: state.bulkForm.random ? state.bulkForm.count : undefined,
    });
    ElMessage.success(`已加入 ${result.addedCount} 道题`);
    await refreshSelectedPaper();
  }

  async function savePaperInfo() {
    await updatePaper(state.selectedPaperId.value, state.editPaperForm);
    ElMessage.success('试卷信息已保存');
    await refreshSelectedPaper();
  }

  async function unpublishPaper() {
    if (state.detail.value) await changePaperStatus(state.detail.value, 'draft');
  }

  async function updatePaperQuestion(paperQuestion: PaperQuestion) {
    await updatePaperQuestionRequest(state.selectedPaperId.value, paperQuestion.id, {
      score: paperQuestion.editScore,
      sectionTitle: paperQuestion.editSectionTitle,
    });
    ElMessage.success('题目调整已保存');
    await refreshSelectedPaper();
  }

  function openSnapshotEditor(paperQuestion: PaperQuestion) {
    if (!canEditSnapshot.value) {
      ElMessage.warning(snapshotEditTip.value);
      return;
    }
    const currentSnapshot = snapshot(paperQuestion);
    Object.assign(state.snapshotForm, {
      paperQuestionId: paperQuestion.id,
      title: currentSnapshot.title || '',
      content: currentSnapshot.content || '',
      analysis: currentSnapshot.analysis || '',
      options: (currentSnapshot.options ?? []).map((option, index) => ({
        id: option.id,
        optionKey: option.optionKey || String.fromCharCode(65 + index),
        content: option.content || '',
        sortOrder: option.sortOrder ?? index + 1,
        isCorrect: Boolean(option.isCorrect),
      })),
    });
    state.snapshotEditorVisible.value = true;
  }

  async function saveSnapshotDisplay() {
    if (!state.snapshotForm.title.trim() || !state.snapshotForm.content.trim()) {
      ElMessage.error(!state.snapshotForm.title.trim() ? '题目标题不能为空' : '题干内容不能为空');
      return;
    }
    const emptyOptionIndex = state.snapshotForm.options.findIndex((option) => !option.content.trim());
    if (emptyOptionIndex >= 0) {
      ElMessage.error(`第 ${emptyOptionIndex + 1} 个选项内容不能为空`);
      return;
    }
    state.snapshotSaving.value = true;
    try {
      await updatePaperQuestionSnapshot(
        state.selectedPaperId.value,
        state.snapshotForm.paperQuestionId,
        {
          title: state.snapshotForm.title,
          content: state.snapshotForm.content,
          analysis: state.snapshotForm.analysis,
          options: state.snapshotForm.options.length
            ? state.snapshotForm.options.map((option, index) => ({
              id: option.id,
              optionKey: option.optionKey || String.fromCharCode(65 + index),
              content: option.content,
              sortOrder: index + 1,
            }))
            : undefined,
        },
      );
      ElMessage.success('显示内容已保存');
      state.snapshotEditorVisible.value = false;
      await refreshSelectedPaper();
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, '保存显示内容失败'));
    } finally {
      state.snapshotSaving.value = false;
    }
  }

  async function moveQuestion(paperQuestion: PaperQuestion, direction: 'up' | 'down') {
    await movePaperQuestion(state.selectedPaperId.value, paperQuestion.id, { direction });
    await refreshSelectedPaper();
  }

  async function removeQuestion(paperQuestion: PaperQuestion) {
    await ElMessageBox.confirm(
      `确认从试卷中删除“${snapshot(paperQuestion).title}”？`,
      '删除题目',
      { type: 'warning' },
    );
    await removePaperQuestion(state.selectedPaperId.value, paperQuestion.id);
    ElMessage.success('已删除题目');
    await refreshSelectedPaper();
  }

  async function publishPaper() {
    if (state.detail.value) await changePaperStatus(state.detail.value, 'published');
  }

  async function changePaperStatus(value: unknown, targetStatus: string) {
    const row = paperRow(value);
    const paperId = row?.id || state.selectedPaperId.value;
    const currentStatus = row?.status || state.detail.value?.status;
    if (!paperId || !targetStatus || targetStatus === currentStatus) return;
    try {
      if (targetStatus === 'archived') {
        await ElMessageBox.confirm(
          '归档后试卷会保留数据，但不建议继续用于创建新考试。需要重新维护时可恢复为草稿。',
          '归档试卷',
          { type: 'warning', confirmButtonText: '归档', cancelButtonText: '取消' },
        );
      }
      if (targetStatus === 'published') await publishPaperRequest(paperId);
      else await updatePaper(paperId, { status: targetStatus });
      ElMessage.success(`试卷状态已更新为${statusLabel('paper', targetStatus)}`);
      state.paperScope.value = paperScopeForStatus(targetStatus);
      state.selectedPaperId.value = paperId;
      await refreshSelectedPaper();
    } catch (error: unknown) {
      if (error !== 'cancel') ElMessage.error(errorMessage(error, '试卷状态更新失败'));
    }
  }

  function answerPaper(value?: unknown) {
    const row = paperRow(value);
    const paperId = row?.id || state.selectedPaperId.value;
    if (paperId) void router.push(`/papers/${paperId}/answer`);
  }

  return {
    handleBulkCourseChange, loadBulkKnowledgeTree, syncSelectedQuestionScore,
    addQuestion, addQuestionsByTags, savePaperInfo, unpublishPaper,
    updatePaperQuestion, openSnapshotEditor, saveSnapshotDisplay, moveQuestion,
    removeQuestion, publishPaper, changePaperStatus, answerPaper,
  };
}

function paperRow(value: unknown): { id?: string; status?: string } {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as { id?: string; status?: string }
    : {};
}
