import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { CourseUnitStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryCatalogDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;
}

export class SaveLessonTypeDto {
  @IsString()
  @MaxLength(96)
  name: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultHours: number;

  @Type(() => Boolean)
  @IsBoolean()
  countInStatistics: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

export class QueryCourseUnitDto extends QueryCatalogDto {
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @IsOptional()
  @IsUUID()
  lessonTypeId?: string;

  @IsOptional()
  @IsEnum(CourseUnitStatus)
  status?: CourseUnitStatus;
}

export class SaveCourseUnitDto {
  @IsString()
  @MaxLength(128)
  code: string;

  @IsOptional()
  @IsUUID()
  courseId?: string;

  @IsUUID()
  lessonTypeId: string;

  @IsOptional()
  @IsString()
  @MaxLength(96)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(96)
  stage?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitNo?: number;

  @IsString()
  @MaxLength(160)
  name: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultHours: number;

  @IsOptional()
  @IsString()
  teachingContent?: string;

  @IsOptional()
  @IsEnum(CourseUnitStatus)
  status?: CourseUnitStatus;
}
