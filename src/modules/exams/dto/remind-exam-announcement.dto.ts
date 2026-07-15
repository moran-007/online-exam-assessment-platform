import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RemindExamAnnouncementDto {
  @ApiPropertyOptional({ description: 'Optional reminder text override' })
  @IsOptional()
  @IsString()
  content?: string;
}
