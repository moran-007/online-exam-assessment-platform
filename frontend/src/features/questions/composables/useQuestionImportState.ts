import { computed, reactive, ref } from 'vue';
import { emptyFillBlankRows, fillBlankAnswerTextFromRows, fillBlankRowsFromText } from '../../../utils/fillBlankAnswers';
import type { UploadInstance } from 'element-plus';
import type { HydroAccountView, HydroPlatform } from '../../hydro/models';
import type {
  BatchPreviewRow,
  DuplicateCheckItem,
  FillBlankRow,
  KnowledgePointTreeNode,
  MaterialQuestionChild,
  NamedOption,
  PortableQuestion,
  QuestionAsset,
  QuestionAssetReport,
  QuestionOption,
  SingleQuestionForm,
} from '../models';

type MarkdownField = 'title' | 'content' | 'analysis' | 'answerText';
type MarkdownObject = SingleQuestionForm | MaterialQuestionChild | QuestionOption;
export type AssetInsertTarget =
  | { type: 'batch'; field: 'batchText' | 'batchAnswerText' | 'singleContent' }
  | { type: 'object'; target: MarkdownObject; field: MarkdownField };

export function useQuestionImportState(
  initialSingleForm: SingleQuestionForm,
  initialMaterialChild: MaterialQuestionChild,
) {
  const courses = ref<NamedOption[]>([]);
  const tags = ref<NamedOption[]>([]);
  const knowledgeTree = ref<KnowledgePointTreeNode[]>([]);
  const importMode = ref('single');
  const sharedCourseId = ref('');
  const sharedCourseTouched = ref(false);
  const sharedKnowledgePointIds = ref<string[]>([]);
  const sharedTagNames = ref<string[]>([]);
  const publishAfterImport = ref(true);
  const singleForm = reactive<SingleQuestionForm>(initialSingleForm);
  const blankAnswerRows = ref<FillBlankRow[]>(emptyFillBlankRows());
  const blankAnswerText = computed({
    get: () => fillBlankAnswerTextFromRows(blankAnswerRows.value),
    set: (value) => {
      blankAnswerRows.value = fillBlankRowsFromText(value);
    },
  });
  const blankCaseSensitive = ref(false);
  const blankSpaceSensitive = ref(false);
  const answerReference = ref('');
  const singleSaving = ref(false);
  const singleHydroPulling = ref(false);
  const singleDuplicateChecking = ref(false);
  const singleConflictResult = ref<DuplicateCheckItem | null>(null);
  const selectedMaterialChildIndex = ref(0);
  const materialChildDialogVisible = ref(false);
  const materialEditingChildIndex = ref(-1);
  const materialChildDraft = reactive<MaterialQuestionChild>(initialMaterialChild);
  const batchText = ref('');
  const batchAnswerText = ref('');
  const batchPreview = ref<BatchPreviewRow[]>([]);
  const batchErrorSummary = ref('');
  const structuredBatchQuestions = ref<PortableQuestion[]>([]);
  const removedBatchRowKeys = ref<Set<string>>(new Set());
  const selectedPreviewIndex = ref(0);
  const importing = ref(false);
  const duplicateChecking = ref(false);
  const uploadedAssets = ref<QuestionAsset[]>([]);
  const uploadingAsset = ref(false);
  const assetDrawerVisible = ref(false);
  const assetInsertTarget = ref<AssetInsertTarget | null>(null);
  const hydroAccounts = ref<HydroAccountView[]>([]);
  const hydroPlatforms = ref<HydroPlatform[]>([]);
  const portableUploadRef = ref<UploadInstance | null>(null);
  const portableUploadKey = ref(0);
  const assetUploadRef = ref<UploadInstance | null>(null);
  const assetDrawerUploadRef = ref<UploadInstance | null>(null);
  const assetUploadKey = ref(0);
  const assetReport = ref<QuestionAssetReport | null>(null);
  const assetReportLoading = ref(false);
  const assetCleanupLoading = ref(false);

  return {
    courses, tags, knowledgeTree, importMode, sharedCourseId, sharedCourseTouched,
    sharedKnowledgePointIds, sharedTagNames, publishAfterImport, singleForm,
    blankAnswerRows, blankAnswerText, blankCaseSensitive, blankSpaceSensitive,
    answerReference, singleSaving, singleHydroPulling, singleDuplicateChecking,
    singleConflictResult, selectedMaterialChildIndex, materialChildDialogVisible,
    materialEditingChildIndex, materialChildDraft, batchText, batchAnswerText,
    batchPreview, batchErrorSummary, structuredBatchQuestions, removedBatchRowKeys,
    selectedPreviewIndex, importing, duplicateChecking, uploadedAssets,
    uploadingAsset, assetDrawerVisible, assetInsertTarget, hydroAccounts,
    hydroPlatforms, portableUploadRef, portableUploadKey, assetUploadRef,
    assetDrawerUploadRef, assetUploadKey, assetReport, assetReportLoading,
    assetCleanupLoading,
  };
}
