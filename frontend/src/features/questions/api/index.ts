import { coursesList } from '../../../api/generated/course/course';
import { knowledgePointsTree } from '../../../api/generated/knowledge-point/knowledge-point';
import {
  questionsBulkDelete,
  questionsBulkUpdateStatus,
  questionsCheckAnswer,
  questionsCheckDuplicates,
  questionsCreate,
  questionsDeleteImpact,
  questionsDetail,
  questionsList,
  questionsPublish,
  questionsPublicDetail,
  questionsPublicList,
  questionsRemove,
  questionsUpdate,
} from '../../../api/generated/question/question';
import { tagsCreate, tagsList } from '../../../api/generated/tag/tag';
import {
  uploadsCleanupOrphanQuestionAssets,
  uploadsContent,
  uploadsPublicContent,
  uploadsQuestionAssetReport,
  uploadsRenameFile,
  uploadsRemoveFile,
  uploadsUploadFile,
} from '../../../api/generated/upload/upload';
import { asGenerated, generatedData } from '../../../api/generated-data';
import type { QuestionPage, QuestionRecord } from '../models';

export const listQuestionCourses = () => generatedData(asGenerated<QuestionPage>(
  coursesList({ pageSize: 100 } as Parameters<typeof coursesList>[0]),
));
export const listQuestionTags = () => generatedData(asGenerated<QuestionPage>(
  tagsList({ pageSize: 100, type: 'QUESTION' } as Parameters<typeof tagsList>[0]),
));
export const getKnowledgePointTree = (courseId: string) => generatedData(asGenerated<QuestionRecord[]>(
  knowledgePointsTree({ courseId }),
));
export const listQuestions = (params: Parameters<typeof questionsList>[0]) =>
  generatedData(asGenerated<QuestionPage>(questionsList(params)));
export const listPublicQuestions = (params: Parameters<typeof questionsPublicList>[0]) =>
  generatedData(asGenerated<QuestionPage>(questionsPublicList(params)));
export const getQuestion = (id: string) => generatedData(asGenerated<QuestionRecord>(questionsDetail(id)));
export const getPublicQuestion = (id: string) => generatedData(asGenerated<QuestionRecord>(questionsPublicDetail(id)));
export const createQuestion = (body: Parameters<typeof questionsCreate>[0]) =>
  generatedData(asGenerated<QuestionRecord>(questionsCreate(body)));
export const updateQuestion = (id: string, body: Parameters<typeof questionsUpdate>[1]) =>
  generatedData(asGenerated<QuestionRecord>(questionsUpdate(id, body)));
export const publishQuestion = (id: string) => generatedData(asGenerated<QuestionRecord>(questionsPublish(id)));
export const removeQuestion = (id: string) => generatedData(asGenerated<QuestionRecord>(questionsRemove(id)));
export const getQuestionDeleteImpact = (id: string) =>
  generatedData(asGenerated<QuestionRecord>(questionsDeleteImpact(id)));
export const checkQuestionAnswer = (id: string, body: Parameters<typeof questionsCheckAnswer>[1]) =>
  generatedData(asGenerated<QuestionRecord>(questionsCheckAnswer(id, body)));
export const checkQuestionDuplicates = (body: Parameters<typeof questionsCheckDuplicates>[0]) =>
  generatedData(asGenerated<QuestionRecord>(questionsCheckDuplicates(body)));
export const bulkDeleteQuestions = (body: Parameters<typeof questionsBulkDelete>[0]) =>
  generatedData(asGenerated<QuestionRecord>(questionsBulkDelete(body)));
export const bulkUpdateQuestionStatus = (body: Parameters<typeof questionsBulkUpdateStatus>[0]) =>
  generatedData(asGenerated<QuestionRecord>(questionsBulkUpdateStatus(body)));
export const createQuestionTag = (body: Parameters<typeof tagsCreate>[0]) =>
  generatedData(asGenerated<QuestionRecord>(tagsCreate(body)));
export const uploadQuestionAsset = (formData: FormData) => generatedData(asGenerated<QuestionRecord>(
  uploadsUploadFile({ body: formData }),
));
export const renameQuestionAsset = (filename: string, body: { displayName: string }) => generatedData(asGenerated<QuestionRecord>(
  uploadsRenameFile(filename, { body: JSON.stringify(body) }),
));
export const removeQuestionAsset = (filename: string) => generatedData(asGenerated(
  uploadsRemoveFile(filename),
));
export const getQuestionAssetReport = () => generatedData(asGenerated<QuestionRecord>(uploadsQuestionAssetReport()));
export const cleanupQuestionAssets = () => generatedData(asGenerated<QuestionRecord>(uploadsCleanupOrphanQuestionAssets()));
export const getQuestionAssetContent = (filename: string) =>
  generatedData(asGenerated<Blob>(uploadsContent(filename)));
export const getPublicQuestionAssetContent = (questionId: string, filename: string, token: string) =>
  generatedData(asGenerated<Blob>(uploadsPublicContent(questionId, filename, { token }, { auth: false } as RequestInit)));
