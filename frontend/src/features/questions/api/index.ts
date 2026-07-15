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
import type {
  AnswerCheckResult,
  BulkQuestionResult,
  DuplicateCheckResult,
  KnowledgePointTreeNode,
  NamedOption,
  PageResult,
  QuestionAsset,
  QuestionAssetCleanupResult,
  QuestionAssetReport,
  QuestionAnswerSubmission,
  QuestionDeleteImpact,
  QuestionPage,
  QuestionMutationPayload,
  QuestionRecord,
} from '../models';

export const listQuestionCourses = () => generatedData(asGenerated<PageResult<NamedOption>>(
  coursesList({ pageSize: 100 } as Parameters<typeof coursesList>[0]),
));
export const listQuestionTags = () => generatedData(asGenerated<PageResult<NamedOption>>(
  tagsList({ pageSize: 100, type: 'QUESTION' } as Parameters<typeof tagsList>[0]),
));
export const getKnowledgePointTree = (courseId: string) => generatedData(asGenerated<KnowledgePointTreeNode[]>(
  knowledgePointsTree({ courseId }),
));
export const listQuestions = (params: Parameters<typeof questionsList>[0]) =>
  generatedData(asGenerated<QuestionPage>(questionsList(params)));
export const listPublicQuestions = (params: Parameters<typeof questionsPublicList>[0]) =>
  generatedData(asGenerated<QuestionPage>(questionsPublicList(params)));
export const getQuestion = (id: string) => generatedData(asGenerated<QuestionRecord>(questionsDetail(id)));
export const getPublicQuestion = (id: string) => generatedData(asGenerated<QuestionRecord>(questionsPublicDetail(id)));
export const createQuestion = (body: QuestionMutationPayload) =>
  generatedData(asGenerated<QuestionRecord>(questionsCreate(body as Parameters<typeof questionsCreate>[0])));
export const updateQuestion = (id: string, body: Partial<QuestionMutationPayload>) =>
  generatedData(asGenerated<QuestionRecord>(questionsUpdate(id, body as Parameters<typeof questionsUpdate>[1])));
export const publishQuestion = (id: string) => generatedData(asGenerated<QuestionRecord>(questionsPublish(id)));
export const removeQuestion = (id: string) => generatedData(asGenerated<QuestionRecord>(questionsRemove(id)));
export const getQuestionDeleteImpact = (id: string) =>
  generatedData(asGenerated<QuestionDeleteImpact>(questionsDeleteImpact(id)));
export const checkQuestionAnswer = (id: string, body: QuestionAnswerSubmission) =>
  generatedData(asGenerated<AnswerCheckResult>(questionsCheckAnswer(id, body as Parameters<typeof questionsCheckAnswer>[1])));
export const checkQuestionDuplicates = (body: Parameters<typeof questionsCheckDuplicates>[0]) =>
  generatedData(asGenerated<DuplicateCheckResult>(questionsCheckDuplicates(body)));
export const bulkDeleteQuestions = (body: Parameters<typeof questionsBulkDelete>[0]) =>
  generatedData(asGenerated<BulkQuestionResult>(questionsBulkDelete(body)));
export const bulkUpdateQuestionStatus = (body: Parameters<typeof questionsBulkUpdateStatus>[0]) =>
  generatedData(asGenerated<BulkQuestionResult>(questionsBulkUpdateStatus(body)));
export const createQuestionTag = (body: Parameters<typeof tagsCreate>[0]) =>
  generatedData(asGenerated<NamedOption>(tagsCreate(body)));
export const uploadQuestionAsset = (formData: FormData) => generatedData(asGenerated<QuestionAsset>(
  uploadsUploadFile({ body: formData }),
));
export const renameQuestionAsset = (filename: string, body: { displayName: string }) => generatedData(asGenerated<QuestionAsset>(
  uploadsRenameFile(filename, { body: JSON.stringify(body) }),
));
export const removeQuestionAsset = (filename: string) => generatedData(asGenerated(
  uploadsRemoveFile(filename),
));
export const getQuestionAssetReport = () => generatedData(asGenerated<QuestionAssetReport>(uploadsQuestionAssetReport()));
export const cleanupQuestionAssets = () => generatedData(asGenerated<QuestionAssetCleanupResult>(uploadsCleanupOrphanQuestionAssets()));
export const getQuestionAssetContent = (filename: string) =>
  generatedData(asGenerated<Blob>(uploadsContent(filename)));
export const getPublicQuestionAssetContent = (questionId: string, filename: string, token: string) =>
  generatedData(asGenerated<Blob>(uploadsPublicContent(questionId, filename, { token }, { auth: false } as RequestInit)));
