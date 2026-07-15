import type { ComputedRef, Ref } from 'vue';
import { ElMessage, type UploadFile, type UploadInstance } from 'element-plus';
import { fillBlankAnswerTextFromRules } from '../../../utils/fillBlankAnswers';
import { decodeText, mimeByFilename, parseCsvRows, parseCsvTable, parseStoredZip } from './portableArchiveCodec';
import type {
  BatchPreviewRow,
  PortableQuestion,
  ProgrammingReference,
  QuestionAnswer,
  QuestionAsset,
  QuestionMutationPayload,
  QuestionOption,
  StoredZipEntry,
} from '../models';

type QuestionValidationPayload = Omit<
  Pick<QuestionMutationPayload, 'courseId' | 'courseName' | 'type' | 'title' | 'content' | 'difficulty' | 'defaultScore' | 'options' | 'answer' | 'inlineChildren'>,
  'answer'
> & { answer?: QuestionAnswer | null; knowledgePointIds?: string[]; knowledgePointNames?: string[] };

type PortableState = {
  portableUploadRef: Ref<UploadInstance | null>;
  portableUploadKey: Ref<number>;
  structuredBatchQuestions: Ref<PortableQuestion[]>;
  removedBatchRowKeys: Ref<Set<string>>;
  batchText: Ref<string>;
  batchAnswerText: Ref<string>;
  importMode: Ref<string>;
  selectedKnowledgeNames: ComputedRef<string[]>;
  sharedKnowledgePointIds: Ref<string[]>;
  sharedTagNames: Ref<string[]>;
  uploadAssetFile: (file: File, options?: { silent?: boolean }) => Promise<QuestionAsset>;
  refreshPreview: () => void;
  mergeTags: (...groups: Array<Array<string | null | undefined>>) => string[];
  mergeIds: (...groups: string[][]) => string[];
  normalizeCourseName: (value: unknown) => string;
  resolveCourseIdForImportedQuestion: (sourceCourseId: unknown, courseName: unknown) => string;
  resolveKnowledgePointIdsByName: (names?: string[]) => string[];
  selectedCourseName: (courseId: string) => string;
  normalizeType: (value: unknown) => string;
  normalizeProgrammingRef: (value: unknown) => ProgrammingReference | null;
  validatePayload: (payload: QuestionValidationPayload, label: string) => void;
  typeLabel: (value: string) => string;
  isChoiceType: (type: string) => boolean;
  isMeaningfulName: (value: unknown) => value is string;
  parseTagNames: (value: unknown) => string[];
  optionKeyForIndex: (index: number) => string;
};

export function usePortableImport(state: PortableState) {
  const {
    batchAnswerText,
    batchText,
    importMode,
    isChoiceType,
    isMeaningfulName,
    mergeIds,
    mergeTags,
    normalizeCourseName,
    normalizeProgrammingRef,
    normalizeType,
    optionKeyForIndex,
    parseTagNames,
    portableUploadKey,
    portableUploadRef,
    refreshPreview,
    removedBatchRowKeys,
    resolveCourseIdForImportedQuestion,
    resolveKnowledgePointIdsByName,
    selectedCourseName,
    selectedKnowledgeNames,
    sharedKnowledgePointIds,
    sharedTagNames,
    structuredBatchQuestions,
    typeLabel,
    uploadAssetFile,
    validatePayload,
  } = state;

  function errorMessage(error: unknown, fallback = '操作失败') {
    return error instanceof Error ? error.message : fallback;
  }

  function recordValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  async function handlePortableImportChange(uploadFile: UploadFile) {
    const file = uploadFile?.raw;
    if (!file) return;

    try {
      const name = String(file.name || '').toLowerCase();
      if (name.endsWith('.zip')) {
        await loadQuestionZipPackage(file);
      } else if (name.endsWith('.json')) {
        const rows = portableQuestionsFromJson(JSON.parse(await file.text()));
        applyPortableQuestions(rows, 'JSON');
      } else if (name.endsWith('.csv')) {
        const rows = parseCsvRows(await file.text());
        ensurePortableCsvRows(rows);
        const questions = rows.map(normalizePortableQuestion);
        applyPortableQuestions(questions, 'CSV');
      } else {
        structuredBatchQuestions.value = [];
        removedBatchRowKeys.value = new Set();
        batchText.value = await file.text();
        batchAnswerText.value = '';
        importMode.value = 'batch';
        refreshPreview();
        ElMessage.success('已载入模板文本，请检查解析结果');
      }
    } catch (error) {
      ElMessage.error(errorMessage(error, '题目文件导入失败'));
    } finally {
      portableUploadRef.value?.clearFiles?.();
      portableUploadKey.value += 1;
    }
  }

  async function loadQuestionZipPackage(file: File) {
    const entries = parseStoredZip(await file.arrayBuffer());
    const assetUrlMap = await uploadZipAssets(entries);
    const templateEntry = entries.get('questions-template.md');
    const answerEntry = entries.get('answers.txt');
    const jsonEntry = entries.get('questions.json');

    if (jsonEntry) {
      const rows = portableQuestionsFromJson(JSON.parse(decodeText(jsonEntry.data))).map((row) =>
        rewritePortableQuestionAssets(row, assetUrlMap),
      );
      applyPortableQuestions(rows, '题目压缩包');
      return;
    }

    if (templateEntry) {
      structuredBatchQuestions.value = [];
      removedBatchRowKeys.value = new Set();
      batchText.value = rewritePortableAssetPaths(decodeText(templateEntry.data), assetUrlMap);
      batchAnswerText.value = answerEntry ? decodeText(answerEntry.data) : '';
      importMode.value = 'batch';
      refreshPreview();
      ElMessage.success('题目压缩包已载入，可预览后批量导入');
      return;
    }

    throw new Error('压缩包内缺少 questions-template.md 或 questions.json');
  }

  async function uploadZipAssets(entries: Map<string, StoredZipEntry>) {
    const assetUrlMap = new Map<string, string>();
    const assetEntries = [...entries.values()].filter((entry) => entry.name.startsWith('assets/') && !entry.name.endsWith('/'));
    for (const entry of assetEntries) {
      const filename = entry.name.split('/').pop() || 'asset';
      const blob = new Blob([Uint8Array.from(entry.data).buffer], { type: mimeByFilename(filename) });
      const uploadFile = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      const asset = await uploadAssetFile(uploadFile, { silent: true });
      assetUrlMap.set(entry.name, asset.url);
    }
    if (assetEntries.length) {
      ElMessage.success(`已恢复 ${assetEntries.length} 个题目附件`);
    }
    return assetUrlMap;
  }

  function applyPortableQuestions(rows: PortableQuestion[], sourceLabel: string) {
    const questions = rows.filter(Boolean);
    if (!questions.length) throw new Error(`${sourceLabel} 中没有可导入的题目`);
    structuredBatchQuestions.value = questions;
    removedBatchRowKeys.value = new Set();
    const { template, answers } = portableQuestionsToBatch(questions);
    batchText.value = template;
    batchAnswerText.value = answers;
    importMode.value = 'batch';
    refreshPreview();
    ElMessage.success(`已从 ${sourceLabel} 解析 ${questions.length} 道题，请检查后导入`);
  }

  function ensurePortableCsvRows(rows: Array<Record<string, string>>) {
    if (!rows.length) return;
    const headers = new Set(Object.keys(rows[0] ?? {}));
    const legacyPaperColumns = ['no', 'section', 'title', 'type', 'score', 'content', 'answer', 'analysis'].every((key) =>
      headers.has(key),
    );
    const hasTransferFields = ['contentMarkdown', 'optionsJson', 'answerJson', 'scoringRuleJson'].some((key) => headers.has(key));
    if (legacyPaperColumns && !hasTransferFields) {
      throw new Error(
        '这是旧版试卷文档 CSV，只包含阅读展示字段，缺少可回导字段：contentMarkdown、optionsJson、answerJson、scoringRuleJson、tagNames、knowledgePointNames。请用新版“CSV/JSON 迁移导出”重新导出。',
      );
    }
  }

  function buildPortablePreviewRow(question: PortableQuestion, index: number): BatchPreviewRow {
    const number = index + 1;
    const knowledgePointNames = mergeTags(selectedKnowledgeNames.value, question.knowledgePointNames);
    const courseName = normalizeCourseName(question.courseName ?? question.course?.name);
    const courseId = resolveCourseIdForImportedQuestion(question.courseId, courseName);
    const payload: BatchPreviewRow = {
      valid: true,
      number,
      courseId,
      courseName: selectedCourseName(courseId) || courseName,
      knowledgePointIds: mergeIds(sharedKnowledgePointIds.value, resolveKnowledgePointIdsByName(knowledgePointNames)),
      knowledgePointNames,
      type: normalizeType(question.type || 'single_choice'),
      title: question.title,
      tagNames: mergeTags(sharedTagNames.value, question.tagNames),
      content: question.content,
      difficulty: Number(question.difficulty) || 1,
      defaultScore: Number(question.defaultScore) || 2,
      analysis: question.analysis ?? '',
      options: question.options ?? [],
      answer: question.answer,
      scoringRule: question.scoringRule,
      programmingRef: normalizeProgrammingRef(question.programmingRef),
      allowOptionShuffle: question.allowOptionShuffle,
      answerText: portableAnswerForImport(question),
      statusText: '待导入',
    };

    try {
      validatePayload(payload, `第 ${number} 题`);
      return payload;
    } catch (error) {
      return {
        ...payload,
        valid: false,
        statusText: `格式错误：${errorMessage(error)}`,
        errorMessage: errorMessage(error),
      };
    }
  }

  function portableQuestionsFromJson(value: unknown): PortableQuestion[] {
    if (Array.isArray(value)) return value.map(normalizePortableQuestion);
    const record = recordValue(value);
    if (Array.isArray(record.questions)) return record.questions.map(normalizePortableQuestion);
    throw new Error('JSON 中缺少 questions 数组');
  }

  function normalizePortableQuestion(value: unknown): PortableQuestion {
    const record = recordValue(value);
    const importPayload = normalizePortableJson(record.importPayload);
    const source = importPayload && typeof importPayload === 'object' && !Array.isArray(importPayload)
      ? { ...recordValue(importPayload) }
      : { ...record };
    const course = recordValue(source.course ?? record.course);
    const tagNames = normalizeNameList(source.tagNames ?? record.tagNames ?? record.tags);
    const knowledgePointNames = normalizeNameList(source.knowledgePointNames ?? record.knowledgePointNames ?? record.knowledgePoints);
    const answer = recordValue(normalizePortableJson(source.answerJson ?? source.answer ?? record.answerJson ?? record.answer)) as QuestionAnswer;
    const options = applyPortableAnswerToOptions(
      normalizePortableOptions(source.optionsJson ?? source.options ?? record?.optionsJson ?? record?.options),
      answer,
    );
    const scoringRule = recordValue(normalizePortableJson(source.scoringRuleJson ?? source.scoringRule ?? record.scoringRuleJson ?? record.scoringRule)) as QuestionAnswer;
    const programmingRef = normalizeProgrammingRef(
      source.programmingRef ?? {
        externalProblemId: source.hydroProblemId ?? source.hydroProblemName ?? source.hydroProblem ?? source.externalProblemId,
        externalProblemUrl: source.hydroProblemUrl ?? source.hydroUrl ?? source.externalProblemUrl,
        languages: source.hydroLanguages ?? source.languages,
      },
    );

    return {
      type: normalizeType(source.type || record.type || 'single_choice'),
      title: String(source.title || record.title || '未命名题目').trim(),
      content: String(source.contentMarkdown ?? source.content ?? record.contentMarkdown ?? record.content ?? '').trim(),
      difficulty: Number(source.difficulty ?? record.difficulty ?? 1) || 1,
      defaultScore: Number(source.defaultScore ?? source.score ?? record.defaultScore ?? record.score ?? 2) || 2,
      analysis: String(source.analysisMarkdown ?? source.analysis ?? record.analysisMarkdown ?? record.analysis ?? '').trim(),
      tagNames,
      knowledgePointNames,
      options,
      answer,
      scoringRule,
      programmingRef,
      allowOptionShuffle: normalizeBoolean(source.allowOptionShuffle ?? record.allowOptionShuffle),
      courseId: String(source.courseId ?? record.courseId ?? course.id ?? ''),
      courseName: String(source.courseName ?? record.courseName ?? course.name ?? ''),
    };
  }

  function normalizePortableOptions(value: unknown): QuestionOption[] {
    const parsed = normalizePortableJson(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value, index) => {
      const option = recordValue(value);
      return {
        id: String(option.id ?? option.optionId ?? '') || undefined,
        optionKey: String(option.optionKey ?? option.label ?? optionKeyForIndex(index)).trim() || optionKeyForIndex(index),
        content: String(option.content ?? option.contentMarkdown ?? '').trim(),
        isCorrect: option.isCorrect === true || option.isCorrect === 'true',
        sortOrder: Number(option.sortOrder ?? index + 1) || index + 1,
      };
    });
  }

  function normalizePortableJson(value: unknown): unknown {
    if (value && typeof value === 'object') return value;
    const text = String(value ?? '').trim();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  function applyPortableAnswerToOptions(options: QuestionOption[], answer: QuestionAnswer): QuestionOption[] {
    if (!Array.isArray(answer?.correctOptionIds) || !options.length) return options;
    const correctIds = new Set(answer.correctOptionIds.map((item) => String(item)));
    return options.map((option) => ({
      ...option,
      isCorrect: option.isCorrect || correctIds.has(String(option.id)) || correctIds.has(String(option.optionKey)),
    }));
  }

  function normalizeBoolean(value: unknown) {
    if (value === true || value === 'true' || value === '1' || value === 1) return true;
    if (value === false || value === 'false' || value === '0' || value === 0) return false;
    return undefined;
  }

  function normalizeNameList(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === 'string' ? item : recordValue(item).name))
        .map((name) => String(name ?? '').trim())
        .filter(isMeaningfulName);
    }
    return parseTagNames(value);
  }

  function rewritePortableQuestionAssets(question: PortableQuestion, assetUrlMap: Map<string, string>): PortableQuestion {
    return {
      ...question,
      content: rewritePortableAssetPaths(question.content, assetUrlMap),
      analysis: rewritePortableAssetPaths(question.analysis, assetUrlMap),
      options: question.options.map((option) => ({
        ...option,
        content: rewritePortableAssetPaths(option.content, assetUrlMap),
      })),
    };
  }

  function rewritePortableAssetPaths(value: unknown, assetUrlMap: Map<string, string>) {
    let result = String(value ?? '');
    for (const [assetPath, url] of assetUrlMap.entries()) {
      result = result.split(assetPath).join(url);
    }
    return result;
  }

  function portableQuestionsToBatch(questions: PortableQuestion[]) {
    const blocks: string[] = [];
    const answers: string[] = [];
    questions.forEach((question, index) => {
      blocks.push(portableQuestionBlock(question));
      const answer = portableAnswerForImport(question);
      if (answer) answers.push(`${index + 1}. ${answer}`);
    });
    return {
      template: blocks.join('\n---\n'),
      answers: answers.join('\n'),
    };
  }

  function portableQuestionBlock(question: PortableQuestion) {
    const lines = [
      `标题：${question.title}`,
      question.courseName ? `课程：${question.courseName}` : '',
      `题型：${typeLabel(question.type)}`,
      `难度：${question.difficulty}`,
      `分值：${question.defaultScore}`,
    ].filter(Boolean);
    if (question.tagNames?.length) lines.push(`标签：${question.tagNames.join(',')}`);
    if (question.knowledgePointNames?.length) lines.push(`知识点：${question.knowledgePointNames.join(',')}`);
    if (question.type === 'programming' && question.programmingRef?.externalProblemId) {
      lines.push(`Hydro题目：${question.programmingRef.externalProblemId}`);
      if (question.programmingRef.externalProblemUrl) lines.push(`Hydro链接：${question.programmingRef.externalProblemUrl}`);
      if (question.programmingRef.languages?.length) lines.push(`Hydro语言：${question.programmingRef.languages.join(',')}`);
    }
    lines.push('题干：', question.content);
    if (isChoiceType(question.type)) {
      lines.push('选项：');
      for (const option of question.options) {
        const [firstLine, ...restLines] = String(option.content || '').split('\n');
        lines.push(`${option.optionKey}. ${firstLine ?? ''}`);
        lines.push(...restLines);
      }
    }
    if (question.analysis) lines.push('解析：', question.analysis);
    return lines.join('\n').trim();
  }

  function portableAnswerForImport(question: PortableQuestion) {
    if (isChoiceType(question.type)) {
      const correctKeys = question.options.filter((option) => option.isCorrect).map((option) => option.optionKey);
      if (correctKeys.length) return correctKeys.join(',');

      if (typeof question.answer === 'string') return question.answer;
      if (Array.isArray(question.answer?.correctOptionIds)) {
        return question.answer.correctOptionIds
          .map((id) => question.options.find((option) => option.id === id || option.optionKey === id)?.optionKey)
          .filter(Boolean)
          .join(',');
      }
    }

    if (question.type === 'fill_blank' && Array.isArray(question.answer?.blanks)) {
      return fillBlankAnswerTextFromRules(question.answer.blanks).replace(/\n/g, '；');
    }

    if (typeof question.answer?.reference === 'string') return question.answer.reference;
    if (typeof question.answer === 'string') return question.answer;
    return '';
  }

  return {
    handlePortableImportChange,
    loadQuestionZipPackage,
    uploadZipAssets,
    applyPortableQuestions,
    ensurePortableCsvRows,
    buildPortablePreviewRow,
    parseStoredZip,
    portableQuestionsFromJson,
    normalizePortableQuestion,
    normalizePortableOptions,
    normalizePortableJson,
    applyPortableAnswerToOptions,
    normalizeBoolean,
    normalizeNameList,
    rewritePortableQuestionAssets,
    rewritePortableAssetPaths,
    portableQuestionsToBatch,
    portableQuestionBlock,
    portableAnswerForImport,
    parseCsvRows,
    parseCsvTable,
    decodeText,
    mimeByFilename,
  };
}
