import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { QueryStatisticsDto } from './dto/query-statistics.dto';
import { ClassStatisticsQuery } from './queries/class-statistics.query';
import { ExamStatisticsQuery } from './queries/exam-statistics.query';
import { KnowledgeStatisticsQuery } from './queries/knowledge-statistics.query';
import { QuestionDiagnosticsQuery } from './queries/question-diagnostics.query';
import { WrongQuestionStatisticsQuery } from './queries/wrong-question-statistics.query';

@Injectable()
export class StatisticsService {
  constructor(
    private readonly examQuery: ExamStatisticsQuery,
    private readonly classQuery: ClassStatisticsQuery,
    private readonly knowledgeQuery: KnowledgeStatisticsQuery,
    private readonly diagnosticQuery: QuestionDiagnosticsQuery,
    private readonly wrongQuestionQuery: WrongQuestionStatisticsQuery,
  ) {}

  overview(query: QueryStatisticsDto, user: RequestUser) {
    return this.examQuery.overview(query, user);
  }

  exams(query: QueryStatisticsDto, user: RequestUser) {
    return this.examQuery.exams(query, user);
  }

  scoreDistribution(query: QueryStatisticsDto, user: RequestUser) {
    return this.examQuery.scoreDistribution(query, user);
  }

  classComparison(query: QueryStatisticsDto, user: RequestUser) {
    return this.classQuery.execute(query, user);
  }

  examDetail(examId: string, user: RequestUser) {
    return this.examQuery.examDetail(examId, user);
  }

  knowledge(query: QueryStatisticsDto, user: RequestUser) {
    return this.knowledgeQuery.knowledge(query, user);
  }

  knowledgeTrend(query: QueryStatisticsDto, user: RequestUser) {
    return this.knowledgeQuery.trend(query, user);
  }

  classes(query: QueryStatisticsDto, user: RequestUser) {
    return this.classQuery.execute(query, user);
  }

  questionDiagnostics(query: QueryStatisticsDto, user: RequestUser) {
    return this.diagnosticQuery.execute(query, user);
  }

  wrongQuestions(query: QueryStatisticsDto, user: RequestUser) {
    return this.wrongQuestionQuery.execute(query, user);
  }
}
