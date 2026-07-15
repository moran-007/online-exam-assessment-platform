import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ExportsController } from './exports.controller';
import { ExportsContext } from './exports.context';
import { ExportQueueWorker, ExportTaskCommandUseCases, ExportTaskQueryUseCases } from './exports.use-cases';

@Module({
  imports: [AuditModule],
  controllers: [ExportsController],
  providers: [ExportsContext, ExportTaskQueryUseCases, ExportTaskCommandUseCases, ExportQueueWorker],
})
export class ExportsModule {}
