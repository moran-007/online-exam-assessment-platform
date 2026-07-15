import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaperStatus, Prisma } from '@prisma/client';
import { normalizePaperStatus, normalizePaperType } from '../../../common/utils/enum-normalizer';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaperDto } from '../dto/create-paper.dto';
import { UpdatePaperDto } from '../dto/update-paper.dto';
import { PaperSupportOperations } from '../paper-support.operations';

@Injectable()
export class PaperLifecycleUseCases {
  constructor(
    readonly prisma: PrismaService,
    readonly audit: AuditService,
    readonly support: PaperSupportOperations,
  ) {}

  async create(dto: CreatePaperDto, userId: string) {
      const paper = await this.prisma.paper.create({
        data: {
          name: dto.name,
          courseId: dto.courseId,
          durationMinutes: dto.durationMinutes ?? 60,
          type: normalizePaperType(dto.type ?? 'fixed'),
          shuffleQuestions: dto.shuffleQuestions ?? false,
          shuffleOptions: dto.shuffleOptions ?? false,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await this.audit.log({
        userId,
        action: 'paper:create',
        module: 'paper',
        targetType: 'paper',
        targetId: paper.id,
        afterData: { name: paper.name },
      });

      return { id: paper.id };
    }

  async update(id: string, dto: UpdatePaperDto, userId: string) {
      const paper = await this.support.findExisting(id);
      const isOnlyStatusPatch =
        dto.status !== undefined &&
        dto.name === undefined &&
        dto.courseId === undefined &&
        dto.durationMinutes === undefined &&
        dto.type === undefined &&
        dto.shuffleQuestions === undefined &&
        dto.shuffleOptions === undefined;

      if (!isOnlyStatusPatch && paper.status !== PaperStatus.DRAFT) {
        throw new BadRequestException('只有草稿试卷可以编辑');
      }

      const updated = await this.prisma.paper.update({
        where: { id },
        data: {
          name: dto.name,
          courseId: dto.courseId,
          durationMinutes: dto.durationMinutes,
          type: dto.type ? normalizePaperType(dto.type) : undefined,
          shuffleQuestions: dto.shuffleQuestions,
          shuffleOptions: dto.shuffleOptions,
          status: dto.status ? normalizePaperStatus(dto.status) : undefined,
          updatedBy: userId,
        },
      });

      await this.audit.log({
        userId,
        action: 'paper:update',
        module: 'paper',
        targetType: 'paper',
        targetId: id,
        beforeData: { name: paper.name, status: paper.status },
        afterData: { name: updated.name, status: updated.status },
      });

      return { id };
    }

  async copyAsDraft(id: string, userId: string) {
      const source = await this.prisma.paper.findFirst({
        where: { id, deletedAt: null },
        include: {
          sections: { orderBy: { sortOrder: 'asc' } },
          questions: { orderBy: [{ sectionId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] },
          rules: true,
        },
      });

      if (!source) {
        throw new NotFoundException('试卷不存在');
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const paper = await tx.paper.create({
          data: {
            name: this.support.copyDraftName(source.name),
            courseId: source.courseId,
            totalScore: source.totalScore,
            durationMinutes: source.durationMinutes,
            type: source.type,
            status: PaperStatus.DRAFT,
            shuffleQuestions: source.shuffleQuestions,
            shuffleOptions: source.shuffleOptions,
            createdBy: userId,
            updatedBy: userId,
          },
        });

        const sectionMap = new Map<string, string>();
        for (const section of source.sections) {
          const created = await tx.paperSection.create({
            data: {
              paperId: paper.id,
              title: section.title,
              description: section.description,
              sortOrder: section.sortOrder,
              score: section.score,
              shuffleQuestions: section.shuffleQuestions,
            },
          });
          sectionMap.set(section.id, created.id);
        }

        for (const question of source.questions) {
          await tx.paperQuestion.create({
            data: {
              paperId: paper.id,
              sectionId: question.sectionId ? sectionMap.get(question.sectionId) ?? null : null,
              questionId: question.questionId,
              questionSnapshotJson: question.questionSnapshotJson as Prisma.InputJsonValue,
              score: question.score,
              sortOrder: question.sortOrder,
            },
          });
        }

        for (const rule of source.rules) {
          await tx.paperRule.create({
            data: {
              paperId: paper.id,
              ruleJson: rule.ruleJson as Prisma.InputJsonValue,
            },
          });
        }

        return { id: paper.id };
      });

      await this.audit.log({
        userId,
        action: 'paper:copy-as-draft',
        module: 'paper',
        targetType: 'paper',
        targetId: result.id,
        afterData: { sourcePaperId: id, name: source.name },
      });

      return result;
    }

  async publish(id: string, userId: string) {
      const paper = await this.prisma.paper.findFirst({
        where: { id, deletedAt: null },
        include: { questions: true },
      });

      if (!paper) {
        throw new NotFoundException('试卷不存在');
      }

      if (!paper.questions.length) {
        throw new BadRequestException('试卷至少需要一道题');
      }

      const totalScore = paper.questions.reduce((sum, question) => sum + Number(question.score), 0);
      await this.prisma.paper.update({
        where: { id },
        data: {
          status: PaperStatus.PUBLISHED,
          totalScore,
          updatedBy: userId,
        },
      });

      await this.audit.log({
        userId,
        action: 'paper:publish',
        module: 'paper',
        targetType: 'paper',
        targetId: id,
        afterData: { status: PaperStatus.PUBLISHED, totalScore },
      });

      return { id, totalScore };
    }
}
