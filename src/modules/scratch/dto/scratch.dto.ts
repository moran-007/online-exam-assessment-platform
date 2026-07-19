import { Type } from 'class-transformer';
import {
  IsDateString,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ScratchAssignmentStatus,
  ScratchJudgeMode,
  ScratchTemplateStatus,
} from '@prisma/client';

export class CreateScratchTemplateDto {
  @IsString() @MaxLength(180) title!: string;
  @IsOptional() @IsString() @MaxLength(10_000) description?: string;
  @IsOptional() @IsString() @MaxLength(64) runtimeProvider?: string;
  @IsOptional() @IsString() @MaxLength(128) runtimeProblemId?: string;
  @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(2_000) runtimeProblemUrl?: string;
}

export class UpdateScratchTemplateDto {
  @IsOptional() @IsString() @MaxLength(180) title?: string;
  @IsOptional() @IsString() @MaxLength(10_000) description?: string;
  @IsOptional() @IsEnum(ScratchTemplateStatus) status?: ScratchTemplateStatus;
  @IsOptional() @IsString() @MaxLength(64) runtimeProvider?: string;
  @IsOptional() @IsString() @MaxLength(128) runtimeProblemId?: string;
  @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(2_000) runtimeProblemUrl?: string;
}

export class CreateScratchAssignmentDto {
  @IsUUID() templateId!: string;
  @IsString() @MaxLength(180) title!: string;
  @IsOptional() @IsString() @MaxLength(20_000) statementMd?: string;
  @IsOptional() @IsString() @MaxLength(2_000) bindNote?: string;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(1000) maxScore?: number;
  @IsOptional() @IsEnum(ScratchJudgeMode) judgeMode?: ScratchJudgeMode;
  @IsOptional() @IsObject() runtimeConfig?: Record<string, unknown>;
}

export class UpdateScratchAssignmentDto {
  @IsOptional() @IsString() @MaxLength(180) title?: string;
  @IsOptional() @IsString() @MaxLength(20_000) statementMd?: string;
  @IsOptional() @IsString() @MaxLength(2_000) bindNote?: string;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(1000) maxScore?: number;
  @IsOptional() @IsEnum(ScratchJudgeMode) judgeMode?: ScratchJudgeMode;
  @IsOptional() @IsObject() runtimeConfig?: Record<string, unknown>;
  @IsOptional() @IsEnum(ScratchAssignmentStatus) status?: ScratchAssignmentStatus;
}

export class CreateScratchWorkDto {
  @IsOptional() @IsString() @MaxLength(180) title?: string;
}

export class SaveScratchWorkVersionDto {
  @IsOptional() @IsString() @MaxLength(2_000) note?: string;
}

export class SubmitScratchWorkDto {
  @IsOptional() @IsString() @MaxLength(2_000) submitNote?: string;
}

export class ReviewScratchWorkDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000) score?: number;
  @IsOptional() @IsString() @MaxLength(10_000) comment?: string;
  @IsOptional() @IsObject() rubric?: Record<string, unknown>;
}

export enum ScratchCallbackStatus {
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

export class ScratchJudgeCallbackDto {
  @IsString() @MaxLength(180) callbackId!: string;
  @IsOptional() @IsString() @MaxLength(180) externalJobId?: string;
  @IsEnum(ScratchCallbackStatus) status!: ScratchCallbackStatus;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) score?: number;
  @IsOptional() @IsBoolean() passed?: boolean;
  @IsOptional() @IsString() @MaxLength(4_000) message?: string;
  @IsOptional() @IsObject() result?: Record<string, unknown>;
}

export class ScratchStudentQueryDto {
  @IsOptional() @IsUUID() studentId?: string;
}
