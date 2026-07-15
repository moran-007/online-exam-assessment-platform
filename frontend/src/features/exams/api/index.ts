import { classesList } from '../../../api/generated/classes/classes';
import { coursesList } from '../../../api/generated/course/course';
import {
  examsAnnouncementReads,
  examsBulkUpdateStatus,
  examsCreate,
  examsEnd,
  examsList,
  examsPublish,
  examsRemindAnnouncementUnread,
  examsRemove,
  examsResults,
  examsUnpublish,
  examsUpdate,
} from '../../../api/generated/exam/exam';
import { papersGenerateFromWrongFrequency, papersList } from '../../../api/generated/paper/paper';
import {
  reviewRulesCreate,
  reviewRulesList,
  reviewRulesRemove,
  reviewRulesUpdate,
} from '../../../api/generated/review-rule/review-rule';
import {
  statisticsClassComparison,
  statisticsClasses,
  statisticsExamDetail,
  statisticsExams,
  statisticsKnowledge,
  statisticsKnowledgeTrend,
  statisticsOverview,
  statisticsQuestionDiagnostics,
  statisticsScoreDistribution,
  statisticsWrongQuestions,
} from '../../../api/generated/statistics/statistics';
import {
  studentEnterExam,
  studentAddWrongQuestion,
  studentExamRanking,
  studentGenerateWrongQuestionPaper,
  studentGetAttempt,
  studentMyExams,
  studentReadExamAnnouncement,
  studentRecordWrongQuestionPractice,
  studentResult,
  studentSaveAnswers,
  studentPapers,
  studentSimulateEnterExam,
  studentSimulateGetAttempt,
  studentSimulateResult,
  studentSimulateSaveAnswers,
  studentSimulateSubmit,
  studentSubmit,
  studentUpdateWrongQuestionStatus,
  studentWrongQuestionEvents,
  studentWrongQuestionInsights,
  studentWrongQuestions,
} from '../../../api/generated/student/student';
import { usersStudents } from '../../../api/generated/user/user';
import { asGenerated, generatedData } from '../../../api/generated-data';
import type { ExamPage, ExamRecord } from '../models';

export const enterStudentExam = (examId: string, simulateStudentId?: string) => simulateStudentId
  ? generatedData(asGenerated<ExamRecord>(studentSimulateEnterExam(examId, { studentId: simulateStudentId })))
  : generatedData(asGenerated<ExamRecord>(studentEnterExam(examId)));
export const getStudentAttempt = (attemptId: string, simulateStudentId?: string) => simulateStudentId
  ? generatedData(asGenerated<ExamRecord>(studentSimulateGetAttempt(attemptId, { studentId: simulateStudentId })))
  : generatedData(asGenerated<ExamRecord>(studentGetAttempt(attemptId)));
export const getStudentAttemptResult = (attemptId: string, simulateStudentId?: string) => simulateStudentId
  ? generatedData(asGenerated<ExamRecord>(studentSimulateResult(attemptId, { studentId: simulateStudentId })))
  : generatedData(asGenerated<ExamRecord>(studentResult(attemptId)));
export const saveStudentAnswers = (
  attemptId: string,
  body: Parameters<typeof studentSaveAnswers>[1],
  simulateStudentId?: string,
  keepalive = false,
) => simulateStudentId
  ? generatedData(asGenerated<ExamRecord>(studentSimulateSaveAnswers(
      attemptId,
      { ...body, studentId: simulateStudentId },
      { keepalive },
    )))
  : generatedData(asGenerated<ExamRecord>(studentSaveAnswers(attemptId, body, { keepalive })));
export const submitStudentAttempt = (attemptId: string, simulateStudentId?: string) => simulateStudentId
  ? generatedData(asGenerated<ExamRecord>(studentSimulateSubmit(attemptId, { studentId: simulateStudentId })))
  : generatedData(asGenerated<ExamRecord>(studentSubmit(attemptId)));
export const listStudentExams = (params?: Parameters<typeof studentMyExams>[0]) =>
  generatedData(asGenerated<ExamRecord[]>(studentMyExams(params)));
export const getStudentExamRanking = (examId: string) =>
  generatedData(asGenerated<ExamRecord>(studentExamRanking(examId)));
export const markExamAnnouncementRead = (examId: string) =>
  generatedData(asGenerated<ExamRecord>(studentReadExamAnnouncement(examId)));
export const listStudentPapers = (params: Parameters<typeof studentPapers>[0]) =>
  generatedData(asGenerated<ExamPage>(studentPapers(params)));
export const listWrongQuestions = (params?: Parameters<typeof studentWrongQuestions>[0]) =>
  generatedData(asGenerated<ExamRecord[]>(studentWrongQuestions(params)));
export const getWrongQuestionInsights = () =>
  generatedData(asGenerated<ExamRecord>(studentWrongQuestionInsights()));
export const addStudentWrongQuestion = (body: Parameters<typeof studentAddWrongQuestion>[0]) =>
  generatedData(asGenerated<ExamRecord>(studentAddWrongQuestion(body)));
export const generateStudentWrongQuestionPaper = (body: Parameters<typeof studentGenerateWrongQuestionPaper>[0]) =>
  generatedData(asGenerated<ExamRecord>(studentGenerateWrongQuestionPaper(body)));
export const recordWrongQuestionPractice = (
  questionId: string,
  body: Parameters<typeof studentRecordWrongQuestionPractice>[1],
) => generatedData(asGenerated<ExamRecord>(studentRecordWrongQuestionPractice(questionId, body)));
export const getWrongQuestionEvents = (questionId: string) =>
  generatedData(asGenerated<ExamRecord[]>(studentWrongQuestionEvents(questionId)));
export const setWrongQuestionStatus = (
  questionId: string,
  body: Parameters<typeof studentUpdateWrongQuestionStatus>[1],
) => generatedData(asGenerated<ExamRecord>(studentUpdateWrongQuestionStatus(questionId, body)));

export const listManagedExams = (params: Parameters<typeof examsList>[0]) =>
  generatedData(asGenerated<ExamPage>(examsList(params)));
export const createManagedExam = (body: Parameters<typeof examsCreate>[0]) =>
  generatedData(asGenerated<ExamRecord>(examsCreate(body)));
export const updateManagedExam = (id: string, body: Parameters<typeof examsUpdate>[1]) =>
  generatedData(asGenerated<ExamRecord>(examsUpdate(id, body)));
export const publishManagedExam = (id: string) => generatedData(asGenerated<ExamRecord>(examsPublish(id)));
export const unpublishManagedExam = (id: string) => generatedData(asGenerated<ExamRecord>(examsUnpublish(id)));
export const endManagedExam = (id: string) => generatedData(asGenerated<ExamRecord>(examsEnd(id)));
export const removeManagedExam = (id: string) => generatedData(asGenerated<ExamRecord>(examsRemove(id)));
export const bulkUpdateManagedExams = (body: Parameters<typeof examsBulkUpdateStatus>[0]) =>
  generatedData(asGenerated<ExamRecord>(examsBulkUpdateStatus(body)));
export const getManagedExamResults = (id: string, params?: Parameters<typeof examsResults>[1]) =>
  generatedData(asGenerated<ExamPage>(examsResults(id, params)));
export const getAnnouncementReads = (id: string) =>
  generatedData(asGenerated<ExamRecord>(examsAnnouncementReads(id)));
export const remindAnnouncementUnread = (id: string, body: Parameters<typeof examsRemindAnnouncementUnread>[1] = {}) =>
  generatedData(asGenerated<ExamRecord>(examsRemindAnnouncementUnread(id, body)));

export const listExamCourses = () => generatedData(asGenerated<ExamPage>(coursesList({ pageSize: 100 })));
export const listExamClasses = () => generatedData(asGenerated<ExamPage>(classesList({ pageSize: 100 })));
export const listExamPapers = () => generatedData(asGenerated<ExamPage>(papersList({ pageSize: 100, status: 'published' })));
export const listExamStudents = () => generatedData(asGenerated<ExamRecord[]>(usersStudents()));

export const loadStatisticsOverview = (params: Parameters<typeof statisticsOverview>[0]) => generatedData(asGenerated<ExamRecord>(statisticsOverview(params)));
export const loadStatisticsExams = (params: Parameters<typeof statisticsExams>[0]) => generatedData(asGenerated<ExamRecord>(statisticsExams(params)));
export const loadStatisticsKnowledge = (params: Parameters<typeof statisticsKnowledge>[0]) => generatedData(asGenerated<ExamRecord>(statisticsKnowledge(params)));
export const loadStatisticsClasses = (params: Parameters<typeof statisticsClasses>[0]) => generatedData(asGenerated<ExamRecord>(statisticsClasses(params)));
export const loadStatisticsWrongQuestions = (params: Parameters<typeof statisticsWrongQuestions>[0]) => generatedData(asGenerated<ExamRecord>(statisticsWrongQuestions(params)));
export const loadStatisticsScoreDistribution = (params: Parameters<typeof statisticsScoreDistribution>[0]) => generatedData(asGenerated<ExamRecord>(statisticsScoreDistribution(params)));
export const loadStatisticsClassComparison = (params: Parameters<typeof statisticsClassComparison>[0]) => generatedData(asGenerated<ExamRecord>(statisticsClassComparison(params)));
export const loadStatisticsKnowledgeTrend = (params: Parameters<typeof statisticsKnowledgeTrend>[0]) => generatedData(asGenerated<ExamRecord>(statisticsKnowledgeTrend(params)));
export const loadStatisticsQuestionDiagnostics = (params: Parameters<typeof statisticsQuestionDiagnostics>[0]) => generatedData(asGenerated<ExamRecord>(statisticsQuestionDiagnostics(params)));
export const loadStatisticsExamDetail = (examId: string) => generatedData(asGenerated<ExamRecord>(statisticsExamDetail(examId)));
export const generateWrongFrequencyPaper = (body: Parameters<typeof papersGenerateFromWrongFrequency>[0]) =>
  generatedData(asGenerated<ExamRecord>(papersGenerateFromWrongFrequency(body)));
export const listReviewRules = () => generatedData(asGenerated<ExamRecord[]>(reviewRulesList()));
export const createReviewRule = (body: Parameters<typeof reviewRulesCreate>[0]) =>
  generatedData(asGenerated<ExamRecord>(reviewRulesCreate(body)));
export const updateReviewRule = (id: string, body: Parameters<typeof reviewRulesUpdate>[1]) =>
  generatedData(asGenerated<ExamRecord>(reviewRulesUpdate(id, body)));
export const removeReviewRule = (id: string) => generatedData(asGenerated<ExamRecord>(reviewRulesRemove(id)));
