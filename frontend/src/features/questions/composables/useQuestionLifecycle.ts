import type { Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  getQuestionDeleteImpact,
  publishQuestion,
  removeQuestion as removeQuestionRequest,
  updateQuestion,
} from '../api';
import type { QuestionRecord, QuestionStatus } from '../models';

type LifecycleState = {
  editMode: Ref<boolean>;
  editingId: Ref<string>;
  load: () => Promise<void>;
  resetForm: () => void;
  statusLabel: (value: string) => string;
};

export function useQuestionLifecycle(state: LifecycleState) {
  const { editMode, editingId, load, resetForm, statusLabel } = state;

  function errorMessage(error: unknown, fallback = '操作失败') {
    return error instanceof Error ? error.message : fallback;
  }

  async function changeStatus(row: QuestionRecord, status: QuestionStatus) {
    try {
      if (editMode.value) {
        await ElMessageBox.confirm(
          `风险操作提示：将“${row.title}”设置为${statusLabel(status)}会影响题库可见性和后续组卷，已生成试卷快照不会自动同步。`,
          '确认状态变更',
          {
            type: 'warning',
            confirmButtonText: `设置为${statusLabel(status)}`,
            cancelButtonText: '取消',
          },
        );
      }
      if (status === 'published') {
        await publishQuestion(row.id);
      } else {
        await updateQuestion(row.id, { status });
      }
      ElMessage.success(`已设置为${statusLabel(status)}`);
      await load();
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error(errorMessage(error));
      }
    }
  }

  async function removeQuestion(row: QuestionRecord) {
    try {
      const impact = await getQuestionDeleteImpact(row.id);
      const references = impact.references || {};
      const resources = impact.resources || [];
      const risks = impact.risks || [];
      const relatedPaperNames = (impact.relatedPapers || []).slice(0, 5).map((paper) => paper.name).join('、');
      const resourceReferenceCount = resources.reduce((sum, item) => sum + Number(item.referenceCount || 0), 0);
      const resourceLocations = resources
        .flatMap((item) => item.locations || [])
        .slice(0, 3)
        .join('；');
      const lines = [
        `试卷引用：${references.paperCount || 0} 份 / ${references.paperQuestionCount || 0} 个位置`,
        ...(relatedPaperNames ? [`关联试卷：${relatedPaperNames}${impact.relatedPapers.length > 5 ? ' 等' : ''}`] : []),
        `关联考试：${references.examCount || 0} 场，其中进行中或已安排 ${references.activeExamCount || 0} 场`,
        `试卷快照：${references.paperInstanceCount || 0} 份`,
        `答题记录：${references.answerRecordCount || 0} 条，错题记录：${references.wrongQuestionCount || 0} 条`,
        `资源引用：${resources.length} 个资源 / ${resourceReferenceCount} 处引用${resources.some((item) => !item.managed) ? '（含未纳管资源）' : ''}`,
        ...(resourceLocations ? [`资源位置：${resourceLocations}`] : []),
        ...risks,
      ];
      await ElMessageBox.confirm(
        `确认删除题目“${row.title}”？\n\n${lines.join('\n')}\n\n删除后题目会归档，并从上述试卷中同步移除；历史答卷和已生成的考试快照仍会保留。`,
        '删除题目风险确认',
        {
          type: 'warning',
          confirmButtonText: '确认删除',
          cancelButtonText: '取消',
        },
      );
      const result = await removeQuestionRequest(row.id);
      ElMessage.success(result.message || '已删除');
      if (editingId.value === row.id) resetForm();
      await load();
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error(errorMessage(error, '已取消'));
      }
    }
  }

  return { changeStatus, removeQuestion };
}
