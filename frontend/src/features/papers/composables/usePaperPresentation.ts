import { computed } from 'vue';
import {
  statusDescription,
  statusLabel,
  statusTransitionOptions,
} from '../../../statusMeta';
import type {
  EditablePaperDetail,
  KnowledgeTreeNode,
  KnowledgeTreeOption,
  PaperDetail,
  PaperQuestion,
  PaperQuestionSnapshot,
} from '../models';
import type { usePaperPageState } from './usePaperPageState';

type State = ReturnType<typeof usePaperPageState>;

export function usePaperPresentation(state: State) {
  const safeDetail = computed<EditablePaperDetail>(() => state.detail.value ?? {
    id: '', name: '', courseId: '', durationMinutes: 0, status: '', sections: [], questions: [],
  });
  const canEditPaper = computed(() => state.detail.value?.status === 'draft');
  const canEditSnapshot = computed(() => Boolean(state.detail.value?.canEditSnapshots));
  const snapshotEditTip = computed(() =>
    state.detail.value?.snapshotEditReason || '当前试卷暂不能修改显示内容',
  );
  const paperCurrentStatusDescription = computed(() =>
    state.detail.value ? statusDescription('paper', state.detail.value.status) : '',
  );
  const displaySections = computed(() => {
    if (!state.detail.value) return [];
    const sections = (state.detail.value.sections ?? [])
      .filter((section) => section.questions?.length)
      .map((section) => ({
        key: section.id || section.title,
        title: section.title,
        score: section.score,
        questions: section.questions,
      }));
    if (state.detail.value.questions?.length) {
      sections.push({
        key: 'unsectioned',
        title: '未分区题目',
        score: state.detail.value.questions.reduce((sum, question) => sum + Number(question.score ?? 0), 0),
        questions: state.detail.value.questions,
      });
    }
    return sections;
  });
  const totalQuestionCount = computed(() =>
    displaySections.value.reduce((sum, section) => sum + section.questions.length, 0),
  );
  const bulkKnowledgeTreeOptions = computed(() => convertKnowledgeTree(state.bulkKnowledgeTree.value));

  function paperStatusTargets(row?: unknown) {
    return statusTransitionOptions('paper', rowRecord(row).status);
  }

  function examUsageCount(row?: unknown) {
    const record = rowRecord(row);
    const count = rowRecord(record._count);
    return Number(record.examUsageCount ?? count.exams ?? 0);
  }

  function examUsageLabel(row?: unknown) {
    const count = examUsageCount(row);
    return count > 0 ? `占用 ${count} 场` : '未占用';
  }

  function examUsageType(row?: unknown) {
    return examUsageCount(row) > 0 ? 'warning' : 'info';
  }

  function paperStatusActionText(currentStatus: string, targetStatus: string) {
    const map: Record<string, string> = {
      'draft->published': '公开试卷', 'draft->archived': '归档试卷',
      'published->draft': '转回草稿', 'published->archived': '归档试卷',
      'archived->draft': '恢复草稿',
    };
    return map[`${currentStatus}->${targetStatus}`] ?? `设为${statusLabel('paper', targetStatus)}`;
  }

  function paperScopeForStatus(status: string) {
    return status === 'draft' || status === 'archived' ? status : 'published';
  }

  function snapshot(paperQuestion: PaperQuestion): PaperQuestionSnapshot {
    return paperQuestion.questionSnapshotJson ?? {};
  }

  function formatDateTime(value?: string | null) {
    return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
  }

  function decoratePaperDetail(paper: PaperDetail): EditablePaperDetail {
    const decorateQuestion = (question: PaperQuestion, sectionTitle: string): PaperQuestion => ({
      ...question,
      editScore: Number(question.score),
      editSectionTitle: sectionTitle,
    });
    return {
      ...paper,
      sections: (paper.sections ?? []).map((section) => ({
        ...section,
        questions: (section.questions ?? []).map((question) => decorateQuestion(question, section.title)),
      })),
      questions: (paper.questions ?? []).map((question) => decorateQuestion(question, '')),
    };
  }

  function convertKnowledgeTree(items: KnowledgeTreeNode[]): KnowledgeTreeOption[] {
    return items.map((item) => ({
      label: `${item.sortOrder ? `${item.sortOrder}. ` : ''}${item.name}`,
      value: item.id,
      children: convertKnowledgeTree(item.children ?? []),
    }));
  }

  return {
    safeDetail, canEditPaper, canEditSnapshot, snapshotEditTip, paperCurrentStatusDescription,
    displaySections, totalQuestionCount, bulkKnowledgeTreeOptions, paperStatusTargets,
    examUsageCount, examUsageLabel, examUsageType, paperStatusActionText,
    paperScopeForStatus, snapshot, formatDateTime, decoratePaperDetail,
  };
}

function rowRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
