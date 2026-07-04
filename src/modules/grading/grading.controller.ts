import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { GradeAnswerDto } from './dto/grade-answer.dto';
import { BatchGradeAnswersDto } from './dto/batch-grade-answers.dto';
import { PublishGradesDto } from './dto/grade-visibility.dto';
import { QueryGradingDto } from './dto/query-grading.dto';
import { PreviewRegradeRunDto } from './dto/regrade-run.dto';
import { GradingService } from './grading.service';

@ApiTags('Grading')
@ApiBearerAuth()
@Controller('grading')
export class GradingController {
  constructor(private readonly gradingService: GradingService) {}

  @Get('answers')
  @Permissions('grading:score:read')
  list(@Query() query: QueryGradingDto, @CurrentUser() user: RequestUser) {
    return this.gradingService.list(query, user);
  }

  @Get('attempts/:attemptId')
  @Permissions('grading:score:read')
  attemptDetail(@Param('attemptId') attemptId: string, @CurrentUser() user: RequestUser) {
    return this.gradingService.attemptDetail(attemptId, user);
  }

  @Patch('answers/:answerRecordId')
  @Permissions('grading:score:update')
  gradeAnswer(
    @Param('answerRecordId') answerRecordId: string,
    @Body() dto: GradeAnswerDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.gradingService.gradeAnswer(answerRecordId, dto, user);
  }

  @Post('answers/batch')
  @Permissions('grading:score:update')
  batchGradeAnswers(@Body() dto: BatchGradeAnswersDto, @CurrentUser() user: RequestUser) {
    return this.gradingService.batchGradeAnswers(dto, user);
  }

  @Post('attempts/:attemptId/finish')
  @Permissions('grading:score:update')
  finishAttempt(@Param('attemptId') attemptId: string, @CurrentUser() user: RequestUser) {
    return this.gradingService.finishAttempt(attemptId, user);
  }

  @Post('attempts/:attemptId/regrade')
  @Permissions('grading:regrade:confirm')
  regradeAttempt(@Param('attemptId') attemptId: string, @CurrentUser() user: RequestUser) {
    return this.gradingService.regradeAttempt(attemptId, user);
  }

  @Post('regrade-runs/preview')
  @Permissions('grading:regrade:preview')
  previewRegradeRun(@Body() dto: PreviewRegradeRunDto, @CurrentUser() user: RequestUser) {
    return this.gradingService.previewRegradeRun(dto, user);
  }

  @Get('regrade-runs/:id')
  @Permissions('grading:regrade:preview')
  getRegradeRun(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.gradingService.getRegradeRun(id, user);
  }

  @Post('regrade-runs/:id/confirm')
  @Permissions('grading:regrade:confirm')
  confirmRegradeRun(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.gradingService.confirmRegradeRun(id, user);
  }

  @Post('regrade-runs/:id/cancel')
  @Permissions('grading:regrade:preview')
  cancelRegradeRun(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.gradingService.cancelRegradeRun(id, user);
  }

  @Post('exams/:examId/grades/publish')
  @Permissions('grading:score:update')
  publishGrades(
    @Param('examId') examId: string,
    @Body() dto: PublishGradesDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.gradingService.publishGrades(examId, dto, user);
  }

  @Post('exams/:examId/grades/withdraw')
  @Permissions('grading:score:update')
  withdrawGrades(@Param('examId') examId: string, @CurrentUser() user: RequestUser) {
    return this.gradingService.withdrawGrades(examId, user);
  }
}
