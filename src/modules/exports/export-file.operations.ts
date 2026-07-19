import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export async function writeExportFileAtomically(
  filePath: string,
  writePartialFile: (partialPath: string) => Promise<void>,
) {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const partialPath = join(directory, `.${basename(filePath)}.${randomUUID()}.part`);

  try {
    await writePartialFile(partialPath);
    await removeIfPresent(filePath);
    await rename(partialPath, filePath);
  } catch (error) {
    await removeIfPresent(partialPath);
    throw error;
  }
}

async function removeIfPresent(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
