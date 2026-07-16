import { ApiProperty } from '@nestjs/swagger';
import { PageResultDto } from '../../../common/dto/api-response.dto';

export class StatisticsOverviewDto {
  @ApiProperty() courses: number;
  @ApiProperty() questions: number;
  @ApiProperty() papers: number;
  @ApiProperty() exams: number;
  @ApiProperty() classes: number;
  @ApiProperty() submittedAttempts: number;
  @ApiProperty() pendingManual: number;
  @ApiProperty() activeWrongQuestions: number;
  @ApiProperty() averageScore: number;
  @ApiProperty() maxScore: number;
  @ApiProperty() minScore: number;
  @ApiProperty() gradedCount: number;
}

export class ExamPerformanceDto {
  @ApiProperty({ format: 'uuid' }) examId: string;
  @ApiProperty() examName: string;
  @ApiProperty() courseName: string;
  @ApiProperty() className: string;
  @ApiProperty() fullScore: number;
  @ApiProperty() status: string;
  @ApiProperty() submitCount: number;
  @ApiProperty() gradedCount: number;
  @ApiProperty() averageScore: number;
  @ApiProperty() maxScore: number;
  @ApiProperty() minScore: number;
}

export class ExamPerformancePageDto extends PageResultDto<ExamPerformanceDto> {
  @ApiProperty({ type: () => [ExamPerformanceDto] })
  declare items: ExamPerformanceDto[];
}

export class ScoreDistributionBucketDto {
  @ApiProperty() label: string;
  @ApiProperty() min: number;
  @ApiProperty() max: number;
  @ApiProperty() count: number;
  @ApiProperty() percent: number;
}

export class ScoreDistributionDto {
  @ApiProperty() total: number;
  @ApiProperty() averageScore: number;
  @ApiProperty() averagePercent: number;
  @ApiProperty({ type: () => [ScoreDistributionBucketDto] })
  buckets: ScoreDistributionBucketDto[];
}

export class ExamQuestionStatisticDto {
  @ApiProperty({ format: 'uuid' }) questionId: string;
  @ApiProperty() title: string;
  @ApiProperty() type: string;
  @ApiProperty() difficulty: number;
  @ApiProperty() answerCount: number;
  @ApiProperty() correctRate: number;
  @ApiProperty() averageScore: number;
}

export class ExamStatisticsDetailDto {
  @ApiProperty({ format: 'uuid' }) examId: string;
  @ApiProperty() examName: string;
  @ApiProperty() courseName: string;
  @ApiProperty() fullScore: number;
  @ApiProperty() submitCount: number;
  @ApiProperty() averageScore: number;
  @ApiProperty() maxScore: number;
  @ApiProperty() minScore: number;
  @ApiProperty({ type: () => [ExamQuestionStatisticDto] })
  questionStats: ExamQuestionStatisticDto[];
}

export class KnowledgePerformanceDto {
  @ApiProperty({ format: 'uuid' }) knowledgePointId: string;
  @ApiProperty() name: string;
  @ApiProperty() answerCount: number;
  @ApiProperty() correctRate: number;
  @ApiProperty() averageScore: number;
}

export class KnowledgeTrendPointDto extends KnowledgePerformanceDto {
  @ApiProperty({ example: '2026-07-16' }) date: string;
}

export class ClassPerformanceDto {
  @ApiProperty({ format: 'uuid' }) classId: string;
  @ApiProperty() className: string;
  @ApiProperty() courseName: string;
  @ApiProperty() studentCount: number;
  @ApiProperty() submitCount: number;
  @ApiProperty() averageScore: number;
  @ApiProperty() maxScore: number;
  @ApiProperty() minScore: number;
  @ApiProperty() passRate: number;
  @ApiProperty() completionRate: number;
}

export class QuestionDiagnosticDto extends ExamQuestionStatisticDto {
  @ApiProperty() actualDifficulty: number;
  @ApiProperty() difficultyDelta: number;
  @ApiProperty() discrimination: number;
  @ApiProperty() anomalyCount: number;
  @ApiProperty({ type: [String] }) knowledgePointNames: string[];
  @ApiProperty({ type: [String] }) tagNames: string[];
  @ApiProperty() suggestion: string;
}

export class StatisticCountDto {
  @ApiProperty() count: number;
}

export class SourceStatisticCountDto extends StatisticCountDto {
  @ApiProperty() source: string;
}

export class MasteryStatisticCountDto extends StatisticCountDto {
  @ApiProperty() masteryStatus: string;
}

export class WrongQuestionStatisticDto {
  @ApiProperty({ format: 'uuid' }) questionId: string;
  @ApiProperty() title: string;
  @ApiProperty() type: string;
  @ApiProperty() difficulty: number;
  @ApiProperty() courseName: string;
  @ApiProperty({ type: [String] }) knowledgePointNames: string[];
  @ApiProperty() wrongCount: number;
  @ApiProperty() studentCount: number;
  @ApiProperty({ type: String, format: 'date-time' }) latestAt: Date;
  @ApiProperty({ type: () => [SourceStatisticCountDto] })
  sourceSummary: SourceStatisticCountDto[];
  @ApiProperty({ type: () => [MasteryStatisticCountDto] })
  masterySummary: MasteryStatisticCountDto[];
}
