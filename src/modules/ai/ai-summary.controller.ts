import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  CreateExamSummaryTaskDto,
  ExamSummaryDatasetPreviewDto,
  AiSummaryTaskResponseDto,
} from './dto/ai-summary.dto';
import { ExamSummaryPreviewUseCases } from './exam-summary-preview.use-cases';
import { ExamSummaryTaskUseCases } from './exam-summary-task.use-cases';
import { StudentSummaryPreviewUseCases } from './student-summary-preview.use-cases';
import {
  CreateStudentSummaryTaskDto,
  EstimateStudentSummaryBatchDto,
  StudentSummaryBatchEstimateDto,
  StudentSummaryDatasetPreviewDto,
  StudentSummaryScopeQueryDto,
} from './dto/student-summary.dto';
import { StudentSummaryTaskUseCases } from './student-summary-task.use-cases';
import { StudentSummaryBatchEstimateUseCases } from './student-summary-batch-estimate.use-cases';

@ApiTags('AI Summary')
@ApiBearerAuth()
@Controller('ai-summaries')
export class AiSummaryController {
  constructor(
    private readonly previews: ExamSummaryPreviewUseCases,
    private readonly tasks: ExamSummaryTaskUseCases,
    private readonly studentPreviews: StudentSummaryPreviewUseCases,
    private readonly studentTasks: StudentSummaryTaskUseCases,
    private readonly studentBatchEstimates: StudentSummaryBatchEstimateUseCases,
  ) {}

  @Get('exams/:examId/preview')
  @Permissions('ai.summary.exam.generate')
  @ApiOkResponse({ type: ExamSummaryDatasetPreviewDto })
  preview(@Param('examId', ParseUUIDPipe) examId: string, @CurrentUser() user: RequestUser) {
    return this.previews.preview(examId, user);
  }

  @Post('exams')
  @Permissions('ai.summary.exam.generate')
  @ApiCreatedResponse({ type: AiSummaryTaskResponseDto })
  create(@Body() dto: CreateExamSummaryTaskDto, @CurrentUser() user: RequestUser) {
    return this.tasks.create(dto, user);
  }

  @Get('students/:studentId/preview')
  @Permissions('ai.summary.student.generate')
  @ApiOkResponse({ type: StudentSummaryDatasetPreviewDto })
  studentPreview(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: StudentSummaryScopeQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.studentPreviews.preview({ studentId, ...query }, user);
  }

  @Post('students')
  @Permissions('ai.summary.student.generate')
  @ApiCreatedResponse({ type: AiSummaryTaskResponseDto })
  createStudent(@Body() dto: CreateStudentSummaryTaskDto, @CurrentUser() user: RequestUser) {
    return this.studentTasks.create(dto, user);
  }

  @Post('students/batch-estimate')
  @Permissions('ai.summary.student.generate')
  @ApiCreatedResponse({ type: StudentSummaryBatchEstimateDto })
  estimateStudentBatch(
    @Body() dto: EstimateStudentSummaryBatchDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.studentBatchEstimates.estimate(dto, user);
  }
}
