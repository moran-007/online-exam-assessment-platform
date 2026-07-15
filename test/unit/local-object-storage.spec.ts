import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { LocalObjectStorage } from '../../src/storage/local-object-storage';

describe('LocalObjectStorage', () => {
  let root: string;
  let storage: LocalObjectStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'question-engine-storage-'));
    const config = { get: jest.fn().mockReturnValue(root) } as unknown as ConfigService;
    storage = new LocalObjectStorage(config);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores content with checksum and opens it by logical key', async () => {
    const stored = await storage.put({
      key: 'question-assets/example.txt',
      data: Buffer.from('hello'),
      mimeType: 'text/plain',
    });
    const stream = await storage.open(stored.key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));

    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello');
    expect(stored.size).toBe(5);
    expect(stored.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects traversal outside the configured root', async () => {
    await expect(storage.put({ key: '../secret.txt', data: Buffer.from('x') })).rejects.toThrow('对象 key 不合法');
    await expect(storage.open('/../secret.txt')).rejects.toThrow('对象 key 不合法');
  });

  it('streams content, lists metadata, moves and deletes objects', async () => {
    const stored = await storage.put({
      key: 'exports/report.csv',
      data: Readable.from([Buffer.from('a,b\n'), Buffer.from('1,2\n')]),
      mimeType: 'text/csv',
    });
    expect(stored).toMatchObject({ size: 8, mimeType: 'text/csv' });

    const listed = await storage.list('exports/');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ key: 'exports/report.csv', size: 8 });

    await storage.move('exports/report.csv', 'exports/final.csv');
    expect(await storage.createDownloadUrl('exports/final.csv', 60)).toBe('/uploads/exports/final.csv');
    await expect(storage.open('exports/report.csv')).rejects.toThrow();
    await storage.delete('exports/final.csv');
    await expect(storage.stat('exports/final.csv')).rejects.toThrow();
  });

  it('encodes each download URL segment and rejects empty keys', async () => {
    expect(await storage.createDownloadUrl('question-assets/空 格.txt', 30)).toBe(
      '/uploads/question-assets/%E7%A9%BA%20%E6%A0%BC.txt',
    );
    await expect(storage.put({ key: '.', data: Buffer.from('x') })).rejects.toThrow('对象 key 不合法');
    await expect(storage.list('')).rejects.toThrow('对象 key 不合法');
  });
});
