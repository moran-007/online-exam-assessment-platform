import type {
  AiProviderConfigResponseDto,
  AiSummaryResultDto,
  AiSummaryTaskResponseDto,
  CreateAiProviderConfigDto,
  StudentSummaryBatchEstimateDto,
  UpdateAiProviderConfigDto,
  RegenerateAiSummaryDto,
} from '../../../api/generated/models';

export type {
  AiProviderPresetDto as AiProviderPreset,
  AiTestResultDto as AiTestResult,
  AiTokenQuotaDto,
  GenerateAiSummaryDto as GenerateAiSummary,
  AiSummaryLifecycleRecordDto as AiSummaryLifecycleRecord,
  ExamSummaryDatasetPreviewDto as ExamSummaryDatasetPreview,
  StudentSummaryDatasetPreviewDto as StudentSummaryDatasetPreview,
  PublishedAiSummaryDto as PublishedAiSummary,
  PublishedAiSummaryDto as StudentPublishedAiSummary,
  IntegratedSummaryDatasetPreviewDto as IntegratedSummaryDatasetPreview,
  AiQualityDashboardDto as AiQualityDashboard,
  AiFeedbackListDto as AiFeedbackList,
  AiFeedbackRecordDto as AiFeedbackRecord,
  AiRegressionRunDto as AiRegressionRun,
} from '../../../api/generated/models';

export type AiProviderConfig = Omit<AiProviderConfigResponseDto, 'maxTokens'> & { maxTokens: number | null };
export type AiSummaryResult = Omit<AiSummaryResultDto, 'outputLimitTokens'> & { outputLimitTokens: number | null };
export type CreateAiProviderConfig = Omit<CreateAiProviderConfigDto, 'maxTokens'> & { maxTokens?: number | null };
export type UpdateAiProviderConfig = Omit<UpdateAiProviderConfigDto, 'maxTokens'> & { maxTokens?: number | null };
export type RegenerateAiSummary = RegenerateAiSummaryDto & { confirmRetry?: boolean };
export type AiSummaryTask = Omit<AiSummaryTaskResponseDto, 'usage'> & {
  usage: Omit<AiSummaryTaskResponseDto['usage'], 'requestedOutputTokens'> & { requestedOutputTokens: number | null };
};
export type ExamSummaryTask = AiSummaryTask;
export type StudentSummaryBatchEstimate = Omit<StudentSummaryBatchEstimateDto, 'requestedOutputTokensPerTask'> & {
  requestedOutputTokensPerTask: number | null;
  reservationOutputTokensPerTask: number;
};

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
