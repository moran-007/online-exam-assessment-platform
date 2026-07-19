import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Inject } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../../observability/metrics.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../../storage/object-storage.interface';

@Injectable()
export class ExportsContext {
  readonly uploadsRoot: string;
  readonly exportDir: string;
  readonly fontPath: string;
  readonly exportExpireDays = 7;
  cleanupTimer?: NodeJS.Timeout;

  constructor(
    readonly prisma: PrismaService,
    readonly audit: AuditService,
    readonly dataScope: DataScopeService,
    readonly metrics: MetricsService,
    @Inject(OBJECT_STORAGE) readonly storage: ObjectStorage,
    config: ConfigService,
  ) {
    this.uploadsRoot = resolve(process.cwd(), config.get<string>('uploadsDir') ?? 'uploads');
    this.exportDir = join(tmpdir(), 'online-exam-export-staging');
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
