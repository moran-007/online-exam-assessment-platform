import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AiSummaryTaskResponseDto } from './dto/ai-summary.dto';
import {
  CreateClassSummaryTaskDto,
  CreateLessonAssistantTaskDto,
  CreateParentReportTaskDto,
  IntegratedSummaryDatasetPreviewDto,
  IntegratedSummaryRangeDto,
} from './dto/integrated-summary.dto';
import { IntegratedSummaryUseCases } from './integrated-summary.use-cases';

@ApiTags('AI Integrated Summary')
@ApiBearerAuth()
@Controller('ai-summaries')
export class IntegratedSummaryController {
  constructor(private readonly summaries: IntegratedSummaryUseCases) {}

  @Get('classes/:classId/preview')
  @Permissions('ai.summary.class.generate')
  @ApiOkResponse({ type: IntegratedSummaryDatasetPreviewDto })
  previewClass(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query() query: IntegratedSummaryRangeDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.summaries.previewClass({ classId, ...query }, user);
  }

  @Post('classes')
  @Permissions('ai.summary.class.generate')
  @ApiCreatedResponse({ type: AiSummaryTaskResponseDto })
  createClass(@Body() dto: CreateClassSummaryTaskDto, @CurrentUser() user: RequestUser) {
    return this.summaries.createClass(dto, user);
  }

  @Get('parent-reports/:studentId/preview')
  @Permissions('ai.summary.parent-report.generate')
  @ApiOkResponse({ type: IntegratedSummaryDatasetPreviewDto })
  previewParent(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: IntegratedSummaryRangeDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.summaries.previewParent({ studentId, ...query }, user);
  }

  @Post('parent-reports')
  @Permissions('ai.summary.parent-report.generate')
  @ApiCreatedResponse({ type: AiSummaryTaskResponseDto })
  createParent(@Body() dto: CreateParentReportTaskDto, @CurrentUser() user: RequestUser) {
    return this.summaries.createParent(dto, user);
  }

  @Get('lessons/:sessionId/preview')
  @Permissions('ai.summary.lesson.generate')
  @ApiOkResponse({ type: IntegratedSummaryDatasetPreviewDto })
  previewLesson(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.summaries.previewLesson(sessionId, user);
  }

  @Post('lessons')
  @Permissions('ai.summary.lesson.generate')
  @ApiCreatedResponse({ type: AiSummaryTaskResponseDto })
  createLesson(@Body() dto: CreateLessonAssistantTaskDto, @CurrentUser() user: RequestUser) {
    return this.summaries.createLesson(dto, user);
  }
}
