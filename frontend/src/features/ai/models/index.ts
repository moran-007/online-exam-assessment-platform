export type {
  AiProviderConfigResponseDto as AiProviderConfig,
  AiProviderPresetDto as AiProviderPreset,
  AiSummaryResultDto as AiSummaryResult,
  AiTestResultDto as AiTestResult,
  AiTokenQuotaDto,
  CreateAiProviderConfigDto as CreateAiProviderConfig,
  GenerateAiSummaryDto as GenerateAiSummary,
  UpdateAiProviderConfigDto as UpdateAiProviderConfig,
  AiSummaryLifecycleRecordDto as AiSummaryLifecycleRecord,
  ExamSummaryDatasetPreviewDto as ExamSummaryDatasetPreview,
  ExamSummaryTaskResponseDto as ExamSummaryTask,
  RegenerateAiSummaryDto as RegenerateAiSummary,
  StudentPublishedAiSummaryDto as StudentPublishedAiSummary,
} from '../../../api/generated/models';

export type AiSummaryClaim = { text: string; evidenceRefs: string[] };
export type AiStructuredSummaryContent = {
  schemaVersion: string;
  headline: AiSummaryClaim;
  overview: AiSummaryClaim[];
  strengths: AiSummaryClaim[];
  risks: AiSummaryClaim[];
  actions: AiSummaryClaim[];
  needsReview: AiSummaryClaim[];
};
