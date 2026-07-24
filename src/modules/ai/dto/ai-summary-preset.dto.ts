import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AiSummaryType } from '@prisma/client';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAiSummaryPresetDto {
  @ApiProperty({ description: '系统提示词；输出 JSON 结构由系统固定维护', maxLength: 12000 })
  @IsString() @IsNotEmpty() @MaxLength(12000)
  systemPrompt: string;

  @ApiProperty({ description: '本次调整原因', maxLength: 300 })
  @IsString() @IsNotEmpty() @MaxLength(300)
  changeReason: string;

  @ApiPropertyOptional({ default: true, description: '保存后立即启用该新版本' })
  @IsOptional() @IsBoolean()
  activate?: boolean;
}

export class AiSummaryPresetResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty({ enum: AiSummaryType }) summaryType: AiSummaryType;
  @ApiProperty() version: number;
  @ApiProperty() systemPrompt: string;
  @ApiProperty() enabled: boolean;
  @ApiProperty({ nullable: true }) changeReason: string | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) reviewedBy: string | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) createdBy: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}
