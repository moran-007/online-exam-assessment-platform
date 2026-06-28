import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class GradeAnswerDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  score: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
