import {
  aiConfigurations,
  aiCreate,
  aiPresets,
  aiRemove,
  aiSummarize,
  aiTest,
  aiUpdate,
} from '../../../api/generated/ai/ai';
import { asGenerated, generatedData } from '../../../api/generated-data';
import type {
  AiProviderConfig,
  AiProviderPreset,
  AiSummaryResult,
  AiTestResult,
  CreateAiProviderConfig,
  GenerateAiSummary,
  UpdateAiProviderConfig,
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
