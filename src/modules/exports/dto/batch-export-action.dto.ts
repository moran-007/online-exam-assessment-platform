import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class BatchExportActionDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  ids: string[];
}
