import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { MAX_AI_OUTPUT_TOKENS, MIN_AI_OUTPUT_TOKENS } from '../ai-summary-limits';

export class IntegratedSummaryRangeDto {
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional() @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional() @IsDateString()
  to?: string;
}

class IntegratedGenerationOptionsDto extends IntegratedSummaryRangeDto {
  @ApiPropertyOptional({ format: 'uuid', description: '不传时按个人默认、系统默认顺序自动选择' })
  @IsOptional() @IsUUID()
  configId?: string;

  @ApiPropertyOptional({
    description: '本次输出上限；不传时使用模型配置上限',
    minimum: MIN_AI_OUTPUT_TOKENS,
    maximum: MAX_AI_OUTPUT_TOKENS,
  })
  @IsOptional() @IsInt() @Min(MIN_AI_OUTPUT_TOKENS) @Max(MAX_AI_OUTPUT_TOKENS)
  maxTokens?: number;
}

export class CreateClassSummaryTaskDto extends IntegratedGenerationOptionsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  classId: string;
}

export class CreateParentReportTaskDto extends IntegratedGenerationOptionsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  studentId: string;
}

export class CreateLessonAssistantTaskDto extends IntegratedGenerationOptionsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sessionId: string;
}

export class IntegratedSummaryDatasetPreviewDto {
  @ApiProperty() inputHash: string;
  @ApiProperty() datasetVersion: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  dataset: Record<string, unknown>;
}
