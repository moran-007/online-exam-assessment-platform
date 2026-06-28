import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class AddPaperQuestionsByTagsDto {
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  tagIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  knowledgePointIds?: string[];

  @IsOptional()
  @IsString()
  sectionTitle?: string;

  @IsOptional()
  @IsString()
  questionType?: string;

  @IsOptional()
  @IsBoolean()
  random?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  count?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  scoreEach?: number;
}
