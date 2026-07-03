import { ArrayNotEmpty, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class BatchGradeAnswersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  answerRecordIds: string[];

  @IsIn(['full', 'zero'])
  mode: 'full' | 'zero';

  @IsOptional()
  @IsString()
  comment?: string;
}
