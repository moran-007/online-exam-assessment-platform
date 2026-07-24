import type { LessonPlan } from './useLessonPlanCatalog';
import { normalizeLessonPlanMarkdown } from './lessonPlanMarkdown';

export interface LessonPlanDocumentContext {
  courseName: string;
  knowledgePointName: string;
}

export interface LessonPlanDocumentModel {
  title: string;
  courseName: string;
  knowledgePointName: string;
  gradeLevel: string;
  duration: string;
  scheduledAt: string;
  classroom: string;
  instructorName: string;
  source: string;
  authorName: string;
  updatedAt: string;
  learnerAnalysis: string;
  objectives: Array<{ label: string; value: string }>;
  teachingContent: Array<{ label: string; value: string }>;
  methodsAndPreparation: Array<{ label: string; value: string }>;
  hasProcessNotes: boolean;
  process: Array<{
    label: string;
    title: string;
    duration: number;
    teacherActivity: string;
    studentActivity: string;
    designAndAssessment: string;
  }>;
  closing: Array<{ label: string; value: string }>;
}

const emptyText = '—';

export function buildLessonPlanDocument(
  plan: LessonPlan,
  context: LessonPlanDocumentContext,
): LessonPlanDocumentModel {
  const value = (text: string) => normalizePlanTextForDisplay(text) || emptyText;
  const optionalRows = (rows: Array<{ label: string; value: string }>) => rows
    .map((item) => ({ ...item, value: normalizePlanTextForDisplay(item.value) }))
    .filter((item) => item.value);
  const process = plan.teachingProcess.map((stage, index) => ({
    label: `${chineseOrdinal(index)}、${stage.title}（${stage.duration}分钟）`,
    title: stage.title,
    duration: stage.duration,
    teacherActivity: value([
      stage.teacherActivity,
      stage.coreQuestion ? `**核心问题**\n${stage.coreQuestion}` : '',
    ].filter(Boolean).join('\n\n')),
    studentActivity: value(stage.studentActivity),
    designAndAssessment: normalizePlanTextForDisplay([
      stage.designIntent ? `**设计意图**\n${stage.designIntent}` : '',
      stage.assessment ? `**评价方式**\n${stage.assessment}` : '',
      stage.resources ? `**教学资源**\n${stage.resources}` : '',
    ].filter(Boolean).join('\n\n')),
  }));
  return {
    title: value(plan.theme),
    courseName: value(context.courseName),
    knowledgePointName: value(context.knowledgePointName),
    gradeLevel: value(plan.gradeLevel),
    duration: `${plan.durationMinutes || 45} 分钟`,
    scheduledAt: plan.scheduledAt ? new Date(plan.scheduledAt.replace(' ', 'T')).toLocaleString('zh-CN', { hour12: false }) : '待安排',
    classroom: value(plan.classroom),
    instructorName: value(plan.instructorName),
    source: plan.source === 'PERSONAL' ? '个人教案' : '系统通用教案',
    authorName: value(plan.authorName),
    updatedAt: new Date(plan.updatedAt).toLocaleString('zh-CN', { hour12: false }),
    learnerAnalysis: normalizePlanTextForDisplay(plan.learnerAnalysis),
    objectives: requiredSectionRows(optionalRows([
      { label: '知识与技能', value: plan.knowledgeObjectives },
      { label: '过程与方法', value: plan.processObjectives },
      { label: '情感态度与价值观', value: plan.valueObjectives },
      { label: '学科核心素养', value: plan.coreCompetencies },
    ]), '教学目标'),
    teachingContent: requiredSectionRows(optionalRows([
      { label: '教学内容', value: plan.teachingContent },
      { label: '教学重点', value: plan.keyPoints },
      { label: '教学难点', value: plan.difficultPoints },
      { label: '教学疑点', value: plan.doubtfulPoints },
    ]), '教学内容'),
    methodsAndPreparation: requiredSectionRows(optionalRows([
      { label: '教学方法', value: plan.teachingMethods },
      { label: '教学手段', value: plan.teachingMeans },
      { label: '教学准备', value: plan.preparation },
    ]), '教学方法'),
    hasProcessNotes: process.some((stage) => stage.designAndAssessment),
    process,
    closing: optionalRows([
      { label: '作业布置', value: plan.homework },
      { label: '学习评价设计', value: plan.assessment },
      { label: '板书设计', value: plan.boardDesign },
      { label: '教学反思', value: plan.reflection },
    ]),
  };
}

function requiredSectionRows(
  rows: Array<{ label: string; value: string }>,
  fallbackLabel: string,
) {
  return rows.length ? rows : [{ label: fallbackLabel, value: emptyText }];
}

export function normalizePlanTextForDisplay(value: string) {
  return normalizeLessonPlanMarkdown(String(value || ''))
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((segment, index) => {
      if (index % 2) return segment;
      return segment
        .replace(/\s*(?=(?:教师活动|学生活动|核心问题|设计意图|评价方式|教学资源)[：:])/g, '\n')
        .replace(/([；;])\s*(?=(?:[①-⑳]|\d+[.、）)]|[（(][一二三四五六七八九十]+[)）]))/g, '$1\n')
        .replace(/([。；;])\s*(?=[一二三四五六七八九十]+[、.．])/g, '$1\n')
        .replace(/\n{3,}/g, '\n\n');
    })
    .join('')
    .trim();
}

function chineseOrdinal(index: number) {
  return ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][index] || String(index + 1);
}

export function printLessonPlan(element: HTMLElement, model: LessonPlanDocumentModel) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, {
    position: 'fixed',
    width: '0',
    height: '0',
    border: '0',
    right: '0',
    bottom: '0',
  });
  document.body.appendChild(frame);

  const printDocument = frame.contentDocument;
  if (!printDocument || !frame.contentWindow) {
    frame.remove();
    throw new Error('浏览器无法打开打印窗口');
  }

  const applicationStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((node) => node.outerHTML)
    .join('\n');
  printDocument.open();
  printDocument.write(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(lessonPlanDocumentTitle(model.title))}</title>
  ${applicationStyles}
  <style>
    @page { size: A4 portrait; margin: 9mm; }
    * { box-sizing: border-box; }
    html, body {
      width: auto !important;
      height: auto !important;
      min-height: 0 !important;
      overflow: visible !important;
    }
    body {
      margin: 0;
      color: #111827;
      background: #fff !important;
      font: 10.5px/1.32 "Microsoft YaHei", "PingFang SC", sans-serif;
    }
    .lesson-plan-document { width: 100%; font-size: 10.5px; line-height: 1.32; }
    .lesson-plan-document__title { margin: 0 0 2px; text-align: center; font-size: 18px; line-height: 1.2; }
    .lesson-plan-document__caption { margin: 0 0 4px; text-align: center; color: #4b5563; font-size: 9.5px; line-height: 1.25; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #374151; padding: 2.5px 4px; vertical-align: top; white-space: normal; overflow-wrap: anywhere; }
    th { background: #f3f4f6; font-weight: 700; text-align: center; vertical-align: middle; line-height: 1.25; }
    .lesson-plan-document__section-column { width: 12%; }
    .lesson-plan-document__label-column { width: 11%; }
    .lesson-plan-document__value-column { width: 21%; }
    .lesson-plan-document__last-value-column { width: 13%; }
    .lesson-plan-document__section { padding: 2.5px; background: #e9eef5; }
    .lesson-plan-document__summary { padding-top: 2px; padding-bottom: 2px; }
    .lesson-plan-document__summary-item { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px; align-items: start; }
    .lesson-plan-document__summary-item + .lesson-plan-document__summary-item { margin-top: 1px; }
    .lesson-plan-document__summary-item > strong { line-height: 1.32; }
    .lesson-plan-document__process-section { background: #dfe8f4; }
    .lesson-plan-document__process-row { break-inside: auto; page-break-inside: auto; }
    .lesson-plan-document__process-shell { padding: 0; }
    .lesson-plan-document__process-table { width: 100%; border: 0; table-layout: fixed; }
    .lesson-plan-document__process-table th,
    .lesson-plan-document__process-table td { border-width: 0 1px 1px 0; padding: 2.5px 4px; }
    .lesson-plan-document__process-table tr > :last-child { border-right: 0; }
    .lesson-plan-document__process-table tbody tr:last-child > * { border-bottom: 0; }
    .lesson-plan-document__process-stage { width: 17%; }
    .lesson-plan-document__process-teacher { width: 35%; }
    .lesson-plan-document__process-student { width: 28%; }
    .lesson-plan-document__process-note { width: 20%; }
    .lesson-plan-document__process-table--without-notes .lesson-plan-document__process-stage { width: 17%; }
    .lesson-plan-document__process-table--without-notes .lesson-plan-document__process-teacher { width: 45%; }
    .lesson-plan-document__process-table--without-notes .lesson-plan-document__process-student { width: 38%; }
    .lesson-plan-document__stage-title { background: #f8fafc; }
    .lesson-plan-document__stage-title span,
    .lesson-plan-document__stage-title small { display: block; }
    .lesson-plan-document__stage-title small { margin-top: 1px; color: #4b5563; font-size: 0.9em; font-weight: 500; }
    .lesson-plan-document__empty { padding: 5px; color: #6b7280; text-align: center; }
    .lesson-plan-document__closing { padding: 2.5px 4px; border-top: 1px solid #374151; background: #fcfcfd; color: #374151; }
    .markdown-body { line-height: 1.32 !important; overflow-x: hidden; }
    .markdown-body > :first-child { margin-top: 0 !important; }
    .markdown-body > :last-child { margin-bottom: 0 !important; }
    .markdown-body p { margin: 0 0 1px !important; }
    .markdown-body ul, .markdown-body ol { margin: 0 !important; padding-left: 16px !important; }
    .markdown-body li + li { margin-top: 0 !important; }
    .code-copy { display: none !important; }
    pre { margin: 1px 0 !important; padding: 3px; border-radius: 3px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .markdown-body table { min-width: 0; margin: 1px 0 !important; font-size: inherit; }
    .markdown-body .katex-display,
    .markdown-body figure,
    .markdown-body blockquote { margin: 1px 0 !important; }
    tr { break-inside: auto; page-break-inside: auto; }
    .lesson-plan-document__process-table thead { display: table-header-group; }
  </style>
</head>
<body>${element.outerHTML}</body>
</html>`);
  printDocument.close();

  const cleanup = () => window.setTimeout(() => frame.remove(), 500);
  frame.contentWindow.addEventListener('afterprint', cleanup, { once: true });
  window.setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  }, 100);
}

export async function exportLessonPlanExcel(model: LessonPlanDocumentModel) {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  workbook.creator = '教学运营平台';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(safeSheetName(model.title), {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
    },
    views: [{ showGridLines: false }],
  });
  worksheet.columns = [
    { width: 13 },
    { width: 16 },
    { width: 22 },
    { width: 14 },
    { width: 22 },
    { width: 14 },
    { width: 22 },
  ];
  worksheet.headerFooter.oddFooter = '&C第 &P / &N 页';

  worksheet.mergeCells('A1:G1');
  worksheet.getCell('A1').value = lessonPlanDocumentTitle(model.title);
  worksheet.getRow(1).height = 25;
  worksheet.mergeCells('A2:G2');
  worksheet.getCell('A2').value = `${model.source} · 作者：${model.authorName} · 更新：${model.updatedAt}`;
  worksheet.getRow(2).height = 16;

  addBasicInformationRows(worksheet, model);
  addSummaryRow(worksheet, '二、教学目标', model.objectives);
  addSummaryRow(worksheet, '三、教学内容', model.teachingContent);
  addSummaryRow(worksheet, '四、教学方法', model.methodsAndPreparation);
  addProcessRows(worksheet, model.process, model.closing, model.hasProcessNotes);

  const border = {
    top: { style: 'thin', color: { argb: 'FF6B7280' } },
    left: { style: 'thin', color: { argb: 'FF6B7280' } },
    bottom: { style: 'thin', color: { argb: 'FF6B7280' } },
    right: { style: 'thin', color: { argb: 'FF6B7280' } },
  } as const;
  const documentLabelSet = new Set([...documentLabels, ...model.process.map((item) => item.label)]);
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell, _columnNumber) => {
      const isLabel = documentLabelSet.has(String(cell.value || ''));
      cell.font = {
        name: 'Microsoft YaHei',
        size: rowNumber === 1 ? 15 : rowNumber === 2 ? 9 : 9.5,
        bold: rowNumber === 1 || isLabel,
        italic: rowNumber === 2,
        color: rowNumber === 2 ? { argb: 'FF6B7280' } : undefined,
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: rowNumber === 1 || isLabel ? 'center' : 'left',
        wrapText: true,
      };
      cell.border = rowNumber === 2 ? {} : border;
      if (rowNumber !== 1 && isLabel) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([new Uint8Array(buffer as ArrayBuffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${safeFileName(lessonPlanDocumentTitle(model.title))}.xlsx`,
  );
}

function addBasicInformationRows(
  worksheet: ReturnType<InstanceType<typeof import('exceljs').Workbook>['addWorksheet']>,
  model: LessonPlanDocumentModel,
) {
  const start = worksheet.rowCount + 1;
  [
    ['课程名称', model.courseName, '课题', model.title, '知识点', model.knowledgePointName],
    ['上课时间', model.scheduledAt, '上课地点', model.classroom, '课时', model.duration],
    ['授课教师', model.instructorName, '教学对象', model.gradeLevel, '作者/上传者', model.authorName],
  ].forEach((values) => {
    const row = worksheet.addRow(['', ...values]);
    row.height = 19;
  });
  if (model.learnerAnalysis) {
    const row = worksheet.addRow(['', '学情分析', excelDisplayText(model.learnerAnalysis)]);
    worksheet.mergeCells(`C${row.number}:G${row.number}`);
    row.height = contentHeight(model.learnerAnalysis, 92);
  }
  worksheet.mergeCells(`A${start}:A${worksheet.rowCount}`);
  worksheet.getCell(`A${start}`).value = '一、基本信息';
}

function addSummaryRow(
  worksheet: ReturnType<InstanceType<typeof import('exceljs').Workbook>['addWorksheet']>,
  groupLabel: string,
  rows: Array<{ label: string; value: string }>,
) {
  const summary = rows.map((item) => `${item.label}：${excelDisplayText(item.value)}`).join('\n');
  const row = worksheet.addRow([groupLabel, summary]);
  worksheet.mergeCells(`B${row.number}:G${row.number}`);
  row.height = contentHeight(summary, 108);
}

function addProcessRows(
  worksheet: ReturnType<InstanceType<typeof import('exceljs').Workbook>['addWorksheet']>,
  rows: LessonPlanDocumentModel['process'],
  closing: LessonPlanDocumentModel['closing'],
  hasProcessNotes: boolean,
) {
  const start = worksheet.rowCount + 1;
  const header = worksheet.addRow(
    hasProcessNotes
      ? ['', '教学环节', '教师活动', '', '学生活动', '评价/意图', '']
      : ['', '教学环节', '教师活动', '', '学生活动', '', ''],
  );
  worksheet.mergeCells(`C${header.number}:D${header.number}`);
  if (hasProcessNotes) worksheet.mergeCells(`F${header.number}:G${header.number}`);
  else worksheet.mergeCells(`E${header.number}:G${header.number}`);
  header.height = 19;

  rows.forEach((item) => {
    const row = worksheet.addRow(hasProcessNotes
      ? [
        '',
        item.label,
        excelDisplayText(item.teacherActivity),
        '',
        excelDisplayText(item.studentActivity),
        excelDisplayText(item.designAndAssessment),
        '',
      ]
      : [
        '',
        item.label,
        excelDisplayText(item.teacherActivity),
        '',
        excelDisplayText(item.studentActivity),
        '',
        '',
      ]);
    worksheet.mergeCells(`C${row.number}:D${row.number}`);
    if (hasProcessNotes) worksheet.mergeCells(`F${row.number}:G${row.number}`);
    else worksheet.mergeCells(`E${row.number}:G${row.number}`);
    row.height = Math.max(
      contentHeight(item.teacherActivity, 46),
      contentHeight(item.studentActivity, hasProcessNotes ? 28 : 58),
      hasProcessNotes ? contentHeight(item.designAndAssessment, 46) : 18,
    );
  });

  if (!rows.length) {
    const row = worksheet.addRow(['', '教学过程待补充']);
    worksheet.mergeCells(`B${row.number}:G${row.number}`);
    row.height = 19;
  }
  closing.forEach((item) => {
    const row = worksheet.addRow(['', item.label, excelDisplayText(item.value)]);
    worksheet.mergeCells(`C${row.number}:G${row.number}`);
    row.height = contentHeight(item.value, 92);
  });

  worksheet.mergeCells(`A${start}:A${worksheet.rowCount}`);
  worksheet.getCell(`A${start}`).value = '五、教学详细过程';
}

function contentHeight(value: string, lineWidth = 55) {
  const lines = excelDisplayText(value).split(/\n+/).filter((line) => line.trim());
  const visualLines = lines.reduce(
    (count, line) => count + Math.max(1, Math.ceil(line.length / lineWidth)),
    0,
  );
  return Math.min(300, Math.max(18, visualLines * 12 + 3));
}

const documentLabels = new Set([
  '课程名称',
  '课题',
  '知识点',
  '年级/对象',
  '教学对象',
  '课时',
  '上课时间',
  '上课地点',
  '授课教师',
  '作者/上传者',
  '学情分析',
  '一、基本信息',
  '二、教学目标',
  '三、教学内容',
  '四、教学方法',
  '五、教学详细过程',
  '知识与技能',
  '过程与方法',
  '情感态度与价值观',
  '学科核心素养',
  '教学重点',
  '教学难点',
  '教学疑点',
  '教学方法',
  '教学手段',
  '教学准备',
  '教学环节',
  '教师活动',
  '学生活动',
  '设计/评价',
  '作业布置',
  '学习评价设计',
  '板书设计',
  '教学反思',
]);

function safeSheetName(value: string) {
  return (value.replace(/[\\/*?:[\]]/g, '').trim() || '教案').slice(0, 31);
}

function lessonPlanDocumentTitle(value: string) {
  return value.endsWith('教案') ? value : `${value} 教案`;
}

function excelDisplayText(value: string) {
  return value
    .replace(/^```[\w-]*\s*$/gm, '')
    .replace(/^```\s*$/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeFileName(value: string) {
  return (value.replace(/[\\/:*?"<>|]/g, '-').trim() || '教案').slice(0, 80);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
