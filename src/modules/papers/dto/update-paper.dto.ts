import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreatePaperDto } from './create-paper.dto';

export class UpdatePaperDto extends PartialType(CreatePaperDto) {
  @IsOptional()
  @IsString()
  status?: string;
}
