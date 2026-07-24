import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  CreateLessonPlanProcessPresetDto,
  LessonPlanProcessPresetResponseDto,
  UpdateLessonPlanProcessPresetDto,
} from './dto/lesson-plan-process-preset.dto';
import { LessonPlanProcessPresetsService } from './lesson-plan-process-presets.service';

@ApiTags('Lesson plan process preset')
@ApiBearerAuth()
@Roles('SUPER_ADMIN', 'ADMIN', 'TEACHER', 'ASSISTANT')
@Controller('lesson-plan-process-presets')
export class LessonPlanProcessPresetsController {
  constructor(
    private readonly processPresets: LessonPlanProcessPresetsService,
  ) {}

  @Get()
  @Permissions('lesson-record:read')
  @ApiOperation({ summary: '获取系统内置及当前教师的教学过程预设' })
  @ApiOkResponse({ type: [LessonPlanProcessPresetResponseDto] })
  list(@CurrentUser() actor: RequestUser) {
    return this.processPresets.list(actor);
  }

  @Post()
  @Permissions('lesson-record:manage')
  @ApiOperation({ summary: '创建当前教师的个人教学过程预设' })
  @ApiCreatedResponse({ type: LessonPlanProcessPresetResponseDto })
  create(
    @Body() dto: CreateLessonPlanProcessPresetDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.processPresets.create(dto, actor);
  }

  @Patch(':id')
  @Permissions('lesson-record:manage')
  @ApiOperation({ summary: '修改当前教师的个人教学过程预设' })
  @ApiOkResponse({ type: LessonPlanProcessPresetResponseDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLessonPlanProcessPresetDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.processPresets.update(id, dto, actor);
  }

  @Delete(':id')
  @Permissions('lesson-record:manage')
  @ApiOperation({ summary: '删除当前教师的个人教学过程预设' })
  @ApiOkResponse({ schema: { type: 'boolean' } })
  remove(@Param('id') id: string, @CurrentUser() actor: RequestUser) {
    return this.processPresets.remove(id, actor);
  }
}
