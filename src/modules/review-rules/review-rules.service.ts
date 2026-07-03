import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewReminderRuleDto, UpdateReviewReminderRuleDto } from './dto/review-reminder-rule.dto';

@Injectable()
export class ReviewRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: { courseId?: string; classId?: string; knowledgePointId?: string }) {
    const items = await this.prisma.reviewReminderRule.findMany({
      where: {
        courseId: query.courseId || undefined,
        classId: query.classId || undefined,
        knowledgePointId: query.knowledgePointId || undefined,
      },
      orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }],
    });
    return items.map((item) => this.formatRule(item));
  }

  async create(dto: ReviewReminderRuleDto, user: RequestUser) {
    const intervals = this.normalizeIntervals(dto.intervalsDays);
    const created = await this.prisma.reviewReminderRule.create({
      data: {
        courseId: dto.courseId,
        classId: dto.classId,
        knowledgePointId: dto.knowledgePointId,
        intervalsJson: intervals as unknown as Prisma.InputJsonArray,
        masteryRuleJson: this.normalizeMasteryRule(dto.masteryRule),
        enabled: dto.enabled ?? true,
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
    return this.formatRule(created);
  }

  async update(id: string, dto: UpdateReviewReminderRuleDto, user: RequestUser) {
    const exists = await this.prisma.reviewReminderRule.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException('复习提醒规则不存在');
    }

    const updated = await this.prisma.reviewReminderRule.update({
      where: { id },
      data: {
        courseId: dto.courseId === null ? null : dto.courseId,
        classId: dto.classId === null ? null : dto.classId,
        knowledgePointId: dto.knowledgePointId === null ? null : dto.knowledgePointId,
        intervalsJson: dto.intervalsDays
          ? (this.normalizeIntervals(dto.intervalsDays) as unknown as Prisma.InputJsonArray)
          : undefined,
        masteryRuleJson: dto.masteryRule === undefined ? undefined : this.normalizeMasteryRule(dto.masteryRule),
        enabled: dto.enabled,
        updatedBy: user.id,
      },
    });
    return this.formatRule(updated);
  }

  async remove(id: string) {
    const exists = await this.prisma.reviewReminderRule.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      throw new NotFoundException('复习提醒规则不存在');
    }
    await this.prisma.reviewReminderRule.delete({ where: { id } });
    return true;
  }

  private normalizeIntervals(value: number[]) {
    const intervals = [...new Set((value || []).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))]
      .sort((a, b) => a - b)
      .slice(0, 12);
    if (!intervals.length) {
      throw new BadRequestException('请至少设置一个复习间隔天数');
    }
    return intervals;
  }

  private normalizeMasteryRule(value?: Record<string, unknown>) {
    const source = value ?? {};
    const correctStreak = Number(source.correctStreak ?? 3);
    const reviewingIntervalDays = Number(source.reviewingIntervalDays ?? 3);
    return {
      correctStreak: Number.isFinite(correctStreak) && correctStreak > 0 ? Math.min(Math.round(correctStreak), 20) : 3,
      reviewingIntervalDays:
        Number.isFinite(reviewingIntervalDays) && reviewingIntervalDays > 0
          ? Math.min(Math.round(reviewingIntervalDays), 365)
          : 3,
    } as Prisma.InputJsonObject;
  }

  private formatRule(item: {
    id: string;
    courseId: string | null;
    classId: string | null;
    knowledgePointId: string | null;
    intervalsJson: Prisma.JsonValue;
    masteryRuleJson: Prisma.JsonValue | null;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: item.id,
      courseId: item.courseId,
      classId: item.classId,
      knowledgePointId: item.knowledgePointId,
      intervalsDays: Array.isArray(item.intervalsJson) ? item.intervalsJson.map(Number).filter(Number.isFinite) : [],
      masteryRule: item.masteryRuleJson ?? {},
      enabled: item.enabled,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
