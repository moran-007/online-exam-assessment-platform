import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const trimOptional = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class ProfileListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(trimOptional)
  keyword?: string;
}

export class UpdateStudentProfileDto {
  @IsOptional() @IsString() @MaxLength(64) @Transform(trimOptional) studentNo?: string;
  @IsOptional() @IsString() @MaxLength(16) @Transform(trimOptional) gender?: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() @MaxLength(128) @Transform(trimOptional) school?: string;
  @IsOptional() @IsString() @MaxLength(64) @Transform(trimOptional) grade?: string;
  @IsOptional() @IsString() @MaxLength(32) @Transform(trimOptional) enrollmentStatus?: string;
  @IsOptional() @IsDateString() enrolledAt?: string;
  @IsOptional() @IsString() @MaxLength(1000) @Transform(trimOptional) notes?: string;
}

export class UpdateTeacherProfileDto {
  @IsOptional() @IsString() @MaxLength(64) @Transform(trimOptional) employeeNo?: string;
  @IsOptional() @IsString() @MaxLength(128) @Transform(trimOptional) subject?: string;
  @IsOptional() @IsString() @MaxLength(32) @Transform(trimOptional) employmentStatus?: string;
  @IsOptional() @IsDateString() joinedAt?: string;
  @IsOptional() @IsString() @MaxLength(1000) @Transform(trimOptional) notes?: string;
}

export class LinkParentStudentDto {
  @IsUUID('4') parentId: string;
  @IsUUID('4') studentId: string;
  @IsString() @MaxLength(32) @Transform(trimOptional) relationship: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}
