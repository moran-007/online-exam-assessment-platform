import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LessonPlanSource } from '@prisma/client';

export class TeachingProcessStageDto {
  @IsString() @MaxLength(100) id!: string;
  @IsString() @MaxLength(120) title!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(300) duration!: number;
  @IsString() @MaxLength(20_000) coreQuestion!: string;
  @IsString() @MaxLength(20_000) teacherActivity!: string;
  @IsString() @MaxLength(20_000) studentActivity!: string;
  @IsString() @MaxLength(20_000) assessment!: string;
  @IsString() @MaxLength(20_000) designIntent!: string;
  @IsString() @MaxLength(20_000) resources!: string;
}

export class SaveLessonPlanDto {
  @IsEnum(LessonPlanSource) source!: LessonPlanSource;
  @IsUUID() courseId!: string;
  @IsOptional() @IsUUID() knowledgePointId?: string;
  @IsString() @MaxLength(200) theme!: string;
  @IsString() @MaxLength(64) scheduledAt!: string;
  @IsString() @MaxLength(160) classroom!: string;
  @IsString() @MaxLength(80) instructorName!: string;
  @IsString() @MaxLength(120) gradeLevel!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(300) durationMinutes!: number;
  @IsString() @MaxLength(20_000) learnerAnalysis!: string;
  @IsString() @MaxLength(20_000) knowledgeObjectives!: string;
  @IsString() @MaxLength(20_000) processObjectives!: string;
  @IsString() @MaxLength(20_000) valueObjectives!: string;
  @IsString() @MaxLength(20_000) coreCompetencies!: string;
  @IsString() @MaxLength(20_000) teachingContent!: string;
  @IsString() @MaxLength(20_000) keyPoints!: string;
  @IsString() @MaxLength(20_000) difficultPoints!: string;
  @IsString() @MaxLength(20_000) doubtfulPoints!: string;
  @IsString() @MaxLength(20_000) teachingMethods!: string;
  @IsString() @MaxLength(20_000) teachingMeans!: string;
  @IsString() @MaxLength(20_000) preparation!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => TeachingProcessStageDto)
  teachingProcess!: TeachingProcessStageDto[];
  @IsString() @MaxLength(20_000) homework!: string;
  @IsString() @MaxLength(20_000) assessment!: string;
  @IsString() @MaxLength(20_000) boardDesign!: string;
  @IsString() @MaxLength(20_000) reflection!: string;
}

export class QueryLessonPlanDto {
  @IsOptional() @IsUUID() courseId?: string;
  @IsOptional() @IsUUID() knowledgePointId?: string;
  @IsOptional() @IsEnum(LessonPlanSource) source?: LessonPlanSource;
}
