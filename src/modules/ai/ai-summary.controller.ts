import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { ExamSummaryDatasetPreviewDto } from './dto/ai-summary.dto';
import { ExamSummaryPreviewUseCases } from './exam-summary-preview.use-cases';

@ApiTags('AI Summary')
@ApiBearerAuth()
@Controller('ai/summaries')
export class AiSummaryController {
  constructor(private readonly useCases: ExamSummaryPreviewUseCases) {}

  @Get('exams/:examId/preview')
  @Permissions('ai.summary.exam.generate')
  @ApiOkResponse({ type: ExamSummaryDatasetPreviewDto })
  preview(@Param('examId', ParseUUIDPipe) examId: string, @CurrentUser() user: RequestUser) {
    return this.useCases.preview(examId, user);
  }
}
