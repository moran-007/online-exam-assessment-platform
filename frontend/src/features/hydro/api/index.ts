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
import type { HydroPage, HydroRecord } from '../models';

export const listStudents = () => generatedData(asGenerated<HydroRecord[]>(usersStudents()));
export const listTeachers = () => generatedData(asGenerated<HydroRecord[]>(usersTeachers()));
export const listHydroPlatforms = (includeDisabled = false) =>
  generatedData(asGenerated<HydroRecord[]>(hydroPlatforms(includeDisabled ? { includeDisabled: true } : undefined)));
export const listHydroAccounts = (params: Parameters<typeof hydroAccounts>[0]) =>
  generatedData(asGenerated<HydroPage>(hydroAccounts(params)));
export const listMyHydroAccounts = () => generatedData(asGenerated<HydroRecord[]>(hydroMyAccounts()));
export const bindHydroAccount = (
  studentId: string,
  body: Parameters<typeof hydroBindStudentAccount>[1],
) => generatedData(asGenerated<HydroRecord>(hydroBindStudentAccount(studentId, body)));
export const bindMyHydroAccount = (body: Parameters<typeof hydroBindMyAccount>[0]) =>
  generatedData(asGenerated<HydroRecord>(hydroBindMyAccount(body)));
export const createHydroPlatform = (body: Parameters<typeof hydroCreatePlatform>[0]) =>
  generatedData(asGenerated<HydroRecord>(hydroCreatePlatform(body)));
export const updateHydroPlatform = (id: string, body: Parameters<typeof hydroUpdatePlatform>[1]) =>
  generatedData(asGenerated<HydroRecord>(hydroUpdatePlatform(id, body)));
export const removeHydroPlatform = (id: string) => generatedData(asGenerated(hydroDeletePlatform(id)));
export const testManagedHydroAccount = (id: string) =>
  generatedData(asGenerated<HydroRecord>(hydroTestAccount(id)));
export const testOwnHydroAccount = (id: string) =>
  generatedData(asGenerated<HydroRecord>(hydroTestMyAccount(id)));
export const removeManagedHydroAccount = (id: string) => generatedData(asGenerated(hydroDeleteAccount(id)));
export const removeOwnHydroAccount = (id: string) => generatedData(asGenerated(hydroDeleteMyAccount(id)));
export const pullHydroProblem = (params: Parameters<typeof hydroPullProblem>[0]) =>
  generatedData(asGenerated<HydroRecord>(hydroPullProblem(params)));
export const submitHydroAttemptCode = (
  attemptId: string,
  questionId: string,
  body: Parameters<typeof hydroSubmitCode>[2],
) => generatedData(asGenerated<HydroRecord>(hydroSubmitCode(attemptId, questionId, body)));
export const submitHydroPracticeCode = (
  questionId: string,
  body: Parameters<typeof hydroSubmitPracticeCode>[1],
) => generatedData(asGenerated<HydroRecord>(hydroSubmitPracticeCode(questionId, body)));
export const getHydroSubmission = (id: string) =>
  generatedData(asGenerated<HydroRecord>(hydroSubmission(id)));
export const getHydroSummary = (params: Parameters<typeof hydroSummary>[0]) =>
  generatedData(asGenerated<HydroRecord>(hydroSummary(params)));
export const writeBackHydroResult = (
  body: Parameters<typeof hydroWriteBack>[0],
  submissionId?: string,
) => submissionId
  ? generatedData(asGenerated<HydroRecord>(hydroWriteBackSubmission(submissionId, body)))
  : generatedData(asGenerated<HydroRecord>(hydroWriteBack(body)));
