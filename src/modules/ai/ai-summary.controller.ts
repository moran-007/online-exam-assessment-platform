import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  CreateExamSummaryTaskDto,
  ExamSummaryDatasetPreviewDto,
  ExamSummaryTaskResponseDto,
} from './dto/ai-summary.dto';
import { ExamSummaryPreviewUseCases } from './exam-summary-preview.use-cases';
import { ExamSummaryTaskUseCases } from './exam-summary-task.use-cases';

@ApiTags('AI Summary')
@ApiBearerAuth()
@Controller('ai-summaries')
export class AiSummaryController {
  constructor(
    private readonly previews: ExamSummaryPreviewUseCases,
    private readonly tasks: ExamSummaryTaskUseCases,
  ) {}

  @Get('exams/:examId/preview')
  @Permissions('ai.summary.exam.generate')
  @ApiOkResponse({ type: ExamSummaryDatasetPreviewDto })
  preview(@Param('examId', ParseUUIDPipe) examId: string, @CurrentUser() user: RequestUser) {
    return this.previews.preview(examId, user);
  }

  @Post('exams')
  @Permissions('ai.summary.exam.generate')
  @ApiCreatedResponse({ type: ExamSummaryTaskResponseDto })
  create(@Body() dto: CreateExamSummaryTaskDto, @CurrentUser() user: RequestUser) {
    return this.tasks.create(dto, user);
  }
}
