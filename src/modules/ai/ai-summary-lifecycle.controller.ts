import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  AiSummaryLifecycleRecordDto,
  AiSummaryLifecycleTaskDto,
  RegenerateAiSummaryDto,
  PublishedAiSummaryDto,
  UpdateAiSummaryDraftDto,
} from './dto/ai-summary-lifecycle.dto';
import { AiSummaryTaskResponseDto } from './dto/ai-summary.dto';
import { AiSummaryLifecycleUseCases } from './ai-summary-lifecycle.use-cases';
import { AiSummaryQueryUseCases } from './ai-summary-query.use-cases';

@ApiTags('AI Summary Lifecycle')
@ApiBearerAuth()
@Controller()
export class AiSummaryLifecycleController {
  constructor(
    private readonly queries: AiSummaryQueryUseCases,
    private readonly lifecycle: AiSummaryLifecycleUseCases,
  ) {}

  @Get('ai-summaries/tasks/:id')
  @Permissions('ai.summary.view-class')
  @ApiOkResponse({ type: AiSummaryLifecycleTaskDto })
  task(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.queries.task(id, user);
  }

  @Get('ai-summaries/:id')
  @Permissions('ai.summary.view-class')
  @ApiOkResponse({ type: AiSummaryLifecycleRecordDto })
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.queries.detail(id, user);
  }

  @Patch('ai-summaries/:id')
  @Permissions('ai.summary.review')
  @ApiOkResponse({ type: AiSummaryLifecycleRecordDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAiSummaryDraftDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.lifecycle.update(id, dto, user);
  }

  @Post('ai-summaries/:id/review')
  @Permissions('ai.summary.review')
  @ApiCreatedResponse({ type: AiSummaryLifecycleRecordDto })
  review(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.lifecycle.review(id, user);
  }

  @Post('ai-summaries/:id/publish')
  @Permissions('ai.summary.publish')
  @ApiCreatedResponse({ type: AiSummaryLifecycleRecordDto })
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.lifecycle.publish(id, user);
  }

  @Post('ai-summaries/:id/revoke')
  @Permissions('ai.summary.revoke')
  @ApiCreatedResponse({ type: AiSummaryLifecycleRecordDto })
  revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.lifecycle.revoke(id, user);
  }

  @Post('ai-summaries/:id/regenerate')
  @Permissions('ai.summary.view-class')
  @ApiCreatedResponse({ type: AiSummaryTaskResponseDto })
  regenerate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegenerateAiSummaryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.lifecycle.regenerate(id, dto, user);
  }

  @Get('exams/:examId/ai-summaries')
  @Permissions('ai.summary.view-class')
  @ApiOkResponse({ type: [AiSummaryLifecycleRecordDto] })
  history(@Param('examId', ParseUUIDPipe) examId: string, @CurrentUser() user: RequestUser) {
    return this.queries.examHistory(examId, user);
  }

  @Get('students/:studentId/ai-summaries')
  @Permissions('ai.summary.view-class')
  @ApiOkResponse({ type: [AiSummaryLifecycleRecordDto] })
  studentHistory(@Param('studentId', ParseUUIDPipe) studentId: string, @CurrentUser() user: RequestUser) {
    return this.queries.studentHistory(studentId, user);
  }

  @Get('me/ai-summaries')
  @Permissions('ai.summary.view-own')
  @ApiOkResponse({ type: [PublishedAiSummaryDto] })
  publishedFor(@CurrentUser() user: RequestUser) {
    return this.queries.publishedFor(user);
  }
}
