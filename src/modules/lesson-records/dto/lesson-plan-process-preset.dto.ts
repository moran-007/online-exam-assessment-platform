import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const LESSON_PLAN_PROCESS_PRESET_SOURCES = ['SYSTEM', 'PERSONAL'] as const;
export type LessonPlanProcessPresetSource =
  typeof LESSON_PLAN_PROCESS_PRESET_SOURCES[number];

export class LessonPlanProcessPresetStageDto {
  @ApiProperty({ example: '导入新课', maxLength: 120 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ description: '环节预计分钟数', minimum: 1, maximum: 300 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(300)
  duration!: number;
}

export class CreateLessonPlanProcessPresetDto {
  @ApiProperty({ example: '我的讲练结合方案', maxLength: 80 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({
    type: () => [LessonPlanProcessPresetStageDto],
    minItems: 1,
    maxItems: 20,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LessonPlanProcessPresetStageDto)
  stages!: LessonPlanProcessPresetStageDto[];
}

export class UpdateLessonPlanProcessPresetDto extends PartialType(
  CreateLessonPlanProcessPresetDto,
) {}

export class LessonPlanProcessPresetResponseDto {
  @ApiProperty({ description: '内置预设使用稳定字符串 ID；个人预设使用 UUID' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: () => [LessonPlanProcessPresetStageDto] })
  stages!: LessonPlanProcessPresetStageDto[];

  @ApiProperty({ enum: LESSON_PLAN_PROCESS_PRESET_SOURCES })
  source!: LessonPlanProcessPresetSource;

  @ApiProperty({ description: '当前用户是否可以修改或删除该预设' })
  canManage!: boolean;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  createdBy!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  createdAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  updatedAt!: Date | null;
}
