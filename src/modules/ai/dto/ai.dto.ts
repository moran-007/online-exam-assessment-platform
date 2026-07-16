import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateAiProviderConfigDto {
  @ApiProperty({ example: 'DeepSeek 默认配置' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'deepseek' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  provider: string;

  @ApiProperty({ example: 'https://api.deepseek.com' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  baseUrl: string;

  @ApiProperty({ example: 'deepseek-v4-flash' })
  @IsString() @IsNotEmpty() @MaxLength(160)
  model: string;

  @ApiProperty({ writeOnly: true, example: 'sk-***' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  apiKey: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional() @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: 30000, minimum: 3000, maximum: 120000 })
  @IsOptional() @IsInt() @Min(3000) @Max(120000)
  timeoutMs?: number;

  @ApiPropertyOptional({ default: 1000, minimum: 1, maximum: 8192 })
  @IsOptional() @IsInt() @Min(1) @Max(8192)
  maxTokens?: number;

  @ApiPropertyOptional({ description: '本地月度 Token 预算；不等同于供应商账户余额', minimum: 1000 })
  @IsOptional() @IsInt() @Min(1000)
  monthlyTokenBudget?: number;
}

export class UpdateAiProviderConfigDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(50)
  provider?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500)
  baseUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  model?: string;
  @ApiPropertyOptional({ writeOnly: true }) @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500)
  apiKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(3000) @Max(120000)
  timeoutMs?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(8192)
  maxTokens?: number;
  @ApiPropertyOptional({ nullable: true, minimum: 1000 }) @IsOptional() @IsInt() @Min(1000)
  monthlyTokenBudget?: number | null;
}

export class GenerateAiSummaryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  configId?: string;

  @ApiProperty({ description: '待总结内容，最多 20000 字符' })
  @IsString() @IsNotEmpty() @MaxLength(20000)
  content: string;

  @ApiPropertyOptional({ description: '附加总结要求，最多 500 字符' })
  @IsOptional() @IsString() @MaxLength(500)
  instruction?: string;

  @ApiPropertyOptional({ default: 1000, minimum: 1, maximum: 1200 })
  @IsOptional() @IsInt() @Min(1) @Max(1200)
  maxTokens?: number;
}

export class AiProviderPresetDto {
  @ApiProperty() provider: string;
  @ApiProperty() name: string;
  @ApiProperty() baseUrl: string;
  @ApiProperty() model: string;
  @ApiProperty() documentationUrl: string;
  @ApiProperty() note: string;
}

export class AiUsageDto {
  @ApiProperty() promptTokens: number;
  @ApiProperty() completionTokens: number;
  @ApiProperty() totalTokens: number;
  @ApiProperty() reported: boolean;
}

export class AiTokenQuotaDto {
  @ApiProperty({ type: String, format: 'date-time' }) periodStart: Date;
  @ApiProperty({ type: String, format: 'date-time' }) periodEnd: Date;
  @ApiProperty({ nullable: true }) budgetTokens: number | null;
  @ApiProperty() usedTokens: number;
  @ApiProperty({ nullable: true }) remainingTokens: number | null;
  @ApiProperty() unreportedCalls: number;
  @ApiProperty() usageComplete: boolean;
  @ApiProperty({ enum: ['local-monthly-budget', 'not-configured'] })
  balanceSource: 'local-monthly-budget' | 'not-configured';
}

export class AiProviderConfigResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() provider: string;
  @ApiProperty() baseUrl: string;
  @ApiProperty() model: string;
  @ApiProperty() enabled: boolean;
  @ApiProperty() isDefault: boolean;
  @ApiProperty() timeoutMs: number;
  @ApiProperty() maxTokens: number;
  @ApiProperty({ nullable: true }) monthlyTokenBudget: number | null;
  @ApiProperty({ type: () => AiTokenQuotaDto }) tokenQuota: AiTokenQuotaDto;
  @ApiProperty() hasApiKey: boolean;
  @ApiProperty() apiKeyMasked: string;
  @ApiProperty({ nullable: true }) lastTestStatus: string | null;
  @ApiProperty({ nullable: true }) lastTestMessage: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) lastTestAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

export class AiDeleteResultDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() deleted: boolean;
}

export class AiTestResultDto {
  @ApiProperty() success: boolean;
  @ApiProperty() message: string;
  @ApiProperty() reply: string;
  @ApiProperty() durationMs: number;
  @ApiProperty({ type: () => AiUsageDto }) usage: AiUsageDto;
  @ApiProperty({ type: () => AiTokenQuotaDto }) tokenQuota: AiTokenQuotaDto;
}

export class AiSummaryResultDto {
  @ApiProperty() summary: string;
  @ApiProperty() provider: string;
  @ApiProperty() model: string;
  @ApiProperty({ type: () => AiUsageDto }) usage: AiUsageDto;
  @ApiProperty({ type: () => AiTokenQuotaDto }) tokenQuota: AiTokenQuotaDto;
  @ApiProperty() durationMs: number;
}
