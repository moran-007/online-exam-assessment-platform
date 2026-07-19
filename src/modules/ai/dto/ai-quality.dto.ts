import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const AI_SUMMARY_TYPES = ['exam', 'student', 'class', 'parent_report', 'lesson'] as const;
export const AI_FEEDBACK_VERDICTS = ['helpful', 'partial', 'incorrect'] as const;
export const AI_FEEDBACK_STATUSES = ['open', 'resolved', 'dismissed'] as const;

export class AiQualityRangeQueryDto {
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional() @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional() @IsDateString()
  endDate?: string;
}

export class AiFeedbackQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AI_FEEDBACK_STATUSES })
  @IsOptional() @IsIn(AI_FEEDBACK_STATUSES)
  status?: typeof AI_FEEDBACK_STATUSES[number];

  @ApiPropertyOptional({ enum: AI_SUMMARY_TYPES })
  @IsOptional() @IsIn(AI_SUMMARY_TYPES)
  summaryType?: typeof AI_SUMMARY_TYPES[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  configId?: string;
}

export class CreateAiSummaryFeedbackDto {
  @ApiProperty({ enum: AI_FEEDBACK_VERDICTS })
  @IsIn(AI_FEEDBACK_VERDICTS)
  verdict: typeof AI_FEEDBACK_VERDICTS[number];

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt() @Min(1) @Max(5)
  rating: number;

  @ApiPropertyOptional({ description: '必须引用当前总结中存在的证据编号' })
  @IsOptional() @IsString() @MaxLength(160)
  evidenceRef?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional() @IsString() @MaxLength(2000)
  comment?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional() @IsString() @MaxLength(4000)
  correctionText?: string;
}

export class ResolveAiSummaryFeedbackDto {
  @ApiProperty({ enum: ['resolved', 'dismissed'] })
  @IsIn(['resolved', 'dismissed'])
  status: 'resolved' | 'dismissed';

  @ApiProperty({ maxLength: 2000 })
  @IsString() @MaxLength(2000)
  resolutionNote: string;
}

export class CreateAiRegressionRunDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  configId: string;

  @ApiProperty({ enum: AI_SUMMARY_TYPES })
  @IsIn(AI_SUMMARY_TYPES)
  summaryType: typeof AI_SUMMARY_TYPES[number];

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 3, default: 2 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3)
  caseCount = 2;
}

export class AiQualityTotalsDto {
  @ApiProperty() calls: number;
  @ApiProperty() succeeded: number;
  @ApiProperty() failed: number;
  @ApiProperty() published: number;
  @ApiProperty() inputTokens: number;
  @ApiProperty() outputTokens: number;
  @ApiProperty() estimatedCost: number;
  @ApiProperty() cacheRequests: number;
  @ApiProperty() cacheHits: number;
  @ApiProperty() cacheHitRate: number;
  @ApiProperty() feedbackCount: number;
  @ApiProperty() averageRating: number;
  @ApiProperty() incorrectRate: number;
}

export class AiQualityBreakdownDto {
  @ApiProperty() summaryType: string;
  @ApiProperty({ format: 'uuid' }) configId: string;
  @ApiProperty() configName: string;
  @ApiProperty() model: string;
  @ApiProperty() promptVersion: number;
  @ApiProperty() calls: number;
  @ApiProperty() successRate: number;
  @ApiProperty() published: number;
  @ApiProperty() averageRating: number;
  @ApiProperty() inputTokens: number;
  @ApiProperty() outputTokens: number;
  @ApiProperty() estimatedCost: number;
}

export class AiQualityDashboardDto {
  @ApiProperty({ format: 'date-time' }) from: Date;
  @ApiProperty({ format: 'date-time' }) to: Date;
  @ApiProperty({ type: () => AiQualityTotalsDto }) totals: AiQualityTotalsDto;
  @ApiProperty({ type: () => [AiQualityBreakdownDto] }) breakdown: AiQualityBreakdownDto[];
}

export class AiFeedbackRecordDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) summaryId: string;
  @ApiProperty() summaryType: string;
  @ApiProperty() verdict: string;
  @ApiProperty() rating: number;
  @ApiProperty({ nullable: true }) evidenceRef: string | null;
  @ApiProperty({ nullable: true }) comment: string | null;
  @ApiProperty({ nullable: true }) correctionText: string | null;
  @ApiProperty() status: string;
  @ApiProperty({ nullable: true }) resolutionNote: string | null;
  @ApiProperty() reporterName: string;
  @ApiProperty({ format: 'date-time' }) createdAt: Date;
  @ApiProperty({ nullable: true, format: 'date-time' }) resolvedAt: Date | null;
}

export class AiFeedbackListDto {
  @ApiProperty({ type: () => [AiFeedbackRecordDto] }) items: AiFeedbackRecordDto[];
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty() total: number;
}

export class AiRegressionRunDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) providerConfigId: string;
  @ApiProperty() configName: string;
  @ApiProperty() model: string;
  @ApiProperty() summaryType: string;
  @ApiProperty() status: string;
  @ApiProperty() passedCases: number;
  @ApiProperty() totalCases: number;
  @ApiProperty() inputTokens: number;
  @ApiProperty() outputTokens: number;
  @ApiProperty({ nullable: true }) sanitizedError: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: Date;
  @ApiProperty({ nullable: true, format: 'date-time' }) finishedAt: Date | null;
}
