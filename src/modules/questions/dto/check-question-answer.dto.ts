import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

export class CheckQuestionAnswerDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedOptionIds?: string[];

  @IsOptional()
  @IsArray()
  blanks?: Array<{ index: number; value: string }>;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>;
}
