import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TagStatus, TagType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryTagDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TagType)
  type?: TagType;

  @IsOptional()
  @IsEnum(TagStatus)
  status?: TagStatus;

  @IsOptional()
  @IsString()
  keyword?: string;
}
