import {
  papersAddQuestion,
  papersAddQuestionsByTags,
  papersCopyAsDraft,
  papersCreate,
  papersDetail,
  papersGenerateFromWrongFrequency,
  papersImportPaper,
  papersList,
  papersMoveQuestion,
  papersPreview,
  papersPublish,
  papersRemoveQuestion,
  papersUpdate,
  papersUpdateQuestion,
  papersUpdateQuestionSnapshot,
} from '../../../api/generated/paper/paper';
import { studentAddWrongQuestions, studentPreviewStudentPaper } from '../../../api/generated/student/student';
import { asGenerated, generatedData } from '../../../api/generated-data';

export type PaperRecord = Record<string, any>;
export type PaperPage = { items: PaperRecord[]; total: number; page: number; pageSize: number };
const data = <T>(request: Promise<unknown>) => generatedData(asGenerated<T>(request));

export const listPapers = (params?: Parameters<typeof papersList>[0]) => data<PaperPage>(papersList(params));
export const createPaper = (body: Parameters<typeof papersCreate>[0]) => data<PaperRecord>(papersCreate(body));
export const importPaper = (body: Parameters<typeof papersImportPaper>[0]) => data<PaperRecord>(papersImportPaper(body));
export const getPaper = (id: string) => data<PaperRecord>(papersDetail(id));
export const updatePaper = (id: string, body: Parameters<typeof papersUpdate>[1]) => data<PaperRecord>(papersUpdate(id, body));
export const copyPaper = (id: string) => data<PaperRecord>(papersCopyAsDraft(id));
export const publishPaper = (id: string) => data<PaperRecord>(papersPublish(id));
export const previewPaper = (id: string, student = false) => student
  ? data<PaperRecord>(studentPreviewStudentPaper(id))
  : data<PaperRecord>(papersPreview(id));
export const addPaperQuestion = (id: string, body: Parameters<typeof papersAddQuestion>[1]) => data<PaperRecord>(papersAddQuestion(id, body));
export const addPaperQuestionsByTags = (id: string, body: Parameters<typeof papersAddQuestionsByTags>[1]) => data<PaperRecord>(papersAddQuestionsByTags(id, body));
export const updatePaperQuestion = (id: string, paperQuestionId: string, body: Parameters<typeof papersUpdateQuestion>[2]) => data<PaperRecord>(papersUpdateQuestion(id, paperQuestionId, body));
export const updatePaperQuestionSnapshot = (id: string, paperQuestionId: string, body: Parameters<typeof papersUpdateQuestionSnapshot>[2]) => data<PaperRecord>(papersUpdateQuestionSnapshot(id, paperQuestionId, body));
export const movePaperQuestion = (id: string, paperQuestionId: string, body: Parameters<typeof papersMoveQuestion>[2]) => data<PaperRecord>(papersMoveQuestion(id, paperQuestionId, body));
export const removePaperQuestion = (id: string, paperQuestionId: string) => data<PaperRecord>(papersRemoveQuestion(id, paperQuestionId));
export const generatePaperFromWrongFrequency = (body: Parameters<typeof papersGenerateFromWrongFrequency>[0]) => data<PaperRecord>(papersGenerateFromWrongFrequency(body));
export const addWrongQuestionsBatch = (body: Parameters<typeof studentAddWrongQuestions>[0]) => data<PaperRecord>(studentAddWrongQuestions(body));
