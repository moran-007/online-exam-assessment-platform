import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AiEvidenceRefDto } from './ai-summary.dto';
import {
  DEFAULT_EXAM_SUMMARY_OUTPUT_TOKENS,
  MAX_EXAM_SUMMARY_OUTPUT_TOKENS,
  MIN_EXAM_SUMMARY_OUTPUT_TOKENS,
} from '../ai-summary-limits';

export class UpdateAiSummaryDraftDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  content: Record<string, unknown>;
}

export class RegenerateAiSummaryDto {
  @ApiProperty({ required: false, format: 'uuid', description: '不传时自动选择默认模型' })
  @IsOptional() @IsUUID()
  configId?: string;

  @ApiProperty({
    required: false,
    default: DEFAULT_EXAM_SUMMARY_OUTPUT_TOKENS,
    minimum: MIN_EXAM_SUMMARY_OUTPUT_TOKENS,
    maximum: MAX_EXAM_SUMMARY_OUTPUT_TOKENS,
  })
  @IsOptional() @IsInt() @Min(MIN_EXAM_SUMMARY_OUTPUT_TOKENS) @Max(MAX_EXAM_SUMMARY_OUTPUT_TOKENS)
  maxTokens?: number;
}

export class AiSummaryLifecycleTaskDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['pending', 'processing', 'succeeded', 'failed', 'cancelled'] }) status: string;
  @ApiProperty() attemptCount: number;
  @ApiProperty() inputHash: string;
  @ApiProperty() inputTokens: number;
  @ApiProperty() outputTokens: number;
  @ApiProperty() model: string;
  @ApiProperty({ nullable: true }) sanitizedError: string | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) summaryId: string | null;
}

export class AiSummaryLifecycleRecordDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['exam'] }) type: string;
  @ApiProperty({ format: 'uuid' }) subjectId: string;
  @ApiProperty({ enum: ['draft', 'in_review', 'approved', 'published', 'revoked'] }) reviewStatus: string;
  @ApiProperty() draftVersion: number;
  @ApiProperty({ type: 'object', additionalProperties: true }) content: Record<string, unknown>;
  @ApiProperty({ type: () => [AiEvidenceRefDto] }) evidence: AiEvidenceRefDto[];
  @ApiProperty({ nullable: true, format: 'uuid' }) reviewedBy: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) publishedAt: Date | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) revokedAt: Date | null;
  @ApiProperty({ format: 'date-time' }) updatedAt: Date;
}

export class StudentPublishedAiSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) examId: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) content: Record<string, unknown>;
  @ApiProperty({ type: () => [AiEvidenceRefDto] }) evidence: AiEvidenceRefDto[];
  @ApiProperty({ format: 'date-time' }) publishedAt: Date;
}
