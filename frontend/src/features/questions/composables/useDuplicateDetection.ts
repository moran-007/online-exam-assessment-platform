import type { ComputedRef, Ref } from 'vue';
import { ElMessage } from 'element-plus';
import { checkQuestionDuplicates } from '../api';
import type {
  BatchPreviewRow,
  DuplicateCheckItem,
  QuestionConflictStatus,
  QuestionOption,
} from '../models';

type DuplicateCheckOptions = { silent?: boolean };
type DuplicateState = {
  importMode: Ref<string>;
  singlePreviewError: ComputedRef<string>;
  singlePreviewQuestion: ComputedRef<BatchPreviewRow>;
  singleDuplicateChecking: Ref<boolean>;
  singleConflictResult: Ref<DuplicateCheckItem | null>;
  duplicateChecking: Ref<boolean>;
  batchPreview: Ref<BatchPreviewRow[]>;
  removedBatchRowKeys: Ref<Set<string>>;
  selectedPreviewIndex: Ref<number>;
  refreshPreview: () => void;
  normalizeType: (value: unknown) => string;
  isChoiceType: (type: string) => boolean;
  optionKeyForIndex: (index: number) => string;
};

export function useDuplicateDetection(state: DuplicateState) {
  const {
    batchPreview,
    duplicateChecking,
    importMode,
    isChoiceType,
    normalizeType,
    optionKeyForIndex,
    removedBatchRowKeys,
    selectedPreviewIndex,
    singleConflictResult,
    singleDuplicateChecking,
    singlePreviewError,
    singlePreviewQuestion,
  } = state;
  let singleDuplicateTimer: number | null = null;
  let lastSingleDuplicateKey = '';

  function errorMessage(error: unknown, fallback = '操作失败') {
    return error instanceof Error ? error.message : fallback;
  }

  async function runSingleDuplicateCheck(options: DuplicateCheckOptions = {}) {
    if (singlePreviewError.value) {
      if (!options.silent) ElMessage.error(singlePreviewError.value);
      return null;
    }

    const payload = buildDuplicateCheckPayload(singlePreviewQuestion.value);
    const currentKey = JSON.stringify(payload);
    if (options.silent && currentKey === lastSingleDuplicateKey && singleConflictResult.value) {
      return singleConflictResult.value;
    }

    singleDuplicateChecking.value = true;
    try {
      const result = await checkQuestionDuplicates({ questions: [payload] });
      const item = result.items?.[0] ?? { index: 0, status: 'ok', message: '未发现重复或冲突', matches: [] };
      singleConflictResult.value = item;
      lastSingleDuplicateKey = currentKey;
      if (!options.silent) {
        if (item.status === 'ok') {
          ElMessage.success('未发现重复或冲突');
        } else {
          ElMessage.warning(`${conflictLabel(item.status)}：${item.message}`);
        }
      }
      return item;
    } catch (error) {
      if (!options.silent) {
        ElMessage.error(errorMessage(error, '重复检测失败'));
      }
      return null;
    } finally {
      singleDuplicateChecking.value = false;
    }
  }

  function scheduleSingleDuplicateCheck() {
    if (singleDuplicateTimer) {
      window.clearTimeout(singleDuplicateTimer);
      singleDuplicateTimer = null;
    }
    singleConflictResult.value = null;
    lastSingleDuplicateKey = '';
    if (importMode.value !== 'single' || singlePreviewError.value) return;
    singleDuplicateTimer = window.setTimeout(() => {
      runSingleDuplicateCheck({ silent: true });
    }, 600);
  }

  async function runDuplicateCheck(options: DuplicateCheckOptions = {}) {
    if (!batchPreview.value.length || batchPreview.value.some((row) => row.valid === false)) return null;
    duplicateChecking.value = true;
    try {
      const payloads = batchPreview.value.map((row) => buildDuplicateCheckPayload(row));
      const result = await checkQuestionDuplicates({ questions: payloads });
      for (const item of result.items ?? []) {
        const row = batchPreview.value[item.index];
        if (!row) continue;
        row.conflictStatus = item.status;
        row.conflictMessage = item.status === 'ok' ? '' : item.message;
        row.conflictMatches = item.matches ?? [];
      }
      const conflictCount = result.conflictCount ?? 0;
      const warningCount = (result.duplicateCount ?? 0) + (result.similarCount ?? 0);
      if (!options.silent) {
        if (conflictCount) {
          ElMessage.warning(`发现 ${conflictCount} 道冲突题，请检查后再导入`);
        } else if (warningCount) {
          ElMessage.warning(`发现 ${warningCount} 道重复或相似题`);
        } else {
          ElMessage.success('未发现重复或冲突');
        }
      }
      return result;
    } catch (error) {
      if (!options.silent) {
        ElMessage.error(errorMessage(error, '重复检测失败'));
      }
      return null;
    } finally {
      duplicateChecking.value = false;
    }
  }

  function buildDuplicateCheckPayload(row: BatchPreviewRow) {
    return {
      courseId: row.courseId,
      courseName: row.courseName,
      type: row.type,
      title: row.title,
      comparable: buildComparableSummary(row),
    };
  }

  function buildComparableSummary(row: BatchPreviewRow) {
    const type = normalizeType(row.type || 'single_choice');
    const titleKey = normalizeComparableText(row.title);
    const contentKey = normalizeComparableText(row.content);
    const options = comparableOptions(row.options ?? []);
    const optionContentKey = options.map((option) => normalizeComparableText(option.content)).join('|');
    const optionFullKey = options
      .map((option) => `${normalizeComparableText(option.content)}:${option.isCorrect ? '1' : '0'}`)
      .join('|');
    const answerKey = stableStringify(isChoiceType(type) ? {} : row.answer ?? {});

    return {
      titleKey,
      contentHash: hashComparableText(contentKey),
      contentLength: contentKey.length,
      optionContentHash: hashComparableText(optionContentKey),
      optionContentLength: optionContentKey.length,
      optionFullHash: hashComparableText(optionFullKey),
      optionFullLength: optionFullKey.length,
      answerHash: hashComparableText(answerKey),
      answerLength: answerKey.length,
    };
  }

  function comparableOptions(options: QuestionOption[]) {
    return [...(options ?? [])]
      .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || String(a.optionKey ?? '').localeCompare(String(b.optionKey ?? '')))
      .map((option, index) => ({
        optionKey: String(option.optionKey || optionKeyForIndex(index)).trim(),
        content: String(option.content ?? '').trim(),
        isCorrect: Boolean(option.isCorrect),
      }));
  }

  function normalizeComparableText(value: unknown) {
    return String(value ?? '')
      .replace(/!\[[^\]]*]\([^)]+\)/g, '![image]')
      .replace(/\[[^\]]+]\([^)]+\)/g, '[link]')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value ?? null);
  }

  function hashComparableText(value: string) {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask = 0xffffffffffffffffn;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= BigInt(value.charCodeAt(index));
      hash = (hash * prime) & mask;
    }
    return hash.toString(16).padStart(16, '0');
  }

  function shouldSkipBatchRow(row: BatchPreviewRow) {
    return row.conflictStatus === 'duplicate' || row.conflictStatus === 'conflict';
  }

  function makeBatchRowKey(row: BatchPreviewRow) {
    return [
      String(row.number || '').trim(),
      String(row.title || '').trim(),
      String(row.type || '').trim(),
      String(row.content || '').trim(),
      JSON.stringify(row.options ?? []),
      JSON.stringify(row.answer ?? null),
    ].join('|');
  }

  function withBatchRowKey(row: BatchPreviewRow): BatchPreviewRow {
    return {
      ...row,
      batchKey: row.batchKey || makeBatchRowKey(row),
    };
  }

  function filterRemovedBatchRows(rows: BatchPreviewRow[]) {
    const removed = removedBatchRowKeys.value;
    return rows.filter((row) => !removed.has(row.batchKey || makeBatchRowKey(row)));
  }

  function removeBatchPreviewRow(value: unknown) {
    const row = batchPreview.value.find((item) => item === value);
    if (!row) return;
    const key = row.batchKey || makeBatchRowKey(row);
    removedBatchRowKeys.value = new Set([...removedBatchRowKeys.value, key]);
    batchPreview.value = batchPreview.value.filter((item) => item !== row);
    if (selectedPreviewIndex.value >= batchPreview.value.length) {
      selectedPreviewIndex.value = Math.max(0, batchPreview.value.length - 1);
    }
    ElMessage.success('已从本次导入预览中移除');
  }

  function conflictLabel(status: QuestionConflictStatus) {
    const labels: Partial<Record<QuestionConflictStatus, string>> = { conflict: '冲突', duplicate: '重复', similar: '相似' };
    return labels[status] || status;
  }

  function conflictTagType(status: QuestionConflictStatus) {
    if (status === 'conflict') return 'danger';
    if (status === 'duplicate') return 'warning';
    return 'info';
  }

  function selectPreview(row: BatchPreviewRow | null) {
    if (!row) return;
    const index = batchPreview.value.indexOf(row);
    if (index >= 0) selectedPreviewIndex.value = index;
  }

  function disposeDuplicateDetection() {
    if (singleDuplicateTimer) window.clearTimeout(singleDuplicateTimer);
    singleDuplicateTimer = null;
  }

  return {
    runSingleDuplicateCheck,
    scheduleSingleDuplicateCheck,
    runDuplicateCheck,
    buildDuplicateCheckPayload,
    buildComparableSummary,
    comparableOptions,
    normalizeComparableText,
    stableStringify,
    hashComparableText,
    shouldSkipBatchRow,
    makeBatchRowKey,
    withBatchRowKey,
    filterRemovedBatchRows,
    removeBatchPreviewRow,
    conflictLabel,
    conflictTagType,
    selectPreview,
    disposeDuplicateDetection,
  };
}
