import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  ApiCreatedRecordResponse,
  ApiRecordArrayResponse,
  ApiRecordPageResponse,
  ApiRecordResponse,
} from '../../common/dto/api-response.dto';
import {
  AddWrongQuestionDto,
  BatchWrongQuestionDto,
  GenerateWrongQuestionPaperDto,
  QueryWrongQuestionDto,
  QueryStudentExamDto,
  QueryStudentPaperDto,
  RecordWrongQuestionPracticeDto,
  SaveAnswerDto,
  SaveAnswersDto,
  SimulateSaveAnswersDto,
  SimulateStudentDto,
  UpdateWrongQuestionStatusDto,
} from './dto/save-answer.dto';
import {
  StudentAttemptUseCases,
  StudentExamUseCases,
  StudentPaperUseCases,
  StudentWrongQuestionUseCases,
} from './student.use-cases';

@ApiTags('Student')
@ApiBearerAuth()
@Controller('student')
export class StudentController {
  constructor(
    private readonly exams: StudentExamUseCases,
    private readonly attempts: StudentAttemptUseCases,
    private readonly wrongQuestionsUseCases: StudentWrongQuestionUseCases,
    private readonly paperUseCases: StudentPaperUseCases,
  ) {}

  @Get('exams')
  @ApiRecordArrayResponse()
  myExams(@CurrentUser() user: RequestUser, @Query() query: QueryStudentExamDto) {
    return this.exams.myExams(user, query);
  }

  @Get('exams/:examId/ranking')
  @ApiRecordResponse()
  examRanking(@Param('examId') examId: string, @CurrentUser() user: RequestUser) {
    return this.exams.examRanking(examId, user);
  }

  @Post('exams/:examId/announcement/read')
  @ApiCreatedRecordResponse()
  readExamAnnouncement(@Param('examId') examId: string, @CurrentUser() user: RequestUser) {
    return this.exams.readExamAnnouncement(examId, user);
  }

  @Post('exams/:examId/enter')
  @ApiCreatedRecordResponse()
  enterExam(@Param('examId') examId: string, @CurrentUser() user: RequestUser) {
    return this.exams.enterExam(examId, user);
  }

  @Get('attempts/:attemptId')
  @ApiRecordResponse()
  getAttempt(@Param('attemptId') attemptId: string, @CurrentUser() user: RequestUser) {
    return this.attempts.getAttempt(attemptId, user);
  }

  @Post('attempts/:attemptId/save-answer')
  @ApiCreatedRecordResponse()
  saveAnswer(
    @Param('attemptId') attemptId: string,
    @Body() dto: SaveAnswerDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attempts.saveAnswer(attemptId, dto, user);
  }

  @Post('attempts/:attemptId/save-answers')
  @ApiCreatedRecordResponse()
  saveAnswers(
    @Param('attemptId') attemptId: string,
    @Body() dto: SaveAnswersDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attempts.saveAnswers(attemptId, dto, user);
  }

  @Post('attempts/:attemptId/submit')
  @ApiCreatedRecordResponse()
  submit(@Param('attemptId') attemptId: string, @CurrentUser() user: RequestUser) {
    return this.attempts.submit(attemptId, user);
  }

  @Get('attempts/:attemptId/result')
  @ApiRecordResponse()
  result(@Param('attemptId') attemptId: string, @CurrentUser() user: RequestUser) {
    return this.attempts.result(attemptId, user);
  }

  @Get('wrong-questions')
  @ApiRecordArrayResponse()
  wrongQuestions(@CurrentUser() user: RequestUser, @Query() query: QueryWrongQuestionDto) {
    return this.wrongQuestionsUseCases.wrongQuestions(user, query);
  }

  @Get('wrong-questions/insights')
  @ApiRecordResponse()
  wrongQuestionInsights(@CurrentUser() user: RequestUser) {
    return this.wrongQuestionsUseCases.wrongQuestionInsights(user);
  }

  @Get('wrong-questions/:questionId/events')
  @ApiRecordArrayResponse()
  wrongQuestionEvents(@Param('questionId') questionId: string, @CurrentUser() user: RequestUser) {
    return this.wrongQuestionsUseCases.wrongQuestionEvents(user, questionId);
  }

  @Post('wrong-questions')
  @ApiCreatedRecordResponse()
  addWrongQuestion(@Body() dto: AddWrongQuestionDto, @CurrentUser() user: RequestUser) {
    return this.wrongQuestionsUseCases.addWrongQuestion(user, dto);
  }

  @Post('wrong-questions/batch')
  @ApiCreatedRecordResponse()
  addWrongQuestions(@Body() dto: BatchWrongQuestionDto, @CurrentUser() user: RequestUser) {
    return this.wrongQuestionsUseCases.addWrongQuestions(user, dto);
  }

  @Patch('wrong-questions/:questionId/status')
  @ApiRecordResponse()
  updateWrongQuestionStatus(
    @Param('questionId') questionId: string,
    @Body() dto: UpdateWrongQuestionStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.wrongQuestionsUseCases.updateWrongQuestionStatus(user, questionId, dto);
  }

  @Post('wrong-questions/:questionId/practice-result')
  @ApiCreatedRecordResponse()
  recordWrongQuestionPractice(
    @Param('questionId') questionId: string,
    @Body() dto: RecordWrongQuestionPracticeDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.wrongQuestionsUseCases.recordWrongQuestionPractice(user, questionId, dto);
  }

  @Post('wrong-questions/paper')
  @ApiCreatedRecordResponse()
  generateWrongQuestionPaper(@Body() dto: GenerateWrongQuestionPaperDto, @CurrentUser() user: RequestUser) {
    return this.wrongQuestionsUseCases.generateWrongQuestionPaper(user, dto);
  }

  @Get('papers')
  @ApiRecordPageResponse()
  papers(@CurrentUser() user: RequestUser, @Query() query: QueryStudentPaperDto) {
    return this.paperUseCases.studentPapers(user, query);
  }

  @Get('papers/:paperId/preview')
  @ApiRecordResponse()
  previewStudentPaper(@Param('paperId') paperId: string, @CurrentUser() user: RequestUser) {
    return this.paperUseCases.previewStudentPaper(user, paperId);
  }

  @Post('simulate/exams/:examId/enter')
  @ApiCreatedRecordResponse()
  @Permissions('exam:read')
  simulateEnterExam(
    @Param('examId') examId: string,
    @Body() dto: SimulateStudentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.exams.enterExamAsStudent(examId, dto.studentId, user);
  }

  @Get('simulate/attempts/:attemptId')
  @ApiRecordResponse()
  @Permissions('exam:read')
  simulateGetAttempt(
    @Param('attemptId') attemptId: string,
    @Query() dto: SimulateStudentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attempts.getAttemptAsStudent(attemptId, dto.studentId, user);
  }

  @Post('simulate/attempts/:attemptId/save-answers')
  @ApiCreatedRecordResponse()
  @Permissions('exam:read')
  simulateSaveAnswers(
    @Param('attemptId') attemptId: string,
    @Body() dto: SimulateSaveAnswersDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attempts.saveAnswersAsStudent(attemptId, dto.studentId, dto, user);
  }

  @Post('simulate/attempts/:attemptId/submit')
  @ApiCreatedRecordResponse()
  @Permissions('exam:read')
  simulateSubmit(
    @Param('attemptId') attemptId: string,
    @Body() dto: SimulateStudentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attempts.submitAsStudent(attemptId, dto.studentId, user);
  }

  @Get('simulate/attempts/:attemptId/result')
  @ApiRecordResponse()
  @Permissions('exam:read')
  simulateResult(@Param('attemptId') attemptId: string, @Query() dto: SimulateStudentDto) {
    return this.attempts.resultAsStudent(attemptId, dto.studentId);
  }
}
