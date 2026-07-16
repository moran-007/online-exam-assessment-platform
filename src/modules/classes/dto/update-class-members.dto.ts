import { ClassTeacherRole } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsUUID } from 'class-validator';

export class UpdateClassMembersDto {
  @IsArray()
  @IsUUID('4', { each: true })
  userIds: string[];
}

export class UpdateClassTeachersDto extends UpdateClassMembersDto {
  @IsOptional()
  @IsEnum(ClassTeacherRole)
  role?: ClassTeacherRole;
}
