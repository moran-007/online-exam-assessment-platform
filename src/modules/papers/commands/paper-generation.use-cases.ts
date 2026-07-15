import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PaperStatus,
  PaperType,
  Prisma,
  QuestionStatus,
  WrongQuestionSourceType,
} from '@prisma/client';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { normalizePaperType, normalizeQuestionType } from '../../../common/utils/enum-normalizer';
import { AuditService } from '../../audit/audit.service';
import { DataScopeService } from '../../data-scope/data-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QuestionSnapshotUseCases } from '../../questions/questions.use-cases';
import { GeneratePaperRuleDto } from '../dto/generate-paper-rule.dto';
import { GeneratePaperFromWrongDto } from '../dto/generate-paper-from-wrong.dto';
import { PaperSupportOperations } from '../paper-support.operations';

@Injectable()
export class PaperGenerationUseCases {
  constructor(
    readonly prisma: PrismaService,
    readonly audit: AuditService,
    readonly dataScope: DataScopeService,
    readonly questionSnapshots: QuestionSnapshotUseCases,
    readonly support: PaperSupportOperations,
  ) {}

  async validateRules(dto: GeneratePaperRuleDto) {
      const items: Array<{
        sectionTitle: string;
        requiredCount: number;
        availableCount: number;
        valid: boolean;
      }> = [];
      const selectedIds = new Set<string>();

      for (const rule of dto.rules) {
        const available = await this.support.findQuestionsByRule(rule, [...selectedIds]);
        for (const question of available.slice(0, rule.count)) {
          selectedIds.add(question.id);
        }
        items.push({
          sectionTitle: rule.sectionTitle,
          requiredCount: rule.count,
          availableCount: available.length,
          valid: available.length >= rule.count,
        });
      }

      return {
        valid: items.every((item) => item.valid),
        items,
      };
    }

  async generateByRule(id: string, dto: GeneratePaperRuleDto, userId: string) {
      const paper = await this.support.findEditable(id);
      const validation = await this.validateRules(dto);

      if (!validation.valid) {
        throw new BadRequestException({
          code: 40010,
          message: '题库数量不足',
          data: validation,
        });
      }

      const selectedIds = new Set<string>();

      const result = await this.prisma.$transaction(async (tx) => {
        await tx.paperQuestion.deleteMany({ where: { paperId: id } });
        await tx.paperSection.deleteMany({ where: { paperId: id } });
        await tx.paperRule.deleteMany({ where: { paperId: id } });

        let questionCount = 0;

        for (const [sectionIndex, rule] of dto.rules.entries()) {
          const section = await tx.paperSection.create({
            data: {
              paperId: id,
              title: rule.sectionTitle,
              description: `每题 ${rule.scoreEach} 分`,
              sortOrder: sectionIndex + 1,
              shuffleQuestions: dto.shuffleQuestions,
            },
          });

          const candidates = await this.support.findQuestionsByRule(rule, [...selectedIds]);
          const chosen = this.support.pickRandom(candidates, rule.count);

          for (const [index, question] of chosen.entries()) {
            selectedIds.add(question.id);
            const snapshot = await this.questionSnapshots.buildSnapshot(tx, question.id);
            await tx.paperQuestion.create({
              data: {
                paperId: id,
                sectionId: section.id,
                questionId: question.id,
                questionSnapshotJson: snapshot,
                score: rule.scoreEach,
                sortOrder: index + 1,
              },
            });
            questionCount += 1;
          }
        }

        await tx.paperRule.create({
          data: {
            paperId: id,
            ruleJson: dto as unknown as Prisma.InputJsonObject,
          },
        });

        const totalScore = await this.support.recalculateScore(tx, id);
        await tx.paper.update({
          where: { id },
          data: {
            type: paper.type === PaperType.RANDOM ? PaperType.RANDOM : normalizePaperType('rule'),
            shuffleQuestions: dto.shuffleQuestions,
            shuffleOptions: dto.shuffleOptions,
          },
        });

        return { paperId: id, totalScore, questionCount };
      });

      await this.audit.log({
        userId,
        action: 'paper:generate-by-rule',
        module: 'paper',
        targetType: 'paper',
        targetId: id,
        afterData: result,
      });

      return result;
    }

  async generateFromWrongFrequency(dto: GeneratePaperFromWrongDto, user: RequestUser) {
      const course = await this.prisma.course.findFirst({
        where: { id: dto.courseId, deletedAt: null },
      });
      if (!course) {
        throw new NotFoundException('课程不存在');
      }

      const scopedStudentIds = await this.scopedStudentIdsForWrongPaper(dto, user);
      const wrongItems = await this.prisma.wrongQuestion.findMany({
        where: {
          studentId: scopedStudentIds ? { in: scopedStudentIds } : undefined,
          sourceType: this.normalizeWrongSourceType(dto.sourceType),
          lastWrongAt: this.dateRange(dto),
          question: {
            courseId: dto.courseId,
            deletedAt: null,
            status: QuestionStatus.PUBLISHED,
            type: dto.questionType ? normalizeQuestionType(dto.questionType) : undefined,
            knowledgePoints: dto.knowledgePointId
              ? {
                  some: { knowledgePointId: dto.knowledgePointId },
                }
              : undefined,
          },
        },
        include: { question: true },
      });
      const frequency = new Map<string, { question: (typeof wrongItems)[number]['question']; wrongCount: number }>();
      for (const item of wrongItems) {
        const current = frequency.get(item.questionId) ?? { question: item.question, wrongCount: 0 };
        current.wrongCount += Math.max(item.wrongCount, 1);
        frequency.set(item.questionId, current);
      }
      const selected = [...frequency.entries()]
        .map(([questionId, item]) => ({ questionId, ...item }))
        .filter((item) => item.wrongCount >= (dto.minWrongCount ?? 1))
        .sort((a, b) => b.wrongCount - a.wrongCount)
        .slice(0, dto.count ?? 20);

      if (!selected.length) {
        throw new BadRequestException('当前条件下没有可用于组卷的错题数据');
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const paper = await tx.paper.create({
          data: {
            name: dto.name?.trim() || `错题频次组卷 ${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}`,
            courseId: dto.courseId,
            durationMinutes: Math.max(selected.length * 3, 30),
            type: PaperType.FIXED,
            status: PaperStatus.DRAFT,
            createdBy: user.id,
            updatedBy: user.id,
          },
        });
        const section = await tx.paperSection.create({
          data: {
            paperId: paper.id,
            title: dto.sectionTitle?.trim() || '高频错题',
            description: `按错题频次自动生成，可继续手动调整。`,
            sortOrder: 1,
          },
        });

        for (const [index, item] of selected.entries()) {
          const snapshot = await this.questionSnapshots.buildSnapshot(tx, item.questionId);
          await tx.paperQuestion.create({
            data: {
              paperId: paper.id,
              sectionId: section.id,
              questionId: item.questionId,
              questionSnapshotJson: {
                ...(snapshot as Record<string, unknown>),
                wrongFrequency: item.wrongCount,
              } as Prisma.InputJsonObject,
              score: dto.scoreEach ?? Number(item.question.defaultScore),
              sortOrder: index + 1,
            },
          });
        }

        const totalScore = await this.support.recalculateScore(tx, paper.id);
        return { paperId: paper.id, questionCount: selected.length, totalScore };
      });

      await this.audit.log({
        userId: user.id,
        action: 'paper:generate-from-wrong-frequency',
        module: 'paper',
        targetType: 'paper',
        targetId: result.paperId,
        afterData: {
          courseId: dto.courseId,
          classId: dto.classId,
          knowledgePointId: dto.knowledgePointId,
          sourceType: dto.sourceType,
          startDate: dto.startDate,
          endDate: dto.endDate,
          questionIds: selected.map((item) => item.questionId),
          wrongCounts: selected.map((item) => item.wrongCount),
        },
      });

      return result;
    }

  async scopedStudentIdsForWrongPaper(dto: GeneratePaperFromWrongDto, user: RequestUser) {
      const classWhere = await this.dataScope.classWhere(user, dto.classId);
      const shouldScope = Boolean(dto.classId) || !this.dataScope.isUnrestricted(user);
      if (!shouldScope) return undefined;

      const classGroups = await this.prisma.classGroup.findMany({
        where: { ...classWhere, deletedAt: null, courseId: dto.courseId },
        include: { students: { select: { studentId: true } } },
      });
      return [...new Set(classGroups.flatMap((item) => item.students.map((student) => student.studentId)))];
    }

  dateRange(dto: GeneratePaperFromWrongDto): Prisma.DateTimeFilter | undefined {
      if (!dto.startDate && !dto.endDate) return undefined;
      return {
        gte: dto.startDate ? new Date(dto.startDate) : undefined,
        lte: dto.endDate ? new Date(dto.endDate) : undefined,
      };
    }

  normalizeWrongSourceType(value?: string): WrongQuestionSourceType | undefined {
      const map: Record<string, WrongQuestionSourceType> = {
        exam: WrongQuestionSourceType.EXAM,
        practice: WrongQuestionSourceType.PRACTICE,
        manual: WrongQuestionSourceType.MANUAL,
        ai_recommendation: WrongQuestionSourceType.AI_RECOMMENDATION,
      };
      return value ? map[value] : undefined;
    }
}
