import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AiTokenQuotaDto } from './ai.dto';
import {
  MAX_EXAM_SUMMARY_OUTPUT_TOKENS,
  MIN_EXAM_SUMMARY_OUTPUT_TOKENS,
} from '../ai-summary-limits';

export class CreateExamSummaryTaskDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  examId: string;

  @ApiPropertyOptional({ format: 'uuid', description: '不传时按个人默认、系统默认顺序自动选择' })
  @IsOptional() @IsUUID()
  configId?: string;

  @ApiPropertyOptional({
    description: '本次输出上限；不传时使用所选模型配置的输出上限',
    minimum: MIN_EXAM_SUMMARY_OUTPUT_TOKENS,
    maximum: MAX_EXAM_SUMMARY_OUTPUT_TOKENS,
  })
  @IsOptional() @IsInt() @Min(MIN_EXAM_SUMMARY_OUTPUT_TOKENS) @Max(MAX_EXAM_SUMMARY_OUTPUT_TOKENS)
  maxTokens?: number;
}

export class AiDataCoverageDto {
  @ApiProperty({ nullable: true }) from: string | null;
  @ApiProperty({ nullable: true }) to: string | null;
  @ApiProperty({ type: [String] }) includes: string[];
  @ApiProperty({ type: [String] }) excludes: string[];
}

export class AiEvidenceRefDto {
  @ApiProperty() refId: string;
  @ApiProperty() sourceType: string;
  @ApiProperty({ format: 'uuid' }) sourceId: string;
  @ApiProperty() metric: string;
  @ApiProperty() path: string;
  @ApiProperty({ nullable: true }) value: string | number | boolean | null;
  @ApiProperty({ nullable: true }) unit: string | null;
  @ApiProperty({ format: 'date-time' }) capturedAt: string;
}

export class AiEvidencedNumberDto {
  @ApiProperty({ nullable: true }) value: number | null;
  @ApiProperty() evidenceRef: string;
}

export class AiExamContextDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ format: 'uuid' }) courseId: string;
  @ApiProperty() courseName: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) classId: string | null;
  @ApiProperty({ nullable: true }) className: string | null;
}

export class AiExamParticipationDto {
  @ApiProperty({ type: () => AiEvidencedNumberDto }) eligible: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) submitted: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) graded: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) submissionRate: AiEvidencedNumberDto;
}

export class AiExamScoresDto {
  @ApiProperty({ type: () => AiEvidencedNumberDto }) fullScore: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) average: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) median: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) minimum: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) maximum: AiEvidencedNumberDto;
}

export class AiExamDistributionDto {
  @ApiProperty() label: string;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) count: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) rate: AiEvidencedNumberDto;
}

export class AiExamQuestionFactDto {
  @ApiProperty({ format: 'uuid' }) questionId: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) answerCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) correctRate: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) averageScore: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) discrimination: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) anomalyCount: AiEvidencedNumberDto;
}

export class AiKnowledgePointFactDto {
  @ApiProperty({ format: 'uuid' }) knowledgePointId: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) answerCount: AiEvidencedNumberDto;
  @ApiProperty({ type: () => AiEvidencedNumberDto }) correctRate: AiEvidencedNumberDto;
}

export class ExamSummaryDatasetPreviewDto {
  @ApiProperty() inputHash: string;
  @ApiProperty() datasetVersion: string;
  @ApiProperty({ format: 'date-time' }) generatedAt: string;
  @ApiProperty({ type: () => AiDataCoverageDto }) dataCoverage: AiDataCoverageDto;
  @ApiProperty({ type: () => AiExamContextDto }) exam: AiExamContextDto;
  @ApiProperty({ type: () => AiExamParticipationDto }) participation: AiExamParticipationDto;
  @ApiProperty({ type: () => AiExamScoresDto }) scores: AiExamScoresDto;
  @ApiProperty({ type: () => [AiExamDistributionDto] }) distribution: AiExamDistributionDto[];
  @ApiProperty({ type: () => [AiExamQuestionFactDto] }) questions: AiExamQuestionFactDto[];
  @ApiProperty({ type: () => [AiKnowledgePointFactDto] }) knowledgePoints: AiKnowledgePointFactDto[];
  @ApiProperty({ type: () => [AiEvidenceRefDto] }) evidence: AiEvidenceRefDto[];
}

export class AiSummaryTaskModelDto {
  @ApiProperty({ format: 'uuid' }) configId: string;
  @ApiProperty() name: string;
  @ApiProperty() model: string;
}

export class AiSummaryTaskUsageDto {
  @ApiProperty() inputTokens: number;
  @ApiProperty() outputTokens: number;
  @ApiProperty() requestedOutputTokens: number;
  @ApiProperty({ nullable: true, description: 'null 表示本次未形成用量记录' }) reported: boolean | null;
  @ApiProperty({ description: '未报告用量时按请求上限保守预留的 Token' }) reservedTokens: number;
  @ApiProperty({ type: () => AiTokenQuotaDto }) tokenQuota: AiTokenQuotaDto;
}

export class AiSummaryDraftDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['draft', 'in_review', 'approved', 'published', 'revoked'] }) reviewStatus: string;
  @ApiProperty() draftVersion: number;
  @ApiProperty({ type: 'object', additionalProperties: true }) content: Record<string, unknown>;
}

export class ExamSummaryTaskResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['pending', 'processing', 'succeeded', 'failed', 'cancelled'] }) status: string;
  @ApiProperty() attemptCount: number;
  @ApiProperty() inputHash: string;
  @ApiProperty({ type: () => AiSummaryTaskModelDto }) model: AiSummaryTaskModelDto;
  @ApiProperty({ type: () => AiSummaryTaskUsageDto }) usage: AiSummaryTaskUsageDto;
  @ApiProperty() cacheHit: boolean;
  @ApiProperty({ nullable: true }) sanitizedError: string | null;
  @ApiProperty({ type: () => AiSummaryDraftDto, nullable: true }) summary: AiSummaryDraftDto | null;
}
