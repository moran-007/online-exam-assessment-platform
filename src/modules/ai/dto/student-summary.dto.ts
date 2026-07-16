import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  MAX_AI_OUTPUT_TOKENS,
  MIN_STUDENT_SUMMARY_OUTPUT_TOKENS,
} from '../ai-summary-limits';
import {
  AiDataCoverageDto,
  AiEvidenceRefDto,
  AiEvidencedNumberDto,
} from './ai-summary.dto';

export class StudentSummaryScopeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  courseId?: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 20 })
  @Transform(({ value }) => normalizeArray(value))
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('4', { each: true })
  examIds?: string[];

  @ApiPropertyOptional({ format: 'date-time', description: '按考试结束时间筛选' })
  @IsOptional() @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time', description: '按考试结束时间筛选' })
  @IsOptional() @IsDateString()
  to?: string;
}

export class CreateStudentSummaryTaskDto extends StudentSummaryScopeQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  studentId: string;

  @ApiPropertyOptional({ format: 'uuid', description: '不传时按个人默认、系统默认顺序自动选择' })
  @IsOptional() @IsUUID()
  configId?: string;

  @ApiPropertyOptional({
    description: '本次输出上限；不传时使用所选模型配置的输出上限',
    minimum: MIN_STUDENT_SUMMARY_OUTPUT_TOKENS,
    maximum: MAX_AI_OUTPUT_TOKENS,
  })
  @IsOptional() @IsInt() @Min(MIN_STUDENT_SUMMARY_OUTPUT_TOKENS) @Max(MAX_AI_OUTPUT_TOKENS)
  maxTokens?: number;
}

export class EstimateStudentSummaryBatchDto extends StudentSummaryScopeQueryDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 20 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ArrayUnique() @IsUUID('4', { each: true })
  studentIds: string[];

  @ApiPropertyOptional({ format: 'uuid', description: '不传时按个人默认、系统默认顺序自动选择' })
  @IsOptional() @IsUUID()
  configId?: string;

  @ApiPropertyOptional({
    description: '每个学生请求的输出上限；不传时使用所选模型配置的输出上限',
    minimum: MIN_STUDENT_SUMMARY_OUTPUT_TOKENS,
    maximum: MAX_AI_OUTPUT_TOKENS,
  })
  @IsOptional() @IsInt() @Min(MIN_STUDENT_SUMMARY_OUTPUT_TOKENS) @Max(MAX_AI_OUTPUT_TOKENS)
  maxTokens?: number;
}

export class StudentSummaryBatchEstimateDto {
  @ApiProperty() taskCount: number;
  @ApiProperty() requestedOutputTokensPerTask: number;
  @ApiProperty() estimatedReservedTokens: number;
  @ApiProperty({ nullable: true }) remainingTokens: number | null;
  @ApiProperty() withinLocalBudget: boolean;
  @ApiProperty() confirmationRequired: boolean;
  @ApiProperty() maxBatchSize: number;
  @ApiProperty({ format: 'uuid' }) configId: string;
  @ApiProperty() model: string;
}

export class AiEvidencedStringDto {
  @ApiProperty() value: string;
  @ApiProperty() evidenceRef: string;
}

export class AiStudentContextDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() alias: string;
}

export class AiStudentSummaryScopeDto {
  @ApiProperty({ nullable: true, format: 'uuid' }) courseId: string | null;
  @ApiProperty({ nullable: true }) courseName: string | null;
  @ApiProperty({ type: [String], format: 'uuid' }) examIds: string[];
}

export class AiStudentCoverageMetricsDto {
  @ApiProperty({ type: () => AiEvidencedNumberDto }) selectedExamCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) gradedExamCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) notSubmittedExamCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) ungradedExamCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) gradedAnswerCount: AiEvidencedNumberDto;
}

export class AiStudentExamPerformanceDto {
  @ApiProperty({ format: 'uuid' }) examId: string;
  @ApiProperty() examName: string;
  @ApiProperty({ format: 'date-time' }) endedAt: string;
  @ApiProperty({ type: () => AiEvidencedStringDto }) status: AiEvidencedStringDto;
  @ApiProperty({ nullable: true, format: 'date-time' }) submittedAt: string | null;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) score: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) fullScore: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) scoreRate: AiEvidencedNumberDto;
}

export class AiStudentQuestionTypeFactDto {
  @ApiProperty() type: string;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) answerCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) correctRate: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) scoreRate: AiEvidencedNumberDto;
}

export class AiStudentKnowledgePointFactDto {
  @ApiProperty({ format: 'uuid' }) knowledgePointId: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) answerCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) correctRate: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) scoreRate: AiEvidencedNumberDto;
}

export class AiStudentWrongQuestionFactDto {
  @ApiProperty({ format: 'uuid' }) questionId: string;
  @ApiProperty() title: string;
  @ApiProperty() questionType: string;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) wrongCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedStringDto }) masteryStatus: AiEvidencedStringDto;
}

export class AiStudentProgrammingFactDto {
  @ApiProperty({ type: () => AiEvidencedNumberDto }) submissionCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) acceptedCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) acceptedRate: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) averageScore: AiEvidencedNumberDto;
}

export class StudentSummaryDatasetPreviewDto {
  @ApiProperty() inputHash: string;
  @ApiProperty() datasetVersion: string;
  @ApiProperty({ format: 'date-time' }) generatedAt: string;
  @ApiProperty({ type: () => AiDataCoverageDto }) dataCoverage: AiDataCoverageDto;
  @ApiProperty({ type: () => AiStudentContextDto }) student: AiStudentContextDto;
  @ApiProperty({ type: () => AiStudentSummaryScopeDto }) scope: AiStudentSummaryScopeDto;
  @ApiProperty({ type: () => AiStudentCoverageMetricsDto }) coverage: AiStudentCoverageMetricsDto;
  @ApiProperty({ type: () => [AiStudentExamPerformanceDto] }) examPerformance: AiStudentExamPerformanceDto[];
  @ApiProperty({ type: () => [AiStudentQuestionTypeFactDto] }) questionTypes: AiStudentQuestionTypeFactDto[];
  @ApiProperty({ type: () => [AiStudentKnowledgePointFactDto] }) knowledgePoints: AiStudentKnowledgePointFactDto[];
  @ApiProperty({ type: () => [AiStudentWrongQuestionFactDto] }) wrongQuestions: AiStudentWrongQuestionFactDto[];
  @ApiProperty({ type: () => AiStudentProgrammingFactDto }) programming: AiStudentProgrammingFactDto;
  @ApiProperty({ type: () => [AiEvidenceRefDto] }) evidence: AiEvidenceRefDto[];
}

function normalizeArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
