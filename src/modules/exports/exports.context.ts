import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExportsContext {
  readonly uploadsRoot: string;
  readonly exportDir: string;
  readonly fontPath: string;
  readonly crc32Table = makeCrc32Table();
  readonly exportExpireDays = 7;
  readonly queue = new Set<string>();
  processingQueue = false;
  cleanupTimer?: NodeJS.Timeout;

  constructor(
    readonly prisma: PrismaService,
    readonly audit: AuditService,
    readonly dataScope: DataScopeService,
    config: ConfigService,
  ) {
    this.uploadsRoot = resolve(process.cwd(), config.get<string>('uploadsDir') ?? 'uploads');
    this.exportDir = join(this.uploadsRoot, 'exports');
    this.fontPath = resolveFontPath();
  }
}

function resolveFontPath() {
  const candidates = [
    'C:\\Windows\\Fonts\\simhei.ttf',
    'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf',
    'C:\\Windows\\Fonts\\Deng.ttf',
  ];
  return candidates.find((path) => existsSync(path)) ?? '';
}

function makeCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}
