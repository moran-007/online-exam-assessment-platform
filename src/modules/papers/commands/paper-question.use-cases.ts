import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { QuestionStatus } from '@prisma/client';
import { normalizeQuestionType } from '../../../common/utils/enum-normalizer';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QuestionSnapshotUseCases } from '../../questions/questions.use-cases';
import { AddPaperQuestionDto } from '../dto/add-paper-question.dto';
import { AddPaperQuestionsByTagsDto } from '../dto/add-paper-questions-by-tags.dto';
import { UpdatePaperQuestionDto } from '../dto/update-paper-question.dto';
import { PaperSupportOperations } from '../paper-support.operations';

@Injectable()
export class PaperQuestionUseCases {
  constructor(
    readonly prisma: PrismaService,
    readonly questionSnapshots: QuestionSnapshotUseCases,
    readonly audit: AuditService,
    readonly support: PaperSupportOperations,
  ) {}

  async addQuestion(id: string, dto: AddPaperQuestionDto, userId: string) {
      const paper = await this.support.findEditable(id);
      const question = await this.prisma.question.findFirst({
        where: { id: dto.questionId, deletedAt: null, status: QuestionStatus.PUBLISHED },
      });

      if (!question) {
        throw new BadRequestException('只能添加已发布题目');
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const sectionId = await this.support.resolveSection(tx, id, dto.sectionId, dto.sectionTitle);
        const snapshot = await this.questionSnapshots.buildSnapshot(tx, dto.questionId);
        const resolvedScore = this.support.snapshotTotalScore(snapshot, dto.score);
        const sortOrder =
          dto.sortOrder ??
          ((await tx.paperQuestion.count({ where: { paperId: id, sectionId } })) + 1);

        const paperQuestion = await tx.paperQuestion.create({
          data: {
            paperId: id,
            sectionId,
            questionId: dto.questionId,
            questionSnapshotJson: snapshot,
            score: resolvedScore,
            sortOrder,
          },
        });

        await this.support.recalculateScore(tx, id);
        return paperQuestion;
      });

      await this.audit.log({
        userId,
        action: 'paper:add-question',
        module: 'paper',
        targetType: 'paper',
        targetId: id,
        afterData: { questionId: dto.questionId, paperQuestionId: result.id },
      });

      return { id: result.id, paperId: paper.id };
    }

  async removeQuestion(id: string, paperQuestionId: string, userId: string) {
      await this.support.findEditable(id);

      await this.prisma.$transaction(async (tx) => {
        await tx.paperQuestion.delete({
          where: { id: paperQuestionId },
        });
        await this.support.recalculateScore(tx, id);
      });

      await this.audit.log({
        userId,
        action: 'paper:remove-question',
        module: 'paper',
        targetType: 'paper',
        targetId: id,
        afterData: { paperQuestionId },
      });

      return true;
    }

  async addQuestionsByTags(id: string, dto: AddPaperQuestionsByTagsDto, userId: string) {
      const paper = await this.support.findEditable(id);
      const hasTagFilter = Boolean(dto.tagIds?.length);
      const hasKnowledgeFilter = Boolean(dto.knowledgePointIds?.length);
      const hasTypeFilter = Boolean(dto.questionType);

      if (!hasTagFilter && !hasKnowledgeFilter && !hasTypeFilter && !dto.courseId) {
        throw new BadRequestException('请至少选择标签、知识点、课程或题型中的一个筛选条件');
      }

      const existingQuestionIds = (
        await this.prisma.paperQuestion.findMany({
          where: { paperId: id },
          select: { questionId: true },
        })
      ).map((item) => item.questionId);

      const candidates = await this.prisma.question.findMany({
        where: {
          courseId: dto.courseId || paper.courseId,
          deletedAt: null,
          status: QuestionStatus.PUBLISHED,
          id: { notIn: existingQuestionIds },
          type: dto.questionType ? normalizeQuestionType(dto.questionType) : undefined,
          tags: hasTagFilter ? { some: { tagId: { in: dto.tagIds } } } : undefined,
          knowledgePoints: hasKnowledgeFilter
            ? { some: { knowledgePointId: { in: dto.knowledgePointIds } } }
            : undefined,
        },
        orderBy: { createdAt: 'desc' },
      });

      const chosen = dto.random
        ? this.support.pickRandom(candidates, dto.count ?? candidates.length)
        : candidates.slice(0, dto.count ?? candidates.length);

      if (!chosen.length) {
        throw new BadRequestException('没有可加入的已发布题目，或这些题目已在试卷中');
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const sectionId = await this.support.resolveSection(tx, id, undefined, dto.sectionTitle || '按标签导入');
        const startOrder = await tx.paperQuestion.count({ where: { paperId: id, sectionId } });
        const createdIds: string[] = [];

        for (const [index, question] of chosen.entries()) {
          const snapshot = await this.questionSnapshots.buildSnapshot(tx, question.id);
          const resolvedScore = this.support.snapshotTotalScore(snapshot, dto.scoreEach ?? Number(question.defaultScore));
          const created = await tx.paperQuestion.create({
            data: {
              paperId: id,
              sectionId,
              questionId: question.id,
              questionSnapshotJson: snapshot,
              score: resolvedScore,
              sortOrder: startOrder + index + 1,
            },
          });
          createdIds.push(created.id);
        }

        await this.support.recalculateScore(tx, id);
        return { addedCount: createdIds.length, paperQuestionIds: createdIds };
      });

      await this.audit.log({
        userId,
        action: 'paper:add-questions-by-tags',
        module: 'paper',
        targetType: 'paper',
        targetId: id,
        afterData: {
          courseId: dto.courseId || paper.courseId,
          tagIds: dto.tagIds,
          knowledgePointIds: dto.knowledgePointIds,
          questionType: dto.questionType,
          random: dto.random ?? false,
          count: dto.count,
          addedCount: result.addedCount,
        },
      });

      return result;
    }

  async updateQuestion(
      id: string,
      paperQuestionId: string,
      dto: UpdatePaperQuestionDto,
      userId: string,
    ) {
      await this.support.findEditable(id);

      const exists = await this.prisma.paperQuestion.findFirst({
        where: { id: paperQuestionId, paperId: id },
      });

      if (!exists) {
        throw new NotFoundException('试卷题目不存在');
      }

      await this.prisma.$transaction(async (tx) => {
        const hasSectionPatch = dto.sectionId !== undefined || dto.sectionTitle !== undefined;
        const sectionId = hasSectionPatch
          ? await this.support.resolveSection(tx, id, dto.sectionId ?? undefined, dto.sectionTitle)
          : undefined;
        await tx.paperQuestion.update({
          where: { id: paperQuestionId },
          data: {
            sectionId: hasSectionPatch ? (dto.sectionId === null ? null : sectionId) : undefined,
            score: dto.score === undefined ? undefined : this.support.snapshotTotalScore(exists.questionSnapshotJson, dto.score),
            sortOrder: dto.sortOrder,
          },
        });
        await this.support.normalizeSortOrders(tx, id);
        await this.support.recalculateScore(tx, id);
      });

      await this.audit.log({
        userId,
        action: 'paper:update-question',
        module: 'paper',
        targetType: 'paper',
        targetId: id,
        afterData: {
          paperQuestionId,
          score: dto.score,
          sectionId: dto.sectionId,
          sectionTitle: dto.sectionTitle,
          sortOrder: dto.sortOrder,
        },
      });

      return { id: paperQuestionId };
    }

  async moveQuestion(id: string, paperQuestionId: string, direction: 'up' | 'down', userId: string) {
      await this.support.findEditable(id);

      await this.prisma.$transaction(async (tx) => {
        const current = await tx.paperQuestion.findFirst({
          where: { id: paperQuestionId, paperId: id },
        });

        if (!current) {
          throw new NotFoundException('试卷题目不存在');
        }

        const neighbor = await tx.paperQuestion.findFirst({
          where: {
            paperId: id,
            sectionId: current.sectionId,
            sortOrder: direction === 'up' ? { lt: current.sortOrder } : { gt: current.sortOrder },
          },
          orderBy: { sortOrder: direction === 'up' ? 'desc' : 'asc' },
        });

        if (!neighbor) {
          return;
        }

        await tx.paperQuestion.update({
          where: { id: current.id },
          data: { sortOrder: neighbor.sortOrder },
        });
        await tx.paperQuestion.update({
          where: { id: neighbor.id },
          data: { sortOrder: current.sortOrder },
        });
        await this.support.normalizeSortOrders(tx, id);
      });

      await this.audit.log({
        userId,
        action: 'paper:move-question',
        module: 'paper',
        targetType: 'paper',
        targetId: id,
        afterData: { paperQuestionId, direction },
      });

      return { id: paperQuestionId };
    }
}
