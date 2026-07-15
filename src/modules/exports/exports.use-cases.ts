import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
  onModuleInit,
  retry,
  retryMany,
} from './export-task.operations';

@Injectable()
export class ExportTaskQueryUseCases {
  constructor(private readonly ctx: ExportsContext) {}
  list(query: QueryExportDto, user: RequestUser) { return list(this.ctx, query, user); }
  download(id: string, user: RequestUser) { return download(this.ctx, id, user); }
  downloadAudits(query: QueryExportDto, user: RequestUser) { return downloadAudits(this.ctx, query, user); }
}

@Injectable()
export class ExportTaskCommandUseCases {
  constructor(private readonly ctx: ExportsContext) {}
  create(dto: CreateExportDto, user: RequestUser) { return create(this.ctx, dto, user); }
  createWrongQuestionExport(dto: CreateExportDto, user: RequestUser) {
    return createWrongQuestionExport(this.ctx, dto, user);
  }
  retry(id: string, user: RequestUser) { return retry(this.ctx, id, user); }
  retryMany(ids: string[], user: RequestUser) { return retryMany(this.ctx, ids, user); }
  cancel(id: string, user: RequestUser) { return cancel(this.ctx, id, user); }
  cancelMany(ids: string[], user: RequestUser) { return cancelMany(this.ctx, ids, user); }
  cleanupExpiredTasks() { return cleanupExpiredTasks(this.ctx); }
}

@Injectable()
export class ExportQueueWorker implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly ctx: ExportsContext) {}
  onModuleInit() { return onModuleInit(this.ctx); }
  onModuleDestroy() {
    if (this.ctx.cleanupTimer) clearInterval(this.ctx.cleanupTimer);
  }
}
