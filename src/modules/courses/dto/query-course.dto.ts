import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CourseStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryCourseDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsEnum(CourseStatus)
  status?: CourseStatus;
}
