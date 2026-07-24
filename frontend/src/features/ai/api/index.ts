import {
  aiConfigurations,
  aiCreate,
  aiPresets,
  aiRemove,
  aiSummarize,
  aiTest,
  aiUpdate,
} from '../../../api/generated/ai/ai';
import {
  aiSummaryCreate,
  aiSummaryCreateStudent,
  aiSummaryEstimateStudentBatch,
  aiSummaryPreview,
  aiSummaryStudentPreview,
} from '../../../api/generated/ai-summary/ai-summary';
import {
  aiSummaryLifecycleClassHistory,
  aiSummaryLifecycleHistory,
  aiSummaryLifecycleLessonHistory,
  aiSummaryLifecycleParentReportHistory,
  aiSummaryLifecyclePublishedFor,
  aiSummaryLifecyclePublish,
  aiSummaryLifecycleRegenerate,
  aiSummaryLifecycleReview,
  aiSummaryLifecycleRevoke,
  aiSummaryLifecycleStudentHistory,
  aiSummaryLifecycleUpdate,
} from '../../../api/generated/ai-summary-lifecycle/ai-summary-lifecycle';
import {
  integratedSummaryCreateClass,
  integratedSummaryCreateLesson,
  integratedSummaryCreateParent,
  integratedSummaryPreviewClass,
  integratedSummaryPreviewLesson,
  integratedSummaryPreviewParent,
} from '../../../api/generated/ai-integrated-summary/ai-integrated-summary';
import { asGenerated, generatedData } from '../../../api/generated-data';
import {
  aiQualityCreateFeedback,
  aiQualityDashboard,
  aiQualityFeedback,
  aiQualityRegressions,
  aiQualityResolveFeedback,
  aiQualityRunRegression,
} from '../../../api/generated/ai-quality/ai-quality';
import {
  aiSummaryPresetActivate,
  aiSummaryPresetList,
  aiSummaryPresetRevise,
} from '../../../api/generated/ai-summary-preset/ai-summary-preset';
import type {
  AiProviderConfig,
  AiProviderPreset,
  AiSummaryResult,
  AiTestResult,
  CreateAiProviderConfig,
  GenerateAiSummary,
  UpdateAiProviderConfig,
  AiSummaryLifecycleRecord,
  ExamSummaryDatasetPreview,
  StudentSummaryDatasetPreview,
  StudentSummaryBatchEstimate,
  AiSummaryTask,
  RegenerateAiSummary,
  PublishedAiSummary,
  IntegratedSummaryDatasetPreview,
  AiQualityDashboard,
  AiFeedbackList,
  AiRegressionRun,
  AiSummaryPreset,
  UpdateAiSummaryPreset,
} from '../models';
import { apiWire } from '../../../api';

export type AiUserPermissionRecord = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
};

export type AiUserPermissionConfig = {
  role: {
    id: string;
    code: 'ai_user';
    name: string;
    description?: string | null;
    status: 'ACTIVE' | 'DISABLED';
    permissionIds: string[];
    permissions: AiUserPermissionRecord[];
  };
  availablePermissions: AiUserPermissionRecord[];
};

const wireData = async <T>(request: Promise<unknown>) => ((await request) as { data: T }).data;

export const getAiUserPermissionConfig = () =>
  wireData<AiUserPermissionConfig>(apiWire('/users/roles/ai-user'));
export const updateAiUserPermissionConfig = (body: { permissionIds: string[]; password: string }) =>
  wireData<AiUserPermissionConfig['role']>(apiWire('/users/roles/ai-user/permissions', {
    method: 'PUT',
    body,
  }));

export const listAiPresets = () => generatedData(asGenerated<AiProviderPreset[]>(aiPresets()));
export const listAiConfigurations = () => generatedData(asGenerated<AiProviderConfig[]>(aiConfigurations()));
export const createAiConfiguration = (body: CreateAiProviderConfig) =>
  generatedData(asGenerated<AiProviderConfig>(aiCreate(body as unknown as Parameters<typeof aiCreate>[0])));
export const updateAiConfiguration = (id: string, body: UpdateAiProviderConfig) =>
  generatedData(asGenerated<AiProviderConfig>(aiUpdate(id, body as unknown as Parameters<typeof aiUpdate>[1])));
export const removeAiConfiguration = (id: string) => generatedData(asGenerated(aiRemove(id)));
export const testAiConfiguration = (id: string) => generatedData(asGenerated<AiTestResult>(aiTest(id)));
export const generateAiSummary = (body: GenerateAiSummary) =>
  generatedData(asGenerated<AiSummaryResult>(aiSummarize(body)));
export const previewExamSummaryDataset = (examId: string) =>
  generatedData(asGenerated<ExamSummaryDatasetPreview>(aiSummaryPreview(examId)));
type RetryConfirmed<T> = T & { confirmRetry?: boolean };

export const createExamSummary = (body: RetryConfirmed<Parameters<typeof aiSummaryCreate>[0]>) =>
  generatedData(asGenerated<AiSummaryTask>(aiSummaryCreate(body)));
export const previewStudentSummaryDataset = (
  studentId: string,
  params?: Parameters<typeof aiSummaryStudentPreview>[1],
) => generatedData(asGenerated<StudentSummaryDatasetPreview>(aiSummaryStudentPreview(studentId, params)));
export const createStudentSummary = (body: RetryConfirmed<Parameters<typeof aiSummaryCreateStudent>[0]>) =>
  generatedData(asGenerated<AiSummaryTask>(aiSummaryCreateStudent(body)));
export const previewClassSummaryDataset = (
  classId: string,
  params?: Parameters<typeof integratedSummaryPreviewClass>[1],
) => generatedData(asGenerated<IntegratedSummaryDatasetPreview>(integratedSummaryPreviewClass(classId, params)));
export const createClassSummary = (body: RetryConfirmed<Parameters<typeof integratedSummaryCreateClass>[0]>) =>
  generatedData(asGenerated<AiSummaryTask>(integratedSummaryCreateClass(body)));
export const previewParentReportDataset = (
  studentId: string,
  params?: Parameters<typeof integratedSummaryPreviewParent>[1],
) => generatedData(asGenerated<IntegratedSummaryDatasetPreview>(integratedSummaryPreviewParent(studentId, params)));
export const createParentReport = (body: RetryConfirmed<Parameters<typeof integratedSummaryCreateParent>[0]>) =>
  generatedData(asGenerated<AiSummaryTask>(integratedSummaryCreateParent(body)));
export const previewLessonAssistantDataset = (sessionId: string) =>
  generatedData(asGenerated<IntegratedSummaryDatasetPreview>(integratedSummaryPreviewLesson(sessionId)));
export const createLessonAssistant = (body: RetryConfirmed<Parameters<typeof integratedSummaryCreateLesson>[0]>) =>
  generatedData(asGenerated<AiSummaryTask>(integratedSummaryCreateLesson(body)));
export const estimateStudentSummaryBatch = (body: Parameters<typeof aiSummaryEstimateStudentBatch>[0]) =>
  generatedData(asGenerated<StudentSummaryBatchEstimate>(aiSummaryEstimateStudentBatch(body)));
export const listExamSummaryHistory = (examId: string) =>
  generatedData(asGenerated<AiSummaryLifecycleRecord[]>(aiSummaryLifecycleHistory(examId)));
export const listStudentSummaryHistory = (studentId: string) =>
  generatedData(asGenerated<AiSummaryLifecycleRecord[]>(aiSummaryLifecycleStudentHistory(studentId)));
export const listClassSummaryHistory = (classId: string) =>
  generatedData(asGenerated<AiSummaryLifecycleRecord[]>(aiSummaryLifecycleClassHistory(classId)));
export const listParentReportHistory = (studentId: string) =>
  generatedData(asGenerated<AiSummaryLifecycleRecord[]>(aiSummaryLifecycleParentReportHistory(studentId)));
export const listLessonAssistantHistory = (sessionId: string) =>
  generatedData(asGenerated<AiSummaryLifecycleRecord[]>(aiSummaryLifecycleLessonHistory(sessionId)));
export const updateExamSummary = (id: string, content: Record<string, unknown>) =>
  generatedData(asGenerated<AiSummaryLifecycleRecord>(aiSummaryLifecycleUpdate(id, { content })));
export const reviewExamSummary = (id: string) =>
  generatedData(asGenerated<AiSummaryLifecycleRecord>(aiSummaryLifecycleReview(id)));
export const publishExamSummary = (id: string) =>
  generatedData(asGenerated<AiSummaryLifecycleRecord>(aiSummaryLifecyclePublish(id)));
export const revokeExamSummary = (id: string) =>
  generatedData(asGenerated<AiSummaryLifecycleRecord>(aiSummaryLifecycleRevoke(id)));
export const regenerateExamSummary = (id: string, body: RegenerateAiSummary) =>
  generatedData(asGenerated<AiSummaryTask>(aiSummaryLifecycleRegenerate(id, body)));
export const listPublishedSummaries = () =>
  generatedData(asGenerated<PublishedAiSummary[]>(aiSummaryLifecyclePublishedFor()));
export const createSummaryFeedback = (
  id: string,
  body: Parameters<typeof aiQualityCreateFeedback>[1],
) => generatedData(asGenerated(aiQualityCreateFeedback(id, body)));
export const getAiQualityDashboard = (params?: Parameters<typeof aiQualityDashboard>[0]) =>
  generatedData(asGenerated<AiQualityDashboard>(aiQualityDashboard(params)));
export const listAiFeedback = (params?: Parameters<typeof aiQualityFeedback>[0]) =>
  generatedData(asGenerated<AiFeedbackList>(aiQualityFeedback(params)));
export const resolveAiFeedback = (id: string, body: Parameters<typeof aiQualityResolveFeedback>[1]) =>
  generatedData(asGenerated(aiQualityResolveFeedback(id, body)));
export const listAiRegressions = () =>
  generatedData(asGenerated<AiRegressionRun[]>(aiQualityRegressions()));
export const runAiRegression = (body: Parameters<typeof aiQualityRunRegression>[0]) =>
  generatedData(asGenerated<AiRegressionRun>(aiQualityRunRegression(body)));
export const listAiSummaryPresets = () =>
  generatedData(asGenerated<AiSummaryPreset[]>(aiSummaryPresetList()));
export const reviseAiSummaryPreset = (id: string, body: UpdateAiSummaryPreset) =>
  generatedData(asGenerated<AiSummaryPreset>(aiSummaryPresetRevise(id, body)));
export const activateAiSummaryPreset = (id: string) =>
  generatedData(asGenerated<AiSummaryPreset>(aiSummaryPresetActivate(id)));
export const listPublishedExamSummaries = listPublishedSummaries;
