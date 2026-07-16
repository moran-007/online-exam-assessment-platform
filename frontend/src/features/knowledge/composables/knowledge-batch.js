import { makeKnowledgeCodeBase } from './knowledge-tree';

export const KNOWLEDGE_BATCH_TEMPLATE = [
  '# 知识点名称 | 父级知识点名称 | 排序',
  '1. 分支结构 | | 1',
  '2. 循环结构 | | 2',
  'for 循环 | 2. 循环结构 | 1',
  'while 循环 | 2. 循环结构 | 2',
].join('\n');

export function parseKnowledgeBatch({ text, selectedCourse, existingPoints, codeSeed }) {
  const rows = [];
  const errors = [];
  const existingNames = new Set(existingPoints.map((item) => item.name));
  const generatedCodes = new Set(existingPoints.map((item) => item.code));

  text.replace(/\r\n/g, '\n').split('\n').forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;

    const parts = splitTemplateLine(line);
    if (isKnowledgeTemplateHeader(parts)) return;

    const [pointName = '', parentName = '', sortOrderText = '0'] = parts;
    const sortOrder = parseOrder(sortOrderText);
    rows.push({
      line: lineNumber,
      pointName: pointName.trim(),
      parentName: parentName.trim(),
      sortOrder,
      pointCode: nextPointCode(pointName, sortOrder, lineNumber, generatedCodes, codeSeed),
      valid: true,
      statusText: '待导入',
    });
  });

  validateKnowledgeRows(rows, errors, selectedCourse, existingNames);
  return { rows, errors };
}

function validateKnowledgeRows(rows, errors, selectedCourse, existingNames) {
  const plannedNames = new Set(rows.map((row) => row.pointName).filter(Boolean));
  const seenNames = new Set();

  rows.forEach((row) => {
    const rowErrors = [];
    if (!selectedCourse) rowErrors.push('请先选择所属课程');
    if (!Number.isFinite(row.sortOrder) || row.sortOrder < 0) rowErrors.push('排序必须是大于等于 0 的数字');
    if (!row.pointName) rowErrors.push('请填写知识点名称');
    if (seenNames.has(row.pointName)) rowErrors.push('知识点名称在本次导入中重复');
    if (row.parentName && row.parentName === row.pointName) rowErrors.push('父级知识点不能是自己');
    if (row.parentName && !existingNames.has(row.parentName) && !plannedNames.has(row.parentName)) {
      rowErrors.push(`父级知识点不存在：${row.parentName}`);
    }
    seenNames.add(row.pointName);

    if (!rowErrors.length) {
      row.statusText = existingNames.has(row.pointName) ? '将更新知识点' : '将新增知识点';
      return;
    }
    row.valid = false;
    row.statusText = rowErrors.join('；');
    errors.push({ line: row.line, message: row.statusText });
  });
}

function splitTemplateLine(line) {
  return (line.includes('|') ? line.split('|') : line.split(',')).map((item) => item.trim());
}

function isKnowledgeTemplateHeader(parts) {
  const first = String(parts[0] || '').trim().toLowerCase();
  return ['知识点名称', '名称', 'name'].includes(first);
}

function parseOrder(value) {
  const match = String(value || '0').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function nextPointCode(name, sortOrder, lineNumber, usedCodes, codeSeed) {
  const base = makeKnowledgeCodeBase(name) || `kp_${sortOrder || lineNumber}`;
  let code = `${base}_${codeSeed}_${lineNumber}`;
  let index = 1;
  while (usedCodes.has(code)) {
    code = `${base}_${codeSeed}_${lineNumber}_${index++}`;
  }
  usedCodes.add(code);
  return code;
}
