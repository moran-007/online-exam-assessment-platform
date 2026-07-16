import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { AttendanceStatus } from '@prisma/client';

export class AttendanceItemDto {
  @IsUUID() studentId: string;
  @IsEnum(AttendanceStatus) status: AttendanceStatus;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) deductHours?: number;
}

export class ConfirmAttendanceDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @ValidateNested({ each: true }) @Type(() => AttendanceItemDto)
  records: AttendanceItemDto[];
}

export class CorrectAttendanceDto {
  @IsEnum(AttendanceStatus) status: AttendanceStatus;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) deductHours: number;
  @IsString() @MaxLength(500) reason: string;
}
