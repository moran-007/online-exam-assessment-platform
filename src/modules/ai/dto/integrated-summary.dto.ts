import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
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
    description: '本次输出上限；配置与本次均为空时由供应商决定',
    minimum: MIN_AI_OUTPUT_TOKENS,
    maximum: MAX_AI_OUTPUT_TOKENS,
  })
  @IsOptional() @IsInt() @Min(MIN_AI_OUTPUT_TOKENS) @Max(MAX_AI_OUTPUT_TOKENS)
  maxTokens?: number;

  @ApiPropertyOptional({
    description: '仅重试相同失败任务时使用；true 表示用户已确认本次会再次调用供应商并记录用量',
    default: false,
  })
  @IsOptional() @IsBoolean()
  confirmRetry?: boolean;
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
