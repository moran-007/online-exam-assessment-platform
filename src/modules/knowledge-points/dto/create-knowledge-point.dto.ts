import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateKnowledgePointDto {
  @IsUUID()
  courseId: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsString()
  @MaxLength(128)
  name: string;

  @IsString()
  @MaxLength(64)
  code: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder = 0;
}
