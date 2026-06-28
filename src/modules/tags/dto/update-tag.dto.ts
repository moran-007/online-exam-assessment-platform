import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TagStatus, TagType } from '@prisma/client';

export class UpdateTagDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsEnum(TagType)
  type?: TagType;

  @IsOptional()
  @IsEnum(TagStatus)
  status?: TagStatus;
}
