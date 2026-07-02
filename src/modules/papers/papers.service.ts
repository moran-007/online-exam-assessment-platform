import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ExamStatus, PaperStatus, PaperType, Prisma, QuestionStatus, TagType, WrongQuestionSourceType } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import {
  normalizePaperStatus,
  normalizePaperType,
  normalizeQuestionType,
  toApiEnum,
} from '../../common/utils/enum-normalizer';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuestionDto } from '../questions/dto/create-question.dto';
import { QuestionsService } from '../questions/questions.service';
import { AddPaperQuestionDto } from './dto/add-paper-question.dto';
import { AddPaperQuestionsByTagsDto } from './dto/add-paper-questions-by-tags.dto';
import { CreatePaperDto } from './dto/create-paper.dto';
import { GeneratePaperRuleDto, GeneratePaperRuleItemDto } from './dto/generate-paper-rule.dto';
import { GeneratePaperFromWrongDto } from './dto/generate-paper-from-wrong.dto';
import { ImportPaperDto } from './dto/import-paper.dto';
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
    private readonly dataScope: DataScopeService,
  ) {}

  async list(query: QueryPaperDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const now = new Date();
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
          _count: {
            select: {
              questions: true,
              exams: {
                where: {
                  deletedAt: null,
                  status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
                  startTime: { lte: now },
                  endTime: { gt: now },
                },
              },
            },
          },
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
        examUsageCount: paper._count.exams,
        examOccupied: paper._count.exams > 0,
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

  async importPaper(dto: ImportPaperDto, userId: string) {
    if (!dto.questions?.length) {
      throw new BadRequestException('导入试卷至少需要包含一道题');
    }

    const normalizedRecords = dto.questions.map((record) => this.normalizeImportedQuestionRecord(record));
    const importedCourseId = normalizedRecords.find((record) => typeof record.courseId === 'string')?.courseId;
    const courseId = dto.courseId || (typeof importedCourseId === 'string' ? importedCourseId : '');
    if (!courseId) {
      throw new BadRequestException('请选择导入试卷所属课程');
    }

    const course = await this.prisma.course.findFirst({ where: { id: courseId, deletedAt: null } });
    if (!course) {
      throw new NotFoundException('导入试卷所属课程不存在');
    }

    const resolvedQuestions: Array<{
      questionId: string;
      snapshot: Prisma.InputJsonObject;
      score: number;
      sectionTitle: string | null;
      sortOrder: number;
    }> = [];
    let reusedCount = 0;
    let createdQuestionCount = 0;

    for (const [index, record] of normalizedRecords.entries()) {
      const payload = await this.toImportedQuestionCreateDto(record, courseId);
      let questionId = dto.reuseExisting === false ? '' : await this.findDuplicateQuestionId(payload);
      if (questionId && !(await this.canReuseImportedQuestion(questionId, payload))) {
        questionId = '';
      }

      if (questionId) {
        reusedCount += 1;
      } else {
        const created = await this.questionsService.create(payload, userId);
        questionId = created.id;
        createdQuestionCount += 1;
      }

      const snapshot = await this.questionsService.buildSnapshot(this.prisma, questionId);
      resolvedQuestions.push({
        questionId,
        snapshot,
        score: Number(record.score ?? payload.defaultScore) || Number(payload.defaultScore) || 0,
        sectionTitle: String(record.sectionTitle || record.section || '').trim() || null,
        sortOrder: Number(record.sortOrder ?? record.no ?? index + 1) || index + 1,
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const paper = await tx.paper.create({
        data: {
          name: this.importedPaperName(dto.name || normalizedRecords[0]?.paperName),
          courseId,
          durationMinutes: dto.durationMinutes ?? 60,
          type: PaperType.FIXED,
          status: PaperStatus.DRAFT,
          shuffleQuestions: dto.shuffleQuestions ?? false,
          shuffleOptions: dto.shuffleOptions ?? false,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      const sectionMap = new Map<string, string>();

      for (const item of resolvedQuestions) {
        const sectionId = item.sectionTitle
          ? await this.resolveImportedSection(tx, paper.id, item.sectionTitle, sectionMap)
          : null;
        await tx.paperQuestion.create({
          data: {
            paperId: paper.id,
            sectionId,
            questionId: item.questionId,
            questionSnapshotJson: item.snapshot,
            score: item.score,
            sortOrder: item.sortOrder,
          },
        });
      }

      await this.normalizeSortOrders(tx, paper.id);
      const totalScore = await this.recalculateScore(tx, paper.id);
      return { paperId: paper.id, questionCount: resolvedQuestions.length, totalScore };
    });

    await this.audit.log({
      userId,
      action: 'paper:import',
      module: 'paper',
      targetType: 'paper',
      targetId: result.paperId,
      afterData: {
        questionCount: result.questionCount,
        reusedCount,
        createdQuestionCount,
      },
    });

    return {
      ...result,
      reusedCount,
      createdQuestionCount,
    };
  }

  async detail(id: string) {
    const now = new Date();
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
        _count: {
          select: {
            exams: {
              where: {
                deletedAt: null,
                status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
                startTime: { lte: now },
                endTime: { gt: now },
              },
            },
          },
        },
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
    const paper = await this.findEditable(id);
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

  private async scopedStudentIdsForWrongPaper(dto: GeneratePaperFromWrongDto, user: RequestUser) {
    const classWhere = await this.dataScope.classWhere(user, dto.classId);
    const shouldScope = Boolean(dto.classId) || !this.dataScope.isUnrestricted(user);
    if (!shouldScope) return undefined;

    const classGroups = await this.prisma.classGroup.findMany({
      where: { ...classWhere, deletedAt: null, courseId: dto.courseId },
      include: { students: { select: { studentId: true } } },
    });
    return [...new Set(classGroups.flatMap((item) => item.students.map((student) => student.studentId)))];
  }

  private dateRange(dto: GeneratePaperFromWrongDto): Prisma.DateTimeFilter | undefined {
    if (!dto.startDate && !dto.endDate) return undefined;
    return {
      gte: dto.startDate ? new Date(dto.startDate) : undefined,
      lte: dto.endDate ? new Date(dto.endDate) : undefined,
    };
  }

  private normalizeWrongSourceType(value?: string): WrongQuestionSourceType | undefined {
    const map: Record<string, WrongQuestionSourceType> = {
      exam: WrongQuestionSourceType.EXAM,
      practice: WrongQuestionSourceType.PRACTICE,
      manual: WrongQuestionSourceType.MANUAL,
      ai_recommendation: WrongQuestionSourceType.AI_RECOMMENDATION,
    };
    return value ? map[value] : undefined;
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

  private normalizeImportedQuestionRecord(record: Record<string, unknown>): Record<string, unknown> {
    const importPayload = this.parseJsonish(record.importPayload);
    const source =
      importPayload && typeof importPayload === 'object' && !Array.isArray(importPayload)
        ? { ...record, ...(importPayload as Record<string, unknown>) }
        : { ...record };
    const answer = this.parseJsonish(source.answerJson ?? source.answer);
    const options = this.applyImportedAnswerToOptions(
      this.normalizeImportedOptions(source.optionsJson ?? source.options),
      answer,
    );
    const type = this.normalizeImportedQuestionType(String(source.type || 'single_choice'));
    const programmingRef = this.normalizeImportedProgrammingRef(source, type);

    return {
      ...source,
      type,
      title: String(source.title || '未命名题目').trim(),
      content: String(source.contentMarkdown ?? source.content ?? '').trim(),
      difficulty: this.clampNumber(source.difficulty, 1, 5, 1),
      defaultScore: this.nonNegativeNumber(source.defaultScore ?? source.score, 2),
      score: this.nonNegativeNumber(source.score ?? source.defaultScore, 2),
      analysis: String(source.analysisMarkdown ?? source.analysis ?? '').trim(),
      options,
      answer: this.normalizeImportedAnswer(answer, String(source.type || 'single_choice')),
      scoringRule: this.toJsonObject(this.parseJsonish(source.scoringRuleJson ?? source.scoringRule)),
      tagNames: this.normalizeNameList(source.tagNames ?? source.tags),
      knowledgePointNames: this.normalizeNameList(source.knowledgePointNames ?? source.knowledgePoints),
      allowOptionShuffle: this.optionalBoolean(source.allowOptionShuffle),
      programmingRef,
      sectionTitle: String(source.sectionTitle ?? source.section ?? '').trim(),
    };
  }

  private async toImportedQuestionCreateDto(record: Record<string, unknown>, courseId: string): Promise<CreateQuestionDto> {
    const tagIds = await this.resolveQuestionTagIds(record.tagNames);
    const knowledgePointIds = await this.resolveKnowledgePointIds(courseId, record.knowledgePointNames);

    return {
      courseId,
      type: String(record.type || 'single_choice'),
      title: String(record.title || '未命名题目').trim(),
      content: String(record.content || '').trim(),
      difficulty: this.clampNumber(record.difficulty, 1, 5, 1),
      defaultScore: this.nonNegativeNumber(record.defaultScore ?? record.score, 2),
      analysis: String(record.analysis ?? '').trim(),
      allowOptionShuffle: this.optionalBoolean(record.allowOptionShuffle),
      knowledgePointIds,
      tagIds,
      options: (Array.isArray(record.options) ? record.options : []) as CreateQuestionDto['options'],
      answer: this.toJsonObject(record.answer),
      scoringRule: this.toJsonObject(record.scoringRule),
      programmingRef: record.programmingRef as CreateQuestionDto['programmingRef'],
    };
  }

  private async findDuplicateQuestionId(payload: CreateQuestionDto) {
    const checked = await this.questionsService.checkDuplicates([payload]);
    return checked.items[0]?.matches.find(
      (match) => match.source === 'question_bank' && match.reason === 'duplicate' && match.id,
    )?.id;
  }

  private async canReuseImportedQuestion(questionId: string, payload: CreateQuestionDto) {
    const importedRef = payload.type === 'programming' ? payload.programmingRef : null;
    const importedExternalId = String(importedRef?.externalProblemId ?? '').trim();
    if (!importedExternalId) return true;

    const existingRef = await this.prisma.programmingProblemRef.findUnique({ where: { questionId } });
    if (!existingRef) return false;
    return existingRef.externalProblemId === importedExternalId;
  }

  private async resolveImportedSection(
    tx: Prisma.TransactionClient,
    paperId: string,
    title: string,
    cache: Map<string, string>,
  ) {
    const normalized = title.trim();
    if (!normalized) return null;
    const cached = cache.get(normalized);
    if (cached) return cached;

    const section = await tx.paperSection.create({
      data: {
        paperId,
        title: normalized.slice(0, 128),
        sortOrder: cache.size + 1,
      },
    });
    cache.set(normalized, section.id);
    return section.id;
  }

  private async resolveQuestionTagIds(value: unknown) {
    const names = this.normalizeNameList(value);
    const ids: string[] = [];
    for (const name of names) {
      const existing = await this.prisma.tag.findFirst({
        where: { deletedAt: null, type: TagType.QUESTION, name: { equals: name, mode: 'insensitive' } },
      });
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      const created = await this.prisma.tag.create({
        data: {
          name: name.slice(0, 64),
          code: this.generatedTagCode(name),
          type: TagType.QUESTION,
        },
      });
      ids.push(created.id);
    }
    return ids;
  }

  private async resolveKnowledgePointIds(courseId: string, value: unknown) {
    const names = this.normalizeNameList(value);
    const ids: string[] = [];
    for (const name of names) {
      const existing = await this.prisma.knowledgePoint.findFirst({
        where: { courseId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
      });
      if (existing) ids.push(existing.id);
    }
    return ids;
  }

  private normalizeImportedOptions(value: unknown): NonNullable<CreateQuestionDto['options']> {
    const parsed = this.parseJsonish(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((option, index) => {
      const item = this.toSnapshotObject(option);
      return {
        optionKey: String(item.optionKey ?? item.label ?? this.optionKeyForIndex(index)).trim() || this.optionKeyForIndex(index),
        content: String(item.content ?? item.contentMarkdown ?? '').trim(),
        isCorrect: item.isCorrect === true || item.isCorrect === 'true',
        sortOrder: this.clampNumber(item.sortOrder ?? index + 1, 1, 999, index + 1),
        id: typeof item.id === 'string' ? item.id : typeof item.optionId === 'string' ? item.optionId : undefined,
      } as NonNullable<CreateQuestionDto['options']>[number] & { id?: string };
    });
  }

  private applyImportedAnswerToOptions(options: NonNullable<CreateQuestionDto['options']>, answer: unknown) {
    const answerObject = this.toJsonObject(answer);
    const correctOptionIds = Array.isArray(answerObject.correctOptionIds)
      ? new Set(answerObject.correctOptionIds.map((item) => String(item)))
      : new Set<string>();
    if (!correctOptionIds.size && typeof answer === 'string') {
      for (const key of answer.split(/[，,\s]+/).map((item) => item.trim()).filter(Boolean)) {
        correctOptionIds.add(key);
      }
    }

    return options.map((option) => ({
      ...option,
      isCorrect:
        Boolean(option.isCorrect) ||
        correctOptionIds.has(String((option as typeof option & { id?: string }).id ?? '')) ||
        correctOptionIds.has(String(option.optionKey)),
    }));
  }

  private normalizeImportedAnswer(value: unknown, type: string) {
    const parsed = this.parseJsonish(value);
    const apiType = this.normalizeImportedQuestionType(type);
    if (apiType === 'fill_blank' && typeof parsed === 'string') {
      return { blanks: [{ index: 1, answers: parsed.split(/[，,]/).map((item) => item.trim()).filter(Boolean), trimSpace: true }] };
    }
    if (['short_answer', 'programming', 'material', 'file_upload', 'scratch_project', 'arduino_project'].includes(apiType) && typeof parsed === 'string') {
      return { reference: parsed };
    }
    return this.toJsonObject(parsed);
  }

  private normalizeImportedProgrammingRef(source: Record<string, unknown>, type: string): CreateQuestionDto['programmingRef'] | null {
    if (type !== 'programming') return null;
    const explicit = this.toJsonObject(
      this.parseJsonish(source.programmingRef ?? source.hydroBinding ?? source.judgeBinding ?? source.hydro),
    );
    const explicitJudgeConfig = this.toJsonObject(this.parseJsonish(explicit.judgeConfig));
    const sourceJudgeConfig = this.toJsonObject(this.parseJsonish(source.judgeConfigJson ?? source.judgeConfig));
    const judgeConfig = { ...sourceJudgeConfig, ...explicitJudgeConfig };
    const externalProblemUrl = this.firstText(
      explicit.externalProblemUrl,
      explicit.hydroProblemUrl,
      explicit.hydroUrl,
      source.externalProblemUrl,
      source.hydroProblemUrl,
      source.hydroUrl,
      source.sourceUrl,
    );
    const externalProblemId = this.firstText(
      explicit.externalProblemId,
      explicit.hydroProblemId,
      explicit.hydroProblemName,
      explicit.hydroProblem,
      source.externalProblemId,
      source.hydroProblemId,
      source.hydroProblemName,
      source.hydroProblem,
      source.ojProblemId,
      source.problemId,
      this.problemIdFromImportedProblemUrl(externalProblemUrl),
    );
    if (!externalProblemId) return null;

    const platformBaseUrl = this.normalizeHydroBaseUrl(
      this.firstText(
        explicit.platformBaseUrl,
        judgeConfig.platformBaseUrl,
        source.platformBaseUrl,
        source.hydroBaseUrl,
        this.baseUrlFromImportedProblemUrl(externalProblemUrl),
      ),
    );
    const domainId =
      this.firstText(
        explicit.domainId,
        judgeConfig.domainId,
        source.domainId,
        source.hydroDomainId,
        this.domainIdFromImportedProblemUrl(externalProblemUrl),
      ) || 'system';
    const domainName = this.firstText(explicit.domainName, judgeConfig.domainName, source.domainName, source.hydroDomainName) || domainId;
    const languages = this.normalizeImportedLanguageList(
      explicit.languages ??
        explicit.languageConfig ??
        explicit.languageConfigJson ??
        source.languages ??
        source.hydroLanguages ??
        source.languageConfig ??
        source.languageConfigJson,
    );
    const normalizedProblemUrl =
      externalProblemUrl || this.defaultImportedHydroProblemUrl(externalProblemId, platformBaseUrl, domainId);
    const accountId = this.uuidText(explicit.accountId ?? judgeConfig.accountId ?? source.accountId);
    const accountLabel = this.firstText(explicit.accountLabel, judgeConfig.accountLabel, source.accountLabel);

    return {
      judgeProvider: this.firstText(explicit.judgeProvider, source.judgeProvider) || 'hydro',
      externalProblemId,
      externalProblemUrl: normalizedProblemUrl,
      platformBaseUrl,
      domainId,
      domainName,
      accountId: accountId || undefined,
      accountLabel: accountLabel || undefined,
      languages,
      timeLimit: this.optionalPositiveInteger(explicit.timeLimit ?? source.timeLimit),
      memoryLimit: this.optionalPositiveInteger(explicit.memoryLimit ?? source.memoryLimit),
      judgeConfig: {
        ...judgeConfig,
        platformBaseUrl,
        domainId,
        domainName,
        accountId: accountId || null,
        accountLabel,
        sourceUrl: this.firstText(judgeConfig.sourceUrl, source.sourceUrl, normalizedProblemUrl),
      },
    };
  }

  private normalizeImportedQuestionType(type: string) {
    const map: Record<string, string> = {
      单选题: 'single_choice',
      多选题: 'multiple_choice',
      判断题: 'true_false',
      填空题: 'fill_blank',
      简答题: 'short_answer',
      编程题: 'programming',
      材料题: 'material',
      文件上传题: 'file_upload',
      scratch项目题: 'scratch_project',
      arduino项目题: 'arduino_project',
    };
    const normalized = map[type.trim().toLowerCase()] ?? map[type.trim()] ?? type.trim();
    return toApiEnum(normalizeQuestionType(normalized || 'single_choice'));
  }

  private parseJsonish(value: unknown): unknown {
    if (value && typeof value === 'object') return value;
    const text = String(value ?? '').trim();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private toJsonObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private normalizeNameList(value: unknown) {
    const parsed = this.parseJsonish(value);
    if (Array.isArray(parsed)) {
      return [
        ...new Set(
          parsed
            .map((item) => (typeof item === 'string' ? item : this.toSnapshotObject(item).name))
            .map((name) => String(name ?? '').trim())
            .filter((name) => name && name !== '-' && name.toLowerCase() !== 'undefined'),
        ),
      ];
    }
    return [
      ...new Set(
        String(parsed ?? '')
          .split(/[，,;；、]/)
          .map((name) => name.trim())
          .filter((name) => name && name !== '-' && name.toLowerCase() !== 'undefined'),
      ),
    ];
  }

  private normalizeImportedLanguageList(value: unknown) {
    const parsed = this.parseJsonish(value);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.map((item) => String(item).trim()).filter(Boolean))];
    }
    const record = this.toJsonObject(parsed);
    if (Array.isArray(record.languages)) {
      return [...new Set(record.languages.map((item) => String(item).trim()).filter(Boolean))];
    }
    if (parsed && typeof parsed === 'object') return [];
    return this.normalizeNameList(parsed);
  }

  private firstText(...values: unknown[]) {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text && text !== '-' && text.toLowerCase() !== 'undefined' && text !== '[object Object]') {
        return text;
      }
    }
    return '';
  }

  private uuidText(value: unknown) {
    const text = this.firstText(value);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
      ? text
      : '';
  }

  private optionalPositiveInteger(value: unknown) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : undefined;
  }

  private normalizeHydroBaseUrl(value?: string | null) {
    const raw = String(value || process.env.HYDRO_BASE_URL || 'https://oj.example.com').trim();
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return withScheme.replace(/\/+$/, '');
  }

  private baseUrlFromImportedProblemUrl(url?: string | null) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return '';
    }
  }

  private domainIdFromImportedProblemUrl(url?: string | null) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      const match = parsed.pathname.match(/\/d\/([^/]+)\/p\//);
      return match?.[1] ? decodeURIComponent(match[1]) : 'system';
    } catch {
      const match = raw.match(/\/d\/([^/]+)\/p\//);
      return match?.[1] ? decodeURIComponent(match[1]) : '';
    }
  }

  private problemIdFromImportedProblemUrl(url?: string | null) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    const match = raw.match(/\/p\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }

  private defaultImportedHydroProblemUrl(problemId: string, baseUrl: string, domainId?: string) {
    const normalizedBaseUrl = this.normalizeHydroBaseUrl(baseUrl);
    const normalizedDomain = String(domainId || '').trim();
    const domainPrefix = normalizedDomain && normalizedDomain !== 'system' ? `/d/${encodeURIComponent(normalizedDomain)}` : '';
    return `${normalizedBaseUrl}${domainPrefix}/p/${encodeURIComponent(problemId)}`;
  }

  private optionalBoolean(value: unknown) {
    if (value === true || value === 'true' || value === '1' || value === 1) return true;
    if (value === false || value === 'false' || value === '0' || value === 0) return false;
    return undefined;
  }

  private clampNumber(value: unknown, min: number, max: number, fallback: number) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.round(numeric)));
  }

  private nonNegativeNumber(value: unknown, fallback: number) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, numeric);
  }

  private optionKeyForIndex(index: number) {
    return String.fromCharCode(65 + index);
  }

  private generatedTagCode(name: string) {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'tag';
    return `import_${base}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 64);
  }

  private importedPaperName(name?: unknown) {
    const base = String(name || '').trim() || '导入试卷';
    const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
    return `${base} 导入 ${stamp}`.slice(0, 128);
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
