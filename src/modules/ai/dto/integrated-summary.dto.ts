import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { MAX_AI_OUTPUT_TOKENS, MIN_AI_OUTPUT_TOKENS } from '../ai-summary-limits';
import { SUMMARY_DATA_DOMAINS, type SummaryDataDomain } from '../datasets/summary-scope';

export class IntegratedSummaryRangeDto {
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional() @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional() @IsDateString()
  to?: string;
}

class SummarySelectionDto {
  @ApiPropertyOptional({
    type: [String], enum: SUMMARY_DATA_DOMAINS,
    description: '班级总结内容，可单选或多选；不传时包含上课、考试和作业',
  })
  @Transform(({ value }) => normalizeArray(value))
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsIn(SUMMARY_DATA_DOMAINS, { each: true })
  summaryDomains?: SummaryDataDomain[];

  @ApiPropertyOptional({ minimum: 1, description: '时间筛选后取最近 N 场考试；不传时不限制考试数量' })
  @Transform(({ value }) => value === '' || value === undefined ? undefined : Number(value))
  @IsOptional() @IsInt() @Min(1)
  recentExamCount?: number;
}

export class ClassSummaryRangeDto extends IntersectionType(
  IntegratedSummaryRangeDto,
  SummarySelectionDto,
) {}

export class ReportSummaryRangeDto extends IntersectionType(
  IntegratedSummaryRangeDto,
  SummarySelectionDto,
) {}

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

export class CreateClassSummaryTaskDto extends IntersectionType(
  IntegratedGenerationOptionsDto,
  SummarySelectionDto,
) {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  classId: string;
}

export class CreateParentReportTaskDto extends IntersectionType(
  IntegratedGenerationOptionsDto,
  SummarySelectionDto,
) {
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

function normalizeArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
