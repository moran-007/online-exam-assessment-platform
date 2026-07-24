import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { MAX_AI_OUTPUT_TOKENS } from '../ai-summary-limits';

export class CreateAiProviderConfigDto {
  @ApiPropertyOptional({ enum: ['system', 'personal'], description: '系统共享配置仅超级管理员可创建' })
  @IsOptional() @IsIn(['system', 'personal'])
  scope?: 'system' | 'personal';

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

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 8192, description: '留空时不设置配置级输出上限' })
  @IsOptional() @IsInt() @Min(1) @Max(8192)
  maxTokens?: number | null;

  @ApiPropertyOptional({ description: '本地月度 Token 预算；不等同于供应商账户余额', minimum: 1000 })
  @IsOptional() @IsInt() @Min(1000)
  monthlyTokenBudget?: number;

  @ApiPropertyOptional({ description: '每百万输入 Token 的估算成本', default: 0, minimum: 0 })
  @IsOptional() @IsNumber() @Min(0)
  inputCostPerMillion?: number;

  @ApiPropertyOptional({ description: '每百万输出 Token 的估算成本', default: 0, minimum: 0 })
  @IsOptional() @IsNumber() @Min(0)
  outputCostPerMillion?: number;
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
  @ApiPropertyOptional({ nullable: true, description: '设为 null 可清除配置级输出上限' })
  @IsOptional() @IsInt() @Min(1) @Max(8192)
  maxTokens?: number | null;
  @ApiPropertyOptional({ nullable: true, minimum: 1000 }) @IsOptional() @IsInt() @Min(1000)
  monthlyTokenBudget?: number | null;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsNumber() @Min(0)
  inputCostPerMillion?: number;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsNumber() @Min(0)
  outputCostPerMillion?: number;
}

export class AiChatHistoryMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty({ maxLength: 20000 })
  @IsString() @IsNotEmpty() @MaxLength(20000)
  content: string;
}

export class GenerateAiSummaryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  configId?: string;

  @ApiProperty({ description: '问答测试问题，最多 20000 字符；不会自动读取平台业务数据' })
  @IsString() @IsNotEmpty() @MaxLength(20000)
  content: string;

  @ApiPropertyOptional({ description: '补充背景或回答要求，最多 500 字符' })
  @IsOptional() @IsString() @MaxLength(500)
  instruction?: string;

  @ApiPropertyOptional({
    type: () => [AiChatHistoryMessageDto],
    maxItems: 20,
    description: '当前页面会话的最近消息；仅用于连续问答，不持久化',
  })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => AiChatHistoryMessageDto)
  history?: AiChatHistoryMessageDto[];

  @ApiPropertyOptional({
    description: '本次输出上限；不传时仅使用显式配置上限，二者均为空则由供应商决定',
    minimum: 1,
    maximum: MAX_AI_OUTPUT_TOKENS,
  })
  @IsOptional() @IsInt() @Min(1) @Max(MAX_AI_OUTPUT_TOKENS)
  maxTokens?: number;
}

export class AiProviderPresetDto {
  @ApiProperty() provider: string;
  @ApiProperty() name: string;
  @ApiProperty() baseUrl: string;
  @ApiProperty() model: string;
  @ApiProperty({ type: [String], description: '该预设已登记的可选模型；model 为默认值' }) models: string[];
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
  @ApiProperty({ description: '供应商未报告用量时，按公开估算上界保守预留的 Token' }) reservedTokens: number;
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
  @ApiProperty({ enum: ['system', 'personal'] }) scope: 'system' | 'personal';
  @ApiProperty() canManage: boolean;
  @ApiProperty() enabled: boolean;
  @ApiProperty() isDefault: boolean;
  @ApiProperty() timeoutMs: number;
  @ApiProperty({ nullable: true, description: '配置级输出上限；null 表示不向供应商设置该限制' })
  maxTokens: number | null;
  @ApiProperty({ nullable: true }) monthlyTokenBudget: number | null;
  @ApiProperty() inputCostPerMillion: number;
  @ApiProperty() outputCostPerMillion: number;
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
  @ApiProperty({ nullable: true, description: '本次发送给供应商的输出 Token 上限；null 表示未显式限制' })
  outputLimitTokens: number | null;
  @ApiProperty({ type: () => AiUsageDto }) usage: AiUsageDto;
  @ApiProperty({ type: () => AiTokenQuotaDto }) tokenQuota: AiTokenQuotaDto;
  @ApiProperty() durationMs: number;
  @ApiProperty({ type: () => [AiChatContextSourceDto] }) contextSources: AiChatContextSourceDto[];
  @ApiProperty({ description: '当前角色是否允许 AI 直接给出答案' }) directAnswerAllowed: boolean;
  @ApiProperty({ description: '当前角色是否允许脱离平台题目和试卷回答通用知识' }) generalKnowledgeAllowed: boolean;
}

export class AiChatContextSourceDto {
  @ApiProperty({ enum: ['question', 'paper', 'class', 'student', 'teacher', 'schedule', 'exam'] })
  type: 'question' | 'paper' | 'class' | 'student' | 'teacher' | 'schedule' | 'exam';
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
}
