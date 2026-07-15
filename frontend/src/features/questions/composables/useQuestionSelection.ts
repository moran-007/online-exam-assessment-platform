import type { ComputedRef, Ref } from 'vue';
import type { Router } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  bulkDeleteQuestions as bulkDeleteQuestionsRequest,
  bulkUpdateQuestionStatus as bulkUpdateQuestionStatusRequest,
} from '../api';
import { createExportTask } from '../../exports/api';
import type { QuestionRecord, QuestionStatus } from '../models';

type QuestionCommand = 'edit' | 'publish' | 'unpublish' | 'hide' | 'show' | 'download' | 'delete';

type SelectionState = {
  router: Router;
  editMode: Ref<boolean>;
  selectedQuestionRows: Ref<QuestionRecord[]>;
  selectedQuestionIds: ComputedRef<string[]>;
  bulkQuestionStatus: Ref<QuestionStatus | ''>;
  pendingExportQuestionIds: Ref<string[]>;
  questionExportVisible: Ref<boolean>;
  questionExportOptions: {
    format: NonNullable<Parameters<typeof createExportTask>[0]['format']>;
    includeAnswers: boolean;
    includeAnalysis: boolean;
  };
  closeEditor: () => void;
  editQuestion: (row: Pick<QuestionRecord, 'id'>) => Promise<void>;
  openPracticeQuestion: (value: unknown) => Promise<void>;
  changeStatus: (row: QuestionRecord, status: QuestionStatus) => Promise<void>;
  removeQuestion: (row: QuestionRecord) => Promise<void>;
  refreshAll: () => Promise<void>;
  statusLabel: (value: string) => string;
};

export function useQuestionSelection(state: SelectionState) {
  const {
    bulkQuestionStatus,
    changeStatus,
    closeEditor,
    editMode,
    editQuestion,
    openPracticeQuestion,
    pendingExportQuestionIds,
    questionExportOptions,
    questionExportVisible,
    refreshAll,
    removeQuestion,
    router,
    selectedQuestionIds,
    selectedQuestionRows,
    statusLabel,
  } = state;

  function errorMessage(error: unknown, fallback = '操作失败') {
    return error instanceof Error ? error.message : fallback;
  }

  function asQuestionRecord(value: unknown): QuestionRecord {
    if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') {
      throw new Error('题目数据无效');
    }
    return value as QuestionRecord;
  }

  function handleQuestionRowClick(row: QuestionRecord) {
    if (editMode.value) {
      editQuestion(row);
      return;
    }

    openPracticeQuestion(row);
  }

  function handleSelectionChange(rows: QuestionRecord[]) {
    selectedQuestionRows.value = rows;
  }

  function openRelatedExams(value: unknown) {
    const row = asQuestionRecord(value);
    const examId = row.occupationExams?.[0]?.id;
    router.push(examId ? `/exams?focusExamId=${examId}` : '/exams');
  }

  function onEditModeChange(value: string | number | boolean) {
    if (value !== true) {
      closeEditor();
      ElMessage.info('已退出编辑模式，点击题目将进入答题');
      return;
    }

    ElMessage.warning('已进入编辑模式，点击题目将打开编辑/复制窗口');
  }

  async function bulkDeleteQuestions() {
    if (!selectedQuestionIds.value.length) {
      ElMessage.warning('请选择需要删除的题目');
      return;
    }

    try {
      await ElMessageBox.confirm(
        `风险操作提示：将批量归档 ${selectedQuestionIds.value.length} 道题目，并从引用这些题目的试卷中同步移除题位、重算总分；历史答卷与已生成考试快照仍会保留。`,
        '批量删除题目',
        {
          type: 'warning',
          confirmButtonText: '批量删除',
          cancelButtonText: '取消',
        },
      );
      const result = await bulkDeleteQuestionsRequest({ ids: selectedQuestionIds.value });
      const failedText = result.failed?.length ? `，${result.failed.length} 道失败` : '';
      ElMessage.success(`已删除 ${result.successCount} 道题${failedText}`);
      selectedQuestionRows.value = [];
      await refreshAll();
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error(errorMessage(error));
      }
    }
  }

  async function bulkUpdateQuestionStatus() {
    if (!selectedQuestionIds.value.length || !bulkQuestionStatus.value) {
      ElMessage.warning('请选择题目和目标状态');
      return;
    }

    try {
      await ElMessageBox.confirm(
        `风险操作提示：将批量把 ${selectedQuestionIds.value.length} 道题设置为“${statusLabel(bulkQuestionStatus.value)}”，会影响题库可见性和后续组卷。`,
        '批量设置题目状态',
        {
          type: 'warning',
          confirmButtonText: '批量设置',
          cancelButtonText: '取消',
        },
      );
      const result = await bulkUpdateQuestionStatusRequest({ ids: selectedQuestionIds.value, status: bulkQuestionStatus.value });
      const failedText = result.failed?.length ? `，${result.failed.length} 道失败` : '';
      ElMessage.success(`已设置 ${result.successCount} 道题为${statusLabel(result.status ?? bulkQuestionStatus.value)}${failedText}`);
      selectedQuestionRows.value = [];
      await refreshAll();
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error(errorMessage(error));
      }
    }
  }

  function openQuestionExportDialog(questionIds: string[]) {
    const ids = [...questionIds];
    if (!ids.length) {
      ElMessage.warning('请先选择需要导出的题目');
      return;
    }

    pendingExportQuestionIds.value = ids;
    questionExportVisible.value = true;
  }

  async function exportQuestion(row: QuestionRecord) {
    openQuestionExportDialog([row.id]);
  }

  function handleQuestionCommand(value: unknown, rawCommand: string | number | object) {
    const row = asQuestionRecord(value);
    const command = String(rawCommand) as QuestionCommand;
    const actions = {
      edit: () => editQuestion(row),
      publish: () => changeStatus(row, 'published'),
      unpublish: () => changeStatus(row, 'draft'),
      hide: () => changeStatus(row, 'disabled'),
      show: () => changeStatus(row, 'draft'),
      download: () => exportQuestion(row),
      delete: () => removeQuestion(row),
    };
    return actions[command]?.();
  }

  async function exportQuestions(questionIds: string[]) {
    try {
      await createExportTask({
          type: 'question_bank',
          format: questionExportOptions.format,
          questionIds,
          includeAnswers: questionExportOptions.includeAnswers,
          includeAnalysis: questionExportOptions.includeAnalysis,
      });
      ElMessage.success('题目导出任务已加入队列，可到导出中心下载');
    } catch (error) {
      ElMessage.error(errorMessage(error, '题目导出失败'));
    }
  }

  async function confirmQuestionExport() {
    await exportQuestions(pendingExportQuestionIds.value);
    questionExportVisible.value = false;
  }

  return {
    handleQuestionRowClick,
    handleSelectionChange,
    openRelatedExams,
    onEditModeChange,
    bulkDeleteQuestions,
    bulkUpdateQuestionStatus,
    openQuestionExportDialog,
    exportQuestion,
    handleQuestionCommand,
    exportQuestions,
    confirmQuestionExport,
  };
}
