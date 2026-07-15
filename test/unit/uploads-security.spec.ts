import { BadRequestException } from '@nestjs/common';
import { UploadsService } from '../../src/modules/uploads/uploads.service';
import {
  assertUploadFileContent,
  isBlockedUploadExtension,
  resolveUploadExtension,
} from '../../src/modules/uploads/upload-file.validator';

describe('UploadsService security validation', () => {
  const service = new UploadsService({} as never, {} as never);

  it('rejects executable content disguised as a text file', async () => {
    const buffer = Buffer.from([0x4d, 0x5a, 0, 0, 1, 2]);
    await expect(service.saveQuestionAsset({
      originalname: 'notes.txt',
      mimetype: 'text/plain',
      size: buffer.length,
      buffer,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an extension and MIME mismatch before storage', async () => {
    const buffer = Buffer.from('%PDF-1.7');
    await expect(service.saveQuestionAsset({
      originalname: 'document.txt',
      mimetype: 'application/pdf',
      size: buffer.length,
      buffer,
    })).rejects.toThrow('文件扩展名与 MIME 类型不一致');
  });

  it.each([
    ['photo.jpeg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff]), '.jpg'],
    ['photo.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), '.png'],
    ['photo.gif', 'image/gif', Buffer.from('GIF89a'), '.gif'],
    ['document.pdf', 'application/pdf', Buffer.from('%PDF-1.7'), '.pdf'],
    ['notes.md', 'text/markdown', Buffer.from('# notes'), '.md'],
    ['archive.zip', 'application/zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]), '.zip'],
    ['sheet.xls', 'application/vnd.ms-excel', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), '.xls'],
  ])('accepts valid %s content', (originalname, mimetype, buffer, extension) => {
    expect(resolveUploadExtension({ originalname, mimetype })).toBe(extension);
    expect(() => assertUploadFileContent({ mimetype, size: buffer.length, buffer })).not.toThrow();
  });

  it('rejects empty, truncated, mis-sized and unsupported uploads', () => {
    expect(() => assertUploadFileContent({ mimetype: 'text/plain', buffer: Buffer.alloc(0) })).toThrow('为空');
    expect(() => assertUploadFileContent({ mimetype: 'text/plain', size: 99, buffer: Buffer.from('ok') })).toThrow('大小');
    expect(() => assertUploadFileContent({ mimetype: 'image/png', buffer: Buffer.from('not-png') })).toThrow('声明的类型');
    expect(() => resolveUploadExtension({ originalname: 'file.bin', mimetype: 'application/octet-stream' })).toThrow('不支持');
    expect(isBlockedUploadExtension('.EXE')).toBe(true);
    expect(isBlockedUploadExtension('.txt')).toBe(false);
  });
});
