import { Injectable } from '@nestjs/common';
import type { AiProviderConfig, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { CredentialCipherService } from '../../security/credential-cipher.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderGateway } from './ai-provider.gateway';
import { AiProviderConfigAccessService } from './ai-provider-config-access.service';
import { thinkingModeFor } from './ai-provider-request.policy';
import { AI_PROVIDER_PRESETS } from './ai-provider.presets';
import { AiTokenQuota, AiTokenUsageService } from './ai-token-usage.service';
import { CreateAiProviderConfigDto, UpdateAiProviderConfigDto } from './dto/ai.dto';

@Injectable()
export class AiConfigUseCases {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipherService,
    private readonly gateway: AiProviderGateway,
    private readonly audit: AuditService,
    private readonly tokenUsage: AiTokenUsageService,
    private readonly access: AiProviderConfigAccessService,
  ) {}

  presets() {
    return [...AI_PROVIDER_PRESETS];
  }

  async list(user: RequestUser) {
    const rows = await this.access.list(user);
    const quotas = await this.tokenUsage.quotas(rows);
    return rows.map((row) => this.format(row, user, quotas.get(row.id)));
  }

  async create(dto: CreateAiProviderConfigDto, user: RequestUser) {
    const id = randomUUID();
    const encrypted = this.cipher.encrypt(dto.apiKey.trim(), this.purpose(id));
    const ownership = this.access.createOwnership(dto.scope, user);
    const data: Prisma.AiProviderConfigUncheckedCreateInput = {
      id,
      name: dto.name.trim(),
      provider: dto.provider.trim().toLowerCase(),
      baseUrl: this.gateway.validateBaseUrl(dto.baseUrl),
      model: dto.model.trim(),
      apiKeyCiphertext: encrypted.ciphertext,
      apiKeyIv: encrypted.iv,
      apiKeyAuthTag: encrypted.authTag,
      apiKeyKeyVersion: encrypted.keyVersion,
      enabled: dto.enabled ?? true,
      isDefault: dto.isDefault ?? false,
      timeoutMs: dto.timeoutMs ?? 30_000,
      maxTokens: dto.maxTokens ?? 1000,
      monthlyTokenBudget: dto.monthlyTokenBudget,
      ...ownership,
      createdBy: user.id,
      updatedBy: user.id,
    };
    const row = await this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.aiProviderConfig.updateMany({ where: this.access.defaultPeers(ownership), data: { isDefault: false } });
      }
      return tx.aiProviderConfig.create({ data });
    });
    await this.audit.log({ userId: user.id, action: 'ai:config-create', module: 'ai', targetType: 'ai_provider_config', targetId: id, afterData: this.auditData(row) });
    return this.format(row, user, await this.tokenUsage.quota(row));
  }

  async update(id: string, dto: UpdateAiProviderConfigDto, user: RequestUser) {
    const existing = await this.access.requireManageable(id, user);
    const encrypted = dto.apiKey?.trim() ? this.cipher.encrypt(dto.apiKey.trim(), this.purpose(id)) : null;
    const data: Prisma.AiProviderConfigUncheckedUpdateInput = {
      name: dto.name?.trim(),
      provider: dto.provider?.trim().toLowerCase(),
      baseUrl: dto.baseUrl ? this.gateway.validateBaseUrl(dto.baseUrl) : undefined,
      model: dto.model?.trim(),
      enabled: dto.enabled,
      isDefault: dto.isDefault,
      timeoutMs: dto.timeoutMs,
      maxTokens: dto.maxTokens,
      monthlyTokenBudget: dto.monthlyTokenBudget,
      updatedBy: user.id,
      ...(encrypted ? {
        apiKeyCiphertext: encrypted.ciphertext,
        apiKeyIv: encrypted.iv,
        apiKeyAuthTag: encrypted.authTag,
        apiKeyKeyVersion: encrypted.keyVersion,
      } : {}),
    };
    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.aiProviderConfig.updateMany({
          where: { id: { not: id }, ...this.access.defaultPeers(existing) }, data: { isDefault: false },
        });
      }
      return tx.aiProviderConfig.update({ where: { id }, data });
    });
    await this.audit.log({ userId: user.id, action: 'ai:config-update', module: 'ai', targetType: 'ai_provider_config', targetId: id, beforeData: this.auditData(existing), afterData: this.auditData(row) });
    return this.format(row, user, await this.tokenUsage.quota(row));
  }

  async remove(id: string, user: RequestUser) {
    const existing = await this.access.requireManageable(id, user);
    await this.prisma.aiProviderConfig.delete({ where: { id } });
    await this.audit.log({ userId: user.id, action: 'ai:config-delete', module: 'ai', targetType: 'ai_provider_config', targetId: id, beforeData: this.auditData(existing) });
    return { id, deleted: true };
  }

  async test(id: string, user: RequestUser) {
    const config = await this.access.requireManageable(id, user);
    const requestedOutputTokens = 4;
    await this.tokenUsage.authorize(config, requestedOutputTokens);
    const startedAt = Date.now();
    try {
      const result = await this.gateway.complete({
        baseUrl: config.baseUrl,
        apiKey: this.decrypt(config),
        model: config.model,
        systemPrompt: '你是连接测试助手。',
        userPrompt: '只回复：OK',
        maxTokens: requestedOutputTokens,
        timeoutMs: config.timeoutMs,
        allowEmptyContent: true,
        thinking: thinkingModeFor(config.provider),
      });
      const tokenQuota = await this.tokenUsage.record({
        config, operation: 'connection_test', requestedOutputTokens, usage: result.usage, userId: user.id,
      });
      await this.prisma.aiProviderConfig.update({ where: { id }, data: { lastTestStatus: 'success', lastTestMessage: '连接成功', lastTestAt: new Date() } });
      await this.audit.log({ userId: user.id, action: 'ai:config-test', module: 'ai', targetType: 'ai_provider_config', targetId: id, afterData: { success: true, durationMs: result.durationMs, ...result.usage } });
      return {
        success: true,
        message: '连接成功',
        reply: result.content.slice(0, 20) || '已收到模型响应',
        durationMs: result.durationMs,
        usage: result.usage,
        tokenQuota,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 280) : '连接失败';
      await this.prisma.aiProviderConfig.update({ where: { id }, data: { lastTestStatus: 'failed', lastTestMessage: message, lastTestAt: new Date() } });
      await this.audit.log({ userId: user.id, action: 'ai:config-test', module: 'ai', targetType: 'ai_provider_config', targetId: id, afterData: { success: false, durationMs: Date.now() - startedAt } });
      throw error;
    }
  }

  private decrypt(row: AiProviderConfig) {
    return this.cipher.decrypt({
      ciphertext: row.apiKeyCiphertext, iv: row.apiKeyIv, authTag: row.apiKeyAuthTag, keyVersion: row.apiKeyKeyVersion,
    }, this.purpose(row.id));
  }

  private purpose(id: string) { return `ai-provider:${id}`; }

  private format(row: AiProviderConfig, user: RequestUser, tokenQuota?: AiTokenQuota) {
    return {
      id: row.id, name: row.name, provider: row.provider, baseUrl: row.baseUrl, model: row.model,
      scope: row.scope.toLowerCase(), canManage: this.access.canManage(row, user),
      enabled: row.enabled, isDefault: row.isDefault, timeoutMs: row.timeoutMs, maxTokens: row.maxTokens,
      monthlyTokenBudget: row.monthlyTokenBudget, tokenQuota,
      hasApiKey: Boolean(row.apiKeyCiphertext), apiKeyMasked: '••••••••',
      lastTestStatus: row.lastTestStatus, lastTestMessage: row.lastTestMessage, lastTestAt: row.lastTestAt,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private auditData(row: AiProviderConfig) {
    return {
      id: row.id, name: row.name, provider: row.provider, baseUrl: row.baseUrl, model: row.model,
      scope: row.scope.toLowerCase(), enabled: row.enabled, isDefault: row.isDefault,
    };
  }
}
