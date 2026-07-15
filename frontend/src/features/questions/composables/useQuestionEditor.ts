import type { ComputedRef, Ref, WritableComputedRef } from 'vue';
import { ElMessage } from 'element-plus';
import {
  createQuestion,
  createQuestionTag,
  getQuestion,
  publishQuestion,
  updateQuestion,
} from '../api';
import type {
  FillBlankRow,
  NamedOption,
  QuestionChild,
  QuestionForm,
  QuestionMutationPayload,
  QuestionRecord,
} from '../models';
import {
  buildFillBlankAnswer,
  emptyFillBlankRows,
  fillBlankAnswerTextFromRules,
} from '../../../utils/fillBlankAnswers';
import { baseForm } from './questionFormFactory';

type QuestionValidationPayload = Pick<
  QuestionMutationPayload,
  'courseId' | 'type' | 'title' | 'content' | 'difficulty' | 'defaultScore' | 'options'
> & {
  children?: QuestionChild[] | QuestionMutationPayload['children'];
};

type EditorState = {
  form: QuestionForm;
  isChoice: ComputedRef<boolean>;
  isEditing: ComputedRef<boolean>;
  blankAnswerRows: Ref<FillBlankRow[]>;
  blankAnswerText: WritableComputedRef<string>;
  answerReference: Ref<string>;
  saving: Ref<boolean>;
  editingId: Ref<string>;
  editMode: Ref<boolean>;
  editorVisible: Ref<boolean>;
  entryMode: Ref<string>;
  questionScope: Ref<string>;
  courses: Ref<NamedOption[]>;
  tags: Ref<NamedOption[]>;
  addMaterialChild: () => void;
  loadMaterialCandidates: () => Promise<void>;
  loadFormKnowledgeTree: () => Promise<void>;
  refreshAll: () => Promise<void>;
  buildProgrammingRefPayload: () => QuestionMutationPayload['programmingRef'];
};

export function useQuestionEditor(state: EditorState) {
  const {
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
  } = state;

  function errorMessage(error: unknown, fallback = '操作失败') {
    return error instanceof Error ? error.message : fallback;
  }

  function countBlankMarkers(content?: string) {
    const matches = String(content || '').match(/_{3,}|\(\s*\)|（\s*）|\[\s*\]/g);
    return matches?.length || 1;
  }

  function resetOptions() {
    if (form.type === 'material') {
      form.options = [];
      void loadMaterialCandidates();
      if (!form.children.length) addMaterialChild();
      return;
    }
    if (form.type === 'true_false') {
      form.options = [
        { optionKey: 'A', content: '正确', isCorrect: true, sortOrder: 1 },
        { optionKey: 'B', content: '错误', isCorrect: false, sortOrder: 2 },
      ];
      return;
    }

    if (isChoice.value) {
      form.options = baseForm().options.map((option) => ({ ...option }));
      return;
    }

    form.options = [];
  }

  function addBlankAnswerRow() {
    blankAnswerRows.value = [...blankAnswerRows.value, { answerText: '' }];
  }

  function removeBlankAnswerRow(index: number) {
    if (blankAnswerRows.value.length <= 1) return;
    blankAnswerRows.value = blankAnswerRows.value.filter((_, rowIndex) => rowIndex !== index);
  }

  function insertFormBlankMarker() {
    if (form.type !== 'fill_blank') return;
    if (!blankAnswerRows.value.length) addBlankAnswerRow();
    const marker = '____';
    const current = String(form.content || '');
    const needsSpace = current && !/[\s([{（【]$/.test(current);
    form.content = `${current}${needsSpace ? ' ' : ''}${marker}`;
    if (countBlankMarkers(form.content) > blankAnswerRows.value.length) {
      addBlankAnswerRow();
    }
  }

  function addOption() {
    const sortOrder = form.options.length + 1;
    form.options.push({
      optionKey: optionKeyForIndex(form.options.length),
      content: '',
      isCorrect: false,
      sortOrder,
    });
  }

  function removeOption(index: number) {
    form.options.splice(index, 1);
    renumberOptions();
    if ((form.type === 'single_choice' || form.type === 'true_false') && !form.options.some((option) => option.isCorrect)) {
      form.options[0].isCorrect = true;
    }
  }

  function renumberOptions() {
    form.options.forEach((option, index) => {
      option.optionKey = optionKeyForIndex(index);
      option.sortOrder = index + 1;
    });
  }

  function optionKeyForIndex(index: number) {
    return index < 26 ? String.fromCharCode(65 + index) : `X${index + 1}`;
  }

  function appendTag(name: string) {
    if (!form.tagNames.includes(name)) {
      form.tagNames.push(name);
    }
  }

  function insertCodeBlock(target: QuestionForm, field: 'content' | 'analysis') {
    const block = '\n```python\nprint("hello")\n```\n';
    target[field] = `${target[field] || ''}${block}`;
  }

  function validateForm() {
    validatePayload({ ...form, courseId: form.courseId }, '当前题目');
  }

  function validatePayload(payload: QuestionValidationPayload, label: string) {
    if (!payload.courseId) throw new Error(`${label}：请选择课程`);
    if (!payload.title?.trim()) throw new Error(`${label}：请填写标题`);
    if (!payload.content?.trim()) throw new Error(`${label}：请填写题干`);
    if (!Number.isFinite(Number(payload.difficulty)) || payload.difficulty < 1 || payload.difficulty > 5) {
      throw new Error(`${label}：难度必须是 1-5`);
    }
    if (!Number.isFinite(Number(payload.defaultScore)) || payload.defaultScore < 0) {
      throw new Error(`${label}：分值不能小于 0`);
    }

    if (isChoiceType(payload.type)) {
      const options = payload.options ?? [];
      const correctCount = options.filter((option) => option.isCorrect).length;
      if (options.length < 2 || options.some((option) => !option.content?.trim())) {
        throw new Error(`${label}：请至少填写两个完整选项`);
      }
      if ((payload.type === 'single_choice' || payload.type === 'true_false') && correctCount !== 1) {
        throw new Error(`${label}：单选/判断题必须有且只有一个正确选项`);
      }
      if (payload.type === 'multiple_choice' && correctCount < 2) {
        throw new Error(`${label}：多选题至少需要两个正确选项`);
      }
    }
    if (payload.type === 'material') {
      if (!payload.children?.length || payload.children.some((child) => !child.questionId || Number(child.score) <= 0)) {
        throw new Error(`${label}：请至少选择一道子题并填写有效分值`);
      }
      if (new Set(payload.children.map((child) => child.questionId)).size !== payload.children.length) {
        throw new Error(`${label}：子题不能重复`);
      }
    }
  }

  async function buildQuestionPayload(options: { includeStatus?: boolean } = {}): Promise<QuestionMutationPayload> {
    const { includeStatus = isEditing.value } = options;
    validateForm();
    const tagIds = await resolveTagIds(form.tagNames);
    const payload: QuestionMutationPayload = {
      courseId: form.courseId,
      type: form.type,
      title: form.title.trim(),
      content: form.content.trim(),
      difficulty: Number(form.difficulty),
      defaultScore: Number(form.defaultScore),
      analysis: form.analysis?.trim() || '',
      knowledgePointIds: [...form.knowledgePointIds],
      tagIds,
      options: isChoice.value
        ? form.options.map((option, index) => ({
            optionKey: option.optionKey,
            content: option.content.trim(),
            isCorrect: Boolean(option.isCorrect),
            sortOrder: index + 1,
          }))
        : [],
      children: form.type === 'material'
        ? form.children.map((child, index) => ({ questionId: child.questionId ?? '', score: Number(child.score), sortOrder: index + 1 }))
        : undefined,
    };

    if (form.type === 'programming') {
      payload.programmingRef = buildProgrammingRefPayload();
    }

    if (includeStatus) {
      payload.status = form.status;
    }

    if (form.type === 'fill_blank') {
      payload.answer = buildFillBlankAnswer(blankAnswerText.value, payload.defaultScore);
    } else if (!isChoice.value && answerReference.value.trim()) {
      payload.answer = { reference: answerReference.value.trim() };
    }

    return payload;
  }

  async function saveQuestion(shouldPublish: boolean) {
    saving.value = true;
    try {
      const payload = await buildQuestionPayload();
      const targetScope = shouldPublish ? 'published' : questionScopeForStatus(payload.status ?? form.status);
      const result = isEditing.value
        ? await updateQuestion(editingId.value, payload)
        : await createQuestion(payload);

      const id = editingId.value || result.id;
      if (shouldPublish) {
        await publishQuestion(id);
      }

      ElMessage.success(shouldPublish ? '已保存并发布' : isEditing.value ? '已保存修改' : '已创建');
      questionScope.value = targetScope;
      editorVisible.value = false;
      resetForm();
      await refreshAll();
    } catch (error) {
      ElMessage.error(errorMessage(error));
    } finally {
      saving.value = false;
    }
  }

  function questionScopeForStatus(status?: string) {
    return status === 'published' ? 'published' : 'draft';
  }

  async function editQuestion(row: Pick<QuestionRecord, 'id'>) {
    let detail;
    try {
      detail = await getQuestion(row.id);
    } catch (error) {
      ElMessage.error(errorMessage(error));
      return;
    }
    editMode.value = true;
    editorVisible.value = true;
    editingId.value = detail.id;
    entryMode.value = 'single';
    Object.assign(form, {
      courseId: detail.courseId,
      type: detail.type,
      status: detail.status,
      title: detail.title,
      knowledgePointIds: (detail.knowledgePoints ?? []).map((point) => point.id),
      tagNames: (detail.tags ?? []).map((tag) => tag.name),
      content: detail.content,
      difficulty: detail.difficulty,
      defaultScore: Number(detail.defaultScore),
      analysis: detail.analysis ?? '',
      programmingRef: {
        externalProblemId: detail.programmingRef?.externalProblemId ?? '',
        externalProblemUrl: detail.programmingRef?.externalProblemUrl ?? '',
        platformBaseUrl: detail.programmingRef?.platformBaseUrl ?? detail.programmingRef?.judgeConfig?.platformBaseUrl ?? 'https://oj.example.com',
        domainId: detail.programmingRef?.domainId ?? detail.programmingRef?.judgeConfig?.domainId ?? 'system',
        domainName: detail.programmingRef?.domainName ?? detail.programmingRef?.judgeConfig?.domainName ?? 'system',
        judgeProvider: detail.programmingRef?.judgeProvider ?? detail.programmingRef?.judgeConfig?.platformCode ?? 'hydro',
        accountId: detail.programmingRef?.accountId ?? detail.programmingRef?.judgeConfig?.accountId ?? '',
        accountLabel: detail.programmingRef?.accountLabel ?? detail.programmingRef?.judgeConfig?.accountLabel ?? '',
        languagesText: (detail.programmingRef?.languages ?? []).join(', ') || 'cc.cc17o2, py.py3',
        timeLimit: detail.programmingRef?.timeLimit ?? null,
        memoryLimit: detail.programmingRef?.memoryLimit ?? null,
        judgeConfig: detail.programmingRef?.judgeConfig ?? null,
      },
      options: (detail.options ?? []).map((option, index) => ({
        optionKey: option.optionKey || optionKeyForIndex(index),
        content: option.content,
        isCorrect: option.isCorrect,
        sortOrder: option.sortOrder ?? index + 1,
      })),
      children: (detail.children ?? []).map((child, index) => ({
        questionId: child.questionId,
        score: Number(child.score),
        sortOrder: child.sortOrder ?? index + 1,
      })),
    });
    if (form.type === 'material') await loadMaterialCandidates();
    await loadFormKnowledgeTree();
    if (isChoice.value && !form.options.length) resetOptions();

    const answerJson = detail.answer?.answerJson ?? {};
    blankAnswerText.value = fillBlankAnswerTextFromRules(answerJson.blanks);
    answerReference.value = answerJson.reference ?? '';
  }

  async function copyQuestion() {
    if (!isEditing.value) {
      ElMessage.warning('请先选择一道题目');
      return;
    }

    saving.value = true;
    try {
      const payload = await buildQuestionPayload({ includeStatus: false });
      payload.title = `${payload.title}（副本）`;
      const created = await createQuestion(payload);
      ElMessage.success('已复制为草稿题目');
      await refreshAll();
      await editQuestion({ id: created.id });
    } catch (error) {
      ElMessage.error(errorMessage(error));
    } finally {
      saving.value = false;
    }
  }

  function closeEditor() {
    editorVisible.value = false;
    resetForm();
  }

  function resetForm() {
    editingId.value = '';
    Object.assign(form, baseForm(), { courseId: courses.value[0]?.id ?? '' });
    blankAnswerRows.value = emptyFillBlankRows();
    answerReference.value = '';
    loadFormKnowledgeTree();
  }

  async function resolveTagIds(tagNames: string[] = []) {
    const names = [...new Set(tagNames.map((name) => String(name).trim()).filter(Boolean))];
    const ids = [];

    for (const [index, name] of names.entries()) {
      const existing = tags.value.find((tag) => tag.name === name);
      if (existing) {
        ids.push(existing.id);
        continue;
      }

      const created = await createQuestionTag({
          name,
          code: makeTagCode(name, index),
          type: 'QUESTION',
      });
      ids.push(created.id);
      tags.value.unshift(created);
    }

    return ids;
  }

  function makeTagCode(name: string, index: number) {
    const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
    return `q_${ascii || 'tag'}_${Date.now()}_${index}`;
  }

  function isChoiceType(type: string) {
    return ['single_choice', 'multiple_choice', 'true_false'].includes(type);
  }

  return {
    resetOptions,
    addBlankAnswerRow,
    removeBlankAnswerRow,
    insertFormBlankMarker,
    addOption,
    removeOption,
    renumberOptions,
    optionKeyForIndex,
    appendTag,
    insertCodeBlock,
    validateForm,
    validatePayload,
    buildQuestionPayload,
    saveQuestion,
    questionScopeForStatus,
    editQuestion,
    copyQuestion,
    closeEditor,
    resetForm,
    resolveTagIds,
    makeTagCode,
    isChoiceType,
  };
}
