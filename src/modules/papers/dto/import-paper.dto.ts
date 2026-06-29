import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class ImportPaperDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsUUID()
  courseId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsBoolean()
  shuffleQuestions?: boolean;

  @IsOptional()
  @IsBoolean()
  shuffleOptions?: boolean;

  @IsOptional()
  @IsBoolean()
  reuseExisting?: boolean;

  @IsArray()
  @IsObject({ each: true })
  questions: Array<Record<string, unknown>>;
}
