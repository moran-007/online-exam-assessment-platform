import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class GeneratePaperRuleItemDto {
  @IsString()
  sectionTitle: string;

  @IsString()
  questionType: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  knowledgePointIds: string[] = [];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  tagIds: string[] = [];

  @IsOptional()
  @IsArray()
  difficultyRange?: number[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  count: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  scoreEach: number;
}

export class GeneratePaperRuleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GeneratePaperRuleItemDto)
  rules: GeneratePaperRuleItemDto[];

  @IsOptional()
  @IsBoolean()
  shuffleQuestions = false;

  @IsOptional()
  @IsBoolean()
  shuffleOptions = false;
}
