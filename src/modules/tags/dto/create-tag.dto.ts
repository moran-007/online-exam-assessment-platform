import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TagType } from '@prisma/client';

export class CreateTagDto {
  @IsString()
  @MaxLength(64)
  name: string;

  @IsString()
  @MaxLength(64)
  code: string;

  @IsOptional()
  @IsEnum(TagType)
  type: TagType = TagType.QUESTION;
}
