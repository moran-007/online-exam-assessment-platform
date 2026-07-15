import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  ApiCreatedRecordResponse,
  ApiRecordArrayResponse,
  ApiRecordPageResponse,
  ApiRecordResponse,
} from '../../common/dto/api-response.dto';
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
import {
  HydroAccountUseCases,
  HydroPlatformUseCases,
  HydroProblemUseCases,
  HydroSubmissionUseCases,
  HydroSummaryUseCases,
  HydroTaskUseCases,
} from './hydro.use-cases';

@ApiTags('Hydro')
@ApiBearerAuth()
@Controller('hydro')
export class HydroController {
  constructor(
    private readonly platformUseCases: HydroPlatformUseCases,
    private readonly problemUseCases: HydroProblemUseCases,
    private readonly taskUseCases: HydroTaskUseCases,
    private readonly accountUseCases: HydroAccountUseCases,
    private readonly submissionUseCases: HydroSubmissionUseCases,
    private readonly summaryUseCases: HydroSummaryUseCases,
  ) {}

  @Get('settings')
  @ApiRecordResponse()
  @Permissions('question:read')
  settings() {
    return this.platformUseCases.settings();
  }

  @Get('platforms')
  @ApiRecordArrayResponse()
  platforms(@Query('includeDisabled') includeDisabled: string | undefined, @CurrentUser() user: RequestUser) {
    return this.platformUseCases.platforms(user, includeDisabled === 'true');
  }

  @Post('platforms')
  @ApiCreatedRecordResponse()
  @Permissions('hydro:platform:manage')
  createPlatform(@Body() dto: SaveHydroPlatformDto, @CurrentUser() user: RequestUser) {
    return this.platformUseCases.createPlatform(dto, user);
  }

  @Patch('platforms/:id')
  @ApiRecordResponse()
  @Permissions('hydro:platform:manage')
  updatePlatform(
    @Param('id') id: string,
    @Body() dto: SaveHydroPlatformDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.platformUseCases.updatePlatform(id, dto, user);
  }

  @Delete('platforms/:id')
  @ApiRecordResponse()
  @Permissions('hydro:platform:manage')
  deletePlatform(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.platformUseCases.deletePlatform(id, user);
  }

  @Get('problems')
  @ApiRecordPageResponse()
  @Permissions('question:read')
  listProblems(@Query() query: QueryHydroSummaryDto, @CurrentUser() user: RequestUser) {
    return this.problemUseCases.listProblemBindings(query, user);
  }

  @Get('tasks')
  @ApiRecordPageResponse()
  @Permissions('exam:read')
  tasks(@Query() query: QueryHydroSummaryDto, @CurrentUser() user: RequestUser) {
    return this.taskUseCases.tasks(query, user);
  }

  @Post('tasks')
  @ApiCreatedRecordResponse()
  @Permissions('exam:create')
  createTask(@Body() dto: SaveHydroTaskDto, @CurrentUser() user: RequestUser) {
    return this.taskUseCases.createTask(dto, user);
  }

  @Post('tasks/sync')
  @ApiCreatedRecordResponse()
  @Permissions('grading:update')
  syncTasks(@Body() dto: SyncHydroTasksDto, @CurrentUser() user: RequestUser) {
    return this.taskUseCases.syncTasks(dto, user);
  }

  @Patch('tasks/:taskId')
  @ApiRecordResponse()
  @Permissions('exam:update')
  updateTask(
    @Param('taskId') taskId: string,
    @Body() dto: UpdateHydroTaskDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.taskUseCases.updateTask(taskId, dto, user);
  }

  @Get('tasks/:taskId/results')
  @ApiRecordPageResponse()
  @Permissions('exam:read')
  taskResults(@Param('taskId') taskId: string, @Query() query: QueryHydroSummaryDto, @CurrentUser() user: RequestUser) {
    return this.taskUseCases.taskResults(taskId, query, user);
  }

  @Post('tasks/:taskId/sync-results')
  @ApiCreatedRecordResponse()
  @Permissions('grading:update')
  syncTaskResults(@Param('taskId') taskId: string, @CurrentUser() user: RequestUser) {
    return this.taskUseCases.syncTaskResults(taskId, user);
  }

  @Post('tasks/:taskId/retry-failed')
  @ApiCreatedRecordResponse()
  @Permissions('grading:update')
  retryFailedTaskResults(@Param('taskId') taskId: string, @CurrentUser() user: RequestUser) {
    return this.taskUseCases.retryFailedTaskResults(taskId, user);
  }

  @Get('problems/pull')
  @ApiRecordResponse()
  @Permissions('question:create')
  pullProblem(@Query() query: PullHydroProblemDto) {
    return this.problemUseCases.pullProblem(query);
  }

  @Get('questions/:questionId/binding')
  @ApiRecordResponse()
  @Permissions('question:read')
  problemBinding(@Param('questionId') questionId: string) {
    return this.problemUseCases.problemBinding(questionId);
  }

  @Put('questions/:questionId/binding')
  @ApiRecordResponse()
  @Permissions('hydro:problem:bind')
  bindProblem(
    @Param('questionId') questionId: string,
    @Body() dto: BindHydroProblemDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.problemUseCases.bindProblem(questionId, dto, user);
  }

  @Delete('questions/:questionId/binding')
  @ApiRecordResponse()
  @Permissions('hydro:problem:bind')
  removeProblemBinding(@Param('questionId') questionId: string, @CurrentUser() user: RequestUser) {
    return this.problemUseCases.removeProblemBinding(questionId, user);
  }

  @Get('accounts')
  @ApiRecordPageResponse()
  @Permissions('hydro:account:read')
  accounts(@Query() query: QueryHydroSummaryDto, @CurrentUser() user: RequestUser) {
    return this.accountUseCases.accounts(query, user);
  }

  @Put('accounts/:studentId')
  @ApiRecordResponse()
  @Permissions('hydro:account:update')
  bindStudentAccount(
    @Param('studentId') studentId: string,
    @Body() dto: BindHydroAccountDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.accountUseCases.bindAccount({ ...dto, studentId }, user);
  }

  @Post('accounts/:accountId/test')
  @ApiCreatedRecordResponse()
  @Permissions('hydro:account:update')
  testAccount(@Param('accountId') accountId: string, @CurrentUser() user: RequestUser) {
    return this.accountUseCases.testAccount(accountId, user);
  }

  @Delete('accounts/:accountId')
  @ApiRecordResponse()
  @Permissions('hydro:account:update')
  deleteAccount(@Param('accountId') accountId: string, @CurrentUser() user: RequestUser) {
    return this.accountUseCases.deleteAccount(accountId, user);
  }

  @Get('my/accounts')
  @ApiRecordArrayResponse()
  myAccounts(@CurrentUser() user: RequestUser) {
    return this.accountUseCases.myAccounts(user);
  }

  @Get('my/account')
  @ApiRecordResponse()
  myAccount(@CurrentUser() user: RequestUser) {
    return this.accountUseCases.myAccount(user);
  }

  @Put('my/account')
  @ApiRecordResponse()
  bindMyAccount(@Body() dto: BindHydroAccountDto, @CurrentUser() user: RequestUser) {
    return this.accountUseCases.bindMyAccount(dto, user);
  }

  @Post('my/accounts/:accountId/test')
  @ApiCreatedRecordResponse()
  testMyAccount(@Param('accountId') accountId: string, @CurrentUser() user: RequestUser) {
    return this.accountUseCases.testMyAccount(accountId, user);
  }

  @Delete('my/accounts/:accountId')
  @ApiRecordResponse()
  deleteMyAccount(@Param('accountId') accountId: string, @CurrentUser() user: RequestUser) {
    return this.accountUseCases.deleteMyAccount(accountId, user);
  }

  @Post('attempts/:attemptId/questions/:questionId/submit-code')
  @ApiCreatedRecordResponse()
  submitCode(
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
    @Body() dto: SubmitHydroCodeDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.submissionUseCases.submitCode(attemptId, questionId, dto, user);
  }

  @Post('questions/:questionId/submit-code')
  @ApiCreatedRecordResponse()
  submitPracticeCode(
    @Param('questionId') questionId: string,
    @Body() dto: SubmitHydroCodeDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.submissionUseCases.submitPracticeCode(questionId, dto, user);
  }

  @Get('submissions/:submissionId')
  @ApiRecordResponse()
  submission(@Param('submissionId') submissionId: string, @CurrentUser() user: RequestUser) {
    return this.submissionUseCases.submissionDetail(submissionId, user);
  }

  @Patch('submissions/:submissionId/result')
  @ApiRecordResponse()
  @Permissions('hydro:result:write')
  writeBackSubmission(
    @Param('submissionId') submissionId: string,
    @Body() dto: WriteBackHydroResultDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.submissionUseCases.writeBackResult({ ...dto, submissionId }, user);
  }

  @Post('writeback')
  @ApiCreatedRecordResponse()
  @Permissions('hydro:result:write')
  writeBack(@Body() dto: WriteBackHydroResultDto, @CurrentUser() user: RequestUser) {
    return this.submissionUseCases.writeBackResult(dto, user);
  }

  @Public()
  @Post('callback')
  @ApiCreatedRecordResponse()
  callback(@Body() dto: WriteBackHydroResultDto, @Headers('x-hydro-secret') headerSecret?: string) {
    return this.submissionUseCases.writeBackCallback(dto, headerSecret);
  }

  @Get('summary')
  @ApiRecordResponse()
  @Permissions('statistics:read')
  summary(@Query() query: QueryHydroSummaryDto, @CurrentUser() user: RequestUser) {
    return this.summaryUseCases.summary(query, user);
  }
}
