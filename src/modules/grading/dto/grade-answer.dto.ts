import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class RubricScoreDto {
  @IsString()
  criterionId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  score: number;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class GradeAnswerDto {
  @IsOptional()
  @IsDateString()
  expectedUpdatedAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  score?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RubricScoreDto)
  rubricScores?: RubricScoreDto[];

  @IsOptional()
  @IsString()
  comment?: string;
}
