import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const LESSON_PLAN_PROMPT_TEMPLATE_SOURCES = ['SYSTEM', 'PERSONAL'] as const;
export type LessonPlanPromptTemplateSource =
  typeof LESSON_PLAN_PROMPT_TEMPLATE_SOURCES[number];

export class SaveLessonPlanPromptTemplateDto {
  @ApiProperty({
    description: '指令模板名称',
    example: '我的数学探究课详案',
    maxLength: 80,
  })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({
    description: '附加到教案生成上下文中的教师自定义要求',
    maxLength: 6000,
  })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(6000)
  templateContent!: string;

  @ApiPropertyOptional({
    description: '单次生成最大输出 Token；null 或不传表示自动',
    nullable: true,
    minimum: 512,
    maximum: 8192,
    example: 6000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(512)
  @Max(8192)
  maxTokens?: number | null;
}

export class LessonPlanPromptTemplateResponseDto {
  @ApiProperty({ description: '内置模板使用稳定字符串 ID；个人模板使用 UUID' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  templateContent!: string;

  @ApiProperty({
    description: '单次生成最大输出 Token；null 表示自动',
    nullable: true,
    minimum: 512,
    maximum: 8192,
  })
  maxTokens!: number | null;

  @ApiProperty({ enum: LESSON_PLAN_PROMPT_TEMPLATE_SOURCES })
  source!: LessonPlanPromptTemplateSource;

  @ApiProperty({ description: '当前用户是否可以修改或删除该模板' })
  canManage!: boolean;

  @ApiProperty({ nullable: true, format: 'uuid' })
  createdBy!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  createdAt!: Date | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  updatedAt!: Date | null;
}
