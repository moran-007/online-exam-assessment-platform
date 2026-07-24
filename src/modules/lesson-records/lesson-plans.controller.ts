import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  LessonPlanCourseOptionDto,
  QueryLessonPlanDto,
  SaveLessonPlanDto,
} from './dto/lesson-plan.dto';
import { LessonPlansService } from './lesson-plans.service';

@ApiTags('Lesson plan')
@ApiBearerAuth()
@Roles('SUPER_ADMIN', 'ADMIN', 'TEACHER', 'ASSISTANT')
@Controller('lesson-plans')
export class LessonPlansController {
  constructor(private readonly lessonPlans: LessonPlansService) {}

  @Get('course-options')
  @Permissions('lesson-plan:read')
  @ApiOkResponse({ type: [LessonPlanCourseOptionDto] })
  courseOptions(@CurrentUser() actor: RequestUser) {
    return this.lessonPlans.courseOptions(actor);
  }

  @Get()
  @Permissions('lesson-plan:read')
  list(@Query() query: QueryLessonPlanDto, @CurrentUser() actor: RequestUser) {
    return this.lessonPlans.list(query, actor);
  }

  @Post()
  @Permissions('lesson-plan:manage')
  create(@Body() dto: SaveLessonPlanDto, @CurrentUser() actor: RequestUser) {
    return this.lessonPlans.create(dto, actor);
  }

  @Patch(':id')
  @Permissions('lesson-plan:manage')
  update(@Param('id') id: string, @Body() dto: SaveLessonPlanDto, @CurrentUser() actor: RequestUser) {
    return this.lessonPlans.update(id, dto, actor);
  }

  @Delete(':id')
  @Permissions('lesson-plan:manage')
  remove(@Param('id') id: string, @CurrentUser() actor: RequestUser) {
    return this.lessonPlans.remove(id, actor);
  }
}
