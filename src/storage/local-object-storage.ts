import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  ObjectStorage,
  PutObjectInput,
  StoredObjectInfo,
} from './object-storage.interface';

@Injectable()
export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(process.cwd(), config.get<string>('uploadsDir') ?? 'uploads');
  }

  async put(input: PutObjectInput) {
    const key = this.safeKey(input.key);
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    if (Buffer.isBuffer(input.data)) {
      await writeFile(path, input.data);
      return {
        key,
        size: input.data.length,
        sha256: createHash('sha256').update(input.data).digest('hex'),
        mimeType: input.mimeType || 'application/octet-stream',
      };
    }
    const hash = createHash('sha256');
    let size = 0;
    const checksum = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(input.data, checksum, createWriteStream(path));
    return {
      key,
      size,
      sha256: hash.digest('hex'),
      mimeType: input.mimeType || 'application/octet-stream',
    };
  }

  async open(key: string) {
    const path = this.pathFor(key);
    await stat(path);
    return createReadStream(path);
  }

  async delete(key: string) {
    await unlink(this.pathFor(key));
  }

  async createDownloadUrl(key: string, _expiresInSeconds: number) {
    return `/uploads/${this.safeKey(key).split('/').map(encodeURIComponent).join('/')}`;
  }

  async move(sourceKey: string, targetKey: string) {
    const target = this.pathFor(targetKey);
    await mkdir(dirname(target), { recursive: true });
    await rename(this.pathFor(sourceKey), target);
  }

  async stat(key: string): Promise<StoredObjectInfo> {
    const normalized = this.safeKey(key);
    const file = await stat(this.pathFor(normalized));
    return {
      key: normalized,
      size: file.size,
      sha256: '',
      mimeType: 'application/octet-stream',
      updatedAt: file.mtime,
    };
  }

  async list(prefix: string) {
    const normalizedPrefix = this.safePrefix(prefix);
    const directory = this.pathFor(normalizedPrefix);
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    const objects: StoredObjectInfo[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      objects.push(await this.stat(posix.join(normalizedPrefix, entry.name)));
    }
    return objects;
  }

  private pathFor(key: string) {
    const normalized = this.safeKey(key);
    const path = resolve(this.root, ...normalized.split('/'));
    const insideRoot = relative(this.root, path);
    if (!insideRoot || insideRoot.startsWith(`..${sep}`) || insideRoot === '..' || isAbsolute(insideRoot)) {
      throw new Error('对象 key 超出存储根目录');
    }
    return path;
  }

  private safePrefix(prefix: string) {
    return this.safeKey(String(prefix || '').replace(/\/+$/, ''));
  }

  private safeKey(value: string) {
    const raw = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const normalized = posix.normalize(raw);
    if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
      throw new Error('对象 key 不合法');
    }
    return normalized;
  }
}
