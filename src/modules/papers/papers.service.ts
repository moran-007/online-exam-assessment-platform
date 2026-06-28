import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ExamStatus, PaperStatus, PaperType, Prisma, QuestionStatus } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import {
  normalizePaperStatus,
  normalizePaperType,
  normalizeQuestionType,
  toApiEnum,
} from '../../common/utils/enum-normalizer';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionsService } from '../questions/questions.service';
import { AddPaperQuestionDto } from './dto/add-paper-question.dto';
import { AddPaperQuestionsByTagsDto } from './dto/add-paper-questions-by-tags.dto';
import { CreatePaperDto } from './dto/create-paper.dto';
import { GeneratePaperRuleDto, GeneratePaperRuleItemDto } from './dto/generate-paper-rule.dto';
import { GeneratePaperFromWrongDto } from './dto/generate-paper-from-wrong.dto';
import { QueryPaperDto } from './dto/query-paper.dto';
import { UpdatePaperQuestionDto } from './dto/update-paper-question.dto';
import { UpdatePaperQuestionSnapshotDto } from './dto/update-paper-question-snapshot.dto';
import { UpdatePaperDto } from './dto/update-paper.dto';

type SnapshotObject = Record<string, unknown>;
type SnapshotOptionObject = SnapshotObject & {
  id?: string;
  optionKey?: string;
  content?: string;
  isCorrect?: boolean;
  sortOrder?: number;
};

@Injectable()
export class PapersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questionsService: QuestionsService,
    private readonly audit: AuditService,
  ) {}

  async list(query: QueryPaperDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.PaperWhereInput = {
      deletedAt: null,
      courseId: query.courseId,
      status: query.status ? normalizePaperStatus(query.status) : undefined,
      OR: query.keyword ? [{ name: { contains: query.keyword, mode: 'insensitive' } }] : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.paper.findMany({
        where,
        include: {
          course: { select: { name: true } },
          _count: { select: { questions: true } },
        },
        orderBy: this.paperOrderBy(query),
        skip,
        take,
      }),
      this.prisma.paper.count({ where }),
    ]);

    return {
      items: items.map((paper) => ({
        ...paper,
        type: toApiEnum(paper.type),
        status: toApiEnum(paper.status),
        totalScore: Number(paper.totalScore),
        courseName: paper.course.name,
        questionCount: paper._count.questions,
      })),
      page,
      pageSize,
      total,
    };
  }

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

  async detail(id: string) {
    const paper = await this.prisma.paper.findFirst({
      where: { id, deletedAt: null },
      include: {
        course: true,
        sections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            questions: { orderBy: { sortOrder: 'asc' } },
          },
        },
        questions: {
          where: { sectionId: null },
          orderBy: { sortOrder: 'asc' },
        },
        rules: true,
      },
    });

    if (!paper) {
      throw new NotFoundException('试卷不存在');
    }

    const snapshotSafety = await this.getSnapshotEditSafety(id);
    return {
      ...this.formatPaper(paper),
      canEditSnapshots: snapshotSafety.canEdit,
      snapshotEditReason: snapshotSafety.reason,
    };
  }

  async update(id: string, dto: UpdatePaperDto, userId: string) {
    const paper = await this.findExisting(id);
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
          name: this.copyDraftName(source.name),
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

  async addQuestion(id: string, dto: AddPaperQuestionDto, userId: string) {
    const paper = await this.findEditable(id);
    const question = await this.prisma.question.findFirst({
      where: { id: dto.questionId, deletedAt: null, status: QuestionStatus.PUBLISHED },
    });

    if (!question) {
      throw new BadRequestException('只能添加已发布题目');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const sectionId = await this.resolveSection(tx, id, dto.sectionId, dto.sectionTitle);
      const snapshot = await this.questionsService.buildSnapshot(tx, dto.questionId);
      const sortOrder =
        dto.sortOrder ??
        ((await tx.paperQuestion.count({ where: { paperId: id, sectionId } })) + 1);

      const paperQuestion = await tx.paperQuestion.create({
        data: {
          paperId: id,
          sectionId,
          questionId: dto.questionId,
          questionSnapshotJson: snapshot,
          score: dto.score,
          sortOrder,
        },
      });

      await this.recalculateScore(tx, id);
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
    await this.findEditable(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.paperQuestion.delete({
        where: { id: paperQuestionId },
      });
      await this.recalculateScore(tx, id);
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
    const paper = await this.findEditable(id);
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
      ? this.pickRandom(candidates, dto.count ?? candidates.length)
      : candidates.slice(0, dto.count ?? candidates.length);

    if (!chosen.length) {
      throw new BadRequestException('没有可加入的已发布题目，或这些题目已在试卷中');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const sectionId = await this.resolveSection(tx, id, undefined, dto.sectionTitle || '按标签导入');
      const startOrder = await tx.paperQuestion.count({ where: { paperId: id, sectionId } });
      const createdIds: string[] = [];

      for (const [index, question] of chosen.entries()) {
        const snapshot = await this.questionsService.buildSnapshot(tx, question.id);
        const created = await tx.paperQuestion.create({
          data: {
            paperId: id,
            sectionId,
            questionId: question.id,
            questionSnapshotJson: snapshot,
            score: dto.scoreEach ?? Number(question.defaultScore),
            sortOrder: startOrder + index + 1,
          },
        });
        createdIds.push(created.id);
      }

      await this.recalculateScore(tx, id);
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
    await this.findEditable(id);

    const exists = await this.prisma.paperQuestion.findFirst({
      where: { id: paperQuestionId, paperId: id },
    });

    if (!exists) {
      throw new NotFoundException('试卷题目不存在');
    }

    await this.prisma.$transaction(async (tx) => {
      const hasSectionPatch = dto.sectionId !== undefined || dto.sectionTitle !== undefined;
      const sectionId = hasSectionPatch
        ? await this.resolveSection(tx, id, dto.sectionId ?? undefined, dto.sectionTitle)
        : undefined;
      await tx.paperQuestion.update({
        where: { id: paperQuestionId },
        data: {
          sectionId: hasSectionPatch ? (dto.sectionId === null ? null : sectionId) : undefined,
          score: dto.score,
          sortOrder: dto.sortOrder,
        },
      });
      await this.normalizeSortOrders(tx, id);
      await this.recalculateScore(tx, id);
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

  async updateQuestionSnapshot(
    id: string,
    paperQuestionId: string,
    dto: UpdatePaperQuestionSnapshotDto,
    userId: string,
  ) {
    await this.findSnapshotEditable(id);

    const exists = await this.prisma.paperQuestion.findFirst({
      where: { id: paperQuestionId, paperId: id },
    });

    if (!exists) {
      throw new NotFoundException('试卷题目不存在');
    }

    const beforeSnapshot = this.toSnapshotObject(exists.questionSnapshotJson);
    const nextSnapshot = this.mergeQuestionSnapshot(beforeSnapshot, dto);

    await this.prisma.paperQuestion.update({
      where: { id: paperQuestionId },
      data: {
        questionSnapshotJson: nextSnapshot as Prisma.InputJsonObject,
      },
    });

    await this.audit.log({
      userId,
      action: 'paper:update-question-snapshot',
      module: 'paper',
      targetType: 'paper',
      targetId: id,
      beforeData: {
        paperQuestionId,
        title: String(beforeSnapshot.title ?? ''),
      },
      afterData: {
        paperQuestionId,
        title: String(nextSnapshot.title ?? ''),
      },
    });

    return { id: paperQuestionId };
  }

  async moveQuestion(id: string, paperQuestionId: string, direction: 'up' | 'down', userId: string) {
    await this.findEditable(id);

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
      await this.normalizeSortOrders(tx, id);
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

  async validateRules(dto: GeneratePaperRuleDto) {
    const items: Array<{
      sectionTitle: string;
      requiredCount: number;
      availableCount: number;
      valid: boolean;
    }> = [];
    const selectedIds = new Set<string>();

    for (const rule of dto.rules) {
      const available = await this.findQuestionsByRule(rule, [...selectedIds]);
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
    await this.findEditable(id);
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

        const candidates = await this.findQuestionsByRule(rule, [...selectedIds]);
        const chosen = this.pickRandom(candidates, rule.count);

        for (const [index, question] of chosen.entries()) {
          selectedIds.add(question.id);
          const snapshot = await this.questionsService.buildSnapshot(tx, question.id);
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

      const totalScore = await this.recalculateScore(tx, id);
      await tx.paper.update({
        where: { id },
        data: {
          type: normalizePaperType('rule'),
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

  async generateFromWrongFrequency(dto: GeneratePaperFromWrongDto, userId: string) {
    const course = await this.prisma.course.findFirst({
      where: { id: dto.courseId, deletedAt: null },
    });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }

    const wrongItems = await this.prisma.wrongQuestion.findMany({
      where: {
        question: {
          courseId: dto.courseId,
          deletedAt: null,
          status: QuestionStatus.PUBLISHED,
          type: dto.questionType ? normalizeQuestionType(dto.questionType) : undefined,
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
          createdBy: userId,
          updatedBy: userId,
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
        const snapshot = await this.questionsService.buildSnapshot(tx, item.questionId);
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

      const totalScore = await this.recalculateScore(tx, paper.id);
      return { paperId: paper.id, questionCount: selected.length, totalScore };
    });

    await this.audit.log({
      userId,
      action: 'paper:generate-from-wrong-frequency',
      module: 'paper',
      targetType: 'paper',
      targetId: result.paperId,
      afterData: {
        courseId: dto.courseId,
        questionIds: selected.map((item) => item.questionId),
        wrongCounts: selected.map((item) => item.wrongCount),
      },
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

  async preview(id: string) {
    return this.detail(id);
  }

  private async findEditable(id: string) {
    const paper = await this.findExisting(id);

    if (paper.status !== PaperStatus.DRAFT) {
      throw new BadRequestException('只有草稿试卷可以编辑');
    }

    return paper;
  }

  private async findSnapshotEditable(id: string) {
    const paper = await this.findExisting(id);
    const safety = await this.getSnapshotEditSafety(id);

    if (!safety.canEdit) {
      throw new BadRequestException(safety.reason);
    }

    return paper;
  }

  private async findExisting(id: string) {
    const paper = await this.prisma.paper.findFirst({
      where: { id, deletedAt: null },
    });

    if (!paper) {
      throw new NotFoundException('试卷不存在');
    }

    return paper;
  }

  private async getSnapshotEditSafety(paperId: string) {
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

  private mergeQuestionSnapshot(snapshot: SnapshotObject, dto: UpdatePaperQuestionSnapshotDto) {
    const hasPatch =
      dto.title !== undefined ||
      dto.content !== undefined ||
      dto.analysis !== undefined ||
      dto.options !== undefined;

    if (!hasPatch) {
      throw new BadRequestException('没有可更新的显示内容');
    }

    const next: SnapshotObject = { ...snapshot };

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) {
        throw new BadRequestException('题目标题不能为空');
      }
      next.title = title;
    }

    if (dto.content !== undefined) {
      const content = dto.content.trim();
      if (!content) {
        throw new BadRequestException('题干内容不能为空');
      }
      next.content = content;
    }

    if (dto.analysis !== undefined) {
      next.analysis = dto.analysis.trim();
    }

    if (dto.options !== undefined) {
      next.options = this.mergeSnapshotOptions(snapshot.options, dto.options);
    }

    return next;
  }

  private mergeSnapshotOptions(
    currentOptionsValue: unknown,
    optionPatches: NonNullable<UpdatePaperQuestionSnapshotDto['options']>,
  ) {
    if (!Array.isArray(currentOptionsValue)) {
      throw new BadRequestException('当前题型没有可编辑的选项');
    }

    if (optionPatches.length !== currentOptionsValue.length) {
      throw new BadRequestException('试卷显示编辑只允许修改现有选项，不能增删选项');
    }

    const currentOptions = currentOptionsValue.map((option) =>
      this.toSnapshotObject(option),
    ) as SnapshotOptionObject[];
    const currentById = new Map(
      currentOptions
        .filter((option) => typeof option.id === 'string' && option.id)
        .map((option) => [option.id as string, option]),
    );
    const usedKeys = new Set<string>();

    const nextOptions = optionPatches.map((patch, index) => {
      const current = patch.id ? currentById.get(patch.id) : currentOptions[index];
      if (!current) {
        throw new BadRequestException(`第 ${index + 1} 个选项不存在，无法更新`);
      }

      const key = current.id ?? `index-${index}`;
      if (usedKeys.has(key)) {
        throw new BadRequestException('选项不能重复提交');
      }
      usedKeys.add(key);

      const content = patch.content.trim();
      if (!content) {
        throw new BadRequestException(`第 ${index + 1} 个选项内容不能为空`);
      }

      const optionKey = patch.optionKey?.trim() || current.optionKey || String.fromCharCode(65 + index);

      return {
        ...current,
        optionKey,
        content,
        sortOrder: patch.sortOrder ?? index + 1,
      };
    });

    if (usedKeys.size !== currentOptions.length) {
      throw new BadRequestException('选项提交不完整，无法更新');
    }

    return nextOptions;
  }

  private toSnapshotObject(value: unknown): SnapshotObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return { ...(value as SnapshotObject) };
  }

  private async resolveSection(
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

  private async recalculateScore(tx: Prisma.TransactionClient, paperId: string) {
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

  private async normalizeSortOrders(tx: Prisma.TransactionClient, paperId: string) {
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

  private async findQuestionsByRule(rule: GeneratePaperRuleItemDto, excludeIds: string[]) {
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

  private pickRandom<T>(items: T[], count: number) {
    return [...items].sort(() => Math.random() - 0.5).slice(0, count);
  }

  private paperOrderBy(query: QueryPaperDto): Prisma.PaperOrderByWithRelationInput[] {
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

  private copyDraftName(name: string) {
    const suffix = ` 副本 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    return `${name}${suffix}`.slice(0, 128);
  }

  private formatPaper(paper: Prisma.PaperGetPayload<{
    include: {
      course: true;
      sections: { include: { questions: true } };
      questions: true;
      rules: true;
    };
  }>) {
    return {
      ...paper,
      type: toApiEnum(paper.type),
      status: toApiEnum(paper.status),
      totalScore: Number(paper.totalScore),
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
