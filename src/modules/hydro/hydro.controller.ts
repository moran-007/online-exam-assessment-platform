import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  BindHydroAccountDto,
  BindHydroProblemDto,
  PullHydroProblemDto,
  QueryHydroSummaryDto,
  SaveHydroPlatformDto,
  SaveHydroTaskDto,
  SyncHydroTasksDto,
  SubmitHydroCodeDto,
  UpdateHydroTaskDto,
  WriteBackHydroResultDto,
} from './dto/hydro.dto';
import { HydroService } from './hydro.service';

@ApiTags('Hydro')
@ApiBearerAuth()
@Controller('hydro')
export class HydroController {
  constructor(private readonly hydroService: HydroService) {}

  @Get('settings')
  @Permissions('question:read')
  settings() {
    return this.hydroService.settings();
  }

  @Get('platforms')
  platforms(@Query('includeDisabled') includeDisabled: string | undefined, @CurrentUser() user: RequestUser) {
    return this.hydroService.platforms(user, includeDisabled === 'true');
  }

  @Post('platforms')
  @Roles('SUPER_ADMIN')
  createPlatform(@Body() dto: SaveHydroPlatformDto, @CurrentUser() user: RequestUser) {
    return this.hydroService.createPlatform(dto, user);
  }

  @Patch('platforms/:id')
  @Roles('SUPER_ADMIN')
  updatePlatform(
    @Param('id') id: string,
    @Body() dto: SaveHydroPlatformDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.hydroService.updatePlatform(id, dto, user);
  }

  @Delete('platforms/:id')
  @Roles('SUPER_ADMIN')
  deletePlatform(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.hydroService.deletePlatform(id, user);
  }

  @Get('problems')
  @Permissions('question:read')
  listProblems(@Query() query: QueryHydroSummaryDto, @CurrentUser() user: RequestUser) {
    return this.hydroService.listProblemBindings(query, user);
  }

  @Get('tasks')
  @Permissions('exam:read')
  tasks(@Query() query: QueryHydroSummaryDto, @CurrentUser() user: RequestUser) {
    return this.hydroService.tasks(query, user);
  }

  @Post('tasks')
  @Permissions('exam:create')
  createTask(@Body() dto: SaveHydroTaskDto, @CurrentUser() user: RequestUser) {
    return this.hydroService.createTask(dto, user);
  }

  @Post('tasks/sync')
  @Permissions('grading:update')
  syncTasks(@Body() dto: SyncHydroTasksDto, @CurrentUser() user: RequestUser) {
    return this.hydroService.syncTasks(dto, user);
  }

  @Patch('tasks/:taskId')
  @Permissions('exam:update')
  updateTask(
    @Param('taskId') taskId: string,
    @Body() dto: UpdateHydroTaskDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.hydroService.updateTask(taskId, dto, user);
  }

  @Get('tasks/:taskId/results')
  @Permissions('exam:read')
  taskResults(@Param('taskId') taskId: string, @Query() query: QueryHydroSummaryDto, @CurrentUser() user: RequestUser) {
    return this.hydroService.taskResults(taskId, query, user);
  }

  @Post('tasks/:taskId/sync-results')
  @Permissions('grading:update')
  syncTaskResults(@Param('taskId') taskId: string, @CurrentUser() user: RequestUser) {
    return this.hydroService.syncTaskResults(taskId, user);
  }

  @Post('tasks/:taskId/retry-failed')
  @Permissions('grading:update')
  retryFailedTaskResults(@Param('taskId') taskId: string, @CurrentUser() user: RequestUser) {
    return this.hydroService.retryFailedTaskResults(taskId, user);
  }

  @Get('problems/pull')
  @Permissions('question:create')
  pullProblem(@Query() query: PullHydroProblemDto) {
    return this.hydroService.pullProblem(query);
  }

  @Get('questions/:questionId/binding')
  @Permissions('question:read')
  problemBinding(@Param('questionId') questionId: string) {
    return this.hydroService.problemBinding(questionId);
  }

  @Put('questions/:questionId/binding')
  @Permissions('question:update')
  bindProblem(
    @Param('questionId') questionId: string,
    @Body() dto: BindHydroProblemDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.hydroService.bindProblem(questionId, dto, user);
  }

  @Delete('questions/:questionId/binding')
  @Permissions('question:update')
  removeProblemBinding(@Param('questionId') questionId: string, @CurrentUser() user: RequestUser) {
    return this.hydroService.removeProblemBinding(questionId, user);
  }

  @Get('accounts')
  @Permissions('class:read')
  accounts(@Query() query: QueryHydroSummaryDto, @CurrentUser() user: RequestUser) {
    return this.hydroService.accounts(query, user);
  }

  @Put('accounts/:studentId')
  @Permissions('class:update')
  bindStudentAccount(
    @Param('studentId') studentId: string,
    @Body() dto: BindHydroAccountDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.hydroService.bindAccount({ ...dto, studentId }, user);
  }

  @Post('accounts/:accountId/test')
  @Permissions('class:update')
  testAccount(@Param('accountId') accountId: string, @CurrentUser() user: RequestUser) {
    return this.hydroService.testAccount(accountId, user);
  }

  @Delete('accounts/:accountId')
  @Permissions('class:update')
  deleteAccount(@Param('accountId') accountId: string, @CurrentUser() user: RequestUser) {
    return this.hydroService.deleteAccount(accountId, user);
  }

  @Get('my/accounts')
  myAccounts(@CurrentUser() user: RequestUser) {
    return this.hydroService.myAccounts(user);
  }

  @Get('my/account')
  myAccount(@CurrentUser() user: RequestUser) {
    return this.hydroService.myAccount(user);
  }

  @Put('my/account')
  bindMyAccount(@Body() dto: BindHydroAccountDto, @CurrentUser() user: RequestUser) {
    return this.hydroService.bindMyAccount(dto, user);
  }

  @Post('my/accounts/:accountId/test')
  testMyAccount(@Param('accountId') accountId: string, @CurrentUser() user: RequestUser) {
    return this.hydroService.testMyAccount(accountId, user);
  }

  @Delete('my/accounts/:accountId')
  deleteMyAccount(@Param('accountId') accountId: string, @CurrentUser() user: RequestUser) {
    return this.hydroService.deleteMyAccount(accountId, user);
  }

  @Post('attempts/:attemptId/questions/:questionId/submit-code')
  submitCode(
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
    @Body() dto: SubmitHydroCodeDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.hydroService.submitCode(attemptId, questionId, dto, user);
  }

  @Post('questions/:questionId/submit-code')
  submitPracticeCode(
    @Param('questionId') questionId: string,
    @Body() dto: SubmitHydroCodeDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.hydroService.submitPracticeCode(questionId, dto, user);
  }

  @Get('submissions/:submissionId')
  submission(@Param('submissionId') submissionId: string, @CurrentUser() user: RequestUser) {
    return this.hydroService.submissionDetail(submissionId, user);
  }

  @Patch('submissions/:submissionId/result')
  @Permissions('grading:update')
  writeBackSubmission(
    @Param('submissionId') submissionId: string,
    @Body() dto: WriteBackHydroResultDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.hydroService.writeBackResult({ ...dto, submissionId }, user);
  }

  @Post('writeback')
  @Permissions('grading:update')
  writeBack(@Body() dto: WriteBackHydroResultDto, @CurrentUser() user: RequestUser) {
    return this.hydroService.writeBackResult(dto, user);
  }

  @Public()
  @Post('callback')
  callback(@Body() dto: WriteBackHydroResultDto, @Headers('x-hydro-secret') headerSecret?: string) {
    return this.hydroService.writeBackCallback(dto, headerSecret);
  }

  @Get('summary')
  @Permissions('statistics:read')
  summary(@Query() query: QueryHydroSummaryDto, @CurrentUser() user: RequestUser) {
    return this.hydroService.summary(query, user);
  }
}
