import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const MIME_EXTENSIONS = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
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
  '.bat',
  '.cmd',
  '.com',
  '.exe',
  '.js',
  '.jse',
  '.msi',
  '.ps1',
  '.scr',
  '.sh',
  '.vbs',
]);

@Injectable()
export class UploadsService {
  async saveImage(file: { originalname?: string; mimetype?: string; buffer: Buffer }) {
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('请上传图片文件');
    }

    return this.saveToFolder(file, 'question-assets');
  }

  async saveQuestionAsset(file: { originalname?: string; mimetype?: string; size?: number; buffer: Buffer }) {
    return this.saveToFolder(file, 'question-assets');
  }

  async renameQuestionAsset(filename: string, displayName: string) {
    const safeCurrentName = this.safeExistingFilename(filename);
    const cleanDisplayName = this.cleanDisplayName(displayName);
    const extension = extname(safeCurrentName).toLowerCase();
    const dir = this.uploadDir('question-assets');
    const nextFilename = `${cleanDisplayName}-${randomUUID().slice(0, 8)}${extension}`;

    try {
      await rename(join(dir, safeCurrentName), join(dir, nextFilename));
    } catch {
      throw new NotFoundException('附件不存在或已被删除');
    }

    return this.fileResponse(nextFilename, 'question-assets', cleanDisplayName);
  }

  async removeQuestionAsset(filename: string) {
    const safeFilename = this.safeExistingFilename(filename);
    try {
      await unlink(join(this.uploadDir('question-assets'), safeFilename));
    } catch {
      throw new NotFoundException('附件不存在或已被删除');
    }

    return true;
  }

  private async saveToFolder(file: { originalname?: string; mimetype?: string; size?: number; buffer: Buffer }, folder: 'question-assets') {
    const extension = this.resolveExtension(file);
    const displayName = this.resolveDisplayName(file.originalname);
    const filename = `${new Date().toISOString().slice(0, 10)}-${displayName}-${randomUUID().slice(0, 8)}${extension}`;
    const dir = this.uploadDir(folder);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), file.buffer);

    return this.fileResponse(filename, folder, displayName, file);
  }

  private fileResponse(
    filename: string,
    folder: 'question-assets',
    displayName: string,
    file?: { originalname?: string; mimetype?: string; size?: number },
  ) {
    const url = `/uploads/${folder}/${filename}`;
    const isImage = Boolean(file?.mimetype?.startsWith('image/')) || this.isImageExtension(filename);
    return {
      url,
      filename,
      displayName,
      originalName: file?.originalname || filename,
      mimeType: file?.mimetype || '',
      size: file?.size ?? 0,
      isImage,
      markdown: isImage ? `![${displayName}](${url})` : `[${displayName}](${url})`,
    };
  }

  private resolveExtension(file: { originalname?: string; mimetype?: string }) {
    const mapped = file.mimetype ? MIME_EXTENSIONS.get(file.mimetype) : '';
    if (mapped) return mapped;

    const originalExt = extname(file.originalname || '').toLowerCase();
    if (!originalExt) {
      throw new BadRequestException('无法识别文件类型，请上传带扩展名的文件');
    }
    if (BLOCKED_EXTENSIONS.has(originalExt)) {
      throw new BadRequestException('该文件类型不允许上传');
    }
    return originalExt;
  }

  private resolveDisplayName(originalName?: string) {
    return this.cleanDisplayName((originalName || '题目附件').replace(/\.[^.]+$/, ''));
  }

  private cleanDisplayName(value: string) {
    const cleaned = String(value || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/[\[\]\(\)]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48);
    return cleaned || '题目附件';
  }

  private safeExistingFilename(value: string) {
    const decoded = decodeURIComponent(String(value || ''));
    const safeName = basename(decoded);
    if (!safeName || safeName !== decoded || safeName.includes('..')) {
      throw new BadRequestException('文件名不合法');
    }

    const extension = extname(safeName).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(extension)) {
      throw new BadRequestException('该文件类型不允许操作');
    }
    return safeName;
  }

  private uploadDir(folder: 'question-assets') {
    return join(process.cwd(), 'uploads', folder);
  }

  private isImageExtension(filename: string) {
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(extname(filename).toLowerCase());
  }
}
