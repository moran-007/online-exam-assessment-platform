import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { CreateExportDto } from './dto/create-export.dto';
import { QueryExportDto } from './dto/query-export.dto';
import { ExportsContext } from './exports.context';
import {
  cancel,
  cancelMany,
  cleanupExpiredTasks,
  create,
  createWrongQuestionExport,
  download,
  downloadAudits,
  list,
  startExportMaintenance,
  retry,
  retryMany,
} from './export-task.operations';
import { EXPORT_JOB_QUEUE, type ExportJobQueue } from './export-job-queue.interface';
import { processTask } from './export-queue.operations';

@Injectable()
export class ExportTaskQueryUseCases {
  constructor(private readonly ctx: ExportsContext) {}
  list(query: QueryExportDto, user: RequestUser) { return list(this.ctx, query, user); }
  download(id: string, user: RequestUser) { return download(this.ctx, id, user); }
  downloadAudits(query: QueryExportDto, user: RequestUser) { return downloadAudits(this.ctx, query, user); }
}

@Injectable()
export class ExportTaskCommandUseCases {
  constructor(
    private readonly ctx: ExportsContext,
    @Inject(EXPORT_JOB_QUEUE) private readonly queue: ExportJobQueue,
  ) {}
  create(dto: CreateExportDto, user: RequestUser) { return create(this.ctx, this.queue, dto, user); }
  createWrongQuestionExport(dto: CreateExportDto, user: RequestUser) {
    return createWrongQuestionExport(this.ctx, this.queue, dto, user);
  }
  retry(id: string, user: RequestUser) { return retry(this.ctx, this.queue, id, user); }
  retryMany(ids: string[], user: RequestUser) { return retryMany(this.ctx, this.queue, ids, user); }
  cancel(id: string, user: RequestUser) { return cancel(this.ctx, this.queue, id, user); }
  cancelMany(ids: string[], user: RequestUser) { return cancelMany(this.ctx, this.queue, ids, user); }
  cleanupExpiredTasks() { return cleanupExpiredTasks(this.ctx); }
}

@Injectable()
export class ExportQueueWorker implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly ctx: ExportsContext,
    @Inject(EXPORT_JOB_QUEUE) private readonly queue: ExportJobQueue,
  ) {}
  async onModuleInit() {
    startExportMaintenance(this.ctx);
    await this.queue.start(async (lease) => {
      await processTask(this.ctx, this.queue, lease);
    });
  }
  async onModuleDestroy() {
    if (this.ctx.cleanupTimer) clearInterval(this.ctx.cleanupTimer);
    await this.queue.stop();
  }
}
