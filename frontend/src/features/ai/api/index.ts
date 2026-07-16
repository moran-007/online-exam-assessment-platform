import {
  aiConfigurations,
  aiCreate,
  aiPresets,
  aiRemove,
  aiSummarize,
  aiTest,
  aiUpdate,
} from '../../../api/generated/ai/ai';
import { aiSummaryCreate, aiSummaryPreview } from '../../../api/generated/ai-summary/ai-summary';
import {
  aiSummaryLifecycleHistory,
  aiSummaryLifecyclePublishedFor,
  aiSummaryLifecyclePublish,
  aiSummaryLifecycleRegenerate,
  aiSummaryLifecycleReview,
  aiSummaryLifecycleRevoke,
  aiSummaryLifecycleUpdate,
} from '../../../api/generated/ai-summary-lifecycle/ai-summary-lifecycle';
import { asGenerated, generatedData } from '../../../api/generated-data';
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
  ExamSummaryTask,
  RegenerateAiSummary,
  StudentPublishedAiSummary,
} from '../models';

export const listAiPresets = () => generatedData(asGenerated<AiProviderPreset[]>(aiPresets()));
export const listAiConfigurations = () => generatedData(asGenerated<AiProviderConfig[]>(aiConfigurations()));
export const createAiConfiguration = (body: CreateAiProviderConfig) =>
  generatedData(asGenerated<AiProviderConfig>(aiCreate(body)));
export const updateAiConfiguration = (id: string, body: UpdateAiProviderConfig) =>
  generatedData(asGenerated<AiProviderConfig>(aiUpdate(id, body)));
export const removeAiConfiguration = (id: string) => generatedData(asGenerated(aiRemove(id)));
export const testAiConfiguration = (id: string) => generatedData(asGenerated<AiTestResult>(aiTest(id)));
export const generateAiSummary = (body: GenerateAiSummary) =>
  generatedData(asGenerated<AiSummaryResult>(aiSummarize(body)));
export const previewExamSummaryDataset = (examId: string) =>
  generatedData(asGenerated<ExamSummaryDatasetPreview>(aiSummaryPreview(examId)));
export const createExamSummary = (body: Parameters<typeof aiSummaryCreate>[0]) =>
  generatedData(asGenerated<ExamSummaryTask>(aiSummaryCreate(body)));
export const listExamSummaryHistory = (examId: string) =>
  generatedData(asGenerated<AiSummaryLifecycleRecord[]>(aiSummaryLifecycleHistory(examId)));
export const updateExamSummary = (id: string, content: Record<string, unknown>) =>
  generatedData(asGenerated<AiSummaryLifecycleRecord>(aiSummaryLifecycleUpdate(id, { content })));
export const reviewExamSummary = (id: string) =>
  generatedData(asGenerated<AiSummaryLifecycleRecord>(aiSummaryLifecycleReview(id)));
export const publishExamSummary = (id: string) =>
  generatedData(asGenerated<AiSummaryLifecycleRecord>(aiSummaryLifecyclePublish(id)));
export const revokeExamSummary = (id: string) =>
  generatedData(asGenerated<AiSummaryLifecycleRecord>(aiSummaryLifecycleRevoke(id)));
export const regenerateExamSummary = (id: string, body: RegenerateAiSummary) =>
  generatedData(asGenerated<ExamSummaryTask>(aiSummaryLifecycleRegenerate(id, body)));
export const listPublishedExamSummaries = () =>
  generatedData(asGenerated<StudentPublishedAiSummary[]>(aiSummaryLifecyclePublishedFor()));
