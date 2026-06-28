import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class GeneratePaperFromWrongDto {
  @IsUUID()
  courseId: string;

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
