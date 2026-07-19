import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { LessonAssetAudience, LessonRecordStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryLessonRecordDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsEnum(LessonRecordStatus) status?: LessonRecordStatus;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class SaveLessonRecordDto {
  @IsOptional() @IsString() @MaxLength(20_000) internalTeachingNotes?: string;
  @IsOptional() @IsString() @MaxLength(20_000) internalClassPerformance?: string;
  @IsOptional() @IsString() @MaxLength(20_000) publicTeachingContent?: string;
  @IsOptional() @IsString() @MaxLength(20_000) publicLearningGoal?: string;
  @IsOptional() @IsString() @MaxLength(20_000) publicClassPerformance?: string;
  @IsOptional() @IsString() @MaxLength(20_000) publicHomework?: string;
  @IsOptional() @IsString() @MaxLength(20_000) publicNextPlan?: string;
  @IsOptional() @IsString() @MaxLength(20_000) publicMaterials?: string;
}

export class LessonRecordTransitionDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class LessonAssetMetadataDto {
  @IsOptional() @IsEnum(LessonAssetAudience) audience?: LessonAssetAudience;
  @IsOptional() @IsString() @MaxLength(180) title?: string;
  @IsOptional() @IsString() @MaxLength(2_000) note?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}
