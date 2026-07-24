import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateAiSummaryPresetDto } from './dto/ai-summary-preset.dto';

@Injectable()
export class AiSummaryPresetUseCases {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.aiSummaryPromptTemplate.findMany({
      select: PRESET_SELECT,
      orderBy: [{ summaryType: 'asc' }, { code: 'asc' }, { version: 'desc' }],
    });
  }

  async revise(id: string, dto: UpdateAiSummaryPresetDto, user: RequestUser) {
    const base = await this.prisma.aiSummaryPromptTemplate.findUnique({ where: { id } });
    if (!base) throw new NotFoundException('AI 总结预设不存在');
    const activate = dto.activate ?? true;
    const created = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.aiSummaryPromptTemplate.findFirst({
        where: { code: base.code },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      if (activate) {
        await tx.aiSummaryPromptTemplate.updateMany({
          where: { code: base.code, enabled: true },
          data: { enabled: false },
        });
      }
      return tx.aiSummaryPromptTemplate.create({
        data: {
          code: base.code,
          summaryType: base.summaryType,
          version: (latest?.version ?? 0) + 1,
          systemPrompt: dto.systemPrompt.trim(),
          outputSchema: base.outputSchema as Prisma.InputJsonValue,
          enabled: activate,
          reviewedBy: activate ? user.id : null,
          changeReason: dto.changeReason.trim(),
          createdBy: user.id,
        },
        select: PRESET_SELECT,
      });
    });
    await this.audit.log({
      userId: user.id,
      action: 'ai:summary-preset-revise',
      module: 'ai',
      targetType: 'ai_summary_prompt_template',
      targetId: created.id,
      beforeData: this.auditData(base),
      afterData: this.auditData(created),
    });
    return created;
  }

  async activate(id: string, user: RequestUser) {
    const target = await this.prisma.aiSummaryPromptTemplate.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('AI 总结预设不存在');
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.aiSummaryPromptTemplate.updateMany({
        where: { code: target.code, enabled: true, id: { not: id } },
        data: { enabled: false },
      });
      return tx.aiSummaryPromptTemplate.update({
        where: { id },
        data: { enabled: true, reviewedBy: user.id },
        select: PRESET_SELECT,
      });
    });
    await this.audit.log({
      userId: user.id,
      action: 'ai:summary-preset-activate',
      module: 'ai',
      targetType: 'ai_summary_prompt_template',
      targetId: id,
      beforeData: this.auditData(target),
      afterData: this.auditData(updated),
    });
    return updated;
  }

  private auditData(row: {
    id: string; code: string; summaryType: string; version: number; systemPrompt: string;
    enabled: boolean; changeReason: string | null;
  }) {
    return {
      id: row.id,
      code: row.code,
      summaryType: row.summaryType,
      version: row.version,
      systemPrompt: row.systemPrompt,
      enabled: row.enabled,
      changeReason: row.changeReason,
    };
  }
}

const PRESET_SELECT = {
  id: true,
  code: true,
  summaryType: true,
  version: true,
  systemPrompt: true,
  enabled: true,
  changeReason: true,
  reviewedBy: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;
