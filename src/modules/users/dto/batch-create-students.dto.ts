import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class CreateStudentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  username: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  realName?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  password?: string;
}

export class BatchCreateStudentItemDto extends CreateStudentDto {}

export class BatchCreateTeacherItemDto extends CreateStudentDto {}

export class BatchCreateStudentsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BatchCreateStudentItemDto)
  students: BatchCreateStudentItemDto[];

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  defaultPassword?: string;
}

export class BatchCreateTeachersDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BatchCreateTeacherItemDto)
  teachers: BatchCreateTeacherItemDto[];

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  defaultPassword?: string;
}
