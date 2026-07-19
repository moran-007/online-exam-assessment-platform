import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsObject, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AiEvidenceRefDto } from './ai-summary.dto';
import {
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
    description: '本次输出上限；不传时仅使用显式配置上限，二者均为空则由供应商决定',
    minimum: MIN_EXAM_SUMMARY_OUTPUT_TOKENS,
    maximum: MAX_EXAM_SUMMARY_OUTPUT_TOKENS,
  })
  @IsOptional() @IsInt() @Min(MIN_EXAM_SUMMARY_OUTPUT_TOKENS) @Max(MAX_EXAM_SUMMARY_OUTPUT_TOKENS)
  maxTokens?: number;

  @ApiProperty({
    required: false,
    description: 'true 表示用户已确认重新生成会再次调用供应商并记录用量',
    default: false,
  })
  @IsOptional() @IsBoolean()
  confirmRetry?: boolean;
}

export class AiSummaryLifecycleTaskDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['exam', 'student', 'class', 'parent_report', 'lesson'] }) type: string;
  @ApiProperty({ format: 'uuid' }) subjectId: string;
  @ApiProperty({ enum: ['pending', 'processing', 'succeeded', 'failed', 'cancelled'] }) status: string;
  @ApiProperty() attemptCount: number;
  @ApiProperty() inputHash: string;
  @ApiProperty() inputTokens: number;
  @ApiProperty() outputTokens: number;
  @ApiProperty({ nullable: true }) requestedOutputTokens: number | null;
  @ApiProperty() model: string;
  @ApiProperty({ nullable: true }) sanitizedError: string | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) summaryId: string | null;
}

export class AiSummaryLifecycleRecordDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['exam', 'student', 'class', 'parent_report', 'lesson'] }) type: string;
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

export class PublishedAiSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['exam', 'student', 'class', 'parent_report', 'lesson'] }) type: string;
  @ApiProperty({ format: 'uuid' }) subjectId: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) content: Record<string, unknown>;
  @ApiProperty({ type: () => [AiEvidenceRefDto] }) evidence: AiEvidenceRefDto[];
  @ApiProperty({ format: 'date-time' }) publishedAt: Date;
}

export class StudentPublishedAiSummaryDto extends PublishedAiSummaryDto {}
