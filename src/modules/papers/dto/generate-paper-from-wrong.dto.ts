import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class GeneratePaperFromWrongDto {
  @IsUUID()
  courseId: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  knowledgePointId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['exam', 'practice', 'manual', 'ai_recommendation'])
  sourceType?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  sectionTitle?: string;

  @IsOptional()
  @IsString()
  questionType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  count?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minWrongCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  scoreEach?: number;
}
