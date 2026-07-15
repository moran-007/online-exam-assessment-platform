import {
  gradingAttemptDetail,
  gradingBatchGradeAnswers,
  gradingCancelRegradeRun,
  gradingConfirmRegradeRun,
  gradingFinishAttempt,
  gradingGradeAnswer,
  gradingList,
  gradingPreviewRegradeRun,
} from '../../../api/generated/grading/grading';
import { asGenerated, generatedData } from '../../../api/generated-data';

export type GradingRecord = Record<string, any>;
export type GradingPage = { items: GradingRecord[]; total: number; page: number; pageSize: number };
const data = <T>(request: Promise<unknown>) => generatedData(asGenerated<T>(request));

export const listGradingAnswers = (params?: Parameters<typeof gradingList>[0]) => data<GradingPage>(gradingList(params));
export const getGradingAttempt = (attemptId: string) => data<GradingRecord>(gradingAttemptDetail(attemptId));
export const gradeAnswer = (answerRecordId: string, body: Parameters<typeof gradingGradeAnswer>[1]) => data<GradingRecord>(gradingGradeAnswer(answerRecordId, body));
export const batchGradeAnswers = (body: Parameters<typeof gradingBatchGradeAnswers>[0]) => data<GradingRecord>(gradingBatchGradeAnswers(body));
export const finishGradingAttempt = (attemptId: string) => data<GradingRecord>(gradingFinishAttempt(attemptId));
export const previewRegradeRun = (body: Parameters<typeof gradingPreviewRegradeRun>[0]) => data<GradingRecord>(gradingPreviewRegradeRun(body));
export const confirmRegradeRun = (id: string) => data<GradingRecord>(gradingConfirmRegradeRun(id));
export const cancelRegradeRun = (id: string) => data<GradingRecord>(gradingCancelRegradeRun(id));
