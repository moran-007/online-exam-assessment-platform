import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AiFeedbackUseCases } from './ai-feedback.use-cases';
import { AiQualityDashboardUseCases } from './ai-quality-dashboard.use-cases';
import { AiRegressionUseCases } from './ai-regression.use-cases';
import {
  AiFeedbackListDto,
  AiFeedbackQueryDto,
  AiFeedbackRecordDto,
  AiQualityDashboardDto,
  AiQualityRangeQueryDto,
  AiRegressionRunDto,
  CreateAiRegressionRunDto,
  CreateAiSummaryFeedbackDto,
  ResolveAiSummaryFeedbackDto,
} from './dto/ai-quality.dto';

@ApiTags('AI Quality')
@ApiBearerAuth()
@Controller()
export class AiQualityController {
  constructor(
    private readonly dashboardUseCases: AiQualityDashboardUseCases,
    private readonly feedbackUseCases: AiFeedbackUseCases,
    private readonly regressionUseCases: AiRegressionUseCases,
  ) {}

  @Get('ai-quality/dashboard')
  @Permissions('ai.quality.read')
  @ApiOkResponse({ type: AiQualityDashboardDto })
  dashboard(@Query() query: AiQualityRangeQueryDto) {
    return this.dashboardUseCases.dashboard(query);
  }

  @Get('ai-quality/feedback')
  @Permissions('ai.quality.read')
  @ApiOkResponse({ type: AiFeedbackListDto })
  feedback(@Query() query: AiFeedbackQueryDto) {
    return this.feedbackUseCases.list(query);
  }

  @Post('ai-summaries/:id/feedback')
  @Permissions('ai.feedback.create')
  @ApiCreatedResponse({ type: AiFeedbackRecordDto })
  createFeedback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAiSummaryFeedbackDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.feedbackUseCases.create(id, dto, user);
  }

  @Patch('ai-quality/feedback/:id')
  @Permissions('ai.quality.manage')
  @ApiOkResponse({ type: AiFeedbackRecordDto })
  resolveFeedback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveAiSummaryFeedbackDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.feedbackUseCases.resolve(id, dto, user);
  }

  @Get('ai-quality/regressions')
  @Permissions('ai.quality.read')
  @ApiOkResponse({ type: [AiRegressionRunDto] })
  regressions() {
    return this.regressionUseCases.list();
  }

  @Post('ai-quality/regressions')
  @Permissions('ai.quality.manage')
  @ApiCreatedResponse({ type: AiRegressionRunDto })
  runRegression(@Body() dto: CreateAiRegressionRunDto, @CurrentUser() user: RequestUser) {
    return this.regressionUseCases.run(dto, user);
  }
}
