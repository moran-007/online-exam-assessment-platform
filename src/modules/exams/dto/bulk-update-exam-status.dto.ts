import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, IsUUID } from 'class-validator';

export class BulkUpdateExamStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  ids: string[];

  @IsString()
  @IsIn(['draft', 'scheduled', 'running', 'ended', 'archived'])
  status: string;
}
