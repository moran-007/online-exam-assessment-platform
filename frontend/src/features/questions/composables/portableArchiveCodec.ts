import type { StoredZipEntry } from '../models';

function parseStoredZip(arrayBuffer: ArrayBuffer): Map<string, StoredZipEntry> {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const entries = new Map<string, StoredZipEntry>();
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
    if (flags & 0x08) throw new Error('暂不支持带数据描述符的 ZIP，请使用系统导出的题目压缩包');
    if (method !== 0) throw new Error('暂不支持压缩加密 ZIP，请使用系统导出的题目压缩包');
    if (dataEnd > bytes.length) throw new Error('ZIP 文件不完整或已损坏');

    const name = decodeText(bytes.slice(nameStart, nameStart + filenameLength)).replace(/\\/g, '/');
    entries.set(name, { name, data: bytes.slice(dataStart, dataEnd) });
    offset = dataEnd;
  }

  if (!entries.size) throw new Error('未识别到可导入的 ZIP 内容');
  return entries;
}

function parseCsvRows(text: string): Array<Record<string, string>> {
  const rows = parseCsvTable(text);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header || '').replace(/^\uFEFF/, '').trim());
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell ?? '').trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const source = String(text ?? '').replace(/\r\n/g, '\n');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function decodeText(value: ArrayBufferView) {
  return new TextDecoder('utf-8').decode(value);
}

function mimeByFilename(filename: string) {
  const extension = String(filename).split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    json: 'application/json',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/markdown',
  };
  return (extension && map[extension]) || 'application/octet-stream';
}

export { parseStoredZip, parseCsvRows, parseCsvTable, decodeText, mimeByFilename };
