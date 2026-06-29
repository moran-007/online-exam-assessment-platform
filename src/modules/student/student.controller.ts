import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  AddWrongQuestionDto,
  BatchWrongQuestionDto,
  GenerateWrongQuestionPaperDto,
  QueryStudentExamDto,
  SaveAnswerDto,
  SaveAnswersDto,
  SimulateSaveAnswersDto,
  SimulateStudentDto,
  UpdateWrongQuestionStatusDto,
} from './dto/save-answer.dto';
import { StudentService } from './student.service';

@ApiTags('Student')
@ApiBearerAuth()
@Controller('student')
export class StudentController {
  constructor(private readonly studentService: StudentService) {}

  @Get('exams')
  myExams(@CurrentUser() user: RequestUser, @Query() query: QueryStudentExamDto) {
    return this.studentService.myExams(user, query);
  }

  @Get('exams/:examId/ranking')
  examRanking(@Param('examId') examId: string, @CurrentUser() user: RequestUser) {
    return this.studentService.examRanking(examId, user);
  }

  @Post('exams/:examId/announcement/read')
  readExamAnnouncement(@Param('examId') examId: string, @CurrentUser() user: RequestUser) {
    return this.studentService.readExamAnnouncement(examId, user);
  }

  @Post('exams/:examId/enter')
  enterExam(@Param('examId') examId: string, @CurrentUser() user: RequestUser) {
    return this.studentService.enterExam(examId, user);
  }

  @Get('attempts/:attemptId')
  getAttempt(@Param('attemptId') attemptId: string, @CurrentUser() user: RequestUser) {
    return this.studentService.getAttempt(attemptId, user);
  }

  @Post('attempts/:attemptId/save-answer')
  saveAnswer(
    @Param('attemptId') attemptId: string,
    @Body() dto: SaveAnswerDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.studentService.saveAnswer(attemptId, dto, user);
  }

  @Post('attempts/:attemptId/save-answers')
  saveAnswers(
    @Param('attemptId') attemptId: string,
    @Body() dto: SaveAnswersDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.studentService.saveAnswers(attemptId, dto, user);
  }

  @Post('attempts/:attemptId/submit')
  submit(@Param('attemptId') attemptId: string, @CurrentUser() user: RequestUser) {
    return this.studentService.submit(attemptId, user);
  }

  @Get('attempts/:attemptId/result')
  result(@Param('attemptId') attemptId: string, @CurrentUser() user: RequestUser) {
    return this.studentService.result(attemptId, user);
  }

  @Get('wrong-questions')
  wrongQuestions(@CurrentUser() user: RequestUser) {
    return this.studentService.wrongQuestions(user);
  }

  @Post('wrong-questions')
  addWrongQuestion(@Body() dto: AddWrongQuestionDto, @CurrentUser() user: RequestUser) {
    return this.studentService.addWrongQuestion(user, dto);
  }

  @Post('wrong-questions/batch')
  addWrongQuestions(@Body() dto: BatchWrongQuestionDto, @CurrentUser() user: RequestUser) {
    return this.studentService.addWrongQuestions(user, dto);
  }

  @Patch('wrong-questions/:questionId/status')
  updateWrongQuestionStatus(
    @Param('questionId') questionId: string,
    @Body() dto: UpdateWrongQuestionStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.studentService.updateWrongQuestionStatus(user, questionId, dto);
  }

  @Post('wrong-questions/paper')
  generateWrongQuestionPaper(@Body() dto: GenerateWrongQuestionPaperDto, @CurrentUser() user: RequestUser) {
    return this.studentService.generateWrongQuestionPaper(user, dto);
  }

  @Get('papers/:paperId/preview')
  previewStudentPaper(@Param('paperId') paperId: string, @CurrentUser() user: RequestUser) {
    return this.studentService.previewStudentPaper(user, paperId);
  }

  @Post('simulate/exams/:examId/enter')
  @Permissions('exam:read')
  simulateEnterExam(
    @Param('examId') examId: string,
    @Body() dto: SimulateStudentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.studentService.enterExamAsStudent(examId, dto.studentId, user);
  }

  @Get('simulate/attempts/:attemptId')
  @Permissions('exam:read')
  simulateGetAttempt(
    @Param('attemptId') attemptId: string,
    @Query() dto: SimulateStudentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.studentService.getAttemptAsStudent(attemptId, dto.studentId, user);
  }

  @Post('simulate/attempts/:attemptId/save-answers')
  @Permissions('exam:read')
  simulateSaveAnswers(
    @Param('attemptId') attemptId: string,
    @Body() dto: SimulateSaveAnswersDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.studentService.saveAnswersAsStudent(attemptId, dto.studentId, dto, user);
  }

  @Post('simulate/attempts/:attemptId/submit')
  @Permissions('exam:read')
  simulateSubmit(
    @Param('attemptId') attemptId: string,
    @Body() dto: SimulateStudentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.studentService.submitAsStudent(attemptId, dto.studentId, user);
  }

  @Get('simulate/attempts/:attemptId/result')
  @Permissions('exam:read')
  simulateResult(@Param('attemptId') attemptId: string, @Query() dto: SimulateStudentDto) {
    return this.studentService.resultAsStudent(attemptId, dto.studentId);
  }
}
