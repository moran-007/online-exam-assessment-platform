import { BadRequestException, Injectable } from '@nestjs/common';
import { AiSummaryTaskStatus, AiSummaryType, Prisma } from '@prisma/client';
import { MetricsService } from '../../observability/metrics.service';
import { CredentialCipherService } from '../../security/credential-cipher.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderCapabilityRegistry } from './ai-provider-capability.registry';
import { AiProviderCallException, AiProviderGateway } from './ai-provider.gateway';
import { thinkingModeFor } from './ai-provider-request.policy';
import { MAX_AI_OUTPUT_TOKENS } from './ai-summary-limits';
import type { SummaryTaskWithRelations } from './ai-summary-task.coordinator';
import { AiTokenUsage, AiTokenUsageService } from './ai-token-usage.service';
import { assertSummaryDataset } from './datasets/dataset-validator';
import type { ExamSummaryDataset, StudentSummaryDataset } from './datasets/summary-dataset';
import { buildExamSummaryUserPrompt } from './exam-summary-prompt';
import { SummaryOutputValidationError, SummaryOutputValidator } from './schemas/summary-output.validator';
import { parseSummaryJson, responseFormatFor, SummaryParseError } from './summary-prompt';
import { buildStudentSummaryUserPrompt } from './student-summary-prompt';

const STALE_AFTER_MS = 5 * 60 * 1000;

class AiSummaryTaskError extends Error {}

type SupportedSummaryDataset = ExamSummaryDataset | StudentSummaryDataset;

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
    let authorizedOutputTokens = task.requestedOutputTokens;
    try {
      if (!task.providerConfig.enabled) throw new AiSummaryTaskError('所选 AI 配置已停用');
      const dataset = this.dataset(task.inputSnapshotJson, task.type);
      const prompt = this.prompt(dataset);
      const capability = await this.capabilities.resolve(task.providerConfig.provider, task.modelSnapshot);
      authorizedOutputTokens = Math.min(
        task.requestedOutputTokens,
        task.providerConfig.maxTokens,
        capability.maxOutputTokens ?? MAX_AI_OUTPUT_TOKENS,
        MAX_AI_OUTPUT_TOKENS,
      );
      await this.tokenUsage.authorize(task.providerConfig, authorizedOutputTokens);
      const result = await this.gateway.complete({
        baseUrl: task.providerConfig.baseUrl,
        apiKey: this.decrypt(task.providerConfig),
        model: task.modelSnapshot,
        systemPrompt: task.promptTemplate.systemPrompt,
        userPrompt: prompt.userPrompt,
        maxTokens: authorizedOutputTokens,
        timeoutMs: task.providerConfig.timeoutMs,
        responseFormat: responseFormatFor(capability, task.promptTemplate.outputSchema, prompt.schemaName),
        thinking: thinkingModeFor(task.providerConfig.provider),
      });
      usage = result.usage;
      await this.recordUsage(task, authorizedOutputTokens, usage, dataset.type);
      usageRecorded = true;
      const output = this.validator.validate(
        parseSummaryJson(result.content, task.schemaVersion),
        dataset.evidenceIndex,
      );
      const { evidenceIndex, ...sourceSnapshot } = dataset;
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
            finishedAt: new Date(),
          },
        }),
      ]);
      this.metric(task, dataset.type, 'succeeded', startedAt, usage);
    } catch (error) {
      if (error instanceof AiProviderCallException && error.usage) usage = error.usage;
      if (!usageRecorded && error instanceof AiProviderCallException
        && (error.usageMayBeUnreported || Boolean(error.usage))) {
        await this.recordUsage(task, authorizedOutputTokens, usage, task.type.toLowerCase()).catch(() => undefined);
      }
      await this.prisma.aiSummaryTask.update({
        where: { id: task.id },
        data: {
          status: AiSummaryTaskStatus.FAILED,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
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
    if (dataset.type !== type.toLowerCase() || !['exam', 'student'].includes(dataset.type)) {
      throw new AiSummaryTaskError('AI 总结任务的数据集类型无效');
    }
    assertSummaryDataset(dataset);
    return dataset;
  }

  private prompt(dataset: SupportedSummaryDataset) {
    if (dataset.type === 'exam') {
      return { userPrompt: buildExamSummaryUserPrompt(dataset), schemaName: 'exam_summary' };
    }
    return { userPrompt: buildStudentSummaryUserPrompt(dataset), schemaName: 'student_summary' };
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
    requestedOutputTokens: number,
    usage: AiTokenUsage,
    summaryType: string,
  ) {
    return this.tokenUsage.record({
      config: task.providerConfig,
      operation: `${summaryType}-summary`,
      correlationId: `${task.correlationId}:${task.attemptCount}`,
      requestedOutputTokens,
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
      estimatedCost: Number(task.estimatedCost),
    });
  }
}
