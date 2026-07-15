import type { ComputedRef, Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { createQuestion, publishQuestion } from '../api';
import {
  DEFAULT_BLANK_ANSWER_TEXT,
  buildFillBlankAnswer,
  emptyFillBlankRows,
} from '../../../utils/fillBlankAnswers';
import type {
  BatchPreviewRow,
  DuplicateCheckItem,
  FillBlankRow,
  MaterialQuestionChild,
  QuestionAnswer,
  QuestionMutationPayload,
  QuestionOption,
  SingleQuestionForm,
} from '../models';

type QuestionValidationPayload = Omit<
  Pick<QuestionMutationPayload, 'courseId' | 'courseName' | 'type' | 'title' | 'content' | 'difficulty' | 'defaultScore' | 'options' | 'answer' | 'inlineChildren'>,
  'answer'
> & { answer?: QuestionAnswer | null; knowledgePointIds?: string[]; knowledgePointNames?: string[] };
type MarkdownObject = SingleQuestionForm | MaterialQuestionChild | QuestionOption;

type DraftState = {
  singleForm: SingleQuestionForm;
  sharedCourseId: Ref<string>;
  sharedKnowledgePointIds: Ref<string[]>;
  sharedTagNames: Ref<string[]>;
  selectedKnowledgeNames: ComputedRef<string[]>;
  singleMaterialScore: ComputedRef<number>;
  answerReference: Ref<string>;
  blankAnswerRows: Ref<FillBlankRow[]>;
  blankAnswerText: { value: string };
  blankCaseSensitive: Ref<boolean>;
  blankSpaceSensitive: Ref<boolean>;
  singleSaving: Ref<boolean>;
  publishAfterImport: Ref<boolean>;
  selectedMaterialChildIndex: Ref<number>;
  materialEditingChildIndex: Ref<number>;
  materialChildDialogVisible: Ref<boolean>;
  singleConflictMessage: ComputedRef<string>;
  baseSingleForm: () => SingleQuestionForm;
  isChoiceType: (type: string) => boolean;
  isTextAnswerType: (type: string) => boolean;
  normalizeAnswerRows: (value: unknown, fallback?: number) => number;
  optionKeyForIndex: (index: number) => string;
  selectedCourseName: (courseId: string) => string;
  blankAnswerOptions: () => { ignoreCase: boolean; trimSpace: boolean };
  buildSingleProgrammingRefPayload: () => QuestionMutationPayload['programmingRef'];
  buildMaterialInlineChildrenPayload: () => NonNullable<QuestionMutationPayload['inlineChildren']>;
  runSingleDuplicateCheck: (options?: { silent?: boolean }) => Promise<DuplicateCheckItem | null>;
  resolveTagIds: (tagNames?: string[]) => Promise<string[]>;
  validatePayload: (payload: QuestionValidationPayload, label: string) => void;
  rememberSingleType: (type: string) => void;
  setImageInsertTarget: (target: MarkdownObject, field: 'title' | 'content' | 'analysis' | 'answerText') => void;
};

export function useSingleQuestionDraft(state: DraftState) {
  const {
    answerReference, baseSingleForm, blankAnswerOptions, blankAnswerRows, blankAnswerText,
    blankCaseSensitive, blankSpaceSensitive, buildMaterialInlineChildrenPayload,
    buildSingleProgrammingRefPayload, isChoiceType, isTextAnswerType, materialChildDialogVisible,
    materialEditingChildIndex, normalizeAnswerRows, optionKeyForIndex, publishAfterImport,
    rememberSingleType, resolveTagIds, runSingleDuplicateCheck, selectedCourseName,
    selectedKnowledgeNames, selectedMaterialChildIndex, setImageInsertTarget, sharedCourseId,
    sharedKnowledgePointIds, sharedTagNames, singleConflictMessage, singleForm,
    singleMaterialScore, singleSaving, validatePayload,
  } = state;

  function errorMessage(error: unknown, fallback = '操作失败') {
    return error instanceof Error ? error.message : fallback;
  }

  function buildSinglePreview(): BatchPreviewRow {
    const options = isChoiceType(singleForm.type)
      ? singleForm.options.map((option, index) => ({
          optionKey: option.optionKey,
          content: option.content,
          isCorrect: Boolean(option.isCorrect),
          sortOrder: index + 1,
        }))
      : [];

    const payload: BatchPreviewRow = {
      valid: true,
      number: 1,
      courseId: sharedCourseId.value,
      courseName: selectedCourseName(sharedCourseId.value),
      knowledgePointIds: [...sharedKnowledgePointIds.value],
      knowledgePointNames: [...selectedKnowledgeNames.value],
      type: singleForm.type,
      title: singleForm.title,
      tagNames: [...sharedTagNames.value],
      content: singleForm.content,
      difficulty: Number(singleForm.difficulty),
      defaultScore: singleForm.type === 'material' && singleForm.children.length
        ? singleMaterialScore.value
        : Number(singleForm.defaultScore),
      analysis: singleForm.analysis,
      options,
      answerText: getSingleAnswerText(),
      statusText: '待导入',
    };

    if (singleForm.type === 'programming') {
      payload.programmingRef = buildSingleProgrammingRefPayload();
    }

    if (singleForm.type === 'material') {
      payload.inlineChildren = buildMaterialInlineChildrenPayload();
      payload.children = payload.inlineChildren.map((child, index) => ({
        inline: true,
        title: child.title,
        type: child.type,
        score: child.score,
        sortOrder: index + 1,
      }));
    }

    if (singleForm.type === 'fill_blank') {
      payload.answer = buildSingleFillBlankPreviewAnswer(payload.defaultScore);
    } else if (isTextAnswerType(singleForm.type)) {
      payload.answer = {
        reference: answerReference.value.trim(),
        rows: normalizeAnswerRows(singleForm.answerRows),
      };
    } else if (singleForm.type !== 'material' && !isChoiceType(singleForm.type) && answerReference.value.trim()) {
      payload.answer = { reference: answerReference.value.trim() };
    }

    return payload;
  }

  function buildSingleFillBlankPreviewAnswer(score: number): QuestionAnswer {
    try {
      return buildFillBlankAnswer(blankAnswerText.value, score, blankAnswerOptions());
    } catch {
      const markerCount = countBlankMarkers(singleForm.content);
      const rowCount = Math.max(1, markerCount, blankAnswerRows.value.length);
      const blankScore = rowCount ? Number(score || 0) / rowCount : Number(score || 0);
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

  function questionPayload(preview: BatchPreviewRow): QuestionMutationPayload {
    const payload = { ...preview } as Partial<BatchPreviewRow>;
    for (const key of [
      'answerText', 'number', 'statusText', 'valid', 'tagNames',
      'conflictStatus', 'conflictMessage', 'conflictMatches', 'batchKey',
    ] as const) {
      delete payload[key];
    }
    if (payload.inlineChildren?.length) {
      delete payload.children;
    }
    return payload as QuestionMutationPayload;
  }

  async function importSingle() {
    singleSaving.value = true;
    try {
      const preview = buildSinglePreview();
      const tagNames = preview.tagNames;
      const payload = questionPayload(preview);
      validatePayload(payload, '当前题目');
      const duplicateResult = await runSingleDuplicateCheck({ silent: true });
      if (duplicateResult && duplicateResult.status !== 'ok') {
        const title = duplicateResult.status === 'conflict' ? '检测到题目冲突' : '检测到相似或重复题目';
        try {
          await ElMessageBox.confirm(`${singleConflictMessage.value || duplicateResult.message}，仍然导入吗？`, title, {
            type: duplicateResult.status === 'conflict' ? 'error' : 'warning',
            confirmButtonText: '仍然导入',
            cancelButtonText: '取消',
          });
        } catch {
          return;
        }
      }
      payload.tagIds = await resolveTagIds(tagNames);
      const created = await createQuestion(payload);
      if (publishAfterImport.value) {
        for (const childId of created.childIds ?? []) {
          await publishQuestion(childId);
        }
        await publishQuestion(created.id);
      }
      rememberSingleType(payload.type || singleForm.type);
      ElMessage.success(publishAfterImport.value ? '单题已导入并发布' : '单题已导入');
    } catch (error) {
      ElMessage.error(errorMessage(error));
    } finally {
      singleSaving.value = false;
    }
  }

  function resetSingleOptions() {
    if (singleForm.type === 'material') {
      singleForm.options = [];
      return;
    }

    if (singleForm.type === 'true_false') {
      singleForm.options = [
        { optionKey: 'A', content: '正确', isCorrect: true, sortOrder: 1 },
        { optionKey: 'B', content: '错误', isCorrect: false, sortOrder: 2 },
      ];
      return;
    }

    if (isChoiceType(singleForm.type)) {
      singleForm.options = baseSingleForm().options.map((option) => ({ ...option }));
      return;
    }

    singleForm.options = [];
  }

  async function handleSingleTypeChange() {
    resetSingleOptions();
    if (singleForm.type === 'fill_blank' && !blankAnswerRows.value.length) {
      blankAnswerRows.value = emptyFillBlankRows();
    }
    if (singleForm.type === 'material') {
      answerReference.value = '';
      selectedMaterialChildIndex.value = Math.min(selectedMaterialChildIndex.value, Math.max(0, singleForm.children.length - 1));
    } else {
      singleForm.children = [];
      selectedMaterialChildIndex.value = 0;
    }
  }

  function addSingleOption() {
    singleForm.options.push({
      optionKey: optionKeyForIndex(singleForm.options.length),
      content: '',
      isCorrect: false,
      sortOrder: singleForm.options.length + 1,
    });
  }

  function removeSingleOption(index: number) {
    singleForm.options.splice(index, 1);
    renumberSingleOptions();
    if ((singleForm.type === 'single_choice' || singleForm.type === 'true_false') && !singleForm.options.some((option) => option.isCorrect)) {
      singleForm.options[0].isCorrect = true;
    }
  }

  function renumberSingleOptions() {
    singleForm.options.forEach((option, index) => {
      option.optionKey = optionKeyForIndex(index);
      option.sortOrder = index + 1;
    });
  }

  function addBlankAnswerRow() {
    blankAnswerRows.value = [...blankAnswerRows.value, { answerText: '' }];
  }

  function removeBlankAnswerRow(index: number) {
    if (blankAnswerRows.value.length <= 1) return;
    blankAnswerRows.value = blankAnswerRows.value.filter((_, rowIndex) => rowIndex !== index);
  }

  function insertSingleBlankMarker() {
    if (singleForm.type !== 'fill_blank') return;
    if (!blankAnswerRows.value.length) addBlankAnswerRow();
    const marker = '____';
    const current = String(singleForm.content || '');
    const needsSpace = current && !/[\s([{（【]$/.test(current);
    singleForm.content = `${current}${needsSpace ? ' ' : ''}${marker}`;
    if (countBlankMarkers(singleForm.content) > blankAnswerRows.value.length) {
      addBlankAnswerRow();
    }
  }

  function countBlankMarkers(content?: string) {
    const matches = String(content || '').match(/_{3,}|\(\s*\)|（\s*）|\[\s*\]/g);
    return matches?.length || 0;
  }

  function resetSingleForm() {
    Object.assign(singleForm, baseSingleForm());
    selectedMaterialChildIndex.value = 0;
    materialEditingChildIndex.value = -1;
    materialChildDialogVisible.value = false;
    blankAnswerRows.value = emptyFillBlankRows();
    blankCaseSensitive.value = false;
    blankSpaceSensitive.value = false;
    answerReference.value = '';
    resetSingleOptions();
    setImageInsertTarget(singleForm, 'content');
  }

  function loadSingleTemplate() {
    Object.assign(singleForm, {
      type: 'fill_blank',
      title: '单题示例：多空填空',
      content: [
        '阅读代码并填写 3 个空。题干可包含数学公式 $a^2 + b^2 = c^2$、化学式 @chem{H2SO4}。',
        '',
        '$$',
        'S = \\pi\\,r^2',
        '$$',
        '',
        '```python',
        'for i in range(len(items)):',
        '    print(items[i])',
        '```',
        '',
        '第 1 空：输出函数是 ____。',
        '第 2 空：循环范围函数是 ____。',
        '第 3 空：获取长度函数是 ____。',
      ].join('\n'),
      difficulty: 1,
      defaultScore: 6,
      analysis: '`print` 负责输出，`range` 生成循环序列，`len` 获取长度。化学方程式示例：@chem{2H2 + O2 -> 2H2O}。',
      options: [],
    });
    blankAnswerText.value = DEFAULT_BLANK_ANSWER_TEXT;
    answerReference.value = '';
  }

  function getSingleAnswerText() {
    if (isChoiceType(singleForm.type)) {
      return singleForm.options.filter((option) => option.isCorrect).map((option) => option.optionKey).join(',');
    }
    if (singleForm.type === 'fill_blank') return blankAnswerText.value;
    if (singleForm.type === 'material') return `${singleForm.children.length} 道子题`;
    return answerReference.value;
  }

  return { buildSinglePreview, buildSingleFillBlankPreviewAnswer, questionPayload, importSingle, resetSingleOptions, handleSingleTypeChange, addSingleOption, removeSingleOption, renumberSingleOptions, addBlankAnswerRow, removeBlankAnswerRow, insertSingleBlankMarker, countBlankMarkers, resetSingleForm, loadSingleTemplate, getSingleAnswerText };
}
