import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UploadsModule } from '../uploads/uploads.module';
import { QuestionsController } from './questions.controller';
import { QuestionsContext } from './questions.context';
import {
  QuestionAnswerUseCases,
  QuestionDuplicateUseCases,
  QuestionImportUseCases,
  QuestionReadUseCases,
  QuestionSnapshotUseCases,
  QuestionWriteUseCases,
} from './questions.use-cases';

const questionUseCases = [
  QuestionReadUseCases,
  QuestionWriteUseCases,
  QuestionImportUseCases,
  QuestionDuplicateUseCases,
  QuestionAnswerUseCases,
  QuestionSnapshotUseCases,
];

@Module({
  imports: [AuditModule, UploadsModule],
  controllers: [QuestionsController],
  providers: [QuestionsContext, ...questionUseCases],
  exports: [QuestionWriteUseCases, QuestionDuplicateUseCases, QuestionSnapshotUseCases],
})
export class QuestionsModule {}
