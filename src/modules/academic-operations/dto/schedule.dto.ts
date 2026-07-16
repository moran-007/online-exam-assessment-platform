import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { LessonSessionKind, LessonSessionStatus, ScheduleRuleStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryScheduleRuleDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional() @IsEnum(ScheduleRuleStatus) status?: ScheduleRuleStatus;
}

export class SaveScheduleRuleDto {
  @IsUUID() classId: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsUUID() lessonTypeId: string;
  @IsOptional() @IsUUID() unitTemplateId?: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(6) weekday: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1439) startMinute: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(1440) endMinute: number;
  @IsDateString() effectiveFrom: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) lessonHours: number;
  @IsOptional() @IsString() @MaxLength(128) classroom?: string;
  @IsOptional() @IsEnum(ScheduleRuleStatus) status?: ScheduleRuleStatus;
}

export class GenerateSessionsDto {
  @IsDateString() from: string;
  @IsDateString() to: string;
  @IsOptional() @IsUUID() ruleId?: string;
  @IsOptional() @IsUUID() classId?: string;
}

export class QuerySessionDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsOptional() @IsEnum(LessonSessionStatus) status?: LessonSessionStatus;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class CreateSessionDto {
  @IsUUID() classId: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsUUID() lessonTypeId: string;
  @IsOptional() @IsUUID() unitTemplateId?: string;
  @IsString() @MaxLength(180) title: string;
  @IsOptional() @IsEnum(LessonSessionKind) kind?: LessonSessionKind;
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) lessonHours: number;
  @IsOptional() @IsString() @MaxLength(128) classroom?: string;
}

export class RescheduleSessionDto {
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsOptional() @IsString() @MaxLength(128) classroom?: string;
  @IsString() @MaxLength(500) reason: string;
}

export class CancelSessionDto {
  @IsString() @MaxLength(500) reason: string;
}

export class MakeupSessionDto extends RescheduleSessionDto {}
