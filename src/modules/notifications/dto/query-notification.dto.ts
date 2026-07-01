import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryNotificationDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  unreadOnly?: string;
}
