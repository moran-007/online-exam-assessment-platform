import { Module } from '@nestjs/common';
import { ClassStatisticsQuery } from './queries/class-statistics.query';
import { ExamStatisticsQuery } from './queries/exam-statistics.query';
import { KnowledgeStatisticsQuery } from './queries/knowledge-statistics.query';
import { QuestionDiagnosticsQuery } from './queries/question-diagnostics.query';
import { WrongQuestionStatisticsQuery } from './queries/wrong-question-statistics.query';
import { FusionDashboardQuery } from './queries/fusion-dashboard.query';
import { StatisticsController } from './statistics.controller';
import { StatisticsScopeService } from './statistics-scope.service';
import { StatisticsService } from './statistics.service';

@Module({
  controllers: [StatisticsController],
  providers: [
    StatisticsService,
    StatisticsScopeService,
    ExamStatisticsQuery,
    ClassStatisticsQuery,
    KnowledgeStatisticsQuery,
    QuestionDiagnosticsQuery,
    WrongQuestionStatisticsQuery,
    FusionDashboardQuery,
  ],
  exports: [StatisticsService, ExamStatisticsQuery, KnowledgeStatisticsQuery],
})
export class StatisticsModule {}
