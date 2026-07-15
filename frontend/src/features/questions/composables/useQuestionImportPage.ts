import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Back, Delete, DocumentAdd, DocumentCopy, Edit, Link, Plus, Refresh, Upload, View } from '@element-plus/icons-vue';
import { listQuestionCourses, listQuestionTags } from '../api';
import { listHydroPlatforms } from '../../hydro/api';
import { useQuestionTypeOptions } from '../composables/useQuestionTypeOptions';
import { useDuplicateDetection } from './useDuplicateDetection';
import { useHydroQuestionReference } from './useHydroQuestionReference';
import { useMaterialChildren } from './useMaterialChildren';
import { useQuestionAssets } from './useQuestionAssets';
import { usePortableImport } from './usePortableImport';
import { useQuestionBatchParser } from './useQuestionBatchParser';
import { useSingleQuestionDraft } from './useSingleQuestionDraft';
import { useBatchQuestionImport } from './useBatchQuestionImport';
import { useQuestionImportCatalog } from './useQuestionImportCatalog';
import { useQuestionImportState } from './useQuestionImportState';
import {
  baseSingleForm as createBaseSingleForm,
  createMaterialChildDraft as createMaterialChildDraftValue,
  normalizeQuestionImportType,
  readRememberedSingleType as readRememberedSingleTypeValue,
  rememberSingleType as rememberSingleTypeValue,
} from './questionImportFormFactory';
import type {
  BatchPreviewRow,
  HydroSiteOption,
  QuestionAnswer,
  QuestionChild,
  QuestionMutationPayload,
} from '../models';

type QuestionValidationPayload = Omit<Pick<QuestionMutationPayload, 'courseId' | 'courseName' | 'type' | 'title' | 'content' | 'difficulty' | 'defaultScore' | 'options' | 'answer' | 'inlineChildren'>, 'answer'> & {
  answer?: QuestionAnswer | null;
  children?: QuestionChild[];
  knowledgePointIds?: string[];
  knowledgePointNames?: string[];
};

function errorMessage(error: unknown, fallback = '操作失败') {
  return error instanceof Error ? error.message : fallback;
}

export function useQuestionImportPage() {
const router = useRouter();
const { typeOptions, materialChildTypeOptions } = useQuestionTypeOptions(true);

const formatSnippets = {
  'math-inline': '$a^2 + b^2 = c^2$',
  'math-block': ['$$', 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', '$$'].join('\n'),
  'chem-inline': '@chem{H2SO4}',
  'chem-equation': '@chem{2H2 + O2 -> 2H2O}',
  symbols: '≤ ≥ ≠ ≈ ± × ÷ √ ∑ ∞ ° ℃ → ← ↔ ∴ ∵ α β γ Δ Ω',
  table: ['| 项目 | 内容 |', '| --- | --- |', '| 条件 | $x > 0$ |', '| 结论 | @chem{CO2} |'].join('\n'),
};

const state = useQuestionImportState(
  createBaseSingleForm(typeOptions),
  createMaterialChildDraftValue(),
);

const knowledgeTreeOptions = computed(() => catalog.convertKnowledgeTree(state.knowledgeTree.value));
const selectedKnowledgeNames = computed(() => {
  const map = new Map(catalog.flattenKnowledgeTree(state.knowledgeTree.value).map((item) => [item.id, item.name]));
  return state.sharedKnowledgePointIds.value.map((id) => map.get(id)).filter(catalog.isMeaningfulName);
});
const isSingleChoice = computed(() => catalog.isChoiceType(state.singleForm.type));
const importableBatchCount = computed(
  () => state.batchPreview.value.filter((row) => row.valid !== false && !duplicates.shouldSkipBatchRow(row)).length,
);
const selectedBatchQuestion = computed(() => state.batchPreview.value[state.selectedPreviewIndex.value] ?? state.batchPreview.value[0]);
const singlePreviewQuestion = computed(() => buildSinglePreview());
const singleMaterialScore = computed(() =>
  state.singleForm.children.reduce((sum, child) => sum + Math.max(0, Number(child.score) || 0), 0),
);
const selectedMaterialChild = computed(() => state.singleForm.children[state.selectedMaterialChildIndex.value] ?? null);
const materialChildDialogTitle = computed(() =>
  state.materialEditingChildIndex.value >= 0
    ? `编辑第 ${state.materialEditingChildIndex.value + 1} 道子题`
    : '添加子题',
);
const referenceAnswerRows = computed(() => Math.min(8, Math.max(3, Number(state.singleForm.answerRows) || 4)));
const draftAnswerEditorRows = computed(() => Math.min(10, Math.max(3, Number(state.materialChildDraft.answerRows) || 4)));
const singleEntryTip = computed(() => catalog.entryTipForType(state.singleForm.type));
const hasMaterialFillBlankChild = computed(() =>
  state.singleForm.type === 'material' && state.singleForm.children.some((child) => child.type === 'fill_blank'),
);
const singleHydroProblemUrl = computed(() => {
  const explicit = hydro.effectiveHydroProblemUrl(state.singleForm.programmingRef);
  const problemId = state.singleForm.programmingRef.externalProblemId?.trim();
  if (explicit) return explicit;
  const baseUrl = hydro.normalizeBaseUrl(state.singleForm.programmingRef.platformBaseUrl || 'https://oj.example.com');
  const domainId = state.singleForm.programmingRef.domainId?.trim();
  const domainPrefix = domainId && domainId !== 'system' ? `/d/${encodeURIComponent(domainId)}` : '';
  return problemId ? `${baseUrl}${domainPrefix}/p/${encodeURIComponent(problemId)}` : '';
});
const hydroAccountOptions = computed(() =>
  hydro.matchingHydroAccountsForRef(state.singleForm.programmingRef).map((account) => ({
    ...account,
    label: `${account.loginUsername || account.hydroUsername || '外部账号'} · ${account.platformName || account.platformCode || 'Hydro'} · ${hydro.shortHost(account.platformBaseUrl)}`,
  })),
);
const hydroSiteOptions = computed(() => {
  const map = new Map<string, HydroSiteOption>();
  const pushSite = (site: Partial<HydroSiteOption> & { baseUrl?: string; platformBaseUrl?: string; code?: string; platformCode?: string; name?: string; platformName?: string }) => {
    const value = hydro.normalizeBaseUrl(site.value || site.baseUrl || site.platformBaseUrl);
    const host = hydro.canonicalHost(value);
    if (!host || map.has(host)) return;
    map.set(host, {
      key: host,
      value,
      judgeProvider: site.judgeProvider || site.code || site.platformCode || 'hydro',
      label: `${site.name || site.platformName || '外部平台'} (${hydro.shortHost(value)})`,
    });
  };
  state.hydroPlatforms.value.forEach((platform) => pushSite(platform));
  state.hydroAccounts.value.forEach((account) =>
    pushSite({
      value: account.platformBaseUrl,
      platformCode: account.platformCode,
      platformName: account.platformName ?? undefined,
    }),
  );
  return [...map.values()];
});
const selectedSingleHydroAccount = computed(() =>
  state.hydroAccounts.value.find((account) => account.id === state.singleForm.programmingRef.accountId) ?? null,
);
const singleHydroBindingLabel = computed(() => {
  const parts = [
    state.singleForm.programmingRef.platformBaseUrl,
    `域 ${hydro.formatHydroDomainLabel(state.singleForm.programmingRef)}`,
    state.singleForm.programmingRef.accountLabel || selectedSingleHydroAccount.value?.loginUsername,
  ].filter(Boolean);
  return parts.join(' / ');
});

const canPullSingleHydroProblem = computed(() =>
  Boolean(state.singleForm.programmingRef.externalProblemId?.trim() || state.singleForm.programmingRef.externalProblemUrl?.trim()),
);
const singlePreviewError = computed(() => {
  try {
    validatePayload(singlePreviewQuestion.value, '当前题目');
    return '';
  } catch (error) {
    return errorMessage(error, '题目内容校验失败');
  }
});
const singleConflictStatus = computed(() => state.singleConflictResult.value?.status ?? '');
const singleConflictMessage = computed(() => {
  const result = state.singleConflictResult.value;
  if (!result || result.status === 'ok') return '';
  const prefix = result.status === 'conflict' ? '检测到冲突' : result.status === 'duplicate' ? '检测到重复' : '检测到相似题';
  return `${prefix}：${result.message}`;
});
const correctChoiceKey = computed({
  get() {
    return state.singleForm.options.find((option) => option.isCorrect)?.optionKey ?? '';
  },
  set(value) {
    state.singleForm.options.forEach((option) => {
      option.isCorrect = option.optionKey === value;
    });
  },
});

const normalizeType = normalizeQuestionImportType;

function baseSingleForm() {
  return createBaseSingleForm(typeOptions);
}

function readRememberedSingleType() {
  return readRememberedSingleTypeValue(typeOptions);
}

function rememberSingleType(type: string) {
  return rememberSingleTypeValue(type, typeOptions);
}

function createMaterialChildDraft(type = 'short_answer') {
  return createMaterialChildDraftValue(type);
}

async function loadBaseData() {
  const [coursePage, tagPage, platformPage] = await Promise.all([
    listQuestionCourses(),
    listQuestionTags(),
    listHydroPlatforms().catch(() => []),
  ]);
  state.courses.value = coursePage.items;
  state.tags.value = tagPage.items;
  state.hydroPlatforms.value = Array.isArray(platformPage) ? platformPage : [];
  state.sharedCourseId.value = state.sharedCourseId.value || state.courses.value[0]?.id || '';
  await catalog.loadKnowledgeTree();
  await hydro.loadHydroAccounts();
  hydro.syncSingleHydroAccountForSite();
  refreshPreview();
}

watch(
  () => state.singleForm.programmingRef.platformBaseUrl,
  (value) => {
    const account = selectedSingleHydroAccount.value;
    if (account && value && !hydro.sameHydroBaseUrl(account.platformBaseUrl, value)) {
      state.singleForm.programmingRef.accountId = '';
      state.singleForm.programmingRef.accountLabel = '';
    }
  },
);

watch(
  () => state.singleForm.programmingRef.externalProblemId,
  (value) => {
    const raw = String(value || '').trim();
    if (!raw || hydro.parseHydroProblemUrl(raw)) return;
    const currentProblemId = hydro.cleanHydroProblemId(raw);
    const explicitProblemId = hydro.problemIdFromHydroUrl(state.singleForm.programmingRef.externalProblemUrl);
    if (explicitProblemId && explicitProblemId !== currentProblemId) {
      state.singleForm.programmingRef.externalProblemUrl = '';
    }
  },
);

function batchRowClass({ row }: { row: BatchPreviewRow }) {
  if (row.valid === false) return 'batch-row-error';
  if (duplicates.shouldSkipBatchRow(row)) return 'batch-row-skip';
  return '';
}

function validatePayload(payload: QuestionValidationPayload, label: string) {
  return batchParserApi.validatePayload(payload, label);
}

const catalog = useQuestionImportCatalog({ ...state, typeOptions, refreshPreview });
const assets = useQuestionAssets({ ...state, refreshPreview });
const duplicates = useDuplicateDetection({
  ...state,
  isChoiceType: catalog.isChoiceType,
  normalizeType,
  optionKeyForIndex: catalog.optionKeyForIndex,
  refreshPreview,
  singlePreviewError,
  singlePreviewQuestion,
});
const material = useMaterialChildren({
  ...state,
  createMaterialChildDraft,
  selectedCourseName: catalog.selectedCourseName,
  selectedKnowledgeNames,
  setImageInsertTarget: assets.setImageInsertTarget,
  validatePayload,
});
const hydro = useHydroQuestionReference({
  ...state,
  canPullSingleHydroProblem,
  hydroSiteOptions,
  refreshPreview,
  resetSingleOptions,
  scheduleSingleDuplicateCheck: duplicates.scheduleSingleDuplicateCheck,
  selectedSingleHydroAccount,
  singleHydroProblemUrl,
});
const portable = usePortableImport({
  ...state,
  isChoiceType: catalog.isChoiceType,
  isMeaningfulName: catalog.isMeaningfulName,
  mergeIds: catalog.mergeIds,
  mergeTags: catalog.mergeTags,
  normalizeCourseName: catalog.normalizeCourseName,
  normalizeProgrammingRef: hydro.normalizeProgrammingRef,
  normalizeType,
  optionKeyForIndex: catalog.optionKeyForIndex,
  parseTagNames: catalog.parseTagNames,
  refreshPreview,
  resolveCourseIdForImportedQuestion: catalog.resolveCourseIdForImportedQuestion,
  resolveKnowledgePointIdsByName: catalog.resolveKnowledgePointIdsByName,
  selectedCourseName: catalog.selectedCourseName,
  selectedKnowledgeNames,
  typeLabel: catalog.typeLabel,
  uploadAssetFile: assets.uploadAssetFile,
  validatePayload,
});
const batchParserApi = useQuestionBatchParser({
  ...state,
  blankAnswerOptions: catalog.blankAnswerOptions,
  buildProgrammingRefFromValues: hydro.buildProgrammingRefFromValues,
  extractField: catalog.extractField,
  isChoiceType: catalog.isChoiceType,
  isTextAnswerType: catalog.isTextAnswerType,
  mergeIds: catalog.mergeIds,
  mergeTags: catalog.mergeTags,
  normalizeAnswerRows: catalog.normalizeAnswerRows,
  normalizeCourseName: catalog.normalizeCourseName,
  normalizeType,
  optionKeyForIndex: catalog.optionKeyForIndex,
  parseAnswerKeys: catalog.parseAnswerKeys,
  parseTagNames: catalog.parseTagNames,
  resolveCourseIdForImportedQuestion: catalog.resolveCourseIdForImportedQuestion,
  resolveKnowledgePointIdsByName: catalog.resolveKnowledgePointIdsByName,
  selectedCourseName: catalog.selectedCourseName,
  selectedKnowledgeNames,
  typeLabel: catalog.typeLabel,
});

const singleDraftApi = useSingleQuestionDraft({
  ...state,
  baseSingleForm,
  blankAnswerOptions: catalog.blankAnswerOptions,
  buildMaterialInlineChildrenPayload: material.buildMaterialInlineChildrenPayload,
  buildSingleProgrammingRefPayload: hydro.buildSingleProgrammingRefPayload,
  isChoiceType: catalog.isChoiceType,
  isTextAnswerType: catalog.isTextAnswerType,
  normalizeAnswerRows: catalog.normalizeAnswerRows,
  optionKeyForIndex: catalog.optionKeyForIndex,
  rememberSingleType,
  resolveTagIds: catalog.resolveTagIds,
  runSingleDuplicateCheck: duplicates.runSingleDuplicateCheck,
  selectedCourseName: catalog.selectedCourseName,
  selectedKnowledgeNames,
  singleConflictMessage,
  singleMaterialScore,
  validatePayload,
  setImageInsertTarget: assets.setImageInsertTarget,
});

function buildSinglePreview() {
  return singleDraftApi.buildSinglePreview();
}

function resetSingleOptions() {
  return singleDraftApi.resetSingleOptions();
}

const batchImportApi = useBatchQuestionImport({
  ...state,
  appendMarkdownText: assets.appendMarkdownText,
  appendMarkdownToObject: assets.appendMarkdownToObject,
  buildPortablePreviewRow: portable.buildPortablePreviewRow,
  filterRemovedBatchRows: duplicates.filterRemovedBatchRows,
  formatBatchErrors: catalog.formatBatchErrors,
  formatSnippets,
  mergeIds: catalog.mergeIds,
  mergeTags: catalog.mergeTags,
  parseBatchResult: batchParserApi.parseBatchResult,
  questionPayload: singleDraftApi.questionPayload,
  resolveTagIds: catalog.resolveTagIds,
  runDuplicateCheck: duplicates.runDuplicateCheck,
  selectedKnowledgeNames,
  setBatchInsertTarget: assets.setBatchInsertTarget,
  setImageInsertTarget: assets.setImageInsertTarget,
  shouldSkipBatchRow: duplicates.shouldSkipBatchRow,
  withBatchRowKey: duplicates.withBatchRowKey,
});

function refreshPreview() {
  return batchImportApi.refreshPreview();
}

watch(
  () => (state.importMode.value === 'single' ? JSON.stringify(duplicates.buildDuplicateCheckPayload(singlePreviewQuestion.value)) : state.importMode.value),
  () => duplicates.scheduleSingleDuplicateCheck(),
);

onBeforeUnmount(() => {
  duplicates.disposeDuplicateDetection();
  state.uploadedAssets.value.forEach(assets.releaseAssetPreview);
});

onMounted(async () => {
  await loadBaseData();
  if (readRememberedSingleType()) {
    resetSingleOptions();
  } else {
    singleDraftApi.loadSingleTemplate();
  }
  batchImportApi.loadBatchTemplate();
  assets.setImageInsertTarget(state.singleForm, 'content');
});

return {
  Back, Delete, DocumentAdd, DocumentCopy, Edit, Link, Plus, Refresh, Upload, View,
  router, typeOptions, materialChildTypeOptions, ...state, ...catalog, ...assets,
  ...duplicates, ...material, ...hydro, ...portable, ...singleDraftApi, ...batchImportApi,
  knowledgeTreeOptions, selectedKnowledgeNames, isSingleChoice, importableBatchCount,
  selectedBatchQuestion, singlePreviewQuestion, singleMaterialScore, selectedMaterialChild,
  materialChildDialogTitle, referenceAnswerRows, draftAnswerEditorRows, singleEntryTip,
  hasMaterialFillBlankChild, singleHydroProblemUrl, hydroAccountOptions, hydroSiteOptions,
  selectedSingleHydroAccount, singleHydroBindingLabel, canPullSingleHydroProblem,
  singlePreviewError, singleConflictStatus, singleConflictMessage, correctChoiceKey,
  loadBaseData, batchRowClass, buildSinglePreview, resetSingleOptions, refreshPreview,
};
}
