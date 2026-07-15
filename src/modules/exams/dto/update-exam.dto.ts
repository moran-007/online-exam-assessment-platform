import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { CreateExamDto } from './create-exam.dto';

export class UpdateExamDto extends PartialType(OmitType(CreateExamDto, ['classId'] as const)) {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  classId?: string | null;

  @IsOptional()
  @IsString()
  status?: string;
}
