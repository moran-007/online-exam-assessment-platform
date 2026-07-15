import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
import {
  accounts,
  bindAccount,
  bindMyAccount,
  deleteAccount,
  deleteMyAccount,
  myAccount,
  myAccounts,
  testAccount,
  testMyAccount,
} from './hydro-account.operations';
import {
  createPlatform,
  deletePlatform,
  platforms,
  settings,
  updatePlatform,
} from './hydro-platform.operations';
import {
  bindProblem,
  listProblemBindings,
  problemBinding,
  pullProblem,
  removeProblemBinding,
} from './hydro-problem.operations';
import { onModuleDestroy, onModuleInit } from './hydro-polling.operations';
import { submissionDetail, submitCode, submitPracticeCode, writeBackCallback, writeBackResult } from './hydro-submission.operations';
import { summary } from './hydro-summary.operations';
import { taskResults, tasks } from './hydro-task-query.operations';
import { createTask, retryFailedTaskResults, syncTaskResults, syncTasks, updateTask } from './hydro-task-write.operations';
import { HydroContext } from './hydro.context';

@Injectable()
export class HydroPlatformUseCases {
  constructor(private readonly ctx: HydroContext) {}

  settings() { return settings(this.ctx); }
  platforms(user: RequestUser, includeDisabled: boolean) { return platforms(this.ctx, user, includeDisabled); }
  createPlatform(dto: SaveHydroPlatformDto, user: RequestUser) { return createPlatform(this.ctx, dto, user); }
  updatePlatform(id: string, dto: SaveHydroPlatformDto, user: RequestUser) { return updatePlatform(this.ctx, id, dto, user); }
  deletePlatform(id: string, user: RequestUser) { return deletePlatform(this.ctx, id, user); }
}

@Injectable()
export class HydroProblemUseCases {
  constructor(private readonly ctx: HydroContext) {}

  pullProblem(query: PullHydroProblemDto) { return pullProblem(this.ctx, query); }
  listProblemBindings(query: QueryHydroSummaryDto, user: RequestUser) { return listProblemBindings(this.ctx, query, user); }
  problemBinding(questionId: string) { return problemBinding(this.ctx, questionId); }
  bindProblem(questionId: string, dto: BindHydroProblemDto, user: RequestUser) {
    return bindProblem(this.ctx, questionId, dto, user);
  }
  removeProblemBinding(questionId: string, user: RequestUser) { return removeProblemBinding(this.ctx, questionId, user); }
}

@Injectable()
export class HydroTaskUseCases {
  constructor(private readonly ctx: HydroContext) {}

  tasks(query: QueryHydroSummaryDto, user: RequestUser) { return tasks(this.ctx, query, user); }
  createTask(dto: SaveHydroTaskDto, user: RequestUser) { return createTask(this.ctx, dto, user); }
  updateTask(taskId: string, dto: UpdateHydroTaskDto, user: RequestUser) { return updateTask(this.ctx, taskId, dto, user); }
  syncTasks(dto: SyncHydroTasksDto, user: RequestUser) { return syncTasks(this.ctx, dto, user); }
  taskResults(taskId: string, query: QueryHydroSummaryDto, user: RequestUser) {
    return taskResults(this.ctx, taskId, query, user);
  }
  syncTaskResults(taskId: string, user: RequestUser) { return syncTaskResults(this.ctx, taskId, user); }
  retryFailedTaskResults(taskId: string, user: RequestUser) { return retryFailedTaskResults(this.ctx, taskId, user); }
}

@Injectable()
export class HydroAccountUseCases {
  constructor(private readonly ctx: HydroContext) {}

  accounts(query: QueryHydroSummaryDto, user: RequestUser) { return accounts(this.ctx, query, user); }
  myAccounts(user: RequestUser) { return myAccounts(this.ctx, user); }
  myAccount(user: RequestUser) { return myAccount(this.ctx, user); }
  bindMyAccount(dto: BindHydroAccountDto, user: RequestUser) { return bindMyAccount(this.ctx, dto, user); }
  bindAccount(dto: BindHydroAccountDto, user: RequestUser) { return bindAccount(this.ctx, dto, user); }
  testMyAccount(accountId: string, user: RequestUser) { return testMyAccount(this.ctx, accountId, user); }
  testAccount(accountId: string, user: RequestUser) { return testAccount(this.ctx, accountId, user); }
  deleteAccount(accountId: string, user: RequestUser) { return deleteAccount(this.ctx, accountId, user); }
  deleteMyAccount(accountId: string, user: RequestUser) { return deleteMyAccount(this.ctx, accountId, user); }
}

@Injectable()
export class HydroSubmissionUseCases {
  constructor(private readonly ctx: HydroContext) {}

  submitCode(attemptId: string, questionId: string, dto: SubmitHydroCodeDto, user: RequestUser) {
    return submitCode(this.ctx, attemptId, questionId, dto, user);
  }
  submitPracticeCode(questionId: string, dto: SubmitHydroCodeDto, user: RequestUser) {
    return submitPracticeCode(this.ctx, questionId, dto, user);
  }
  submissionDetail(submissionId: string, user: RequestUser) { return submissionDetail(this.ctx, submissionId, user); }
  writeBackResult(dto: WriteBackHydroResultDto, user: RequestUser) { return writeBackResult(this.ctx, dto, user); }
  writeBackCallback(dto: WriteBackHydroResultDto, secret?: string) { return writeBackCallback(this.ctx, dto, secret); }
}

@Injectable()
export class HydroSummaryUseCases {
  constructor(private readonly ctx: HydroContext) {}
  summary(query: QueryHydroSummaryDto, user: RequestUser) { return summary(this.ctx, query, user); }
}

@Injectable()
export class HydroPollingWorker implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly ctx: HydroContext) {}
  onModuleInit() { return onModuleInit(this.ctx); }
  onModuleDestroy() { return onModuleDestroy(this.ctx); }
}
