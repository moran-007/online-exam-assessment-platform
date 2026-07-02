import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class PublishGradesDto {
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  attemptIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  studentIds?: string[];

  @IsOptional()
  @IsString()
  mode?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  skipPending?: boolean;
}
