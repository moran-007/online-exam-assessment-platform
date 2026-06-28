import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, IsUUID } from 'class-validator';

export class BulkQuestionActionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  ids: string[];
}

export class BulkQuestionStatusDto extends BulkQuestionActionDto {
  @IsString()
  @IsIn(['draft', 'pending_review', 'published', 'disabled'])
  status: string;
}
