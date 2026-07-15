import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ExamsController } from './exams.controller';
import { ExamsContext } from './exams.context';
import {
  ExamAnnouncementUseCases,
  ExamLifecycleUseCases,
  ExamQueryUseCases,
  ExamWriteUseCases,
} from './exams.use-cases';

@Module({
  imports: [AuditModule],
  controllers: [ExamsController],
  providers: [
    ExamsContext,
    ExamQueryUseCases,
    ExamWriteUseCases,
    ExamLifecycleUseCases,
    ExamAnnouncementUseCases,
  ],
})
export class ExamsModule {}
