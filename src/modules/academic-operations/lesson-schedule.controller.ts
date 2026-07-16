import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  CancelSessionDto,
  CreateSessionDto,
  GenerateSessionsDto,
  MakeupSessionDto,
  QueryScheduleRuleDto,
  QuerySessionDto,
  RescheduleSessionDto,
  SaveScheduleRuleDto,
} from './dto/schedule.dto';
import { LessonScheduleService } from './lesson-schedule.service';

@ApiTags('Academic operations - schedule')
@ApiBearerAuth()
@Controller()
export class LessonScheduleController {
  constructor(private readonly schedule: LessonScheduleService) {}

  @Get('schedule-rules')
  @Permissions('schedule:read')
  rules(@Query() query: QueryScheduleRuleDto, @CurrentUser() actor: RequestUser) {
    return this.schedule.listRules(query, actor);
  }

  @Post('schedule-rules')
  @Permissions('schedule:manage')
  createRule(@Body() dto: SaveScheduleRuleDto, @CurrentUser() actor: RequestUser) {
    return this.schedule.createRule(dto, actor);
  }

  @Patch('schedule-rules/:id')
  @Permissions('schedule:manage')
  updateRule(@Param('id') id: string, @Body() dto: SaveScheduleRuleDto, @CurrentUser() actor: RequestUser) {
    return this.schedule.updateRule(id, dto, actor);
  }

  @Post('lesson-sessions/generate')
  @Permissions('schedule:manage')
  generate(@Body() dto: GenerateSessionsDto, @CurrentUser() actor: RequestUser) {
    return this.schedule.generate(dto, actor);
  }

  @Get('lesson-sessions')
  @Permissions('schedule:read')
  sessions(@Query() query: QuerySessionDto, @CurrentUser() actor: RequestUser) {
    return this.schedule.listSessions(query, actor);
  }

  @Post('lesson-sessions')
  @Permissions('schedule:manage')
  createSession(@Body() dto: CreateSessionDto, @CurrentUser() actor: RequestUser) {
    return this.schedule.createSession(dto, actor);
  }

  @Post('lesson-sessions/:id/reschedule')
  @Permissions('schedule:manage')
  reschedule(@Param('id') id: string, @Body() dto: RescheduleSessionDto, @CurrentUser() actor: RequestUser) {
    return this.schedule.reschedule(id, dto, actor);
  }

  @Patch('lesson-sessions/:id/cancel')
  @Permissions('schedule:manage')
  cancel(@Param('id') id: string, @Body() dto: CancelSessionDto, @CurrentUser() actor: RequestUser) {
    return this.schedule.cancel(id, dto, actor);
  }

  @Post('lesson-sessions/:id/makeup')
  @Permissions('schedule:manage')
  makeup(@Param('id') id: string, @Body() dto: MakeupSessionDto, @CurrentUser() actor: RequestUser) {
    return this.schedule.makeup(id, dto, actor);
  }
}
