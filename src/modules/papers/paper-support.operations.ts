import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ExamStatus, PaperStatus, Prisma, QuestionStatus } from '@prisma/client';
import { normalizeQuestionType, toApiEnum } from '../../common/utils/enum-normalizer';
import { PrismaService } from '../prisma/prisma.service';
import { GeneratePaperRuleItemDto } from './dto/generate-paper-rule.dto';
import { QueryPaperDto } from './dto/query-paper.dto';

@Injectable()
export class PaperSupportOperations {
  constructor(readonly prisma: PrismaService) {}

  paperScopeWhere(scope: string | undefined, now = new Date()): Prisma.PaperWhereInput {
      const value = String(scope || '').trim().toLowerCase();
      const activeExam: Prisma.ExamWhereInput = {
        deletedAt: null,
        status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
        startTime: { lte: now },
        endTime: { gt: now },
      };
      if (value === 'occupied') {
        return { exams: { some: activeExam } };
      }
      if (value === 'published') {
        return {
          status: PaperStatus.PUBLISHED,
          exams: { none: activeExam },
        };
      }
      if (value === 'draft') {
        return { status: PaperStatus.DRAFT };
      }
      if (value === 'archived') {
        return { status: PaperStatus.ARCHIVED };
      }
      return {};
    }

  async findEditable(id: string) {
      const paper = await this.findExisting(id);

      if (paper.status !== PaperStatus.DRAFT) {
        throw new BadRequestException('只有草稿试卷可以编辑');
      }

      return paper;
    }

  async findSnapshotEditable(id: string) {
      const paper = await this.findExisting(id);
      const safety = await this.getSnapshotEditSafety(id);

      if (!safety.canEdit) {
        throw new BadRequestException(safety.reason);
      }

      return paper;
    }

  async findExisting(id: string) {
      const paper = await this.prisma.paper.findFirst({
        where: { id, deletedAt: null },
      });

      if (!paper) {
        throw new NotFoundException('试卷不存在');
      }

      return paper;
    }

  async getSnapshotEditSafety(paperId: string) {
      const [lockedExamCount, paperInstanceCount, attemptCount] = await this.prisma.$transaction([
        this.prisma.exam.count({
          where: {
            paperId,
            deletedAt: null,
            status: { in: [ExamStatus.RUNNING, ExamStatus.ENDED] },
          },
        }),
        this.prisma.paperInstance.count({
          where: {
            exam: { paperId, deletedAt: null },
          },
        }),
        this.prisma.examAttempt.count({
          where: {
            exam: { paperId, deletedAt: null },
          },
        }),
      ]);

      if (lockedExamCount > 0) {
        return {
          canEdit: false,
          reason: '关联考试正在进行或已结束，为保证答卷与评分追溯一致，暂不能修改试卷显示内容。',
        };
      }

      if (attemptCount > 0) {
        return {
          canEdit: false,
          reason: '该试卷已有提交记录，为保证成绩可追溯，暂不能修改试卷显示内容。',
        };
      }

      if (paperInstanceCount > 0) {
        return {
          canEdit: false,
          reason: '该试卷已有学生进入考试并生成个人试卷，暂不能修改显示内容。',
        };
      }

      return {
        canEdit: true,
        reason: '可修改试卷内题目显示内容，不会影响原题库题目。',
      };
    }

  async resolveSection(
      tx: Prisma.TransactionClient,
      paperId: string,
      sectionId?: string,
      sectionTitle?: string,
    ) {
      if (sectionId) {
        return sectionId;
      }

      if (!sectionTitle) {
        return null;
      }

      const existing = await tx.paperSection.findFirst({
        where: { paperId, title: sectionTitle },
      });

      if (existing) {
        return existing.id;
      }

      const section = await tx.paperSection.create({
        data: {
          paperId,
          title: sectionTitle,
          sortOrder: (await tx.paperSection.count({ where: { paperId } })) + 1,
        },
      });

      return section.id;
    }

  async recalculateScore(tx: Prisma.TransactionClient, paperId: string) {
      const questions = await tx.paperQuestion.findMany({
        where: { paperId },
        select: { score: true, sectionId: true },
      });
      const totalScore = questions.reduce((sum, item) => sum + Number(item.score), 0);
      const sections = await tx.paperSection.findMany({
        where: { paperId },
        select: { id: true },
      });
      const sectionIds = sections.map((section) => section.id);

      for (const sectionId of sectionIds) {
        const sectionScore = questions
          .filter((question) => question.sectionId === sectionId)
          .reduce((sum, item) => sum + Number(item.score), 0);
        await tx.paperSection.update({
          where: { id: sectionId },
          data: { score: sectionScore },
        });
      }

      await tx.paper.update({
        where: { id: paperId },
        data: { totalScore },
      });

      return totalScore;
    }

  snapshotTotalScore(snapshotValue: Prisma.JsonValue | Prisma.InputJsonValue, fallback: number) {
      if (!snapshotValue || typeof snapshotValue !== 'object' || Array.isArray(snapshotValue)) return fallback;
      const snapshot = snapshotValue as Record<string, unknown>;
      if (String(snapshot.type ?? '').toLowerCase() !== 'material') return fallback;
      const children = Array.isArray(snapshot.children) ? snapshot.children : [];
      return children.reduce((sum, child) => {
        if (!child || typeof child !== 'object' || Array.isArray(child)) return sum;
        return sum + Math.max(0, Number((child as Record<string, unknown>).score ?? 0));
      }, 0);
    }

  async normalizeSortOrders(tx: Prisma.TransactionClient, paperId: string) {
      const questions = await tx.paperQuestion.findMany({
        where: { paperId },
        orderBy: [{ sectionId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      const groups = new Map<string, typeof questions>();

      for (const question of questions) {
        const key = question.sectionId ?? 'unsectioned';
        groups.set(key, [...(groups.get(key) ?? []), question]);
      }

      for (const group of groups.values()) {
        for (const [index, question] of group.entries()) {
          if (question.sortOrder !== index + 1) {
            await tx.paperQuestion.update({
              where: { id: question.id },
              data: { sortOrder: index + 1 },
            });
          }
        }
      }
    }

  async findQuestionsByRule(rule: GeneratePaperRuleItemDto, excludeIds: string[]) {
      const [minDifficulty, maxDifficulty] = rule.difficultyRange ?? [1, 5];

      return this.prisma.question.findMany({
        where: {
          deletedAt: null,
          status: QuestionStatus.PUBLISHED,
          type: normalizeQuestionType(rule.questionType),
          id: { notIn: excludeIds },
          difficulty: {
            gte: minDifficulty,
            lte: maxDifficulty,
          },
          knowledgePoints: (rule.knowledgePointIds ?? []).length
            ? {
                some: {
                  knowledgePointId: { in: rule.knowledgePointIds ?? [] },
                },
              }
            : undefined,
          tags: (rule.tagIds ?? []).length
            ? {
                some: {
                  tagId: { in: rule.tagIds ?? [] },
                },
              }
            : undefined,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

  pickRandom<T>(items: T[], count: number) {
      return [...items].sort(() => Math.random() - 0.5).slice(0, count);
    }

  paperOrderBy(query: QueryPaperDto): Prisma.PaperOrderByWithRelationInput[] {
      const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
      const orderMap: Record<string, Prisma.PaperOrderByWithRelationInput> = {
        createdAt: { createdAt: direction },
        updatedAt: { updatedAt: direction },
        name: { name: direction },
        type: { type: direction },
        status: { status: direction },
        totalScore: { totalScore: direction },
        durationMinutes: { durationMinutes: direction },
      };
      const primary = orderMap[query.sortBy || 'createdAt'] ?? { createdAt: 'desc' };
      return query.sortBy && query.sortBy !== 'createdAt' ? [primary, { createdAt: 'desc' }] : [primary];
    }

  copyDraftName(name: string) {
      const suffix = ` 副本 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      return `${name}${suffix}`.slice(0, 128);
    }

  formatPaper(paper: Prisma.PaperGetPayload<{
      include: {
        course: true;
        sections: { include: { questions: true } };
        questions: true;
        rules: true;
        _count: { select: { exams: true } };
      };
    }>) {
      const examUsageCount = paper._count.exams;
      return {
        ...paper,
        type: toApiEnum(paper.type),
        status: toApiEnum(paper.status),
        totalScore: Number(paper.totalScore),
        examUsageCount,
        examOccupied: examUsageCount > 0,
        sections: paper.sections.map((section) => ({
          ...section,
          score: Number(section.score),
          questions: section.questions.map((question) => ({
            ...question,
            score: Number(question.score),
          })),
        })),
        questions: paper.questions.map((question) => ({
          ...question,
          score: Number(question.score),
        })),
      };
    }
}
