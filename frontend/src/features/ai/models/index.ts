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
  StudentSummaryDatasetPreviewDto as StudentSummaryDatasetPreview,
  StudentSummaryBatchEstimateDto as StudentSummaryBatchEstimate,
  AiSummaryTaskResponseDto as AiSummaryTask,
  AiSummaryTaskResponseDto as ExamSummaryTask,
  RegenerateAiSummaryDto as RegenerateAiSummary,
  PublishedAiSummaryDto as PublishedAiSummary,
  PublishedAiSummaryDto as StudentPublishedAiSummary,
  IntegratedSummaryDatasetPreviewDto as IntegratedSummaryDatasetPreview,
  AiQualityDashboardDto as AiQualityDashboard,
  AiFeedbackListDto as AiFeedbackList,
  AiFeedbackRecordDto as AiFeedbackRecord,
  AiRegressionRunDto as AiRegressionRun,
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
