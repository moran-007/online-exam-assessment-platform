import { computed, onMounted, ref, watch } from 'vue';
import {
  Check,
  Close,
  Delete,
  Download,
  DocumentAdd,
  DocumentCopy,
  Edit,
  Hide,
  Link,
  MoreFilled,
  Plus,
  Refresh,
  Search,
  Upload,
  View,
} from '@element-plus/icons-vue';
import type {
  HydroSiteOption,
  QuestionRecord,
  QuestionStatus,
} from '../models';
import { useQuestionEditor } from './useQuestionEditor';
import { useQuestionFilters } from './useQuestionFilters';
import { useQuestionHydroBinding } from './useQuestionHydroBinding';
import { useQuestionLifecycle } from './useQuestionLifecycle';
import { useQuestionPractice } from './useQuestionPractice';
import { useQuestionSelection } from './useQuestionSelection';
import { useQuestionPageState } from './useQuestionPageState';

export function useQuestionPage() {
const {
  answerLayout,
  answerReference,
  blankAnswerRows,
  blankAnswerText,
  bulkQuestionStatus,
  canPullHydroProblem,
  correctChoiceKey,
  courses,
  editMode,
  editingId,
  editorTitle,
  editorVisible,
  entryMode,
  filter,
  filterKnowledgeTree,
  filterKnowledgeTreeOptions,
  form,
  formKnowledgeTree,
  formKnowledgeTreeOptions,
  formatDateTime,
  hydroAccounts,
  hydroPlatforms,
  hydroPulling,
  isChoice,
  isChoiceType,
  isEditing,
  items,
  materialCandidates,
  pageSizes,
  pagination,
  pendingExportQuestionIds,
  practiceAnswer,
  practiceChildAnswers,
  practiceChildResults,
  practiceDetail,
  practiceDialogWidth,
  practiceHydroAccountId,
  practiceProgrammingResult,
  practiceProgrammingSubmitLoading,
  practiceResult,
  practiceVisible,
  previewVisible,
  questionExportOptions,
  questionExportVisible,
  questionScope,
  quickTags,
  router,
  saving,
  selectedQuestionIds,
  selectedQuestionRows,
  showLowColumns,
  showMediumColumns,
  statusLabel,
  statusOptions,
  statusSegmentOptions,
  statusTagType,
  tags,
  typeLabel,
  typeOptions,
} = useQuestionPageState();

const practiceMatchedHydroAccounts = computed(() => matchedHydroAccountsFor(practiceDetail.value));
const hydroProblemUrl = computed(() => {
  const explicit = effectiveHydroProblemUrl(form.programmingRef);
  const problemId = form.programmingRef.externalProblemId?.trim();
  if (explicit) return explicit;
  const baseUrl = normalizeBaseUrl(form.programmingRef.platformBaseUrl || 'https://oj.example.com');
  const domainId = form.programmingRef.domainId?.trim();
  const domainPrefix = domainId && domainId !== 'system' ? `/d/${encodeURIComponent(domainId)}` : '';
  return problemId ? `${baseUrl}${domainPrefix}/p/${encodeURIComponent(problemId)}` : '';
});
const hydroAccountOptions = computed(() =>
  matchingHydroAccountsForRef(form.programmingRef).map((account) => ({
    ...account,
    label: `${account.loginUsername || account.hydroUsername || '外部账号'} · ${account.platformName || account.platformCode || 'Hydro'} · ${shortHost(account.platformBaseUrl)}`,
  })),
);
const hydroSiteOptions = computed(() => {
  const map = new Map<string, HydroSiteOption>();
  const pushSite = (site: Partial<HydroSiteOption> & { baseUrl?: string; platformBaseUrl?: string; code?: string; platformCode?: string; name?: string; platformName?: string }) => {
    const value = normalizeBaseUrl(site.value || site.baseUrl || site.platformBaseUrl);
    const host = canonicalHost(value);
    if (!host || map.has(host)) return;
    map.set(host, {
      key: host,
      value,
      judgeProvider: site.judgeProvider || site.code || site.platformCode || 'hydro',
      label: `${site.name || site.platformName || '外部平台'} (${shortHost(value)})`,
    });
  };
  hydroPlatforms.value.forEach((platform) => pushSite(platform));
  hydroAccounts.value.forEach((account) =>
    pushSite({
      value: account.platformBaseUrl,
      platformCode: account.platformCode,
      platformName: account.platformName ?? undefined,
    }),
  );
  return [...map.values()];
});
const selectedHydroAccount = computed(() =>
  hydroAccounts.value.find((account) => account.id === form.programmingRef.accountId) ?? null,
);
const hydroBindingLabel = computed(() => {
  const parts = [
    form.programmingRef.platformBaseUrl,
    `域 ${formatHydroDomainLabel(form.programmingRef)}`,
    form.programmingRef.accountLabel || selectedHydroAccount.value?.loginUsername,
  ].filter(Boolean);
  return parts.join(' / ');
});

watch(
  () => form.programmingRef.platformBaseUrl,
  (value) => {
    const account = selectedHydroAccount.value;
    if (account && value && !sameHydroBaseUrl(account.platformBaseUrl, value)) {
      form.programmingRef.accountId = '';
      form.programmingRef.accountLabel = '';
    }
  },
);

watch(
  () => form.programmingRef.externalProblemId,
  (value) => {
    const raw = String(value || '').trim();
    if (!raw || parseHydroProblemUrl(raw)) return;
    const currentProblemId = cleanHydroProblemId(raw);
    const explicitProblemId = problemIdFromHydroUrl(form.programmingRef.externalProblemUrl);
    if (explicitProblemId && explicitProblemId !== currentProblemId) {
      form.programmingRef.externalProblemUrl = '';
    }
  },
);

const {
  formatHydroDomainLabel,
  languageOptionsFor,
  languageLabel,
  programmingFeedbackType,
  programmingFeedbackTitle,
  loadHydroAccounts,
  loadHydroPlatforms,
  handleHydroAccountChange,
  handleHydroSiteChange,
  handleHydroProblemInputChange,
  buildProgrammingRefPayload,
  pullHydroProblem,
  openHydroProblemUrl,
  effectiveHydroProblemUrl,
  cleanHydroProblemId,
  parseHydroProblemUrl,
  problemIdFromHydroUrl,
  normalizeBaseUrl,
  shortHost,
  matchingHydroAccountsForRef,
  matchedHydroAccountsFor,
  defaultHydroAccountId,
  hydroPracticeAccountLabel,
  sameHydroBaseUrl,
  canonicalHost,
  hydroSourceLabel,
  openHydroProblem,
} = useQuestionHydroBinding({
  canPullHydroProblem,
  form,
  hydroAccounts,
  hydroPlatforms,
  hydroProblemUrl,
  hydroPulling,
  hydroSiteOptions,
  resetOptions,
  selectedHydroAccount,
});

const {
  openPracticeQuestion,
  editQuestionFromPractice,
  checkPracticeAnswer,
  submitPracticeProgrammingAnswer,
  updatePracticeAnswer,
  updatePracticeChildAnswers,
} = useQuestionPractice({
  defaultHydroAccountId,
  editMode,
  editQuestion,
  languageOptionsFor,
  practiceAnswer,
  practiceChildAnswers,
  practiceChildResults,
  practiceDetail,
  practiceHydroAccountId,
  practiceProgrammingResult,
  practiceProgrammingSubmitLoading,
  practiceResult,
  practiceVisible,
});

const {
  loadCourses,
  loadFormKnowledgeTree,
  handleFormCourseChange,
  loadMaterialCandidates,
  addMaterialChild,
  removeMaterialChild,
  isMaterialCandidateDisabled,
  handleFilterCourseChange,
  loadTags,
  load,
  refreshAll,
  loadFirstPage,
  handleQuestionSortChange,
  filterByTag,
  filterByKnowledgePoint,
  handleSizeChange,
  handleCurrentChange,
} = useQuestionFilters({
  courses,
  editingId,
  filter,
  filterKnowledgeTree,
  form,
  formKnowledgeTree,
  items,
  materialCandidates,
  pagination,
  questionScope,
  tags,
});

const editorApi = useQuestionEditor({
  addMaterialChild,
  answerReference,
  blankAnswerRows,
  blankAnswerText,
  buildProgrammingRefPayload,
  courses,
  editingId,
  editMode,
  editorVisible,
  entryMode,
  form,
  isChoice,
  isEditing,
  loadFormKnowledgeTree,
  loadMaterialCandidates,
  questionScope,
  refreshAll,
  saving,
  tags,
});

function resetOptions() {
  return editorApi.resetOptions();
}

function editQuestion(row: Pick<QuestionRecord, 'id'>) {
  return editorApi.editQuestion(row);
}

function closeEditor() {
  return editorApi.closeEditor();
}

const {
  addBlankAnswerRow,
  removeBlankAnswerRow,
  insertFormBlankMarker,
  addOption,
  removeOption,
  appendTag,
  insertCodeBlock,
  saveQuestion,
  copyQuestion,
  resetForm,
} = editorApi;

const lifecycleApi = useQuestionLifecycle({
  editMode,
  editingId,
  load,
  resetForm,
  statusLabel,
});

function changeStatus(row: QuestionRecord, status: QuestionStatus) {
  return lifecycleApi.changeStatus(row, status);
}

function removeQuestion(row: QuestionRecord) {
  return lifecycleApi.removeQuestion(row);
}

const {
  handleQuestionRowClick,
  handleSelectionChange,
  openRelatedExams,
  onEditModeChange,
  bulkDeleteQuestions,
  bulkUpdateQuestionStatus,
  openQuestionExportDialog,
  handleQuestionCommand,
  confirmQuestionExport,
} = useQuestionSelection({
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
});

onMounted(async () => {
  await Promise.all([loadCourses(), loadTags(), loadHydroPlatforms(), loadHydroAccounts()]);
  await load();
});

return {
  Check,
  Close,
  Delete,
  DocumentAdd,
  DocumentCopy,
  Download,
  Edit,
  Hide,
  Link,
  MoreFilled,
  Plus,
  Refresh,
  Search,
  Upload,
  View,
  addBlankAnswerRow,
  addMaterialChild,
  addOption,
  answerLayout,
  answerReference,
  appendTag,
  blankAnswerRows,
  bulkDeleteQuestions,
  bulkQuestionStatus,
  bulkUpdateQuestionStatus,
  canPullHydroProblem,
  checkPracticeAnswer,
  closeEditor,
  computed,
  confirmQuestionExport,
  copyQuestion,
  correctChoiceKey,
  courses,
  editMode,
  editQuestionFromPractice,
  editorTitle,
  editorVisible,
  entryMode,
  filter,
  filterByKnowledgePoint,
  filterByTag,
  filterKnowledgeTreeOptions,
  form,
  formKnowledgeTreeOptions,
  formatDateTime,
  formatHydroDomainLabel,
  handleCurrentChange,
  handleFilterCourseChange,
  handleFormCourseChange,
  handleHydroAccountChange,
  handleHydroProblemInputChange,
  handleHydroSiteChange,
  handleQuestionCommand,
  handleQuestionRowClick,
  handleQuestionSortChange,
  handleSelectionChange,
  handleSizeChange,
  hydroAccountOptions,
  hydroBindingLabel,
  hydroPracticeAccountLabel,
  hydroProblemUrl,
  hydroPulling,
  hydroSiteOptions,
  hydroSourceLabel,
  insertCodeBlock,
  insertFormBlankMarker,
  isChoice,
  isChoiceType,
  isEditing,
  isMaterialCandidateDisabled,
  items,
  languageLabel,
  languageOptionsFor,
  loadFirstPage,
  materialCandidates,
  onEditModeChange,
  openHydroProblem,
  openHydroProblemUrl,
  openPracticeQuestion,
  openQuestionExportDialog,
  openRelatedExams,
  pageSizes,
  pagination,
  pendingExportQuestionIds,
  practiceAnswer,
  practiceChildAnswers,
  practiceChildResults,
  practiceDetail,
  practiceDialogWidth,
  practiceHydroAccountId,
  practiceMatchedHydroAccounts,
  practiceProgrammingResult,
  practiceProgrammingSubmitLoading,
  practiceResult,
  practiceVisible,
  previewVisible,
  programmingFeedbackTitle,
  programmingFeedbackType,
  pullHydroProblem,
  questionExportOptions,
  questionExportVisible,
  questionScope,
  quickTags,
  ref,
  refreshAll,
  removeBlankAnswerRow,
  removeMaterialChild,
  removeOption,
  resetForm,
  resetOptions,
  router,
  saveQuestion,
  saving,
  selectedQuestionIds,
  showLowColumns,
  showMediumColumns,
  statusLabel,
  statusOptions,
  statusSegmentOptions,
  statusTagType,
  submitPracticeProgrammingAnswer,
  tags,
  typeLabel,
  typeOptions,
  updatePracticeAnswer,
  updatePracticeChildAnswers,
};
}
