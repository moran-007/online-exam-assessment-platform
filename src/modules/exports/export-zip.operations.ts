import { BadRequestException } from '@nestjs/common';
import { createReadStream, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { ExportsContext } from './exports.context';
import { writeExportFileAtomically } from './export-file.operations';

type ZipEntryBase = {
  name: string;
  date?: Date;
};

export type ZipEntry = ZipEntryBase & (
  | { data: Buffer | string; filePath?: never; stream?: never }
  | { data?: never; filePath: string; stream?: never }
  | { data?: never; filePath?: never; stream: () => Readable }
);

export type ExportRowSource =
  | Iterable<Record<string, unknown>>
  | AsyncIterable<Record<string, unknown>>;

export class StreamingZipWriter {
  private readonly zip = new ZipFile();
  private readonly output: Readable;
  private readonly outputCompletion: Promise<void>;
  private closed = false;

  constructor(filePath: string) {
    this.output = this.zip.outputStream as Readable;
    this.zip.once('error', (error) => this.output.destroy(error));
    this.outputCompletion = pipeline(this.output, createWriteStream(filePath));
  }

  async addEntry(entry: ZipEntry, prefix = '') {
    if (this.closed) throw new Error('ZIP writer is already closed');
    const name = normalizeZipEntryName(prefix, entry.name);
    const options = entry.date ? { mtime: entry.date } : undefined;

    if (entry.filePath !== undefined) {
      const input = createReadStream(entry.filePath, { highWaterMark: 64 * 1024 });
      this.zip.addReadStream(input, name, options);
      await finished(input);
      return;
    }

    if (entry.stream !== undefined) {
      const input = entry.stream();
      this.zip.addReadStream(input, name, options);
      await finished(input);
      return;
    }

    const input = Readable.from([entry.data]);
    this.zip.addReadStream(input, name, {
      ...options,
      size: typeof entry.data === 'string' ? Buffer.byteLength(entry.data) : entry.data.length,
    });
    await finished(input);
  }

  async addEntries(entries: Iterable<ZipEntry>, prefix = '') {
    for (const entry of entries) await this.addEntry(entry, prefix);
  }

  async close() {
    if (this.closed) return this.outputCompletion;
    this.closed = true;
    this.zip.end();
    await this.outputCompletion;
  }

  async abort(error: unknown) {
    this.closed = true;
    this.output.destroy(error instanceof Error ? error : new Error(String(error)));
    await this.outputCompletion.catch(() => undefined);
  }
}

export async function writeZipArchive(
  filePath: string,
  addEntries: (writer: StreamingZipWriter) => Promise<void>,
) {
  await writeExportFileAtomically(filePath, async (partialPath) => {
    const writer = new StreamingZipWriter(partialPath);
    try {
      await addEntries(writer);
      await writer.close();
    } catch (error) {
      await writer.abort(error);
      throw error;
    }
  });
}

export async function writeZipFile(filePath: string, entries: Iterable<ZipEntry>) {
  await writeZipArchive(filePath, (writer) => writer.addEntries(entries));
}

export function csvZipStreamEntry(name: string, rows: ExportRowSource): ZipEntry {
  return { name, stream: () => Readable.from(csvChunks(rows)) };
}

function normalizeZipEntryName(prefix: string, name: string) {
  const combined = [prefix, name]
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/');
  const parts = combined.split('/');
  if (
    !combined
    || combined.startsWith('/')
    || /^[a-zA-Z]:\//.test(combined)
    || parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`ZIP entry path is unsafe: ${combined || '<empty>'}`);
  }
  return combined;
}

export function safeZipName(_ctx: ExportsContext, value: string) {
  const withoutControlCharacters = [...String(value || '')]
    .map((character) => character.charCodeAt(0) < 32 ? '_' : character)
    .join('');
  return withoutControlCharacters
    .replace(/[<>:"\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 160);
}

export async function writeTableExportFile(
  ctx: ExportsContext,
  taskId: string,
  type: string,
  format: string,
  rows: ExportRowSource,
) {
  if (!['csv', 'xlsx', 'json'].includes(format)) {
    throw new BadRequestException('表格类导出仅支持 CSV、XLSX 或 JSON；PDF/Word 请使用“试卷文档”或“错题导出”');
  }
  const fileName = `${type}-${taskId}.${format}`;
  const filePath = join(ctx.exportDir, fileName);

  if (format === 'xlsx') {
    await writeStreamingWorkbook(filePath, rows);
    return `/uploads/exports/${fileName}`;
  }

  await writeExportFileAtomically(filePath, async (partialPath) => {
    const chunks = format === 'json' ? jsonChunks(rows) : csvChunks(rows);
    await pipeline(Readable.from(chunks), createWriteStream(partialPath));
  });
  return `/uploads/exports/${fileName}`;
}

async function writeStreamingWorkbook(filePath: string, rows: ExportRowSource) {
  await writeZipArchive(filePath, async (writer) => {
    await writer.addEntries([
      { name: '[Content_Types].xml', data: XLSX_CONTENT_TYPES },
      { name: '_rels/.rels', data: XLSX_ROOT_RELS },
      { name: 'docProps/app.xml', data: XLSX_APP_PROPERTIES },
      { name: 'docProps/core.xml', data: xlsxCoreProperties() },
      { name: 'xl/styles.xml', data: XLSX_STYLES },
      { name: 'xl/workbook.xml', data: XLSX_WORKBOOK },
      { name: 'xl/_rels/workbook.xml.rels', data: XLSX_WORKBOOK_RELS },
      { name: 'xl/worksheets/sheet1.xml', stream: () => Readable.from(worksheetXmlChunks(rows)) },
    ]);
  });
}

async function* worksheetXmlChunks(rows: ExportRowSource) {
  const iterator = toAsyncIterator(rows);
  const first = await iterator.next();
  const headers = first.done ? [] : Object.keys(first.value);
  yield XLSX_WORKSHEET_START;
  if (headers.length) yield xlsxRow(1, headers, headers, 1);
  let rowNumber = 2;
  if (!first.done) yield xlsxRow(rowNumber++, headers, first.value);
  for await (const row of remainingRows(iterator)) yield xlsxRow(rowNumber++, headers, row);
  yield '</sheetData><autoFilter ref="A1:';
  yield `${columnName(Math.max(headers.length, 1))}1"/>`;
  yield '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
}

function xlsxRow(
  rowNumber: number,
  headers: string[],
  values: Record<string, unknown> | string[],
  style = 0,
) {
  const cells = headers.map((header, index) => {
    const value = Array.isArray(values) ? values[index] : values[header];
    return xlsxCell(`${columnName(index + 1)}${rowNumber}`, value, style);
  }).join('');
  return `<row r="${rowNumber}">${cells}</row>`;
}

function xlsxCell(reference: string, value: unknown, style: number) {
  const styleAttribute = style ? ` s="${style}"` : '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"${styleAttribute}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${reference}" t="b"${styleAttribute}><v>${value ? 1 : 0}</v></c>`;
  }
  const text = serializeCellValue(value);
  return `<c r="${reference}" t="inlineStr"${styleAttribute}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function serializeCellValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return stringifyJson(value);
  return String(value);
}

function columnName(index: number) {
  let value = index;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const XLSX_CONTENT_TYPES = XML_HEADER + [
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '<Default Extension="xml" ContentType="application/xml"/>',
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
  '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
  '</Types>',
].join('');

const XLSX_ROOT_RELS = XML_HEADER + [
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
  '</Relationships>',
].join('');

const XLSX_APP_PROPERTIES = XML_HEADER + [
  '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ',
  'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
  '<Application>Online Exam Assessment Platform</Application>',
  '<DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>',
  '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>',
  '<vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>',
  '<TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>导出数据</vt:lpstr></vt:vector></TitlesOfParts>',
  '<Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc>',
  '<HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion></Properties>',
].join('');

const XLSX_STYLES = XML_HEADER + [
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>',
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>',
  '<fills count="2"><fill><patternFill patternType="none"/></fill>',
  '<fill><patternFill patternType="gray125"/></fill></fills>',
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>',
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>',
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
  '</styleSheet>',
].join('');

const XLSX_WORKBOOK = XML_HEADER + [
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
  '<sheets><sheet name="导出数据" sheetId="1" r:id="rId1"/></sheets></workbook>',
].join('');

const XLSX_WORKBOOK_RELS = XML_HEADER + [
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
  '</Relationships>',
].join('');

const XLSX_WORKSHEET_START = XML_HEADER + [
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" ',
  'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>',
].join('');

function xlsxCoreProperties() {
  const createdAt = new Date().toISOString();
  return XML_HEADER + [
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ',
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ',
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '<dc:creator>Online Exam Assessment Platform</dc:creator>',
    `<dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created>`,
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified>`,
    '</cp:coreProperties>',
  ].join('');
}

async function* csvChunks(rows: ExportRowSource) {
  const iterator = toAsyncIterator(rows);
  const first = await iterator.next();
  if (first.done) return;
  const headers = Object.keys(first.value);
  yield `\uFEFF${headers.join(',')}`;
  yield `\n${csvRow(headers, first.value)}`;
  for await (const row of remainingRows(iterator)) yield `\n${csvRow(headers, row)}`;
}

async function* jsonChunks(rows: ExportRowSource) {
  yield '[';
  let index = 0;
  for await (const row of toAsyncIterable(rows)) {
    const serialized = stringifyJson(row, 2).replace(/^/gm, '  ');
    yield `${index ? ',\n' : '\n'}${serialized}`;
    index += 1;
  }
  yield index ? '\n]' : ']';
}

export function toCsv(_ctx: ExportsContext, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [`\uFEFF${headers.join(',')}`, ...rows.map((row) => csvRow(headers, row))].join('\n');
}

function csvRow(headers: string[], row: Record<string, unknown>) {
  return headers
    .map((header) => `"${String(row[header] ?? '').replace(/"/g, '""')}"`)
    .join(',');
}

function stringifyJson(value: unknown, spacing?: number) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, spacing);
}

function toAsyncIterable(rows: ExportRowSource): AsyncIterable<Record<string, unknown>> {
  if (Symbol.asyncIterator in rows) return rows;
  return Readable.from(rows) as AsyncIterable<Record<string, unknown>>;
}

function toAsyncIterator(rows: ExportRowSource): AsyncIterator<Record<string, unknown>> {
  return toAsyncIterable(rows)[Symbol.asyncIterator]();
}

async function* remainingRows(iterator: AsyncIterator<Record<string, unknown>>) {
  while (true) {
    const next = await iterator.next();
    if (next.done) return;
    yield next.value;
  }
}
