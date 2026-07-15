import { uploadQuestionAsset } from '../../questions/api';
import type { PaperImportPackage, PaperImportQuestion, PaperSnapshotOption } from '../models';

type UnknownRecord = Record<string, unknown>;
type ZipEntry = { name: string; data: Uint8Array };

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

export async function readPaperImportZip(file: File): Promise<PaperImportPackage> {
  const entries = parseStoredZip(await file.arrayBuffer());
  const jsonEntry = entries.get('questions.json');
  if (!jsonEntry) throw new Error('试卷迁移包缺少 questions.json，请使用新版 ZIP 迁移包');
  const assetUrlMap = await uploadPaperZipAssets(entries);
  return readPaperImportJson(JSON.parse(decodeText(jsonEntry.data)) as unknown, assetUrlMap);
}

export function readPaperImportJson(
  value: unknown,
  assetUrlMap = new Map<string, string>(),
): PaperImportPackage {
  const root = recordValue(value);
  const records = Array.isArray(value) ? value : root.questions;
  if (!Array.isArray(records) || !records.length) throw new Error('JSON 中缺少 questions 数组');
  const paper = recordValue(root.paper);
  const first = recordValue(records[0]);
  return {
    paperName: String(paper.name || root.paperName || first.paperName || '导入试卷'),
    durationMinutes: Number(paper.durationMinutes ?? root.durationMinutes) || 60,
    shuffleQuestions: normalizeBoolean(paper.shuffleQuestions ?? root.shuffleQuestions),
    shuffleOptions: normalizeBoolean(paper.shuffleOptions ?? root.shuffleOptions),
    questions: records.map((record, index) => normalizePaperImportRecord(record, index, assetUrlMap)),
  };
}

function normalizePaperImportRecord(
  value: unknown,
  index: number,
  assetUrlMap: Map<string, string>,
): PaperImportQuestion {
  const record = recordValue(value);
  const importPayload = normalizeJsonish(record.importPayload);
  const source = { ...record, ...recordValue(importPayload) };
  const answer = normalizeJsonish(source.answerJson ?? source.answer ?? record.answerJson ?? record.answer);
  const options = normalizePaperImportOptions(
    source.optionsJson ?? source.options ?? record.optionsJson ?? record.options,
    answer,
    assetUrlMap,
  );
  return {
    ...source,
    no: Number(source.no ?? record.no ?? index + 1) || index + 1,
    paperName: optionalString(source.paperName ?? record.paperName),
    sectionTitle: optionalString(source.sectionTitle ?? source.section ?? record.sectionTitle ?? record.section),
    type: normalizeQuestionType(source.type || record.type || 'single_choice'),
    title: String(source.title || record.title || '未命名题目').trim(),
    content: rewritePaperAssetPaths(
      source.contentMarkdown ?? source.content ?? record.contentMarkdown ?? record.content ?? '',
      assetUrlMap,
    ),
    difficulty: Number(source.difficulty ?? record.difficulty ?? 1) || 1,
    defaultScore: Number(source.defaultScore ?? source.score ?? record.defaultScore ?? record.score ?? 2) || 2,
    score: Number(source.score ?? source.defaultScore ?? record.score ?? record.defaultScore ?? 2) || 2,
    analysis: rewritePaperAssetPaths(
      source.analysisMarkdown ?? source.analysis ?? record.analysisMarkdown ?? record.analysis ?? '',
      assetUrlMap,
    ),
    options,
    answer,
    scoringRule: normalizeJsonish(source.scoringRuleJson ?? source.scoringRule ?? record.scoringRuleJson ?? record.scoringRule),
    tagNames: normalizeNameList(source.tagNames ?? record.tagNames ?? record.tags),
    knowledgePointNames: normalizeNameList(source.knowledgePointNames ?? record.knowledgePointNames ?? record.knowledgePoints),
    allowOptionShuffle: normalizeBoolean(source.allowOptionShuffle ?? record.allowOptionShuffle),
    courseId: optionalString(source.courseId ?? record.courseId),
  };
}

function normalizePaperImportOptions(
  value: unknown,
  answer: unknown,
  assetUrlMap: Map<string, string>,
): PaperSnapshotOption[] {
  const parsed = normalizeJsonish(value);
  if (!Array.isArray(parsed)) return [];
  const answerRecord = recordValue(answer);
  const correctIds = new Set(
    Array.isArray(answerRecord.correctOptionIds) ? answerRecord.correctOptionIds.map(String) : [],
  );
  return parsed.map((rawOption, index) => {
    const option = recordValue(rawOption);
    const id = option.id ?? option.optionId;
    const optionKey = String(option.optionKey ?? option.label ?? optionKeyForIndex(index)).trim()
      || optionKeyForIndex(index);
    return {
      id: optionalString(id),
      optionKey,
      content: rewritePaperAssetPaths(option.content ?? option.contentMarkdown ?? '', assetUrlMap),
      isCorrect: option.isCorrect === true || option.isCorrect === 'true'
        || correctIds.has(String(id ?? option.optionKey)),
      sortOrder: Number(option.sortOrder ?? index + 1) || index + 1,
    };
  });
}

async function uploadPaperZipAssets(entries: Map<string, ZipEntry>) {
  const assetUrlMap = new Map<string, string>();
  const assetEntries = [...entries.values()].filter(
    (entry) => entry.name.startsWith('assets/') && !entry.name.endsWith('/'),
  );
  for (const entry of assetEntries) {
    const filename = entry.name.split('/').pop() || 'asset';
    const formData = new FormData();
    const content = entry.data.slice().buffer as ArrayBuffer;
    formData.append('file', new File([new Blob([content], { type: mimeByFilename(filename) })], filename));
    const asset = await uploadQuestionAsset(formData);
    if (asset?.url) assetUrlMap.set(entry.name, asset.url);
  }
  return assetUrlMap;
}

function rewritePaperAssetPaths(value: unknown, assetUrlMap: Map<string, string>) {
  let result = String(value ?? '');
  for (const [assetPath, url] of assetUrlMap.entries()) result = result.split(assetPath).join(url);
  return result;
}

function parseStoredZip(arrayBuffer: ArrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const entries = new Map<string, ZipEntry>();
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + filenameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (flags & 0x08) throw new Error('暂不支持带数据描述符的 ZIP，请使用系统导出的试卷迁移包');
    if (method !== 0) throw new Error('暂不支持压缩加密 ZIP，请使用系统导出的试卷迁移包');
    if (dataEnd > bytes.length) throw new Error('ZIP 文件不完整或已损坏');
    const name = decodeText(bytes.slice(nameStart, nameStart + filenameLength)).replace(/\\/g, '/');
    entries.set(name, { name, data: bytes.slice(dataStart, dataEnd) });
    offset = dataEnd;
  }
  if (!entries.size) throw new Error('未识别到可导入的 ZIP 内容');
  return entries;
}

function decodeText(bytes: Uint8Array) {
  return new TextDecoder('utf-8').decode(bytes);
}

function normalizeJsonish(value: unknown): unknown {
  if (value && typeof value === 'object') return value;
  const text = String(value ?? '').trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function normalizeNameList(value: unknown) {
  const parsed = normalizeJsonish(value);
  const values = Array.isArray(parsed)
    ? parsed.map((item) => typeof item === 'string' ? item : recordValue(item).name)
    : String(parsed ?? '').split(/[，,;；、]/);
  return [...new Set(values.map((name) => String(name ?? '').trim()).filter(isMeaningfulName))];
}

function isMeaningfulName(name: string) {
  return Boolean(name && name !== '-' && name.toLowerCase() !== 'undefined');
}

function normalizeQuestionType(type: unknown) {
  const map: Record<string, string> = {
    单选题: 'single_choice', 多选题: 'multiple_choice', 判断题: 'true_false',
    填空题: 'fill_blank', 简答题: 'short_answer', 编程题: 'programming',
    材料题: 'material', 文件上传题: 'file_upload', scratch项目题: 'scratch_project',
    arduino项目题: 'arduino_project',
  };
  const text = String(type || '').trim();
  return map[text] || map[text.toLowerCase()] || text.replace(/-/g, '_').toLowerCase() || 'single_choice';
}

function normalizeBoolean(value: unknown) {
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  return undefined;
}

function optionalString(value: unknown) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function optionKeyForIndex(index: number) {
  return String.fromCharCode(65 + index);
}

function mimeByFilename(filename: string) {
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.jpe?g$/i.test(filename)) return 'image/jpeg';
  if (/\.gif$/i.test(filename)) return 'image/gif';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  if (/\.svg$/i.test(filename)) return 'image/svg+xml';
  if (/\.pdf$/i.test(filename)) return 'application/pdf';
  return 'application/octet-stream';
}
