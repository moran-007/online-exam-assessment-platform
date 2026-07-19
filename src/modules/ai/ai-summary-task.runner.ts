import { BadRequestException, Injectable } from '@nestjs/common';
import { AiSummaryTaskStatus, AiSummaryType, Prisma } from '@prisma/client';
import { MetricsService } from '../../observability/metrics.service';
import { CredentialCipherService } from '../../security/credential-cipher.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderCapabilityRegistry } from './ai-provider-capability.registry';
import { AiProviderCallException, AiProviderGateway } from './ai-provider.gateway';
import { providerRequestPolicyFor } from './ai-provider-request.policy';
import type { SummaryTaskWithRelations } from './ai-summary-task.coordinator';
import { AiTokenUsage, AiTokenUsageService } from './ai-token-usage.service';
import { assertSummaryDataset } from './datasets/dataset-validator';
import type { SupportedSummaryDataset } from './datasets/summary-dataset';
import { SummaryOutputValidationError, SummaryOutputValidator } from './schemas/summary-output.validator';
import { parseSummaryJson, responseFormatFor, SummaryParseError } from './summary-prompt';
import { buildSummaryPrompt } from './summary-prompt.factory';

const STALE_AFTER_MS = 5 * 60 * 1000;

class AiSummaryTaskError extends Error {}

@Injectable()
export class AiSummaryTaskRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipherService,
    private readonly gateway: AiProviderGateway,
    private readonly capabilities: AiProviderCapabilityRegistry,
    private readonly tokenUsage: AiTokenUsageService,
    private readonly validator: SummaryOutputValidator,
    private readonly metrics: MetricsService,
  ) {}

  async run(taskId: string) {
    const claimed = await this.prisma.aiSummaryTask.updateMany({
      where: {
        id: taskId,
        OR: [
          { status: { in: [AiSummaryTaskStatus.PENDING, AiSummaryTaskStatus.FAILED] } },
          { status: AiSummaryTaskStatus.PROCESSING, startedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
        ],
      },
      data: {
        status: AiSummaryTaskStatus.PROCESSING,
        attemptCount: { increment: 1 },
        startedAt: new Date(),
        finishedAt: null,
        sanitizedError: null,
      },
    });
    if (!claimed.count) return this.task(taskId);

    const task = await this.task(taskId);
    const startedAt = Date.now();
    let usage: AiTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, reported: false };
    let usageRecorded = false;
    try {
      if (!task.providerConfig.enabled) throw new AiSummaryTaskError('所选 AI 配置已停用');
      const dataset = this.dataset(task.inputSnapshotJson, task.type);
      const prompt = buildSummaryPrompt(dataset);
      const capability = await this.capabilities.resolve(task.providerConfig.provider, task.modelSnapshot);
      await this.tokenUsage.authorize(task.providerConfig, task.reservationOutputTokens);
      const result = await this.gateway.complete({
        baseUrl: task.providerConfig.baseUrl,
        apiKey: this.decrypt(task.providerConfig),
        model: task.modelSnapshot,
        systemPrompt: task.promptTemplate.systemPrompt,
        userPrompt: prompt.userPrompt,
        maxTokens: task.requestedOutputTokens ?? undefined,
        timeoutMs: task.providerConfig.timeoutMs,
        responseFormat: responseFormatFor(capability, task.promptTemplate.outputSchema, prompt.schemaName),
        ...providerRequestPolicyFor(
          task.providerConfig.provider,
          task.providerConfig.baseUrl,
          task.modelSnapshot,
        ),
      });
      usage = result.usage;
      await this.recordUsage(task, usage, dataset.type);
      usageRecorded = true;
      const output = this.validator.validate(
        parseSummaryJson(result.content, task.schemaVersion),
        dataset.evidenceIndex,
      );
      const { evidenceIndex, ...sourceSnapshot } = dataset;
      const estimatedCost = this.estimatedCost(task.providerConfig, usage, task.reservationOutputTokens);
      await this.prisma.$transaction([
        this.prisma.aiSummary.create({
          data: {
            taskId: task.id,
            type: task.type,
            subjectId: task.subjectId,
            summaryJson: output as unknown as Prisma.InputJsonValue,
            sourceSnapshotJson: sourceSnapshot as unknown as Prisma.InputJsonValue,
            evidenceIndexJson: evidenceIndex as unknown as Prisma.InputJsonValue,
          },
        }),
        this.prisma.aiSummaryTask.update({
          where: { id: task.id },
          data: {
            status: AiSummaryTaskStatus.SUCCEEDED,
            inputTokens: usage.promptTokens,
            outputTokens: usage.completionTokens,
            estimatedCost,
            finishedAt: new Date(),
          },
        }),
      ]);
      this.metric(task, dataset.type, 'succeeded', startedAt, usage);
    } catch (error) {
      if (error instanceof AiProviderCallException && error.usage) usage = error.usage;
      if (!usageRecorded && error instanceof AiProviderCallException
        && (error.usageMayBeUnreported || Boolean(error.usage))) {
        await this.recordUsage(task, usage, task.type.toLowerCase()).catch(() => undefined);
      }
      await this.prisma.aiSummaryTask.update({
        where: { id: task.id },
        data: {
          status: AiSummaryTaskStatus.FAILED,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          estimatedCost: this.estimatedCost(task.providerConfig, usage, task.reservationOutputTokens),
          finishedAt: new Date(),
          sanitizedError: this.sanitizedError(error),
        },
      });
      this.metric(task, task.type.toLowerCase(), 'failed', startedAt, usage);
    }
    return this.task(taskId);
  }

  private task(id: string) {
    return this.prisma.aiSummaryTask.findUniqueOrThrow({
      where: { id },
      include: { providerConfig: true, promptTemplate: true, summary: true },
    });
  }

  private dataset(value: Prisma.JsonValue, type: AiSummaryType): SupportedSummaryDataset {
    const dataset = value as unknown as SupportedSummaryDataset;
    if (dataset.type !== type.toLowerCase() || !['exam', 'student', 'class', 'parent_report', 'lesson'].includes(dataset.type)) {
      throw new AiSummaryTaskError('AI 总结任务的数据集类型无效');
    }
    assertSummaryDataset(dataset);
    return dataset;
  }

  private decrypt(config: { id: string; apiKeyCiphertext: string; apiKeyIv: string; apiKeyAuthTag: string; apiKeyKeyVersion: number }) {
    return this.cipher.decrypt({
      ciphertext: config.apiKeyCiphertext,
      iv: config.apiKeyIv,
      authTag: config.apiKeyAuthTag,
      keyVersion: config.apiKeyKeyVersion,
    }, `ai-provider:${config.id}`);
  }

  private recordUsage(
    task: SummaryTaskWithRelations,
    usage: AiTokenUsage,
    summaryType: string,
  ) {
    return this.tokenUsage.record({
      config: task.providerConfig,
      operation: `${summaryType}-summary`,
      correlationId: `${task.correlationId}:${task.attemptCount}`,
      requestedOutputTokens: task.requestedOutputTokens,
      reservationOutputTokens: task.reservationOutputTokens,
      usage,
      userId: task.createdBy,
    });
  }

  private sanitizedError(error: unknown) {
    const safe = error instanceof AiProviderCallException
      || error instanceof SummaryOutputValidationError
      || error instanceof SummaryParseError
      || error instanceof BadRequestException
      || error instanceof AiSummaryTaskError
      ? error.message
      : 'AI 总结任务执行失败';
    return safe.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
  }

  private metric(
    task: SummaryTaskWithRelations,
    summaryType: string,
    outcome: string,
    startedAt: number,
    usage: AiTokenUsage,
  ) {
    this.metrics.recordAiSummary({
      summaryType,
      provider: task.providerConfig.provider,
      outcome,
      durationSeconds: (Date.now() - startedAt) / 1000,
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
      estimatedCost: this.estimatedCost(task.providerConfig, usage, task.reservationOutputTokens),
    });
  }

  private estimatedCost(
    config: { inputCostPerMillion: Prisma.Decimal; outputCostPerMillion: Prisma.Decimal },
    usage: AiTokenUsage,
    reservationOutputTokens: number,
  ) {
    const estimatedOutputTokens = usage.reported
      ? usage.completionTokens
      : Math.max(usage.completionTokens, reservationOutputTokens);
    const cost = usage.promptTokens * Number(config.inputCostPerMillion)
      + estimatedOutputTokens * Number(config.outputCostPerMillion);
    return Number((cost / 1_000_000).toFixed(6));
  }
}
