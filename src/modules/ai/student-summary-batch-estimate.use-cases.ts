import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { MetricsService } from '../../observability/metrics.service';
import { DataScopeService } from '../data-scope/data-scope.service';
import { AiProviderCapabilityRegistry } from './ai-provider-capability.registry';
import { AiProviderConfigAccessService } from './ai-provider-config-access.service';
import { MIN_STUDENT_SUMMARY_OUTPUT_TOKENS, resolveOutputTokenPolicy } from './ai-summary-limits';
import { AiTokenUsageService } from './ai-token-usage.service';
import { EstimateStudentSummaryBatchDto } from './dto/student-summary.dto';

export const MAX_STUDENT_SUMMARY_BATCH_SIZE = 20;

@Injectable()
export class StudentSummaryBatchEstimateUseCases {
  constructor(
    private readonly dataScope: DataScopeService,
    private readonly configAccess: AiProviderConfigAccessService,
    private readonly capabilities: AiProviderCapabilityRegistry,
    private readonly tokenUsage: AiTokenUsageService,
    private readonly metrics: MetricsService,
  ) {}

  async estimate(dto: EstimateStudentSummaryBatchDto, user: RequestUser) {
    await Promise.all(dto.studentIds.map((studentId) => (
      this.dataScope.assertStudentSummaryAccessible(user, studentId)
    )));
    const config = await this.configAccess.resolve(user, dto.configId);
    const capability = await this.capabilities.resolve(config.provider, config.model);
    const outputPolicy = resolveOutputTokenPolicy(
      dto.maxTokens,
      config.maxTokens,
      capability.maxOutputTokens,
      MIN_STUDENT_SUMMARY_OUTPUT_TOKENS,
    );
    const quota = await this.tokenUsage.quota(config);
    const estimatedReservedTokens = dto.studentIds.length * outputPolicy.reservationLimit;
    const withinLocalBudget = quota.remainingTokens === null
      || estimatedReservedTokens <= quota.remainingTokens;
    this.metrics.recordAiBudgetDecision('student-summary-batch-estimate', withinLocalBudget ? 'accepted' : 'rejected');
    return {
      taskCount: dto.studentIds.length,
      requestedOutputTokensPerTask: outputPolicy.requestLimit,
      reservationOutputTokensPerTask: outputPolicy.reservationLimit,
      estimatedReservedTokens,
      remainingTokens: quota.remainingTokens,
      withinLocalBudget,
      confirmationRequired: true,
      maxBatchSize: MAX_STUDENT_SUMMARY_BATCH_SIZE,
      configId: config.id,
      model: config.model,
    };
  }
}
