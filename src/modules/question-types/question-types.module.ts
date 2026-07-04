import { Global, Module } from '@nestjs/common';
import { QuestionTypeRegistry } from './question-type-registry.service';
import { QuestionTypesController } from './question-types.controller';
import { ScoringHistoryService } from './scoring-history.service';

@Global()
@Module({
  controllers: [QuestionTypesController],
  providers: [QuestionTypeRegistry, ScoringHistoryService],
  exports: [QuestionTypeRegistry, ScoringHistoryService],
})
export class QuestionTypesModule {}
