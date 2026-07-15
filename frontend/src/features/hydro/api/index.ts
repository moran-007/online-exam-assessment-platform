import {
  hydroAccounts,
  hydroBindMyAccount,
  hydroBindStudentAccount,
  hydroCreatePlatform,
  hydroDeleteAccount,
  hydroDeleteMyAccount,
  hydroDeletePlatform,
  hydroMyAccounts,
  hydroPlatforms,
  hydroPullProblem,
  hydroSubmission,
  hydroSubmitCode,
  hydroSubmitPracticeCode,
  hydroSummary,
  hydroTestAccount,
  hydroTestMyAccount,
  hydroUpdatePlatform,
  hydroWriteBack,
  hydroWriteBackSubmission,
} from '../../../api/generated/hydro/hydro';
import { usersStudents, usersTeachers } from '../../../api/generated/user/user';
import { asGenerated, generatedData } from '../../../api/generated-data';
import type {
  HydroAccountView,
  HydroLoginResult,
  HydroPlatform,
  HydroRecord,
  HydroStatisticsSummary,
  HydroSubmissionResult,
  HydroPulledProblem,
  HydroUserOption,
  PageResult,
} from '../models';

export const listStudents = () => generatedData(asGenerated<HydroUserOption[]>(usersStudents()));
export const listTeachers = () => generatedData(asGenerated<HydroUserOption[]>(usersTeachers()));
export const listHydroPlatforms = (includeDisabled = false) =>
  generatedData(asGenerated<HydroPlatform[]>(hydroPlatforms(includeDisabled ? { includeDisabled: true } : undefined)));
export const listHydroAccounts = (params: Parameters<typeof hydroAccounts>[0]) =>
  generatedData(asGenerated<PageResult<HydroAccountView>>(hydroAccounts(params)));
export const listMyHydroAccounts = () => generatedData(asGenerated<HydroAccountView[]>(hydroMyAccounts()));
export const bindHydroAccount = (
  studentId: string,
  body: Parameters<typeof hydroBindStudentAccount>[1],
) => generatedData(asGenerated<HydroAccountView>(hydroBindStudentAccount(studentId, body)));
export const bindMyHydroAccount = (body: Parameters<typeof hydroBindMyAccount>[0]) =>
  generatedData(asGenerated<HydroAccountView>(hydroBindMyAccount(body)));
export const createHydroPlatform = (body: Parameters<typeof hydroCreatePlatform>[0]) =>
  generatedData(asGenerated<HydroPlatform>(hydroCreatePlatform(body)));
export const updateHydroPlatform = (id: string, body: Parameters<typeof hydroUpdatePlatform>[1]) =>
  generatedData(asGenerated<HydroPlatform>(hydroUpdatePlatform(id, body)));
export const removeHydroPlatform = (id: string) => generatedData(asGenerated(hydroDeletePlatform(id)));
export const testManagedHydroAccount = (id: string) =>
  generatedData(asGenerated<HydroLoginResult>(hydroTestAccount(id)));
export const testOwnHydroAccount = (id: string) =>
  generatedData(asGenerated<HydroLoginResult>(hydroTestMyAccount(id)));
export const removeManagedHydroAccount = (id: string) => generatedData(asGenerated(hydroDeleteAccount(id)));
export const removeOwnHydroAccount = (id: string) => generatedData(asGenerated(hydroDeleteMyAccount(id)));
export const pullHydroProblem = (params: Parameters<typeof hydroPullProblem>[0]) =>
  generatedData(asGenerated<HydroPulledProblem>(hydroPullProblem(params)));
export const submitHydroAttemptCode = (
  attemptId: string,
  questionId: string,
  body: Parameters<typeof hydroSubmitCode>[2],
) => generatedData(asGenerated<HydroSubmissionResult>(hydroSubmitCode(attemptId, questionId, body)));
export const submitHydroPracticeCode = (
  questionId: string,
  body: Parameters<typeof hydroSubmitPracticeCode>[1],
) => generatedData(asGenerated<HydroSubmissionResult>(hydroSubmitPracticeCode(questionId, body)));
export const getHydroSubmission = (id: string) =>
  generatedData(asGenerated<HydroSubmissionResult>(hydroSubmission(id)));
export const getHydroSummary = (params: Parameters<typeof hydroSummary>[0]) =>
  generatedData(asGenerated<HydroStatisticsSummary>(hydroSummary(params)));
export const writeBackHydroResult = (
  body: Parameters<typeof hydroWriteBack>[0],
  submissionId?: string,
) => submissionId
  ? generatedData(asGenerated<HydroRecord>(hydroWriteBackSubmission(submissionId, body)))
  : generatedData(asGenerated<HydroRecord>(hydroWriteBack(body)));
