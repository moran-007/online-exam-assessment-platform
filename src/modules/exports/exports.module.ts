import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ExportsController } from './exports.controller';
import { ExportsContext } from './exports.context';
import { ExportQueueWorker, ExportTaskCommandUseCases, ExportTaskQueryUseCases } from './exports.use-cases';
import { EXPORT_JOB_QUEUE } from './export-job-queue.interface';
import { PostgresExportJobQueue } from './postgres-export-job-queue';

@Module({
  imports: [AuditModule],
  controllers: [ExportsController],
  providers: [
    ExportsContext,
    ExportTaskQueryUseCases,
    ExportTaskCommandUseCases,
    ExportQueueWorker,
    { provide: EXPORT_JOB_QUEUE, useClass: PostgresExportJobQueue },
  ],
})
export class ExportsModule {}
