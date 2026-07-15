import type { ComputedRef, Ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  buildFillBlankAnswer,
  emptyFillBlankRows,
  fillBlankAnswerTextFromRows,
} from '../../../utils/fillBlankAnswers';
import type {
  MaterialQuestionChild,
  QuestionAnswer,
  QuestionChild,
  QuestionMutationPayload,
  QuestionOption,
  SingleQuestionForm,
} from '../models';

type ValidatedInlineChild = QuestionChild & Required<Pick<QuestionChild, 'type' | 'title' | 'content' | 'difficulty'>>;
type QuestionValidationPayload = Omit<
  Pick<QuestionMutationPayload, 'courseId' | 'courseName' | 'type' | 'title' | 'content' | 'difficulty' | 'defaultScore' | 'options' | 'answer' | 'inlineChildren'>,
  'answer'
> & { answer?: QuestionAnswer | null; children?: QuestionChild[]; knowledgePointIds?: string[]; knowledgePointNames?: string[] };

type MaterialState = {
  singleForm: SingleQuestionForm;
  answerReference: Ref<string>;
  blankCaseSensitive: Ref<boolean>;
  blankSpaceSensitive: Ref<boolean>;
  selectedMaterialChildIndex: Ref<number>;
  materialChildDialogVisible: Ref<boolean>;
  materialEditingChildIndex: Ref<number>;
  materialChildDraft: MaterialQuestionChild;
  sharedCourseId: Ref<string>;
  sharedKnowledgePointIds: Ref<string[]>;
  selectedKnowledgeNames: ComputedRef<string[]>;
  createMaterialChildDraft: (type?: string) => MaterialQuestionChild;
  selectedCourseName: (courseId: string) => string;
  setImageInsertTarget: (target: SingleQuestionForm | MaterialQuestionChild | QuestionOption, field: 'title' | 'content' | 'analysis' | 'answerText') => void;
  validatePayload: (payload: QuestionValidationPayload, label: string) => void;
};

export function useMaterialChildren(state: MaterialState) {
  const {
    answerReference,
    blankCaseSensitive,
    blankSpaceSensitive,
    createMaterialChildDraft,
    materialChildDialogVisible,
    materialChildDraft,
    materialEditingChildIndex,
    selectedCourseName,
    selectedKnowledgeNames,
    selectedMaterialChildIndex,
    setImageInsertTarget,
    sharedCourseId,
    sharedKnowledgePointIds,
    singleForm,
    validatePayload,
  } = state;
  let materialChildLocalId = 1;

  function errorMessage(error: unknown, fallback = '操作失败') {
    return error instanceof Error ? error.message : fallback;
  }

  function isChoiceType(type: string) {
    return ['single_choice', 'multiple_choice', 'true_false'].includes(type);
  }

  function isTextAnswerType(type: string) {
    return ['short_answer', 'programming', 'file_upload'].includes(type);
  }

  function normalizeAnswerRows(value: unknown, fallback = 6) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(12, Math.max(2, Math.round(number))) : fallback;
  }

  function optionKeyForIndex(index: number) {
    return index < 26 ? String.fromCharCode(65 + index) : 'X' + (index + 1);
  }

  function countBlankMarkers(content?: string) {
    const matches = String(content || '').match(/_{3,}|\(\s*\)|（\s*）|\[\s*\]/g);
    return matches?.length || 0;
  }

  function blankAnswerOptions() {
    return {
      ignoreCase: !blankCaseSensitive.value,
      trimSpace: !blankSpaceSensitive.value,
    };
  }

  function buildMaterialInlineChildrenPayload(): ValidatedInlineChild[] {
    return singleForm.children.map((child, index) => materialInlineChildPayload(child, index));
  }

  function materialInlineChildPayload(child: MaterialQuestionChild, index = 0): ValidatedInlineChild {
    const payload: ValidatedInlineChild = {
      type: child.type,
      title: String(child.title || '').trim(),
      content: String(child.content || '').trim(),
      difficulty: Number(child.difficulty || singleForm.difficulty || 1),
      score: Number(child.score || 0),
      analysis: String(child.analysis || '').trim(),
      allowOptionShuffle: true,
      sortOrder: index + 1,
    };

    if (isChoiceType(child.type)) {
      payload.options = (child.options ?? []).map((option, optionIndex) => ({
        optionKey: option.optionKey || optionKeyForIndex(optionIndex),
        content: String(option.content || '').trim(),
        isCorrect: Boolean(option.isCorrect),
        sortOrder: optionIndex + 1,
      }));
    } else if (child.type === 'fill_blank') {
      payload.answer = buildMaterialChildFillBlankAnswer(child);
    } else if (isTextAnswerType(child.type)) {
      payload.answer = {
        reference: String(child.answerText || '').trim(),
        rows: normalizeAnswerRows(child.answerRows),
      };
    } else if (String(child.answerText || '').trim()) {
      payload.answer = { reference: String(child.answerText).trim() };
    }

    return payload;
  }

  function buildMaterialChildFillBlankAnswer(child: MaterialQuestionChild): QuestionAnswer {
    try {
      return buildFillBlankAnswer(fillBlankAnswerTextFromRows(child.blankRows ?? []), child.score, blankAnswerOptions());
    } catch {
      const markerCount = countBlankMarkers(child.content);
      const rowCount = Math.max(1, markerCount);
      const blankScore = rowCount ? Number(child.score || 0) / rowCount : Number(child.score || 0);
      return {
        blanks: Array.from({ length: rowCount }, (_, index) => ({
          index: index + 1,
          answers: [],
          ignoreCase: !blankCaseSensitive.value,
          trimSpace: !blankSpaceSensitive.value,
          score: blankScore,
        })),
      };
    }
  }

  function convertShortAnswerToMaterial() {
    const child = baseMaterialInlineChild(1, 'short_answer');
    child.title = singleForm.title ? `${singleForm.title}：第 1 问` : '第 1 问';
    child.content = '请根据大题说明作答。';
    child.difficulty = Number(singleForm.difficulty || 1);
    child.score = Number(singleForm.defaultScore || 2);
    child.answerText = answerReference.value;
    child.answerRows = normalizeAnswerRows(singleForm.answerRows);
    child.analysis = singleForm.analysis;
    singleForm.type = 'material';
    singleForm.children = [child];
    singleForm.options = [];
    selectedMaterialChildIndex.value = 0;
    answerReference.value = '';
    ElMessage.success('已改为大题/组合题，可继续添加多个简答、填空或选择小题');
  }

  function removeSingleMaterialChild(index: number) {
    singleForm.children.splice(index, 1);
    singleForm.children.forEach((child, childIndex) => {
      child.sortOrder = childIndex + 1;
    });
    selectedMaterialChildIndex.value = Math.min(selectedMaterialChildIndex.value, Math.max(0, singleForm.children.length - 1));
  }

  function baseMaterialInlineChild(sortOrder = 1, type = 'short_answer'): MaterialQuestionChild {
    const child: MaterialQuestionChild = {
      localId: `material-child-${materialChildLocalId++}`,
      type,
      title: '',
      content: '',
      difficulty: Number(singleForm.difficulty || 1),
      score: 2,
      answerRows: 6,
      analysis: '',
      answerText: '',
      blankRows: emptyFillBlankRows(),
      sortOrder,
      options: [],
    };
    resetMaterialInlineChild(child);
    return child;
  }

  function cloneMaterialChild(child: MaterialQuestionChild): MaterialQuestionChild {
    return {
      ...createMaterialChildDraft(child?.type || 'short_answer'),
      ...child,
      options: (child?.options ?? []).map((option) => ({ ...option })),
      blankRows: (child?.blankRows?.length ? child.blankRows : emptyFillBlankRows()).map((row) => ({ ...row })),
      answerRows: normalizeAnswerRows(child?.answerRows),
    };
  }

  function assignMaterialChild(target: MaterialQuestionChild, source: MaterialQuestionChild) {
    Object.assign(target, cloneMaterialChild(source));
  }

  function openMaterialChildDialog(type = 'short_answer') {
    materialEditingChildIndex.value = -1;
    const draft = createMaterialChildDraft(type);
    draft.difficulty = Number(singleForm.difficulty || 1);
    draft.sortOrder = singleForm.children.length + 1;
    draft.title = `第 ${singleForm.children.length + 1} 问`;
    resetMaterialInlineChild(draft);
    assignMaterialChild(materialChildDraft, draft);
    materialChildDialogVisible.value = true;
    setImageInsertTarget(materialChildDraft, 'content');
  }

  function editSingleMaterialChild(index: number) {
    const child = singleForm.children[index];
    if (!child) return;
    selectedMaterialChildIndex.value = index;
    materialEditingChildIndex.value = index;
    assignMaterialChild(materialChildDraft, child);
    materialChildDialogVisible.value = true;
    setImageInsertTarget(materialChildDraft, 'content');
  }

  function saveMaterialChildDraft() {
    const index = materialEditingChildIndex.value >= 0 ? materialEditingChildIndex.value : singleForm.children.length;
    const payload = materialInlineChildPayload(materialChildDraft, index);
    try {
      validatePayload({
        ...payload,
        courseId: sharedCourseId.value,
        courseName: selectedCourseName(sharedCourseId.value),
        defaultScore: payload.score,
        knowledgePointIds: [...sharedKnowledgePointIds.value],
        knowledgePointNames: [...selectedKnowledgeNames.value],
      }, `子题 ${index + 1}`);
    } catch (error) {
      ElMessage.error(errorMessage(error));
      return;
    }

    const child = cloneMaterialChild(materialChildDraft);
    child.localId = child.localId || `material-child-${materialChildLocalId++}`;
    child.sortOrder = index + 1;
    if (materialEditingChildIndex.value >= 0) {
      singleForm.children.splice(materialEditingChildIndex.value, 1, child);
      selectedMaterialChildIndex.value = materialEditingChildIndex.value;
    } else {
      singleForm.children.push(child);
      selectedMaterialChildIndex.value = singleForm.children.length - 1;
    }
    singleForm.children.forEach((item, childIndex) => {
      item.sortOrder = childIndex + 1;
    });
    materialChildDialogVisible.value = false;
    ElMessage.success('子题已保存');
  }

  function deleteMaterialChildFromDialog() {
    if (materialEditingChildIndex.value < 0) return;
    removeSingleMaterialChild(materialEditingChildIndex.value);
    materialChildDialogVisible.value = false;
    materialEditingChildIndex.value = -1;
  }

  function baseChoiceOptions(): QuestionOption[] {
    return [
      { optionKey: 'A', content: '', isCorrect: false, sortOrder: 1 },
      { optionKey: 'B', content: '', isCorrect: true, sortOrder: 2 },
      { optionKey: 'C', content: '', isCorrect: false, sortOrder: 3 },
      { optionKey: 'D', content: '', isCorrect: false, sortOrder: 4 },
    ];
  }

  function resetMaterialInlineChild(child: MaterialQuestionChild) {
    if (child.type === 'true_false') {
      child.options = [
        { optionKey: 'A', content: '正确', isCorrect: true, sortOrder: 1 },
        { optionKey: 'B', content: '错误', isCorrect: false, sortOrder: 2 },
      ];
    } else if (isChoiceType(child.type)) {
      child.options = baseChoiceOptions();
    } else {
      child.options = [];
    }
    child.answerText = '';
    if (isTextAnswerType(child.type)) {
      child.answerRows = normalizeAnswerRows(child.answerRows);
    }
    if (child.type === 'fill_blank') {
      child.blankRows = emptyFillBlankRows();
    }
  }

  function materialChildCorrectChoiceKey(child: MaterialQuestionChild) {
    return child.options.find((option) => option.isCorrect)?.optionKey ?? '';
  }

  function setMaterialChildCorrectChoice(child: MaterialQuestionChild, value: string | number | boolean | undefined) {
    const selected = String(value ?? '');
    child.options.forEach((option) => {
      option.isCorrect = option.optionKey === selected;
    });
  }

  function addMaterialChildOption(child: MaterialQuestionChild) {
    child.options.push({
      optionKey: optionKeyForIndex(child.options.length),
      content: '',
      isCorrect: false,
      sortOrder: child.options.length + 1,
    });
  }

  function removeMaterialChildOption(child: MaterialQuestionChild, index: number) {
    child.options.splice(index, 1);
    child.options.forEach((option, optionIndex) => {
      option.optionKey = optionKeyForIndex(optionIndex);
      option.sortOrder = optionIndex + 1;
    });
    if ((child.type === 'single_choice' || child.type === 'true_false') && !child.options.some((option) => option.isCorrect)) {
      child.options[0].isCorrect = true;
    }
  }

  function insertMaterialChildBlankMarker(child: MaterialQuestionChild) {
    if (child.type !== 'fill_blank') return;
    if (!child.blankRows?.length) child.blankRows = emptyFillBlankRows();
    const marker = '____';
    const current = String(child.content || '');
    const needsSpace = current && !/[\s([{（【]$/.test(current);
    child.content = `${current}${needsSpace ? ' ' : ''}${marker}`;
    if (countBlankMarkers(child.content) > child.blankRows.length) {
      addMaterialChildBlankAnswerRow(child);
    }
  }

  function addMaterialChildBlankAnswerRow(child: MaterialQuestionChild) {
    child.blankRows = [...(child.blankRows?.length ? child.blankRows : []), { answerText: '' }];
  }

  function removeMaterialChildBlankAnswerRow(child: MaterialQuestionChild, index: number) {
    if (!child.blankRows?.length || child.blankRows.length <= 1) return;
    child.blankRows = child.blankRows.filter((_, rowIndex) => rowIndex !== index);
  }

  return {
    buildMaterialInlineChildrenPayload,
    materialInlineChildPayload,
    buildMaterialChildFillBlankAnswer,
    convertShortAnswerToMaterial,
    removeSingleMaterialChild,
    baseMaterialInlineChild,
    cloneMaterialChild,
    assignMaterialChild,
    openMaterialChildDialog,
    editSingleMaterialChild,
    saveMaterialChildDraft,
    deleteMaterialChildFromDialog,
    baseChoiceOptions,
    resetMaterialInlineChild,
    materialChildCorrectChoiceKey,
    setMaterialChildCorrectChoice,
    addMaterialChildOption,
    removeMaterialChildOption,
    insertMaterialChildBlankMarker,
    addMaterialChildBlankAnswerRow,
    removeMaterialChildBlankAnswerRow,
  };
}
