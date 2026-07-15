import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { GradeAnswerUseCases } from './commands/grade-answer.use-cases';
import { GradeVisibilityUseCases } from './commands/grade-visibility.use-cases';
import { RegradeUseCases } from './commands/regrade.use-cases';
import { GradingController } from './grading.controller';
import { GradingSupportOperations } from './grading-support.operations';
import { GradingQueryUseCases } from './queries/grading-query.use-cases';

@Module({
  imports: [AuditModule],
  controllers: [GradingController],
  providers: [
    GradingSupportOperations,
    GradingQueryUseCases,
    GradeAnswerUseCases,
    RegradeUseCases,
    GradeVisibilityUseCases,
  ],
})
export class GradingModule {}
