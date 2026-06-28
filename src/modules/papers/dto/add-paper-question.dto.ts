import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class AddPaperQuestionDto {
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsString()
  sectionTitle?: string;

  @IsUUID()
  questionId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  score: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;
}
