import { open as openFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import yauzl = require('yauzl');
import { writeZipFile } from '../../src/modules/exports/export-zip.operations';

describe('streaming ZIP exports', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'streaming-export-test-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('archives large attachments without buffering their total size', async () => {
    const sourcePath = join(directory, 'large-attachment.bin');
    const zipPath = join(directory, 'archive.zip');
    const attachmentBytes = 32 * 1024 * 1024;
    const source = await openFile(sourcePath, 'w');
    await source.truncate(attachmentBytes);
    await source.close();

    const baseline = process.memoryUsage().arrayBuffers;
    let peak = baseline;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().arrayBuffers);
    }, 2);
    try {
      await writeZipFile(zipPath, [
        { name: 'metadata.json', data: '{"schemaVersion":1}' },
        { name: 'assets/one.bin', filePath: sourcePath },
        { name: 'assets/two.bin', filePath: sourcePath },
        { name: 'assets/three.bin', filePath: sourcePath },
      ]);
    } finally {
      clearInterval(sampler);
    }

    const entries = await readZipEntrySizes(zipPath);
    expect(entries).toMatchObject({
      'metadata.json': 19,
      'assets/one.bin': attachmentBytes,
      'assets/two.bin': attachmentBytes,
      'assets/three.bin': attachmentBytes,
    });
    expect((await stat(zipPath)).size).toBeGreaterThan(100);
    // zlib and the ZIP library retain native buffers until a later GC cycle.
    // The useful invariant is that archiving never retains the aggregate payload.
    expect(peak - baseline).toBeLessThan(attachmentBytes * 3);
  }, 30_000);

  it('rejects traversal names and removes partial output', async () => {
    const zipPath = join(directory, 'unsafe.zip');
    await expect(writeZipFile(zipPath, [{ name: '../outside.txt', data: 'unsafe' }]))
      .rejects.toThrow('ZIP entry path is unsafe');

    expect(await readdir(directory)).toEqual([]);
  });
});

function readZipEntrySizes(filePath: string): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error('ZIP could not be opened'));
        return;
      }
      const entries: Record<string, number> = {};
      zip.on('error', reject);
      zip.on('entry', (entry) => {
        entries[entry.fileName] = entry.uncompressedSize;
        zip.readEntry();
      });
      zip.on('end', () => resolve(entries));
      zip.readEntry();
    });
  });
}
