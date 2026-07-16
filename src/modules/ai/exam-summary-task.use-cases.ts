import { Injectable, NotFoundException } from '@nestjs/common';
import { AiSummaryTaskStatus, AiSummaryType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { MetricsService } from '../../observability/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderConfigAccessService } from './ai-provider-config-access.service';
import { AiTokenUsageService } from './ai-token-usage.service';
import { ExamSummaryDatasetBuilder } from './datasets/exam-summary-dataset.builder';
import { CreateExamSummaryTaskDto } from './dto/ai-summary.dto';
import { ExamSummaryTaskRunner } from './exam-summary-task.runner';
import { EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION } from './schemas/summary-output.schema';
import { createSummaryDatasetInputHash } from './summary-input-hash';

@Injectable()
export class ExamSummaryTaskUseCases {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: ExamSummaryDatasetBuilder,
    private readonly configAccess: AiProviderConfigAccessService,
    private readonly runner: ExamSummaryTaskRunner,
    private readonly tokenUsage: AiTokenUsageService,
    private readonly metrics: MetricsService,
  ) {}

  async create(dto: CreateExamSummaryTaskDto, user: RequestUser) {
    const dataset = await this.builder.build(dto.examId, user);
    const [config, template] = await Promise.all([
      this.configAccess.resolve(user, dto.configId),
      this.activeTemplate(),
    ]);
    const identity = {
      type: AiSummaryType.EXAM,
      subjectId: dto.examId,
      inputHash: createSummaryDatasetInputHash(dataset),
      datasetVersion: dataset.datasetVersion,
      promptVersion: template.version,
      schemaVersion: EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION,
      providerConfigId: config.id,
      modelSnapshot: config.model,
    };
    let task = await this.reusable(identity);
    if (!task) {
      try {
        task = await this.prisma.aiSummaryTask.create({
          data: {
            ...identity,
            scopeJson: { examId: dto.examId },
            inputSnapshotJson: dataset as unknown as Prisma.InputJsonValue,
            promptTemplateId: template.id,
            requestedOutputTokens: Math.min(dto.maxTokens ?? 1000, config.maxTokens, 1200),
            correlationId: randomUUID(),
            createdBy: user.id,
          },
          include: { providerConfig: true, promptTemplate: true, summary: true },
        });
      } catch (error) {
        if (!this.uniqueConflict(error)) throw error;
        task = await this.reusable(identity);
      }
    }
    if (!task) throw new Error('无法创建或读取 AI 总结任务');
    const cacheHit = task.status === AiSummaryTaskStatus.SUCCEEDED;
    this.metrics.recordAiSummary({
      summaryType: 'exam', provider: config.provider, outcome: 'cache_lookup',
      durationSeconds: 0, cacheHit,
    });
    if (task.status !== AiSummaryTaskStatus.SUCCEEDED) task = await this.runner.run(task.id);
    return this.present(task, cacheHit);
  }

  private activeTemplate() {
    return this.prisma.aiSummaryPromptTemplate.findFirst({
      where: { summaryType: AiSummaryType.EXAM, code: 'exam-summary', enabled: true },
      orderBy: { version: 'desc' },
    }).then((template) => {
      if (!template) throw new NotFoundException('尚未启用考试总结 Prompt 模板');
      return template;
    });
  }

  private reusable(identity: {
    type: AiSummaryType;
    subjectId: string;
    inputHash: string;
    datasetVersion: string;
    promptVersion: number;
    schemaVersion: string;
    providerConfigId: string;
    modelSnapshot: string;
  }) {
    return this.prisma.aiSummaryTask.findFirst({
      where: identity,
      include: { providerConfig: true, promptTemplate: true, summary: true },
    });
  }

  private async present(task: NonNullable<Awaited<ReturnType<ExamSummaryTaskUseCases['reusable']>>>, cacheHit: boolean) {
    const quota = await this.tokenUsage.quota(task.providerConfig);
    return {
      id: task.id,
      status: task.status.toLowerCase(),
      attemptCount: task.attemptCount,
      inputHash: task.inputHash,
      model: { configId: task.providerConfigId, name: task.providerConfig.name, model: task.modelSnapshot },
      usage: { inputTokens: task.inputTokens, outputTokens: task.outputTokens, tokenQuota: quota },
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
