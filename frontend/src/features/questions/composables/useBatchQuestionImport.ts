import type { ComputedRef, Ref } from 'vue';
import { ElMessage } from 'element-plus';
import { createQuestion, publishQuestion } from '../api';
import type {
  BatchParseResult,
  BatchPreviewRow,
  MaterialQuestionChild,
  PortableQuestion,
  QuestionMutationPayload,
  QuestionOption,
  SingleQuestionForm,
} from '../models';
import type { AssetInsertTarget } from './useQuestionAssets';

type MarkdownField = 'title' | 'content' | 'analysis' | 'answerText';
type MarkdownObject = SingleQuestionForm | MaterialQuestionChild | QuestionOption;
type BatchState = {
  importMode: Ref<string>;
  structuredBatchQuestions: Ref<PortableQuestion[]>;
  removedBatchRowKeys: Ref<Set<string>>;
  batchText: Ref<string>;
  batchAnswerText: Ref<string>;
  batchPreview: Ref<BatchPreviewRow[]>;
  batchErrorSummary: Ref<string>;
  selectedPreviewIndex: Ref<number>;
  selectedKnowledgeNames: ComputedRef<string[]>;
  sharedKnowledgePointIds: Ref<string[]>;
  sharedTagNames: Ref<string[]>;
  importing: Ref<boolean>;
  publishAfterImport: Ref<boolean>;
  singleForm: SingleQuestionForm;
  assetInsertTarget: Ref<AssetInsertTarget | null>;
  formatSnippets: Record<string, string>;
  buildPortablePreviewRow: (question: PortableQuestion, index: number) => BatchPreviewRow;
  withBatchRowKey: (row: BatchPreviewRow) => BatchPreviewRow;
  filterRemovedBatchRows: (rows: BatchPreviewRow[]) => BatchPreviewRow[];
  parseBatchResult: (text: string, answerText?: string) => BatchParseResult;
  mergeIds: (...groups: string[][]) => string[];
  mergeTags: (...groups: Array<Array<string | null | undefined>>) => string[];
  formatBatchErrors: (errors: Array<{ number: number; title: string; message: string }>) => string;
  runDuplicateCheck: (options?: { silent?: boolean }) => Promise<unknown>;
  shouldSkipBatchRow: (row: BatchPreviewRow) => boolean;
  questionPayload: (row: BatchPreviewRow) => QuestionMutationPayload;
  resolveTagIds: (tagNames?: string[]) => Promise<string[]>;
  setBatchInsertTarget: (field: 'batchText' | 'batchAnswerText' | 'singleContent') => void;
  setImageInsertTarget: (target: MarkdownObject, field: MarkdownField) => void;
  appendMarkdownToObject: (target: MarkdownObject, field: MarkdownField, markdown: string) => void;
  appendMarkdownText: (value: unknown, markdown: string) => string;
};

export function useBatchQuestionImport(state: BatchState) {
  const {
    appendMarkdownText, appendMarkdownToObject, assetInsertTarget, batchAnswerText,
    batchErrorSummary, batchPreview, batchText, buildPortablePreviewRow, filterRemovedBatchRows,
    formatBatchErrors, formatSnippets, importMode, importing, mergeIds, mergeTags,
    parseBatchResult, publishAfterImport, questionPayload, removedBatchRowKeys, resolveTagIds,
    runDuplicateCheck, selectedKnowledgeNames, selectedPreviewIndex, setBatchInsertTarget,
    setImageInsertTarget, sharedKnowledgePointIds, sharedTagNames, shouldSkipBatchRow,
    singleForm, structuredBatchQuestions, withBatchRowKey,
  } = state;

  function errorMessage(error: unknown, fallback = '操作失败') {
    return error instanceof Error ? error.message : fallback;
  }

  function refreshPreview() {
    if (importMode.value !== 'batch') return;

    try {
      if (structuredBatchQuestions.value.length) {
        const rows = structuredBatchQuestions.value.map((question, index) => withBatchRowKey(buildPortablePreviewRow(question, index)));
        batchPreview.value = filterRemovedBatchRows(rows);
        batchErrorSummary.value = rows.some((row) => row.valid === false) ? formatBatchErrors(
          rows
            .filter((row) => row.valid === false)
            .map((row) => ({ number: row.number, title: row.title, message: row.errorMessage ?? '格式错误' })),
        ) : '';
        if (selectedPreviewIndex.value >= batchPreview.value.length) {
          selectedPreviewIndex.value = 0;
        }
        return;
      }

      const result = parseBatchResult(batchText.value, batchAnswerText.value);
      batchPreview.value = filterRemovedBatchRows(
        result.rows.map((row) =>
          withBatchRowKey({
            ...row,
            knowledgePointIds: mergeIds(sharedKnowledgePointIds.value, row.knowledgePointIds ?? []),
            knowledgePointNames: mergeTags(selectedKnowledgeNames.value, row.knowledgePointNames ?? []),
            tagNames: mergeTags(sharedTagNames.value, row.tagNames ?? []),
          }),
        ),
      );
      batchErrorSummary.value = result.errors.length ? formatBatchErrors(result.errors) : '';
      if (selectedPreviewIndex.value >= batchPreview.value.length) {
        selectedPreviewIndex.value = 0;
      }
    } catch (error) {
      batchPreview.value = [];
      batchErrorSummary.value = batchText.value.trim() ? errorMessage(error) : '';
    }
  }

  function handleBatchTemplateInput() {
    structuredBatchQuestions.value = [];
    removedBatchRowKeys.value = new Set();
    refreshPreview();
  }

  function handleImportModeChange() {
    if (importMode.value === 'batch') {
      setBatchInsertTarget('batchText');
    } else {
      setImageInsertTarget(singleForm, 'content');
    }
    refreshPreview();
  }

  async function previewBatch() {
    refreshPreview();
    if (batchErrorSummary.value) {
      ElMessage.error('存在格式问题，请查看解析结果');
    } else {
      await runDuplicateCheck({ silent: true });
      ElMessage.success(`解析到 ${batchPreview.value.length} 道题`);
    }
  }

  async function importBatch() {
    importMode.value = 'batch';
    refreshPreview();
    if (!batchPreview.value.length) {
      ElMessage.error('请先粘贴题目内容');
      return;
    }
    if (batchPreview.value.some((row) => row.valid === false)) {
      ElMessage.error('批量录入格式未通过，请先修正错误');
      return;
    }
    await runDuplicateCheck({ silent: true });
    const skippedRows = batchPreview.value.filter(shouldSkipBatchRow);
    const importRows = batchPreview.value.filter((row) => row.valid !== false && !shouldSkipBatchRow(row));
    if (skippedRows.length) {
      skippedRows.forEach((row) => {
        row.statusText = row.conflictStatus === 'conflict' ? '已跳过：题目冲突' : '已跳过：重复题目';
      });
      ElMessage.warning(`已跳过 ${skippedRows.length} 道重复/冲突题，其余题目继续导入`);
    } else if (batchPreview.value.some((row) => row.conflictStatus === 'similar')) {
      ElMessage.warning('检测到相似题目，已在解析结果中标注；相似题默认继续导入');
    }
    if (!importRows.length) {
      ElMessage.warning('没有可导入题目，请移除重复/冲突项或修改内容后重试');
      return;
    }

    importing.value = true;
    let successCount = 0;
    try {
      for (const question of importRows) {
        const index = batchPreview.value.indexOf(question);
        const tagNames = question.tagNames;
        const payload = questionPayload(question);
        try {
          payload.tagIds = await resolveTagIds(tagNames);
          const created = await createQuestion(payload);
          if (publishAfterImport.value) {
            await publishQuestion(created.id);
          }
          if (index >= 0) batchPreview.value[index].statusText = publishAfterImport.value ? '已导入并发布' : '已导入';
          successCount += 1;
        } catch (error) {
          if (index >= 0) {
            batchPreview.value[index].valid = false;
            batchPreview.value[index].statusText = errorMessage(error);
          }
        }
      }
    } finally {
      importing.value = false;
    }

    ElMessage.success(`成功导入 ${successCount} / ${importRows.length} 道题，跳过 ${skippedRows.length} 道重复/冲突题`);
  }

  function loadBatchTemplate() {
    structuredBatchQuestions.value = [];
    removedBatchRowKeys.value = new Set();
    batchText.value = [
      '标题：批量示例：Python 输出',
      '题型：单选题',
      '难度：1',
      '分值：2',
      '标签：Python,代码阅读',
      '知识点：变量与表达式',
      '题干：',
      '阅读代码，输出结果是什么？题干可包含数学公式 $a^2 + b^2 = c^2$ 和化学式 @chem{CO2}。',
      '',
      '$$',
      'f(x)=x^2+2x+1',
      '$$',
      '',
      '```python',
      'print(1 + 2)',
      '```',
      '选项：',
      'A. `1`',
      'B. `3`',
      'C. `12`',
      'D. `None`',
      '解析：',
      '表达式 `1 + 2` 的结果是 `3`。常用特殊符号：≤ ≥ ≠ ± × ÷ √ ∑ ∞。',
      '---',
      '标题：批量示例：可变容器',
      '题型：多选题',
      '难度：2',
      '分值：4',
      '标签：Python,数据结构',
      '知识点：列表,字典',
      '题干：',
      'Python 中哪些是常见可变容器？',
      '选项：',
      'A. list',
      'B. dict',
      'C. int',
      'D. str',
      'E. set',
      '解析：',
      '`list`、`dict` 和 `set` 可以原地修改。',
      '---',
      '标题：批量示例：多空填空',
      '题型：填空题',
      '难度：1',
      '分值：6',
      '标签：Python,基础语法',
      '知识点：循环,函数',
      '题干：',
      '补全代码相关概念：输出函数是 ____，循环范围函数是 ____，获取序列长度函数是 ____。',
      '解析：',
      '`print` 输出内容，`range` 生成循环范围，`len` 返回长度。',
    ].join('\n');
    batchAnswerText.value = ['1. B', '2. A,B,E', '3. 第1空：print；第2空：range；第3空：len'].join('\n');
    refreshPreview();
  }

  function insertCodeBlock(target: MarkdownObject, field: MarkdownField) {
    appendMarkdownToObject(target, field, '\n```python\nprint("hello")\n```\n');
    setImageInsertTarget(target, field);
  }

  function insertFormatSnippet(command: keyof typeof formatSnippets) {
    const snippet = formatSnippets[command];
    if (!snippet) return;
    insertMarkdownSnippet(snippet);
  }

  function insertMarkdownSnippet(markdown: string) {
    if (!assetInsertTarget.value) {
      if (importMode.value === 'batch') {
        setBatchInsertTarget('batchText');
      } else {
        setImageInsertTarget(singleForm, 'content');
      }
    }

    if (assetInsertTarget.value?.type === 'object') {
      appendMarkdownToObject(assetInsertTarget.value.target, assetInsertTarget.value.field, markdown);
    } else if (assetInsertTarget.value?.field === 'batchAnswerText') {
      batchAnswerText.value = appendMarkdownText(batchAnswerText.value, markdown);
    } else if (assetInsertTarget.value?.field === 'singleContent') {
      singleForm.content = appendMarkdownText(singleForm.content, markdown);
    } else {
      batchText.value = appendMarkdownText(batchText.value, markdown);
    }

    refreshPreview();
  }

  return { refreshPreview, handleBatchTemplateInput, handleImportModeChange, previewBatch, importBatch, loadBatchTemplate, insertCodeBlock, insertFormatSnippet, insertMarkdownSnippet };
}
