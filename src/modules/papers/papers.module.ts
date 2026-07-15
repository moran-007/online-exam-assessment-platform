import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { QuestionsModule } from '../questions/questions.module';
import { ImportPaperUseCase } from './commands/import-paper.use-case';
import { PaperGenerationUseCases } from './commands/paper-generation.use-cases';
import { PaperLifecycleUseCases } from './commands/paper-lifecycle.use-cases';
import { PaperQuestionUseCases } from './commands/paper-question.use-cases';
import { PaperSnapshotUseCase } from './commands/paper-snapshot.use-case';
import { PaperImportNormalizer } from './paper-import.normalizer';
import { PaperSnapshotAssembler } from './paper-snapshot.assembler';
import { PaperSupportOperations } from './paper-support.operations';
import { PapersController } from './papers.controller';
import { PaperQueryUseCases } from './queries/paper-query.use-cases';

@Module({
  imports: [AuditModule, QuestionsModule],
  controllers: [PapersController],
  providers: [
    PaperSupportOperations,
    PaperImportNormalizer,
    PaperSnapshotAssembler,
    PaperQueryUseCases,
    PaperLifecycleUseCases,
    ImportPaperUseCase,
    PaperQuestionUseCases,
    PaperSnapshotUseCase,
    PaperGenerationUseCases,
  ],
  exports: [PaperQueryUseCases],
})
export class PapersModule {}
