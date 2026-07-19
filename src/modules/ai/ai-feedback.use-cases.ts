import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AiFeedbackStatus,
  AiFeedbackVerdict,
  AiSummaryReviewStatus,
  AiSummaryType,
  Prisma,
} from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiSummaryAccessService } from './ai-summary-access.service';
import {
  AiFeedbackQueryDto,
  CreateAiSummaryFeedbackDto,
  ResolveAiSummaryFeedbackDto,
} from './dto/ai-quality.dto';

@Injectable()
export class AiFeedbackUseCases {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AiSummaryAccessService,
    private readonly audit: AuditService,
  ) {}

  async create(summaryId: string, dto: CreateAiSummaryFeedbackDto, user: RequestUser) {
    const summary = await this.access.requirePublishedForFeedback(summaryId, user);
    if (summary.reviewStatus !== AiSummaryReviewStatus.PUBLISHED) {
      throw new BadRequestException('只能对已发布的 AI 总结提交反馈');
    }
    this.assertEvidence(summary.evidenceIndexJson, dto.evidenceRef);
    if (dto.verdict === 'incorrect' && !dto.comment?.trim() && !dto.correctionText?.trim()) {
      throw new BadRequestException('标记为不正确时，请填写问题说明或修正建议');
    }
    const row = await this.prisma.aiSummaryFeedback.create({
      data: {
        summaryId,
        reportedBy: user.id,
        verdict: this.verdict(dto.verdict),
        rating: dto.rating,
        evidenceRef: dto.evidenceRef?.trim() || null,
        comment: dto.comment?.trim() || null,
        correctionText: dto.correctionText?.trim() || null,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'ai:feedback-create',
      module: 'ai',
      targetType: 'ai_summary_feedback',
      targetId: row.id,
      afterData: { summaryId, verdict: dto.verdict, rating: dto.rating, evidenceRef: dto.evidenceRef ?? null },
    });
    return this.present(row, summary.type.toLowerCase(), user.realName ?? user.username);
  }

  async list(query: AiFeedbackQueryDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.AiSummaryFeedbackWhereInput = {
      status: query.status ? this.status(query.status) : undefined,
      summary: {
        type: query.summaryType ? this.summaryType(query.summaryType) : undefined,
        task: query.configId ? { providerConfigId: query.configId } : undefined,
      },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.aiSummaryFeedback.findMany({
        where,
        include: { summary: { select: { type: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.aiSummaryFeedback.count({ where }),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((row) => row.reportedBy) } },
      select: { id: true, realName: true, username: true },
    });
    const names = new Map(users.map((item) => [item.id, item.realName ?? item.username]));
    return {
      items: rows.map((row) => this.present(row, row.summary.type.toLowerCase(), names.get(row.reportedBy) ?? '未知用户')),
      page,
      pageSize,
      total,
    };
  }

  async resolve(id: string, dto: ResolveAiSummaryFeedbackDto, user: RequestUser) {
    const existing = await this.prisma.aiSummaryFeedback.findUnique({
      where: { id },
      include: { summary: { select: { type: true } } },
    });
    if (!existing) throw new NotFoundException('AI 反馈不存在');
    const row = await this.prisma.aiSummaryFeedback.update({
      where: { id },
      data: {
        status: this.status(dto.status),
        resolutionNote: dto.resolutionNote.trim(),
        resolvedBy: user.id,
        resolvedAt: new Date(),
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'ai:feedback-resolve',
      module: 'ai',
      targetType: 'ai_summary_feedback',
      targetId: id,
      beforeData: { status: existing.status.toLowerCase() },
      afterData: { status: dto.status, resolutionNote: dto.resolutionNote.trim() },
    });
    return this.present(row, existing.summary.type.toLowerCase(), '');
  }

  private assertEvidence(value: Prisma.JsonValue, evidenceRef?: string) {
    if (!evidenceRef) return;
    const index = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    if (!Object.prototype.hasOwnProperty.call(index, evidenceRef)) {
      throw new BadRequestException('反馈引用的证据不存在于当前总结');
    }
  }

  private verdict(value: string) {
    if (value === 'helpful') return AiFeedbackVerdict.HELPFUL;
    if (value === 'partial') return AiFeedbackVerdict.PARTIAL;
    return AiFeedbackVerdict.INCORRECT;
  }

  private status(value: string) {
    if (value === 'resolved') return AiFeedbackStatus.RESOLVED;
    if (value === 'dismissed') return AiFeedbackStatus.DISMISSED;
    return AiFeedbackStatus.OPEN;
  }

  private summaryType(value: string) {
    return value.toUpperCase() as AiSummaryType;
  }

  private present(
    row: {
      id: string;
      summaryId: string;
      verdict: AiFeedbackVerdict;
      rating: number;
      evidenceRef: string | null;
      comment: string | null;
      correctionText: string | null;
      status: AiFeedbackStatus;
      resolutionNote: string | null;
      createdAt: Date;
      resolvedAt: Date | null;
    },
    summaryType: string,
    reporterName: string,
  ) {
    return {
      ...row,
      summaryType,
      verdict: row.verdict.toLowerCase(),
      status: row.status.toLowerCase(),
      reporterName,
    };
  }
}
