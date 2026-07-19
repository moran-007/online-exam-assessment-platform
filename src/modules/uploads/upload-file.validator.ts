import { BadRequestException } from '@nestjs/common';
import { extname } from 'node:path';

const MIME_EXTENSIONS = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['text/markdown', '.md'],
  ['text/csv', '.csv'],
  ['application/zip', '.zip'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
  ['application/msword', '.doc'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.ms-powerpoint', '.ppt'],
]);

const BLOCKED_EXTENSIONS = new Set([
  '.bat', '.cmd', '.com', '.exe', '.js', '.jse', '.msi', '.ps1', '.scr', '.sh', '.vbs',
]);

type UploadFile = { originalname?: string; mimetype?: string; size?: number; buffer: Buffer };

/**
 * Busboy/Multer may expose UTF-8 filename bytes as Latin-1 characters. Decode
 * only when the transformation is lossless so genuine Latin-1 names are not
 * replaced with invalid Unicode.
 */
export function normalizeUploadFileName(fileName?: string) {
  const value = fileName?.trim();
  if (!value || !/[\u0080-\u00ff]/.test(value)) return value;
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  const lossless = !decoded.includes('\ufffd') && Buffer.from(decoded, 'utf8').toString('latin1') === value;
  return lossless ? decoded : value;
}

export function isBlockedUploadExtension(extension: string) {
  return BLOCKED_EXTENSIONS.has(extension.toLowerCase());
}

export function resolveUploadExtension(file: Pick<UploadFile, 'originalname' | 'mimetype'>) {
  const originalExt = extname(file.originalname || '').toLowerCase();
  if (originalExt === '.sb3' && ['application/octet-stream', 'application/zip', 'application/x.scratch.sb3'].includes(file.mimetype || '')) {
    return '.sb3';
  }
  const mapped = file.mimetype ? MIME_EXTENSIONS.get(file.mimetype) : '';
  if (!mapped || !originalExt) throw new BadRequestException('不支持该文件类型，或文件类型声明不完整');
  if (isBlockedUploadExtension(originalExt)) throw new BadRequestException('该文件类型不允许上传');
  const aliases = mapped === '.jpg' ? new Set(['.jpg', '.jpeg']) : new Set([mapped]);
  if (!aliases.has(originalExt)) throw new BadRequestException('文件扩展名与 MIME 类型不一致');
  return mapped;
}

export function assertUploadFileContent(file: Pick<UploadFile, 'originalname' | 'mimetype' | 'size' | 'buffer'>) {
  if (!Buffer.isBuffer(file.buffer) || !file.buffer.length) throw new BadRequestException('上传文件内容为空');
  if (file.size !== undefined && file.size !== file.buffer.length) throw new BadRequestException('上传文件大小校验失败');
  const mimeType = file.mimetype ?? '';
  const bytes = file.buffer;
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  const isZip = startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0x50, 0x4b, 0x05, 0x06);
  const isOle = startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  const isScratchProject = extname(file.originalname || '').toLowerCase() === '.sb3' && isZip;
  const valid =
    (mimeType === 'image/jpeg' && startsWith(0xff, 0xd8, 0xff)) ||
    (mimeType === 'image/png' && startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) ||
    (mimeType === 'image/gif' && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) ||
    (mimeType === 'image/webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') ||
    (mimeType === 'application/pdf' && bytes.subarray(0, 5).toString('ascii') === '%PDF-') ||
    (['application/zip',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'].includes(mimeType) && isZip) ||
    (['application/octet-stream', 'application/zip', 'application/x.scratch.sb3'].includes(mimeType) && isScratchProject) ||
    (['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'].includes(mimeType) && isOle) ||
    (['text/plain', 'text/markdown', 'text/csv'].includes(mimeType) && !bytes.includes(0));
  if (!valid) throw new BadRequestException('文件内容与声明的类型不一致，已拒绝上传');
}
