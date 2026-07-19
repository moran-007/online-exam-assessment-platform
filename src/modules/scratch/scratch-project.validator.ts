import { BadRequestException } from '@nestjs/common';
import { basename, extname } from 'node:path';
import { Entry, fromBuffer, ZipFile } from 'yauzl';

export type ScratchProjectSummary = {
  projectJsonSize: number;
  unpackedSize: number;
  assetCount: number;
  targetCount: number;
  spriteCount: number;
  hasStage: boolean;
};

const limits = {
  maxProjectBytes: 50 * 1024 * 1024,
  maxUnpackedBytes: 150 * 1024 * 1024,
  maxAssetBytes: 20 * 1024 * 1024,
  maxProjectJsonBytes: 12 * 1024 * 1024,
  maxAssetCount: 500,
};

const nestedArchives = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.xz', '.bz2']);

export async function validateScratchProject(buffer: Buffer, originalName: string): Promise<ScratchProjectSummary> {
  if (extname(originalName).toLowerCase() !== '.sb3') throw new BadRequestException('Scratch 项目必须使用 .sb3 文件');
  if (!buffer.length || buffer.length > limits.maxProjectBytes) throw new BadRequestException('Scratch 项目为空或超过 50MB');
  const zip = await openZip(buffer);
  return inspectZip(zip);
}

function openZip(buffer: Buffer) {
  return new Promise<ZipFile>((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) reject(new BadRequestException('文件不是合法的 .sb3/ZIP 项目'));
      else resolve(zip);
    });
  });
}

function inspectZip(zip: ZipFile) {
  return new Promise<ScratchProjectSummary>((resolve, reject) => {
    let unpackedSize = 0;
    let assetCount = 0;
    let projectJson: Buffer | null = null;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(error instanceof BadRequestException ? error : new BadRequestException('无法解析 Scratch 项目'));
    };

    zip.on('entry', async (entry) => {
      try {
        if (entry.fileName.endsWith('/')) return zip.readEntry();
        assertSafePath(entry.fileName);
        unpackedSize += entry.uncompressedSize;
        if (unpackedSize > limits.maxUnpackedBytes) throw new BadRequestException('Scratch 项目解压后超过 150MB');

        if (entry.fileName === 'project.json') {
          projectJson = await readEntry(zip, entry, limits.maxProjectJsonBytes);
        } else {
          assetCount += 1;
          if (assetCount > limits.maxAssetCount) throw new BadRequestException('Scratch 项目素材数量超过 500');
          if (entry.uncompressedSize > limits.maxAssetBytes) throw new BadRequestException('Scratch 项目存在超过 20MB 的单个素材');
          if (nestedArchives.has(extname(basename(entry.fileName)).toLowerCase())) {
            throw new BadRequestException('Scratch 项目不允许嵌套压缩包');
          }
          const ratio = entry.compressedSize ? entry.uncompressedSize / entry.compressedSize : Number.POSITIVE_INFINITY;
          if (entry.uncompressedSize > 1024 * 1024 && ratio > 100) throw new BadRequestException('Scratch 项目素材压缩率异常');
        }
        zip.readEntry();
      } catch (error) {
        fail(error);
      }
    });
    zip.on('error', fail);
    zip.on('end', () => {
      if (settled) return;
      try {
        if (!projectJson) throw new BadRequestException('.sb3 必须包含 project.json');
        const project = JSON.parse(projectJson.toString('utf8')) as { targets?: Array<{ isStage?: boolean }> };
        const targets = Array.isArray(project.targets) ? project.targets : [];
        if (!targets.length || !targets.some((target) => target.isStage === true)) {
          throw new BadRequestException('project.json 缺少有效舞台或角色');
        }
        settled = true;
        resolve({
          projectJsonSize: projectJson.length,
          unpackedSize,
          assetCount,
          targetCount: targets.length,
          spriteCount: targets.filter((target) => target.isStage !== true).length,
          hasStage: true,
        });
      } catch (error) {
        fail(error instanceof SyntaxError ? new BadRequestException('project.json 不是合法 JSON') : error);
      }
    });
    zip.readEntry();
  });
}

function assertSafePath(name: string) {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw new BadRequestException('Scratch 项目包含不安全路径');
  }
  if (name.split('/').some((part) => part === '.' || part === '..')) {
    throw new BadRequestException('Scratch 项目包含路径穿越条目');
  }
}

function readEntry(zip: ZipFile, entry: Entry, maxBytes: number) {
  if (entry.uncompressedSize > maxBytes) return Promise.reject(new BadRequestException('project.json 超过 12MB'));
  return new Promise<Buffer>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(new BadRequestException('无法读取 project.json'));
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) stream.destroy(new BadRequestException('project.json 超过 12MB'));
        else chunks.push(chunk);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}
