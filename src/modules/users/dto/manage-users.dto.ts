import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PermissionType, RoleStatus, UserStatus, UserType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListManagedUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  keyword?: string;

  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class CreateManagedUserDto {
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

  @IsEnum(UserType)
  userType: UserType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  roleIds?: string[];

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class UpdateManagedUserDto {
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

  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  roleIds?: string[];
}

export class ChangeOwnPasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  currentPassword: string;

  @IsString()
  @MinLength(6)
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  newPassword: string;
}

export class ResetManagedUserPasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  password: string;
}

export class SaveRoleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  description?: string;

  @IsOptional()
  @IsEnum(RoleStatus)
  status?: RoleStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  permissionIds?: string[];
}

export class UpdateRolePermissionsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  permissionIds: string[];
}

export class UpdateAiUserPermissionsDto extends UpdateRolePermissionsDto {
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  password: string;
}

export class AiUserReadablePermissionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiProperty()
  code!: string;

  @ApiProperty({ enum: PermissionType })
  type!: PermissionType;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  parentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  path?: string | null;

  @ApiPropertyOptional({ nullable: true })
  method?: string | null;

  @ApiProperty()
  sortOrder!: number;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  createdAt?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  updatedAt?: Date;
}

export class AiUserRoleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiProperty({ enum: RoleStatus })
  status!: RoleStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty()
  userCount!: number;

  @ApiProperty({ type: [String], format: 'uuid' })
  permissionIds!: string[];

  @ApiProperty({ type: [AiUserReadablePermissionResponseDto] })
  permissions!: AiUserReadablePermissionResponseDto[];

  @ApiPropertyOptional()
  assignable?: boolean;

  @ApiPropertyOptional()
  protected?: boolean;
}

export class AiUserPermissionConfigResponseDto {
  @ApiProperty({ type: AiUserRoleResponseDto })
  role!: AiUserRoleResponseDto;

  @ApiProperty({ type: [AiUserReadablePermissionResponseDto] })
  availablePermissions!: AiUserReadablePermissionResponseDto[];
}
