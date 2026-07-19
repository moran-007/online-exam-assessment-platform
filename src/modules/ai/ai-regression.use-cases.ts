import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AiRegressionStatus,
  AiSummaryTaskStatus,
  AiSummaryType,
} from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { CredentialCipherService } from '../../security/credential-cipher.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderCapabilityRegistry } from './ai-provider-capability.registry';
import { AiProviderConfigAccessService } from './ai-provider-config-access.service';
import { AiProviderCallException, AiProviderGateway } from './ai-provider.gateway';
import { providerRequestPolicyFor } from './ai-provider-request.policy';
import { resolveOutputTokenPolicy } from './ai-summary-limits';
import { AiTokenUsage, AiTokenUsageService } from './ai-token-usage.service';
import { assertSummaryDataset } from './datasets/dataset-validator';
import type { SupportedSummaryDataset } from './datasets/summary-dataset';
import { CreateAiRegressionRunDto } from './dto/ai-quality.dto';
import {
  CLASS_SUMMARY_OUTPUT_SCHEMA_VERSION,
  EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION,
  LESSON_ASSISTANT_OUTPUT_SCHEMA_VERSION,
  PARENT_REPORT_OUTPUT_SCHEMA_VERSION,
  STUDENT_SUMMARY_OUTPUT_SCHEMA_VERSION,
} from './schemas/summary-output.schema';
import { SummaryOutputValidator } from './schemas/summary-output.validator';
import { parseSummaryJson, responseFormatFor } from './summary-prompt';
import { buildSummaryPrompt } from './summary-prompt.factory';

@Injectable()
export class AiRegressionUseCases {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configAccess: AiProviderConfigAccessService,
    private readonly cipher: CredentialCipherService,
    private readonly gateway: AiProviderGateway,
    private readonly capabilities: AiProviderCapabilityRegistry,
    private readonly validator: SummaryOutputValidator,
    private readonly tokenUsage: AiTokenUsageService,
    private readonly audit: AuditService,
  ) {}

  async run(dto: CreateAiRegressionRunDto, user: RequestUser) {
    const summaryType = this.summaryType(dto.summaryType);
    const [config, template, fixtures] = await Promise.all([
      this.configAccess.resolve(user, dto.configId),
      this.prisma.aiSummaryPromptTemplate.findFirst({
        where: { summaryType, enabled: true },
        orderBy: { version: 'desc' },
      }),
      this.prisma.aiSummaryTask.findMany({
        where: { type: summaryType, status: AiSummaryTaskStatus.SUCCEEDED, summary: { isNot: null } },
        select: { id: true, inputSnapshotJson: true },
        orderBy: { createdAt: 'desc' },
        take: dto.caseCount,
      }),
    ]);
    if (!template) throw new NotFoundException('该总结类型没有启用的 Prompt 模板');
    if (!fixtures.length) throw new BadRequestException('该总结类型暂无成功样本，无法执行模型切换回归');
    const run = await this.prisma.aiModelRegressionRun.create({
      data: {
        providerConfigId: config.id,
        promptTemplateId: template.id,
        summaryType,
        totalCases: fixtures.length,
        createdBy: user.id,
      },
    });
    const capability = await this.capabilities.resolve(config.provider, config.model);
    const outputPolicy = resolveOutputTokenPolicy(
      undefined,
      config.maxTokens,
      capability.maxOutputTokens,
    );
    let passedCases = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let sanitizedError: string | null = null;
    for (const fixture of fixtures) {
      let usage: AiTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, reported: false };
      let recordUsage = false;
      try {
        const dataset = fixture.inputSnapshotJson as unknown as SupportedSummaryDataset;
        assertSummaryDataset(dataset);
        const prompt = buildSummaryPrompt(dataset);
        await this.tokenUsage.authorize(config, outputPolicy.reservationLimit);
        const result = await this.gateway.complete({
          baseUrl: config.baseUrl,
          apiKey: this.decrypt(config),
          model: config.model,
          systemPrompt: template.systemPrompt,
          userPrompt: prompt.userPrompt,
          maxTokens: outputPolicy.requestLimit ?? undefined,
          timeoutMs: config.timeoutMs,
          responseFormat: responseFormatFor(capability, template.outputSchema, prompt.schemaName),
          ...providerRequestPolicyFor(config.provider, config.baseUrl, config.model),
        });
        usage = result.usage;
        recordUsage = true;
        this.validator.validate(
          parseSummaryJson(result.content, this.schemaVersion(summaryType)),
          dataset.evidenceIndex,
        );
        passedCases += 1;
      } catch (error) {
        if (error instanceof AiProviderCallException && error.usage) usage = error.usage;
        if (error instanceof AiProviderCallException) {
          recordUsage ||= error.usageMayBeUnreported || Boolean(error.usage);
        }
        sanitizedError ??= this.error(error);
      } finally {
        inputTokens += usage.promptTokens;
        outputTokens += usage.completionTokens;
        if (recordUsage) {
          await this.tokenUsage.record({
            config,
            operation: 'model-regression',
            correlationId: `${run.id}:${fixture.id}`,
            requestedOutputTokens: outputPolicy.requestLimit,
            reservationOutputTokens: outputPolicy.reservationLimit,
            usage,
            userId: user.id,
          }).catch(() => undefined);
        }
      }
    }
    const updated = await this.prisma.aiModelRegressionRun.update({
      where: { id: run.id },
      data: {
        status: passedCases === fixtures.length ? AiRegressionStatus.PASSED : AiRegressionStatus.FAILED,
        passedCases,
        inputTokens,
        outputTokens,
        sanitizedError,
        finishedAt: new Date(),
      },
      include: { providerConfig: { select: { name: true, model: true } } },
    });
    await this.audit.log({
      userId: user.id,
      action: 'ai:model-regression',
      module: 'ai',
      targetType: 'ai_model_regression_run',
      targetId: run.id,
      afterData: {
        configId: config.id,
        summaryType: dto.summaryType,
        status: updated.status.toLowerCase(),
        passedCases,
        totalCases: fixtures.length,
      },
    });
    return this.present(updated);
  }

  async list() {
    const rows = await this.prisma.aiModelRegressionRun.findMany({
      include: { providerConfig: { select: { name: true, model: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => this.present(row));
  }

  private decrypt(config: {
    id: string;
    apiKeyCiphertext: string;
    apiKeyIv: string;
    apiKeyAuthTag: string;
    apiKeyKeyVersion: number;
  }) {
    return this.cipher.decrypt({
      ciphertext: config.apiKeyCiphertext,
      iv: config.apiKeyIv,
      authTag: config.apiKeyAuthTag,
      keyVersion: config.apiKeyKeyVersion,
    }, `ai-provider:${config.id}`);
  }

  private summaryType(value: string) {
    return value.toUpperCase() as AiSummaryType;
  }

  private schemaVersion(type: AiSummaryType) {
    const versions: Record<AiSummaryType, string> = {
      [AiSummaryType.EXAM]: EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION,
      [AiSummaryType.STUDENT]: STUDENT_SUMMARY_OUTPUT_SCHEMA_VERSION,
      [AiSummaryType.CLASS]: CLASS_SUMMARY_OUTPUT_SCHEMA_VERSION,
      [AiSummaryType.PARENT_REPORT]: PARENT_REPORT_OUTPUT_SCHEMA_VERSION,
      [AiSummaryType.LESSON]: LESSON_ASSISTANT_OUTPUT_SCHEMA_VERSION,
    };
    return versions[type];
  }

  private error(error: unknown) {
    const message = error instanceof Error ? error.message : '模型回归失败';
    return message.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
  }

  private present(row: {
    id: string;
    providerConfigId: string;
    summaryType: AiSummaryType;
    status: AiRegressionStatus;
    passedCases: number;
    totalCases: number;
    inputTokens: number;
    outputTokens: number;
    sanitizedError: string | null;
    createdAt: Date;
    finishedAt: Date | null;
    providerConfig: { name: string; model: string };
  }) {
    return {
      id: row.id,
      providerConfigId: row.providerConfigId,
      configName: row.providerConfig.name,
      model: row.providerConfig.model,
      summaryType: row.summaryType.toLowerCase(),
      status: row.status.toLowerCase(),
      passedCases: row.passedCases,
      totalCases: row.totalCases,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      sanitizedError: row.sanitizedError,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
    };
  }
}
