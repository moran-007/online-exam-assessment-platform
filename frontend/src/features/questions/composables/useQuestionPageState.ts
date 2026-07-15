import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { createExportTask } from '../../exports/api';
import type { HydroAccountView, HydroPlatform, HydroSubmissionResult } from '../../hydro/models';
import { useResponsiveColumns } from '../../../composables/useResponsiveColumns';
import { emptyFillBlankRows, fillBlankAnswerTextFromRows, fillBlankRowsFromText } from '../../../utils/fillBlankAnswers';
import type {
  AnswerCheckResult,
  FillBlankRow,
  KnowledgePointTreeNode,
  KnowledgeTreeOption,
  NamedOption,
  PracticeAnswer,
  QuestionForm,
  QuestionRecord,
  QuestionStatus,
} from '../models';
import { useQuestionTypeOptions } from './useQuestionTypeOptions';
import { baseForm } from './questionFormFactory';
import { initialPracticeAnswer } from './useQuestionPractice';

export function useQuestionPageState() {
  const router = useRouter();
  const { showMediumColumns, showLowColumns } = useResponsiveColumns();
  const { typeOptions } = useQuestionTypeOptions();
  const statusOptions = [
    { label: '草稿', value: 'draft' },
    { label: '待审核', value: 'pending_review' },
    { label: '已公开', value: 'published' },
    { label: '已隐藏', value: 'disabled' },
  ];
  const statusSegmentOptions = statusOptions.map((item) => ({ label: item.label, value: item.value }));

  const courses = ref<NamedOption[]>([]);
  const tags = ref<NamedOption[]>([]);
  const formKnowledgeTree = ref<KnowledgePointTreeNode[]>([]);
  const filterKnowledgeTree = ref<KnowledgePointTreeNode[]>([]);
  const items = ref<QuestionRecord[]>([]);
  const materialCandidates = ref<QuestionRecord[]>([]);
  const blankAnswerRows = ref<FillBlankRow[]>(emptyFillBlankRows());
  const blankAnswerText = computed({
    get: () => fillBlankAnswerTextFromRows(blankAnswerRows.value),
    set: (value) => {
      blankAnswerRows.value = fillBlankRowsFromText(value);
    },
  });
  const answerReference = ref('');
  const previewVisible = ref(true);
  const entryMode = ref('single');
  const saving = ref(false);
  const hydroPulling = ref(false);
  const editingId = ref('');
  const editMode = ref(false);
  const editorVisible = ref(false);
  const selectedQuestionRows = ref<QuestionRecord[]>([]);
  const questionScope = ref('published');
  const filter = reactive({
    courseId: '',
    knowledgePointId: '',
    tagId: '',
    type: '',
    keyword: '',
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
  const pageSizes = [20, 50, 100];
  const bulkQuestionStatus = ref<QuestionStatus | ''>('');
  const questionExportVisible = ref(false);
  const pendingExportQuestionIds = ref<string[]>([]);
  const hydroAccounts = ref<HydroAccountView[]>([]);
  const hydroPlatforms = ref<HydroPlatform[]>([]);
  const questionExportOptions = reactive<{
    format: NonNullable<Parameters<typeof createExportTask>[0]['format']>;
    includeAnswers: boolean;
    includeAnalysis: boolean;
  }>({ format: 'zip', includeAnswers: true, includeAnalysis: true });
  const form = reactive<QuestionForm>(baseForm());
  const practiceVisible = ref(false);
  const practiceDetail = ref<QuestionRecord | null>(null);
  const practiceResult = ref<AnswerCheckResult | null>(null);
  const practiceProgrammingResult = ref<HydroSubmissionResult | null>(null);
  const practiceProgrammingSubmitLoading = ref(false);
  const practiceHydroAccountId = ref('');
  const answerLayout = ref('side');
  const practiceAnswer = reactive<PracticeAnswer>(initialPracticeAnswer());
  const practiceChildAnswers = reactive<Record<string, PracticeAnswer>>({});
  const practiceChildResults = reactive<Record<string, AnswerCheckResult>>({});

  const isEditing = computed(() => Boolean(editingId.value));
  const isChoice = computed(() => isChoiceType(form.type));
  const quickTags = computed(() => tags.value.slice(0, 3));
  const formKnowledgeTreeOptions = computed(() => convertKnowledgeTree(formKnowledgeTree.value));
  const filterKnowledgeTreeOptions = computed(() => convertKnowledgeTree(filterKnowledgeTree.value));
  const editorTitle = computed(() => (isEditing.value ? '编辑题目 / 复制题目' : '题目编辑'));
  const selectedQuestionIds = computed(() => selectedQuestionRows.value.map((row) => row.id));
  const practiceDialogWidth = computed(() => (answerLayout.value === 'side' ? '1180px' : '860px'));
  const canPullHydroProblem = computed(() =>
    Boolean(form.programmingRef.externalProblemId?.trim() || form.programmingRef.externalProblemUrl?.trim()),
  );
  const correctChoiceKey = computed({
    get: () => form.options.find((option) => option.isCorrect)?.optionKey ?? '',
    set: (value) => {
      form.options.forEach((option) => {
        option.isCorrect = option.optionKey === value;
      });
    },
  });

  function isChoiceType(type: string) {
    return ['single_choice', 'multiple_choice', 'true_false'].includes(type);
  }

  function typeLabel(value: string) {
    return typeOptions.find((item) => item.value === value)?.label ?? value ?? '';
  }

  function statusLabel(value: string) {
    return statusOptions.find((item) => item.value === value)?.label ?? value ?? '';
  }

  function statusTagType(value: string) {
    const map: Record<string, 'info' | 'warning' | 'success' | 'danger'> = {
      draft: 'info',
      pending_review: 'warning',
      published: 'success',
      disabled: 'danger',
    };
    return map[value] ?? 'info';
  }

  function formatDateTime(value?: string) {
    return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
  }

  function convertKnowledgeTree(nodes: KnowledgePointTreeNode[]): KnowledgeTreeOption[] {
    return nodes.map((item) => ({
      label: `${item.sortOrder ? `${item.sortOrder}. ` : ''}${item.name}`,
      value: item.id,
      children: convertKnowledgeTree(item.children ?? []),
    }));
  }

  return {
    answerLayout, answerReference, blankAnswerRows, blankAnswerText, bulkQuestionStatus,
    canPullHydroProblem, correctChoiceKey, courses, editMode, editingId, editorTitle,
    editorVisible, entryMode, filter, filterKnowledgeTree, filterKnowledgeTreeOptions,
    form, formKnowledgeTree, formKnowledgeTreeOptions, formatDateTime, hydroAccounts,
    hydroPlatforms, hydroPulling, isChoice, isChoiceType, isEditing, items,
    materialCandidates, pageSizes, pagination, pendingExportQuestionIds,
    practiceAnswer, practiceChildAnswers, practiceChildResults, practiceDetail,
    practiceDialogWidth, practiceHydroAccountId, practiceProgrammingResult,
    practiceProgrammingSubmitLoading, practiceResult, practiceVisible, previewVisible,
    questionExportOptions, questionExportVisible, questionScope, quickTags, router,
    saving, selectedQuestionIds, selectedQuestionRows, showLowColumns, showMediumColumns,
    statusLabel, statusOptions, statusSegmentOptions, statusTagType, tags, typeLabel,
    typeOptions,
  };
}
