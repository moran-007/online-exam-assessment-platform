import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class UpdatePaperQuestionDto {
  @IsOptional()
  @IsUUID()
  sectionId?: string | null;

  @IsOptional()
  @IsString()
  sectionTitle?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  score?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;
}
