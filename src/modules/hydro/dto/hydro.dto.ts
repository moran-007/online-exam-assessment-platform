import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class BindHydroProblemDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  judgeProvider?: string = 'hydro';

  @IsString()
  @MaxLength(128)
  externalProblemId: string;

  @IsOptional()
  @IsString()
  externalProblemUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  platformBaseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  domainId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  domainName?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  accountLabel?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timeLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  memoryLimit?: number;

  @IsOptional()
  @IsObject()
  judgeConfig?: Record<string, unknown>;
}

export class BindHydroAccountDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  platformCode?: string = 'hydro';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  platformName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  platformBaseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  loginUsername?: string;

  @IsOptional()
  @IsString()
  loginPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  hydroUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  hydroUsername?: string;

  @IsOptional()
  @IsIn(['bound', 'disabled'])
  bindStatus?: string = 'bound';
}

export class PullHydroProblemDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  problemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  problemUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  platformBaseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  domainId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  domainName?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class SubmitHydroCodeDto {
  @IsString()
  @MaxLength(64)
  language: string;

  @IsString()
  code: string;
}

export class WriteBackHydroResultDto {
  @IsOptional()
  @IsUUID()
  submissionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalSubmissionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  score?: number;

  @IsString()
  @MaxLength(64)
  status: string;

  @IsOptional()
  @IsObject()
  result?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  judgedAt?: string;

  @IsOptional()
  @IsString()
  secret?: string;
}

export class QueryHydroSummaryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  examId?: string;

  @IsOptional()
  @IsUUID()
  questionId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  platformCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  platformBaseUrl?: string;
}
