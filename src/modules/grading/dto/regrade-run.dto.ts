import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class PreviewRegradeRunDto {
  @IsUUID()
  examId: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('4', { each: true })
  attemptIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('4', { each: true })
  answerRecordIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('4', { each: true })
  studentIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('4', { each: true })
  questionIds?: string[];

  @IsOptional()
  @IsIn(['snapshot', 'latest', 'specified'])
  ruleSource?: 'snapshot' | 'latest' | 'specified';

  @IsOptional()
  @IsUUID()
  scoringRuleVersionId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}
