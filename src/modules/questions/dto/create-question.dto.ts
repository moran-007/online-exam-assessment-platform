import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class QuestionOptionDto {
  @IsString()
  @MaxLength(16)
  optionKey: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsBoolean()
  isCorrect = false;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder = 0;
}

export class CreateQuestionDto {
  @IsUUID()
  courseId: string;

  @IsString()
  type: string;

  @IsString()
  @MaxLength(255)
  title: string;

  @IsString()
  content: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  defaultScore: number;

  @IsOptional()
  @IsString()
  analysis?: string;

  @IsOptional()
  @IsBoolean()
  allowOptionShuffle?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  knowledgePointIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  tagIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];

  @IsOptional()
  @IsObject()
  answer?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  scoringRule?: Record<string, unknown>;
}
