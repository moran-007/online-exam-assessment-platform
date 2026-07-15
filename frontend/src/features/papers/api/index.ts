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
import type {
  PaperAddResult,
  PaperDetail,
  PaperGenerationResult,
  PaperImportResult,
  PaperListItem,
  PageResult,
} from '../models';

const data = <T>(request: Promise<unknown>) => generatedData(asGenerated<T>(request));

export const listPapers = (params?: Parameters<typeof papersList>[0]) => data<PageResult<PaperListItem>>(papersList(params));
export const createPaper = (body: Parameters<typeof papersCreate>[0]) => data<PaperDetail>(papersCreate(body));
export const importPaper = (body: Parameters<typeof papersImportPaper>[0]) => data<PaperImportResult>(papersImportPaper(body));
export const getPaper = (id: string) => data<PaperDetail>(papersDetail(id));
export const updatePaper = (id: string, body: Parameters<typeof papersUpdate>[1]) => data<PaperDetail>(papersUpdate(id, body));
export const copyPaper = (id: string) => data<PaperDetail>(papersCopyAsDraft(id));
export const publishPaper = (id: string) => data<PaperDetail>(papersPublish(id));
export const previewPaper = (id: string, student = false) => student
  ? data<PaperDetail>(studentPreviewStudentPaper(id))
  : data<PaperDetail>(papersPreview(id));
export const addPaperQuestion = (id: string, body: Parameters<typeof papersAddQuestion>[1]) => data<PaperDetail>(papersAddQuestion(id, body));
export const addPaperQuestionsByTags = (id: string, body: Parameters<typeof papersAddQuestionsByTags>[1]) => data<PaperAddResult>(papersAddQuestionsByTags(id, body));
export const updatePaperQuestion = (id: string, paperQuestionId: string, body: Parameters<typeof papersUpdateQuestion>[2]) => data<PaperDetail>(papersUpdateQuestion(id, paperQuestionId, body));
export const updatePaperQuestionSnapshot = (id: string, paperQuestionId: string, body: Parameters<typeof papersUpdateQuestionSnapshot>[2]) => data<PaperDetail>(papersUpdateQuestionSnapshot(id, paperQuestionId, body));
export const movePaperQuestion = (id: string, paperQuestionId: string, body: Parameters<typeof papersMoveQuestion>[2]) => data<PaperDetail>(papersMoveQuestion(id, paperQuestionId, body));
export const removePaperQuestion = (id: string, paperQuestionId: string) => data<PaperDetail>(papersRemoveQuestion(id, paperQuestionId));
export const generatePaperFromWrongFrequency = (body: Parameters<typeof papersGenerateFromWrongFrequency>[0]) => data<PaperGenerationResult>(papersGenerateFromWrongFrequency(body));
export const addWrongQuestionsBatch = (body: Parameters<typeof studentAddWrongQuestions>[0]) => data<PaperDetail>(studentAddWrongQuestions(body));
