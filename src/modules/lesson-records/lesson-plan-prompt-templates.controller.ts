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
  LessonPlanPromptTemplateResponseDto,
  SaveLessonPlanPromptTemplateDto,
} from './dto/lesson-plan-prompt-template.dto';
import { LessonPlanPromptTemplatesService } from './lesson-plan-prompt-templates.service';

@ApiTags('Lesson plan prompt template')
@ApiBearerAuth()
@Roles('SUPER_ADMIN', 'ADMIN', 'TEACHER', 'ASSISTANT')
@Controller('lesson-plan-prompt-templates')
export class LessonPlanPromptTemplatesController {
  constructor(
    private readonly promptTemplates: LessonPlanPromptTemplatesService,
  ) {}

  @Get()
  @Permissions('lesson-record:read')
  @ApiOperation({ summary: '获取系统内置及当前教师的教案生成指令模板' })
  @ApiOkResponse({ type: [LessonPlanPromptTemplateResponseDto] })
  list(@CurrentUser() actor: RequestUser) {
    return this.promptTemplates.list(actor);
  }

  @Post()
  @Permissions('lesson-record:manage')
  @ApiOperation({ summary: '创建当前教师的个人教案生成指令模板' })
  @ApiCreatedResponse({ type: LessonPlanPromptTemplateResponseDto })
  create(
    @Body() dto: SaveLessonPlanPromptTemplateDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.promptTemplates.create(dto, actor);
  }

  @Patch(':id')
  @Permissions('lesson-record:manage')
  @ApiOperation({ summary: '修改当前教师的个人教案生成指令模板' })
  @ApiOkResponse({ type: LessonPlanPromptTemplateResponseDto })
  update(
    @Param('id') id: string,
    @Body() dto: SaveLessonPlanPromptTemplateDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.promptTemplates.update(id, dto, actor);
  }

  @Delete(':id')
  @Permissions('lesson-record:manage')
  @ApiOperation({ summary: '删除当前教师的个人教案生成指令模板' })
  @ApiOkResponse({ schema: { type: 'boolean' } })
  remove(@Param('id') id: string, @CurrentUser() actor: RequestUser) {
    return this.promptTemplates.remove(id, actor);
  }
}
