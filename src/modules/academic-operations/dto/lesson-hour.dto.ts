import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { LessonHourLedgerType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryLessonHourDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional() @IsEnum(LessonHourLedgerType) type?: LessonHourLedgerType;
}

export class CreateLessonHourAdjustmentDto {
  @IsUUID() studentId: string;
  @IsOptional() @IsUUID() courseId?: string;
  @IsOptional() @IsUUID() classId?: string;
  @IsEnum(LessonHourLedgerType) type: LessonHourLedgerType;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) amount: number;
  @IsString() @MaxLength(180) idempotencyKey: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ReconcileLessonHoursDto {
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) expectedBalance?: number;
}
