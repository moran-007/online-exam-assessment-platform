import { IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryAuditLogDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsUUID()
  targetId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
