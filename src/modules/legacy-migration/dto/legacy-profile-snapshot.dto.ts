import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const trimOptional = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

class LegacyPersonDto {
  @IsString() @MaxLength(128) legacyId: string;
  @IsString() @MaxLength(128) @Transform(trimOptional) name: string;
  @IsOptional() @IsString() @MaxLength(32) @Transform(trimOptional) phone?: string;
  @IsOptional() @IsString() @MaxLength(32) @Transform(trimOptional) status?: string;
}

export class LegacyStudentDto extends LegacyPersonDto {
  @IsOptional() @IsString() @MaxLength(16) @Transform(trimOptional) gender?: string;
  @IsOptional() @IsString() @MaxLength(128) @Transform(trimOptional) school?: string;
  @IsOptional() @IsString() @MaxLength(128) @Transform(trimOptional) parentName?: string;
  @IsOptional() @IsString() @MaxLength(32) @Transform(trimOptional) parentPhone?: string;
}

export class LegacyTeacherDto extends LegacyPersonDto {
  @IsOptional() @IsString() @MaxLength(128) @Transform(trimOptional) subject?: string;
}

export class LegacyClassDto {
  @IsString() @MaxLength(128) legacyId: string;
  @IsString() @MaxLength(128) @Transform(trimOptional) name: string;
  @IsOptional() @IsString() @MaxLength(128) teacherLegacyId?: string;
  @IsOptional() @IsString() @MaxLength(32) status?: string;
}

export class LegacyClassStudentDto {
  @IsString() @MaxLength(128) legacyId: string;
  @IsString() @MaxLength(128) classLegacyId: string;
  @IsString() @MaxLength(128) studentLegacyId: string;
  @IsOptional() @IsString() @MaxLength(32) status?: string;
  @IsOptional() @IsString() @MaxLength(32) joinDate?: string;
  @IsOptional() @IsString() @MaxLength(32) leaveDate?: string;
}

export class LegacyAccountDto {
  @IsString() @MaxLength(128) legacyId: string;
  @IsString() @MaxLength(64) @Transform(trimOptional) username: string;
  @IsOptional() @IsString() @MaxLength(128) studentLegacyId?: string;
  @IsOptional() @IsString() @MaxLength(128) teacherLegacyId?: string;
}

export class LegacyProfileSnapshotDto {
  @IsString() @MaxLength(64) sourceSystem: string;
  @IsString() @MaxLength(64) sourceVersion: string;

  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => LegacyStudentDto)
  students: LegacyStudentDto[];

  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => LegacyTeacherDto)
  teachers: LegacyTeacherDto[];

  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => LegacyClassDto)
  classes: LegacyClassDto[];

  @IsArray() @ArrayMaxSize(10000) @ValidateNested({ each: true }) @Type(() => LegacyClassStudentDto)
  classStudents: LegacyClassStudentDto[];

  @IsArray() @ArrayMaxSize(3000) @ValidateNested({ each: true }) @Type(() => LegacyAccountDto)
  accounts: LegacyAccountDto[];
}

export class ResolveMigrationConflictDto {
  @IsIn(['CREATE_WITHOUT_PHONE', 'SKIP'])
  resolutionCode: 'CREATE_WITHOUT_PHONE' | 'SKIP';

  @IsString() @MaxLength(500) @Transform(trimOptional)
  note: string;

  @IsOptional() @IsBoolean()
  waive?: boolean;
}
