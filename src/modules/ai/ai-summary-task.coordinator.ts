import { Injectable, NotFoundException } from '@nestjs/common';
import { AiSummaryTaskStatus, AiSummaryType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { MetricsService } from '../../observability/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderConfigAccessService } from './ai-provider-config-access.service';
import { AiSummaryTaskRunner } from './ai-summary-task.runner';
import { resolveOutputTokenLimit } from './ai-summary-limits';
import { AiTokenUsageService } from './ai-token-usage.service';
import type { SummaryDatasetBase } from './datasets/summary-dataset';
import { createSummaryDatasetInputHash } from './summary-input-hash';

export type SummaryTaskDefinition = {
  type: AiSummaryType;
  subjectId: string;
  scope: Prisma.InputJsonObject;
  dataset: SummaryDatasetBase & { type: 'exam' | 'student' };
  templateCode: string;
  schemaVersion: string;
  minOutputTokens: number;
  maxTokens?: number;
  configId?: string;
};

export type SummaryTaskOptions = {
  generationKey?: string;
  sourceSummaryId?: string;
};

@Injectable()
export class AiSummaryTaskCoordinator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configAccess: AiProviderConfigAccessService,
    private readonly runner: AiSummaryTaskRunner,
    private readonly tokenUsage: AiTokenUsageService,
    private readonly metrics: MetricsService,
  ) {}

  async create(definition: SummaryTaskDefinition, user: RequestUser, options: SummaryTaskOptions = {}) {
    const [config, template] = await Promise.all([
      this.configAccess.resolve(user, definition.configId),
      this.activeTemplate(definition.type, definition.templateCode),
    ]);
    const requestedOutputTokens = resolveOutputTokenLimit(
      definition.maxTokens,
      config.maxTokens,
      definition.minOutputTokens,
    );
    const identity = {
      type: definition.type,
      subjectId: definition.subjectId,
      inputHash: createSummaryDatasetInputHash(definition.dataset),
      datasetVersion: definition.dataset.datasetVersion,
      promptVersion: template.version,
      schemaVersion: definition.schemaVersion,
      providerConfigId: config.id,
      modelSnapshot: config.model,
      generationKey: options.generationKey ?? 'initial',
      requestedOutputTokens,
    };
    let task = await this.reusable(identity);
    if (!task) task = await this.createOrRead(identity, definition, template.id, user.id, options);
    if (!task) throw new Error('无法创建或读取 AI 总结任务');

    const cacheHit = task.status === AiSummaryTaskStatus.SUCCEEDED;
    this.metrics.recordAiSummary({
      summaryType: definition.dataset.type,
      provider: config.provider,
      outcome: 'cache_lookup',
      durationSeconds: 0,
      cacheHit,
    });
    if (!cacheHit) task = await this.runner.run(task.id);
    return this.present(task, cacheHit);
  }

  private activeTemplate(type: AiSummaryType, code: string) {
    return this.prisma.aiSummaryPromptTemplate.findFirst({
      where: { summaryType: type, code, enabled: true },
      orderBy: { version: 'desc' },
    }).then((template) => {
      if (!template) throw new NotFoundException('尚未启用对应的 AI 总结 Prompt 模板');
      return template;
    });
  }

  private async createOrRead(
    identity: SummaryTaskIdentity,
    definition: SummaryTaskDefinition,
    promptTemplateId: string,
    createdBy: string,
    options: SummaryTaskOptions,
  ) {
    try {
      return await this.prisma.aiSummaryTask.create({
        data: {
          ...identity,
          scopeJson: {
            ...definition.scope,
            ...(options.sourceSummaryId ? { sourceSummaryId: options.sourceSummaryId } : {}),
          },
          inputSnapshotJson: definition.dataset as unknown as Prisma.InputJsonValue,
          promptTemplateId,
          correlationId: randomUUID(),
          createdBy,
        },
        include: TASK_INCLUDE,
      });
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      return this.reusable(identity);
    }
  }

  private reusable(identity: SummaryTaskIdentity) {
    return this.prisma.aiSummaryTask.findFirst({ where: identity, include: TASK_INCLUDE });
  }

  private async present(task: SummaryTaskWithRelations, cacheHit: boolean) {
    const [quota, usageEvent] = await Promise.all([
      this.tokenUsage.quota(task.providerConfig),
      this.prisma.aiUsageEvent.findFirst({
        where: { correlationId: { startsWith: `${task.correlationId}:` } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const reservedTokens = usageEvent && !usageEvent.usageReported
      ? Math.max(usageEvent.requestedOutputTokens, usageEvent.totalTokens)
      : 0;
    return {
      id: task.id,
      status: task.status.toLowerCase(),
      attemptCount: task.attemptCount,
      inputHash: task.inputHash,
      model: { configId: task.providerConfigId, name: task.providerConfig.name, model: task.modelSnapshot },
      usage: {
        inputTokens: task.inputTokens,
        outputTokens: task.outputTokens,
        requestedOutputTokens: task.requestedOutputTokens,
        reported: usageEvent?.usageReported ?? null,
        reservedTokens,
        tokenQuota: quota,
      },
      cacheHit,
      sanitizedError: task.sanitizedError,
      summary: task.summary ? {
        id: task.summary.id,
        reviewStatus: task.summary.reviewStatus.toLowerCase(),
        draftVersion: task.summary.draftVersion,
        content: task.summary.summaryJson,
      } : null,
    };
  }

  private uniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}

const TASK_INCLUDE = { providerConfig: true, promptTemplate: true, summary: true } as const;

type SummaryTaskIdentity = {
  type: AiSummaryType;
  subjectId: string;
  inputHash: string;
  datasetVersion: string;
  promptVersion: number;
  schemaVersion: string;
  providerConfigId: string;
  modelSnapshot: string;
  generationKey: string;
  requestedOutputTokens: number;
};

export type SummaryTaskWithRelations = Prisma.AiSummaryTaskGetPayload<{ include: typeof TASK_INCLUDE }>;
