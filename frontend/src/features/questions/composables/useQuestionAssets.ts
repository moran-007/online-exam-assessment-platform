import type { Ref } from 'vue';
import { ElMessage, ElMessageBox, type UploadFile, type UploadInstance } from 'element-plus';
import {
  cleanupQuestionAssets,
  getQuestionAssetContent,
  getQuestionAssetReport,
  removeQuestionAsset,
  renameQuestionAsset,
  uploadQuestionAsset,
} from '../api';
import type {
  MaterialQuestionChild,
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

type AssetState = {
  uploadedAssets: Ref<QuestionAsset[]>;
  uploadingAsset: Ref<boolean>;
  assetDrawerVisible: Ref<boolean>;
  assetInsertTarget: Ref<AssetInsertTarget | null>;
  assetUploadRef: Ref<UploadInstance | null>;
  assetDrawerUploadRef: Ref<UploadInstance | null>;
  assetUploadKey: Ref<number>;
  assetReport: Ref<QuestionAssetReport | null>;
  assetReportLoading: Ref<boolean>;
  assetCleanupLoading: Ref<boolean>;
  importMode: Ref<string>;
  batchText: Ref<string>;
  batchAnswerText: Ref<string>;
  singleForm: SingleQuestionForm;
  refreshPreview: () => void;
};

export function useQuestionAssets(state: AssetState) {
  const {
    assetCleanupLoading,
    assetDrawerUploadRef,
    assetDrawerVisible,
    assetInsertTarget,
    assetReport,
    assetReportLoading,
    assetUploadKey,
    assetUploadRef,
    batchAnswerText,
    batchText,
    importMode,
    refreshPreview,
    singleForm,
    uploadedAssets,
    uploadingAsset,
  } = state;

  function errorMessage(error: unknown, fallback = '操作失败') {
    return error instanceof Error ? error.message : fallback;
  }

  function setImageInsertTarget(target: MarkdownObject, field: MarkdownField) {
    assetInsertTarget.value = { type: 'object', target, field };
  }

  function setBatchInsertTarget(field: 'batchText' | 'batchAnswerText' | 'singleContent') {
    assetInsertTarget.value = { type: 'batch', field };
  }

  async function handleAssetUploadChange(uploadFile: UploadFile) {
    const file = uploadFile?.raw;
    if (!file) return;
    try {
      await uploadAssetFile(file);
      assetDrawerVisible.value = true;
    } finally {
      assetUploadRef.value?.clearFiles?.();
      assetDrawerUploadRef.value?.clearFiles?.();
      assetUploadKey.value += 1;
    }
  }

  async function handleImagePaste(event: ClipboardEvent, target: MarkdownObject, field: MarkdownField) {
    const file = extractImageFromClipboard(event);
    if (!file) return;

    event.preventDefault();
    setImageInsertTarget(target, field);
    const asset = await uploadAssetFile(file);
    insertUploadedAsset(asset);
  }

  async function handleBatchImagePaste(event: ClipboardEvent, field: 'batchText' | 'batchAnswerText' | 'singleContent') {
    const file = extractImageFromClipboard(event);
    if (!file) return;

    event.preventDefault();
    setBatchInsertTarget(field);
    const asset = await uploadAssetFile(file);
    insertUploadedAsset(asset);
  }

  function extractImageFromClipboard(event: ClipboardEvent) {
    const items = [...(event.clipboardData?.items ?? [])];
    return items.find((item) => item.type?.startsWith('image/'))?.getAsFile() ?? null;
  }

  async function uploadAssetFile(file: File, options: { silent?: boolean } = {}): Promise<QuestionAsset> {
    uploadingAsset.value = true;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const asset = await uploadQuestionAsset(formData);
      const normalized = normalizeUploadedAsset(asset);
      await prepareAssetPreview(normalized);
      uploadedAssets.value = [normalized, ...uploadedAssets.value.filter((item) => item.url !== normalized.url)].slice(0, 24);
      if (!options.silent) {
        ElMessage.success(normalized.isImage ? '图片已上传' : '附件已上传');
      }
      return normalized;
    } finally {
      uploadingAsset.value = false;
    }
  }

  function insertUploadedAsset(asset: QuestionAsset) {
    const markdown = assetMarkdown(asset);
    if (!markdown) return;

    if (!assetInsertTarget.value) {
      setBatchInsertTarget(importMode.value === 'batch' ? 'batchText' : 'singleContent');
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

  async function renameAsset(asset: QuestionAsset) {
    const nextName = String(asset.displayName || '').trim();
    if (!nextName) {
      asset.displayName = asset.savedDisplayName || asset.filename;
      return;
    }
    if (nextName === asset.savedDisplayName) return;

    const oldUrl = asset.url;
    const oldMarkdown = assetMarkdown(asset);
    try {
      const renamed = normalizeUploadedAsset(
        await renameQuestionAsset(asset.filename, { displayName: nextName }),
      );
      releaseAssetPreview(asset);
      await prepareAssetPreview(renamed);
      Object.assign(asset, renamed);
      replaceAssetReferences(oldUrl, asset.url, oldMarkdown, assetMarkdown(asset));
      ElMessage.success('附件已重命名');
    } catch (error) {
      asset.displayName = asset.savedDisplayName || asset.displayName;
      ElMessage.error(errorMessage(error));
    }
  }

  async function removeUploadedAsset(asset: QuestionAsset) {
    try {
      await removeQuestionAsset(asset.filename);
      releaseAssetPreview(asset);
      uploadedAssets.value = uploadedAssets.value.filter((item) => item.url !== asset.url);
      removeAssetReferences(asset.url);
      ElMessage.success('附件已删除');
      refreshPreview();
    } catch (error) {
      ElMessage.error(errorMessage(error));
    }
  }

  async function loadQuestionAssetReport() {
    assetReportLoading.value = true;
    try {
      assetReport.value = await getQuestionAssetReport();
      ElMessage.success('资源检查完成');
    } catch (error) {
      ElMessage.error(errorMessage(error, '资源检查失败'));
    } finally {
      assetReportLoading.value = false;
    }
  }

  async function cleanupQuestionAssetOrphans() {
    if (!assetReport.value?.orphanCount) return;
    try {
      await ElMessageBox.confirm(
        `将删除 ${assetReport.value.orphanCount} 个未被题目、试卷快照或作答实例引用的本地题目附件。此操作不可恢复，是否继续？`,
        '清理孤立附件',
        { type: 'warning' },
      );
    } catch {
      return;
    }

    assetCleanupLoading.value = true;
    try {
      const result = await cleanupQuestionAssets();
      const deletedUrls = new Set((result.deleted ?? []).map((item) => item.url));
      if (deletedUrls.size) {
        uploadedAssets.value = uploadedAssets.value.filter((asset) => !deletedUrls.has(asset.url));
      }
      ElMessage.success(`已清理 ${result.deletedCount} 个孤立附件${result.failedCount ? `，${result.failedCount} 个失败` : ''}`);
      await loadQuestionAssetReport();
    } catch (error) {
      ElMessage.error(errorMessage(error, '清理失败'));
    } finally {
      assetCleanupLoading.value = false;
    }
  }

  function normalizeUploadedAsset(asset: QuestionAsset): QuestionAsset {
    const filename = asset?.filename || '附件';
    const displayName = asset?.displayName || filename.replace(/\.[^.]+$/, '') || filename;
    return {
      ...asset,
      displayName,
      savedDisplayName: displayName,
      isImage: Boolean(asset?.isImage) || /\.(png|jpe?g|gif|webp|svg)$/i.test(filename),
      align: asset?.align || 'center',
      width: Number(asset?.width) || 80,
      previewUrl: asset?.previewUrl || '',
    };
  }

  async function prepareAssetPreview(asset: QuestionAsset) {
    if (!asset?.isImage || !asset?.filename) return;
    try {
      const blob = await getQuestionAssetContent(asset.filename);
      asset.previewUrl = URL.createObjectURL(blob);
    } catch {
      asset.previewUrl = '';
    }
  }

  function releaseAssetPreview(asset: QuestionAsset) {
    if (asset?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(asset.previewUrl);
    if (asset) asset.previewUrl = '';
  }

  function assetMarkdown(asset: QuestionAsset) {
    const url = asset?.url;
    if (!url) return asset?.markdown || '';
    const label = String(asset.displayName || asset.filename || '附件').trim() || '附件';
    return asset.isImage ? `![${label}](${assetImageUrl(asset)})` : `[${label}](${url})`;
  }

  function assetImageUrl(asset: QuestionAsset) {
    const url = new URL(asset.url, window.location.origin);
    const align = asset.align ?? 'center';
    url.searchParams.set('align', ['left', 'center', 'right'].includes(align) ? align : 'center');
    url.searchParams.set('w', String(clampImageWidth(asset.width)));
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function clampImageWidth(value: unknown) {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) return 80;
    return Math.min(100, Math.max(20, Math.round(nextValue)));
  }

  function appendMarkdownToObject(target: MarkdownObject, field: MarkdownField, markdown: string) {
    const record = target as unknown as Record<MarkdownField, string>;
    record[field] = appendMarkdownText(record[field], markdown);
  }

  function appendMarkdownText(value: unknown, markdown: string) {
    const current = String(value || '').trimEnd();
    return `${current}${current ? '\n\n' : ''}${markdown}\n`;
  }

  function replaceAssetReferences(oldUrl: string, nextUrl: string, oldMarkdown: string, nextMarkdown: string) {
    const replaceValue = (value: unknown) => String(value || '').split(oldMarkdown).join(nextMarkdown).split(oldUrl).join(nextUrl);
    singleForm.content = replaceValue(singleForm.content);
    singleForm.analysis = replaceValue(singleForm.analysis);
    singleForm.options.forEach((option) => {
      option.content = replaceValue(option.content);
    });
    batchText.value = replaceValue(batchText.value);
    batchAnswerText.value = replaceValue(batchAnswerText.value);
    refreshPreview();
  }

  function removeAssetReferences(url: string) {
    const removeValue = (value: unknown) =>
      String(value || '')
        .split('\n')
        .filter((line) => !line.includes(url))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n');
    singleForm.content = removeValue(singleForm.content);
    singleForm.analysis = removeValue(singleForm.analysis);
    singleForm.options.forEach((option) => {
      option.content = removeValue(option.content);
    });
    batchText.value = removeValue(batchText.value);
    batchAnswerText.value = removeValue(batchAnswerText.value);
  }

  function fileExt(asset: QuestionAsset) {
    const match = String(asset.filename || asset.url || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toUpperCase().slice(0, 5) : 'FILE';
  }

  function formatFileSize(size: unknown) {
    const value = Number(size || 0);
    if (!value) return '未知大小';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  }

  return {
    setImageInsertTarget,
    setBatchInsertTarget,
    handleAssetUploadChange,
    handleImagePaste,
    handleBatchImagePaste,
    extractImageFromClipboard,
    uploadAssetFile,
    insertUploadedAsset,
    renameAsset,
    removeUploadedAsset,
    loadQuestionAssetReport,
    cleanupQuestionAssetOrphans,
    normalizeUploadedAsset,
    prepareAssetPreview,
    releaseAssetPreview,
    assetMarkdown,
    assetImageUrl,
    clampImageWidth,
    appendMarkdownToObject,
    appendMarkdownText,
    replaceAssetReferences,
    removeAssetReferences,
    fileExt,
    formatFileSize,
  };
}
