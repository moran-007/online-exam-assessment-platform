import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateExamDto {
  @IsUUID()
  paperId: string;

  @IsString()
  @MaxLength(128)
  name: string;

  @IsUUID()
  courseId: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsString()
  startTime: string;

  @IsString()
  endTime: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationMinutes: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  attemptLimit?: number;

  @IsOptional()
  @IsString()
  showAnswerMode?: string;

  @IsOptional()
  @IsString()
  showScoreMode?: string;

  @IsOptional()
  @IsString()
  announcement?: string;

  @IsOptional()
  @IsObject()
  antiCheatConfig?: Record<string, unknown>;
}
