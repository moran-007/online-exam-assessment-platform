import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExamStatus, Prisma, QuestionStatus, QuestionType } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import {
  normalizeQuestionStatus,
  normalizeQuestionType,
  toApiEnum,
} from '../../common/utils/enum-normalizer';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CheckQuestionAnswerDto } from './dto/check-question-answer.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { QueryQuestionDto } from './dto/query-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';

type QuestionAnswerJson = {
  correctOptionIds?: string[];
  blanks?: Array<{
    index: number;
    answers: string[];
    ignoreCase?: boolean;
    trimSpace?: boolean;
    score?: number;
  }>;
  reference?: string;
  [key: string]: unknown;
};

type ComparableQuestion = {
  index: number;
  id?: string;
  courseId: string;
  courseName?: string;
  title: string;
  type: string;
  status?: string;
  titleKey: string;
  contentKey: string;
  optionContentKey: string;
  fullKey: string;
};

@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: QueryQuestionDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.QuestionWhereInput = {
      deletedAt: null,
      courseId: query.courseId,
      type: query.type ? normalizeQuestionType(query.type) : undefined,
      status: query.status ? normalizeQuestionStatus(query.status) : undefined,
      difficulty: query.difficulty,
      tags: query.tagId ? { some: { tagId: query.tagId } } : undefined,
      knowledgePoints: query.knowledgePointId ? { some: { knowledgePointId: query.knowledgePointId } } : undefined,
      OR: query.keyword
        ? [
            { title: { contains: query.keyword, mode: 'insensitive' } },
            { content: { contains: query.keyword, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.question.findMany({
        where,
        include: {
          course: { select: { name: true } },
          knowledgePoints: { include: { knowledgePoint: true } },
          tags: { include: { tag: true } },
        },
        orderBy: this.questionOrderBy(query),
        skip,
        take,
      }),
      this.prisma.question.count({ where }),
    ]);
    const occupationMap = await this.findOccupationMap(items.map((item) => item.id));

    return {
      items: items.map((item) => {
        const occupationExams = occupationMap.get(item.id) ?? [];
        return {
          id: item.id,
          courseId: item.courseId,
          courseName: item.course.name,
          title: item.title,
          type: toApiEnum(item.type),
          status: toApiEnum(item.status),
          difficulty: item.difficulty,
          defaultScore: Number(item.defaultScore),
          knowledgePoints: item.knowledgePoints.map((relation) => relation.knowledgePoint),
          tags: item.tags.map((relation) => relation.tag),
          occupiedByExam: occupationExams.length > 0,
          occupationLabels: occupationExams.map((exam) => `${exam.name}（${toApiEnum(exam.status)}）`),
          occupationExams: occupationExams.map((exam) => ({
            id: exam.id,
            name: exam.name,
            status: toApiEnum(exam.status),
          })),
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  async publicList(query: QueryQuestionDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.QuestionWhereInput = {
      deletedAt: null,
      status: QuestionStatus.PUBLISHED,
      courseId: query.courseId,
      type: query.type ? normalizeQuestionType(query.type) : undefined,
      difficulty: query.difficulty,
      tags: query.tagId ? { some: { tagId: query.tagId } } : undefined,
      knowledgePoints: query.knowledgePointId ? { some: { knowledgePointId: query.knowledgePointId } } : undefined,
      paperQuestions: {
        none: {
          paper: {
            exams: {
              some: {
                status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
              },
            },
          },
        },
      },
      OR: query.keyword
        ? [
            { title: { contains: query.keyword, mode: 'insensitive' } },
            { content: { contains: query.keyword, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.question.findMany({
        where,
        include: {
          course: { select: { name: true } },
          knowledgePoints: { include: { knowledgePoint: true } },
          tags: { include: { tag: true } },
        },
        orderBy: this.questionOrderBy(query),
        skip,
        take,
      }),
      this.prisma.question.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        type: toApiEnum(item.type),
        difficulty: item.difficulty,
        defaultScore: Number(item.defaultScore),
        courseName: item.course.name,
        knowledgePoints: item.knowledgePoints.map((relation) => relation.knowledgePoint),
        tags: item.tags.map((relation) => relation.tag),
      })),
      page,
      pageSize,
      total,
    };
  }

  async publicDetail(id: string) {
    const question = await this.prisma.question.findFirst({
      where: {
        id,
        deletedAt: null,
        status: QuestionStatus.PUBLISHED,
        paperQuestions: {
          none: {
            paper: {
              exams: {
                some: {
                  status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
                },
              },
            },
          },
        },
      },
      include: {
        course: true,
        options: { orderBy: { sortOrder: 'asc' } },
        tags: { include: { tag: true } },
      },
    });

    if (!question) {
      throw new NotFoundException('题目不存在或暂不可见');
    }

    return {
      id: question.id,
      title: question.title,
      content: question.content,
      type: toApiEnum(question.type),
      difficulty: question.difficulty,
      defaultScore: Number(question.defaultScore),
      courseName: question.course.name,
      tags: question.tags.map((relation) => relation.tag),
      options: question.options.map((option) => ({
        optionId: option.id,
        label: option.optionKey,
        content: option.content,
      })),
    };
  }

  async detail(id: string) {
    const question = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
      include: {
        course: true,
        options: { orderBy: { sortOrder: 'asc' } },
        answer: true,
        programmingRef: true,
        knowledgePoints: { include: { knowledgePoint: true } },
        tags: { include: { tag: true } },
        versions: { orderBy: { version: 'desc' }, take: 10 },
      },
    });

    if (!question) {
      throw new NotFoundException('题目不存在');
    }

    return {
      ...question,
      type: toApiEnum(question.type),
      status: toApiEnum(question.status),
      programmingRef: question.programmingRef ? this.formatProgrammingRef(question.programmingRef) : null,
      knowledgePoints: question.knowledgePoints.map((relation) => relation.knowledgePoint),
      tags: question.tags.map((relation) => relation.tag),
    };
  }

  async checkDuplicates(questions: unknown[] = []) {
    const incoming = questions.map((question, index) => this.toComparableQuestion(this.normalizeCheckQuestion(question), index));
    if (!incoming.length) {
      return { items: [], total: 0, duplicateCount: 0, conflictCount: 0, similarCount: 0 };
    }

    const courseIds = [...new Set(incoming.map((item) => item.courseId).filter(Boolean))];
    const titles = [...new Set(incoming.map((item) => item.title).filter(Boolean))];
    const candidates = courseIds.length && titles.length
      ? await this.prisma.question.findMany({
          where: {
            deletedAt: null,
            courseId: { in: courseIds },
            OR: titles.map((title) => ({ title: { equals: title, mode: 'insensitive' } })),
          },
          include: {
            course: { select: { name: true } },
            options: { orderBy: { sortOrder: 'asc' } },
            answer: true,
          },
        })
      : [];
    const existing = candidates.map((question, index) => this.toComparableQuestion(question, index, true));

    const items = incoming.map((item, index) => {
      const matches: Array<{
        source: 'batch' | 'question_bank';
        id?: string;
        title: string;
        type: string;
        status?: string;
        courseName?: string;
        reason: 'duplicate' | 'conflict' | 'similar';
        message: string;
      }> = [];

      for (const previous of incoming.slice(0, index)) {
        if (previous.courseId !== item.courseId || previous.type !== item.type) continue;
        if (previous.fullKey === item.fullKey) {
          matches.push({
            source: 'batch',
            title: previous.title,
            type: previous.type,
            reason: 'duplicate',
            message: `与本次导入第 ${previous.index + 1} 题完全重复`,
          });
          continue;
        }
        if (previous.titleKey === item.titleKey) {
          matches.push({
            source: 'batch',
            title: previous.title,
            type: previous.type,
            reason: 'conflict',
            message: `与本次导入第 ${previous.index + 1} 题标题相同，但题干、选项或答案不一致`,
          });
          continue;
        }
        if (previous.contentKey && previous.contentKey === item.contentKey && previous.optionContentKey === item.optionContentKey) {
          matches.push({
            source: 'batch',
            title: previous.title,
            type: previous.type,
            reason: 'similar',
            message: `与本次导入第 ${previous.index + 1} 题题干和选项相似`,
          });
        }
      }

      for (const candidate of existing) {
        if (candidate.courseId !== item.courseId || candidate.type !== item.type) continue;
        if (candidate.titleKey === item.titleKey) {
          matches.push({
            source: 'question_bank',
            id: candidate.id,
            title: candidate.title,
            type: candidate.type,
            status: candidate.status,
            courseName: candidate.courseName,
            reason: candidate.fullKey === item.fullKey ? 'duplicate' : 'conflict',
            message:
              candidate.fullKey === item.fullKey
                ? '题库中已有完全相同题目'
                : '题库中已有同标题题目，但题干、选项或答案不一致',
          });
          continue;
        }
        if (candidate.contentKey && candidate.contentKey === item.contentKey && candidate.optionContentKey === item.optionContentKey) {
          matches.push({
            source: 'question_bank',
            id: candidate.id,
            title: candidate.title,
            type: candidate.type,
            status: candidate.status,
            courseName: candidate.courseName,
            reason: 'similar',
            message: '题库中存在题干和选项相似的题目',
          });
        }
      }

      const hasConflict = matches.some((match) => match.reason === 'conflict');
      const hasDuplicate = matches.some((match) => match.reason === 'duplicate');
      const hasSimilar = matches.some((match) => match.reason === 'similar');
      const status = hasConflict ? 'conflict' : hasDuplicate ? 'duplicate' : hasSimilar ? 'similar' : 'ok';

      return {
        index,
        title: item.title,
        type: item.type,
        status,
        severity: hasConflict ? 'danger' : hasDuplicate || hasSimilar ? 'warning' : 'none',
        message:
          status === 'ok'
            ? '未发现重复或冲突'
            : matches
                .slice(0, 3)
                .map((match) => match.message)
                .join('；'),
        matches,
      };
    });

    return {
      items,
      total: items.length,
      duplicateCount: items.filter((item) => item.status === 'duplicate').length,
      conflictCount: items.filter((item) => item.status === 'conflict').length,
      similarCount: items.filter((item) => item.status === 'similar').length,
    };
  }

  async checkAnswer(id: string, dto: CheckQuestionAnswerDto, userId: string) {
    const question = await this.prisma.question.findFirst({
      where: { id, deletedAt: null, status: QuestionStatus.PUBLISHED },
      include: {
        options: { orderBy: { sortOrder: 'asc' } },
        answer: true,
      },
    });

    if (!question) {
      throw new NotFoundException('题目不存在或未发布');
    }

    const answerJson = (question.answer?.answerJson ?? {}) as QuestionAnswerJson;
    const grading = this.gradeStandaloneQuestion(question.type, Number(question.defaultScore), answerJson, dto);
    const answerSummary = this.buildAnswerSummary(question.type, answerJson, dto, question.options);

    await this.audit.log({
      userId,
      action: 'question:check-answer',
      module: 'question',
      targetType: 'question',
      targetId: id,
      afterData: { isCorrect: grading.isCorrect, score: grading.score },
    });

    return {
      ...grading,
      totalScore: Number(question.defaultScore),
      questionType: toApiEnum(question.type),
      studentAnswer: dto,
      studentAnswerText: answerSummary.studentAnswerText,
      correctAnswer: answerJson,
      correctAnswerText: answerSummary.correctAnswerText || answerSummary.referenceAnswerText,
      referenceAnswerText: answerSummary.referenceAnswerText,
      answerExplanation: answerSummary.answerExplanation,
      options: question.options.map((option) => ({
        optionId: option.id,
        label: option.optionKey,
        content: option.content,
        isCorrect: option.isCorrect,
      })),
      analysis: question.analysis,
    };
  }

  async deleteImpact(id: string) {
    const question = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
      include: {
        course: { select: { name: true } },
        options: { orderBy: { sortOrder: 'asc' } },
        answer: true,
      },
    });

    if (!question) {
      throw new NotFoundException('题目不存在');
    }

    const resourceReferences = this.extractResourceReferences(
      question.content,
      question.analysis,
      question.options.map((option) => option.content),
      question.answer?.answerJson,
      question.answer?.scoringRuleJson,
    );
    const resourceAssets = resourceReferences.length
      ? await this.prisma.fileAsset.findMany({
          where: {
            deletedAt: null,
            OR: [
              { url: { in: resourceReferences } },
              { objectKey: { in: resourceReferences.map((url) => url.replace(/^\/uploads\//, '')) } },
            ],
          },
        })
      : [];
    const resourceStats = await this.resourceReferenceStats(resourceReferences);

    const [paperQuestionCount, paperCount, examCount, activeExamCount, paperInstanceCount, answerRecordCount, wrongQuestionCount, judgeSubmissionCount, versionCount] =
      await this.prisma.$transaction([
        this.prisma.paperQuestion.count({ where: { questionId: id } }),
        this.prisma.paper.count({
          where: {
            deletedAt: null,
            questions: { some: { questionId: id } },
          },
        }),
        this.prisma.exam.count({
          where: {
            deletedAt: null,
            paper: { questions: { some: { questionId: id } } },
          },
        }),
        this.prisma.exam.count({
          where: {
            deletedAt: null,
            status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
            paper: { questions: { some: { questionId: id } } },
          },
        }),
        this.prisma.paperInstance.count({
          where: {
            exam: { deletedAt: null, paper: { questions: { some: { questionId: id } } } },
          },
        }),
        this.prisma.answerRecord.count({ where: { questionId: id } }),
        this.prisma.wrongQuestion.count({ where: { questionId: id } }),
        this.prisma.judgeSubmission.count({ where: { questionId: id } }),
        this.prisma.questionVersion.count({ where: { questionId: id } }),
      ]);

    const risks: string[] = [];
    if (paperQuestionCount > 0) risks.push(`已被 ${paperQuestionCount} 个试卷题目引用，试卷快照不会自动同步`);
    if (activeExamCount > 0) risks.push(`有 ${activeExamCount} 场已安排或进行中的考试引用该题`);
    if (answerRecordCount > 0) risks.push(`已有 ${answerRecordCount} 条答题记录，删除后历史成绩仍保留快照`);
    if (wrongQuestionCount > 0) risks.push(`已有 ${wrongQuestionCount} 条错题记录`);
    if (resourceReferences.length > 0) risks.push(`题干/选项/解析引用 ${resourceReferences.length} 个资源，删除题目不会删除资源文件`);

    return {
      question: {
        id: question.id,
        title: question.title,
        courseName: question.course.name,
        status: toApiEnum(question.status),
      },
      references: {
        paperQuestionCount,
        paperCount,
        examCount,
        activeExamCount,
        paperInstanceCount,
        answerRecordCount,
        wrongQuestionCount,
        judgeSubmissionCount,
        versionCount,
      },
      resources: resourceReferences.map((url) => {
        const asset = resourceAssets.find((item) => item.url === url || `/uploads/${item.objectKey}` === url || item.objectKey === url.replace(/^\/uploads\//, ''));
        const stats = resourceStats.get(url) ?? { count: 0, locations: [] };
        return {
          url,
          kind: this.resourceKind(url, asset?.mimeType),
          fileName: asset?.fileName ?? url.split('/').pop() ?? url,
          fileSize: asset ? Number(asset.fileSize) : null,
          managed: Boolean(asset),
          referenceCount: stats.count,
          locations: stats.locations.slice(0, 8),
        };
      }),
      risks,
      canDelete: true,
    };
  }

  async create(dto: CreateQuestionDto, userId: string) {
    const type = normalizeQuestionType(dto.type);
    this.validateQuestionInput(type, dto);

    const question = await this.prisma.$transaction(async (tx) => {
      const created = await tx.question.create({
        data: {
          courseId: dto.courseId,
          type,
          title: dto.title,
          content: dto.content,
          difficulty: dto.difficulty,
          defaultScore: dto.defaultScore,
          analysis: dto.analysis,
          allowOptionShuffle: dto.allowOptionShuffle,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      const options = await this.replaceOptions(tx, created.id, dto.options);
      const answerJson = this.resolveAnswerJson(type, dto, options);

      await tx.questionAnswer.create({
        data: {
          questionId: created.id,
          answerJson,
          scoringRuleJson: (dto.scoringRule ?? { mode: 'strict' }) as Prisma.InputJsonObject,
        },
      });
      await this.replaceRelations(tx, created.id, dto.knowledgePointIds, dto.tagIds);
      await this.upsertProgrammingRef(tx, created.id, type, dto.programmingRef);

      const snapshot = await this.buildSnapshot(tx, created.id);
      await tx.questionVersion.create({
        data: {
          questionId: created.id,
          version: 1,
          snapshotJson: snapshot,
          createdBy: userId,
        },
      });

      return created;
    });

    await this.audit.log({
      userId,
      action: 'question:create',
      module: 'question',
      targetType: 'question',
      targetId: question.id,
      afterData: { title: question.title, type: question.type },
    });

    return { id: question.id };
  }

  async update(id: string, dto: UpdateQuestionDto, userId: string) {
    const current = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
    });

    if (!current) {
      throw new NotFoundException('题目不存在');
    }

    const type = dto.type ? normalizeQuestionType(dto.type) : current.type;
    const status = dto.status ? normalizeQuestionStatus(dto.status) : undefined;
    const hasOptionsPatch = dto.options !== undefined;
    const hasAnswerPatch = dto.answer !== undefined;
    const hasScoringRulePatch = dto.scoringRule !== undefined;
    const hasKnowledgePatch = dto.knowledgePointIds !== undefined;
    const hasTagPatch = dto.tagIds !== undefined;
    const hasProgrammingRefPatch = dto.programmingRef !== undefined || type !== QuestionType.PROGRAMMING;

    if (hasOptionsPatch || dto.type) {
      const existingOptions = dto.options
        ? []
        : await this.prisma.questionOption.findMany({
            where: { questionId: id },
            orderBy: { sortOrder: 'asc' },
          });
      this.validateQuestionInput(type, {
        ...dto,
        type,
        title: dto.title ?? current.title,
        content: dto.content ?? current.content,
        difficulty: dto.difficulty ?? current.difficulty,
        defaultScore: Number(dto.defaultScore ?? current.defaultScore),
        options:
          (hasOptionsPatch ? dto.options : undefined) ??
          existingOptions.map((option) => ({
            optionKey: option.optionKey,
            content: option.content,
            isCorrect: option.isCorrect,
            sortOrder: option.sortOrder,
          })),
      } as CreateQuestionDto);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const question = await tx.question.update({
        where: { id },
        data: {
          courseId: dto.courseId,
          type,
          title: dto.title,
          content: dto.content,
          difficulty: dto.difficulty,
          defaultScore: dto.defaultScore,
          analysis: dto.analysis,
          allowOptionShuffle: dto.allowOptionShuffle,
          status,
          version: { increment: 1 },
          updatedBy: userId,
        },
      });

      let options:
        | Array<{
            id: string;
            optionKey: string;
            content: string;
            isCorrect: boolean;
            sortOrder: number;
          }>
        | undefined;

      if (hasOptionsPatch) {
        options = await this.replaceOptions(tx, id, dto.options);
      }

      if (hasAnswerPatch || hasOptionsPatch || hasScoringRulePatch) {
        const currentOptions =
          options ??
          (await tx.questionOption.findMany({
            where: { questionId: id },
            orderBy: { sortOrder: 'asc' },
          }));
        await tx.questionAnswer.upsert({
          where: { questionId: id },
          update: {
            answerJson: this.resolveAnswerJson(type, dto as CreateQuestionDto, currentOptions),
            scoringRuleJson: dto.scoringRule as Prisma.InputJsonObject | undefined,
          },
          create: {
            questionId: id,
            answerJson: this.resolveAnswerJson(type, dto as CreateQuestionDto, currentOptions),
            scoringRuleJson: (dto.scoringRule ?? { mode: 'strict' }) as Prisma.InputJsonObject,
          },
        });
      }

      if (hasKnowledgePatch || hasTagPatch) {
        await this.replaceRelations(tx, id, dto.knowledgePointIds, dto.tagIds);
      }

      if (hasProgrammingRefPatch) {
        await this.upsertProgrammingRef(tx, id, type, dto.programmingRef);
      }

      const snapshot = await this.buildSnapshot(tx, id);
      await tx.questionVersion.create({
        data: {
          questionId: id,
          version: question.version,
          snapshotJson: snapshot,
          createdBy: userId,
        },
      });

      return question;
    });

    await this.audit.log({
      userId,
      action: 'question:update',
      module: 'question',
      targetType: 'question',
      targetId: id,
      beforeData: { title: current.title, status: current.status },
      afterData: { title: updated.title, status: updated.status },
    });

    return { id };
  }

  async publish(id: string, userId: string) {
    const question = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
      include: { answer: true },
    });

    if (!question) {
      throw new NotFoundException('题目不存在');
    }

    if (!question.answer) {
      throw new BadRequestException('题目缺少答案，不能发布');
    }

    const updated = await this.prisma.question.update({
      where: { id },
      data: {
        status: QuestionStatus.PUBLISHED,
        reviewedBy: userId,
        reviewedAt: new Date(),
      },
    });

    await this.audit.log({
      userId,
      action: 'question:publish',
      module: 'question',
      targetType: 'question',
      targetId: id,
      afterData: { status: updated.status },
    });

    return { id };
  }

  async remove(id: string, userId: string) {
    const exists = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
    });

    if (!exists) {
      throw new NotFoundException('题目不存在');
    }

    await this.prisma.question.update({
      where: { id },
      data: {
        status: QuestionStatus.ARCHIVED,
        deletedAt: new Date(),
        updatedBy: userId,
      },
    });

    await this.audit.log({
      userId,
      action: 'question:delete',
      module: 'question',
      targetType: 'question',
      targetId: id,
    });

    return true;
  }

  async bulkDelete(ids: string[], userId: string) {
    const uniqueIds = [...new Set(ids)];
    const failed: Array<{ id: string; message: string }> = [];
    let successCount = 0;

    for (const id of uniqueIds) {
      try {
        await this.remove(id, userId);
        successCount += 1;
      } catch (error) {
        failed.push({ id, message: error instanceof Error ? error.message : '删除失败' });
      }
    }

    await this.audit.log({
      userId,
      action: 'question:bulk-delete',
      module: 'question',
      targetType: 'question',
      targetId: uniqueIds[0],
      afterData: { ids: uniqueIds, successCount, failedCount: failed.length },
    });

    return {
      successCount,
      failed,
    };
  }

  async bulkUpdateStatus(ids: string[], status: string, userId: string) {
    const uniqueIds = [...new Set(ids)];
    const targetStatus = normalizeQuestionStatus(status);
    if (targetStatus === QuestionStatus.ARCHIVED) {
      throw new BadRequestException('归档请使用删除操作');
    }

    const failed: Array<{ id: string; message: string }> = [];
    let successCount = 0;

    for (const id of uniqueIds) {
      try {
        if (targetStatus === QuestionStatus.PUBLISHED) {
          await this.publish(id, userId);
        } else {
          await this.update(id, { status } as UpdateQuestionDto, userId);
        }
        successCount += 1;
      } catch (error) {
        failed.push({ id, message: error instanceof Error ? error.message : '状态更新失败' });
      }
    }

    await this.audit.log({
      userId,
      action: 'question:bulk-status',
      module: 'question',
      targetType: 'question',
      targetId: uniqueIds[0],
      afterData: { ids: uniqueIds, status: targetStatus, successCount, failedCount: failed.length },
    });

    return {
      status: toApiEnum(targetStatus),
      successCount,
      failed,
    };
  }

  async buildSnapshot(
    tx: Prisma.TransactionClient | PrismaService,
    questionId: string,
  ): Promise<Prisma.InputJsonObject> {
    const question = await tx.question.findUniqueOrThrow({
      where: { id: questionId },
      include: {
        course: true,
        options: { orderBy: { sortOrder: 'asc' } },
        answer: true,
        programmingRef: true,
        knowledgePoints: { include: { knowledgePoint: true } },
        tags: { include: { tag: true } },
      },
    });

    return {
      id: question.id,
      courseId: question.courseId,
      courseName: question.course.name,
      type: toApiEnum(question.type),
      title: question.title,
      content: question.content,
      difficulty: question.difficulty,
      defaultScore: Number(question.defaultScore),
      analysis: question.analysis,
      allowOptionShuffle: question.allowOptionShuffle,
      version: question.version,
      options: question.options.map((option) => ({
        id: option.id,
        optionKey: option.optionKey,
        content: option.content,
        isCorrect: option.isCorrect,
        sortOrder: option.sortOrder,
      })),
      answer: question.answer?.answerJson ?? null,
      scoringRule: question.answer?.scoringRuleJson ?? null,
      programmingRef: question.programmingRef
        ? this.formatProgrammingRef(question.programmingRef)
        : null,
      knowledgePoints: question.knowledgePoints.map((relation) => ({
        id: relation.knowledgePoint.id,
        name: relation.knowledgePoint.name,
      })),
      tags: question.tags.map((relation) => ({
        id: relation.tag.id,
        name: relation.tag.name,
      })),
    };
  }

  private programmingLanguages(value: Prisma.JsonValue | null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const languages = (value as Record<string, unknown>).languages;
    return Array.isArray(languages) ? languages.map(String).filter(Boolean) : [];
  }

  private formatProgrammingRef(ref: {
    judgeProvider: string;
    externalProblemId: string;
    externalProblemUrl: string | null;
    languageConfigJson: Prisma.JsonValue | null;
    timeLimit: number | null;
    memoryLimit: number | null;
    judgeConfigJson: Prisma.JsonValue | null;
  }) {
    const judgeConfig = this.toPlainRecord(ref.judgeConfigJson);
    return {
      judgeProvider: ref.judgeProvider,
      externalProblemId: ref.externalProblemId,
      externalProblemUrl: ref.externalProblemUrl,
      platformBaseUrl: String(judgeConfig.platformBaseUrl ?? this.baseUrlFromProblemUrl(ref.externalProblemUrl)).trim(),
      domainId: String(judgeConfig.domainId ?? this.domainIdFromProblemUrl(ref.externalProblemUrl) ?? 'system').trim(),
      domainName: String(judgeConfig.domainName ?? judgeConfig.domainId ?? this.domainIdFromProblemUrl(ref.externalProblemUrl) ?? 'system').trim(),
      accountId: judgeConfig.accountId ? String(judgeConfig.accountId) : null,
      accountLabel: judgeConfig.accountLabel ? String(judgeConfig.accountLabel) : null,
      languages: this.programmingLanguages(ref.languageConfigJson),
      timeLimit: ref.timeLimit,
      memoryLimit: ref.memoryLimit,
      judgeConfig: ref.judgeConfigJson,
    };
  }

  private async upsertProgrammingRef(
    tx: Prisma.TransactionClient,
    questionId: string,
    type: QuestionType,
    ref: CreateQuestionDto['programmingRef'] | undefined,
  ) {
    if (type !== QuestionType.PROGRAMMING) {
      await tx.programmingProblemRef.deleteMany({ where: { questionId } });
      return;
    }

    if (ref === undefined) return;
    const externalProblemId = String(ref?.externalProblemId ?? '').trim();
    if (!externalProblemId) {
      await tx.programmingProblemRef.deleteMany({ where: { questionId } });
      return;
    }

    const provider = String(ref?.judgeProvider || 'hydro').trim().toLowerCase();
    const platformBaseUrl = this.normalizeHydroBaseUrl(ref?.platformBaseUrl || this.baseUrlFromProblemUrl(ref?.externalProblemUrl));
    const domainId = String(ref?.domainId || this.domainIdFromProblemUrl(ref?.externalProblemUrl) || 'system').trim() || 'system';
    const domainName = String(ref?.domainName || domainId).trim();
    const externalProblemUrl = ref?.externalProblemUrl?.trim() || this.defaultHydroProblemUrl(externalProblemId, platformBaseUrl, domainId);
    const languageConfig = {
      languages: Array.isArray(ref?.languages)
        ? ref.languages.map((item) => String(item).trim()).filter(Boolean)
        : [],
    };
    const judgeConfig = {
      ...(ref?.judgeConfig ?? {}),
      platformBaseUrl,
      domainId,
      domainName,
      accountId: ref?.accountId ?? this.toPlainRecord(ref?.judgeConfig).accountId ?? null,
      accountLabel: ref?.accountLabel?.trim() || String(this.toPlainRecord(ref?.judgeConfig).accountLabel ?? ''),
      submitPageUrl:
        String(this.toPlainRecord(ref?.judgeConfig).submitPageUrl ?? '').trim() ||
        `${externalProblemUrl.replace(/\/+$/, '')}/submit`,
    };

    await tx.programmingProblemRef.upsert({
      where: { questionId },
      update: {
        judgeProvider: provider,
        externalProblemId,
        externalProblemUrl,
        languageConfigJson: languageConfig as Prisma.InputJsonObject,
        timeLimit: ref?.timeLimit,
        memoryLimit: ref?.memoryLimit,
        judgeConfigJson: judgeConfig as Prisma.InputJsonObject,
      },
      create: {
        questionId,
        judgeProvider: provider,
        externalProblemId,
        externalProblemUrl,
        languageConfigJson: languageConfig as Prisma.InputJsonObject,
        timeLimit: ref?.timeLimit,
        memoryLimit: ref?.memoryLimit,
        judgeConfigJson: judgeConfig as Prisma.InputJsonObject,
      },
    });
  }

  private defaultHydroProblemUrl(problemId: string, baseUrl = process.env.HYDRO_BASE_URL || 'https://oj.example.com', domainId?: string) {
    const normalizedBaseUrl = this.normalizeHydroBaseUrl(baseUrl);
    const normalizedDomain = String(domainId || '').trim();
    const domainPrefix = normalizedDomain && normalizedDomain !== 'system' ? `/d/${encodeURIComponent(normalizedDomain)}` : '';
    return `${normalizedBaseUrl}${domainPrefix}/p/${encodeURIComponent(problemId)}`;
  }

  private normalizeHydroBaseUrl(value?: string | null) {
    const raw = String(value || process.env.HYDRO_BASE_URL || 'https://oj.example.com').trim();
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return withScheme.replace(/\/+$/, '');
  }

  private baseUrlFromProblemUrl(url?: string | null) {
    const raw = String(url || '').trim();
    if (!raw) return process.env.HYDRO_BASE_URL || 'https://oj.example.com';
    try {
      const parsed = new URL(raw);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return process.env.HYDRO_BASE_URL || 'https://oj.example.com';
    }
  }

  private domainIdFromProblemUrl(url?: string | null) {
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

  private normalizeCheckQuestion(value: unknown): CreateQuestionDto {
    const record = this.toPlainRecord(this.parseJsonish(value));
    const importPayload = this.toPlainRecord(this.parseJsonish(record.importPayload));
    const source = Object.keys(importPayload).length ? { ...record, ...importPayload } : record;
    const options = this.normalizeCheckOptions(source.optionsJson ?? source.options);

    return {
      courseId: String(source.courseId ?? ''),
      type: String(source.type ?? 'single_choice'),
      title: String(source.title ?? '未命名题目'),
      content: String(source.contentMarkdown ?? source.content ?? ''),
      difficulty: Number(source.difficulty) || 1,
      defaultScore: Number(source.defaultScore ?? source.score) || 0,
      analysis: typeof source.analysisMarkdown === 'string'
        ? source.analysisMarkdown
        : typeof source.analysis === 'string'
          ? source.analysis
          : undefined,
      allowOptionShuffle: typeof source.allowOptionShuffle === 'boolean' ? source.allowOptionShuffle : undefined,
      knowledgePointIds: Array.isArray(source.knowledgePointIds) ? source.knowledgePointIds.map(String) : undefined,
      tagIds: Array.isArray(source.tagIds) ? source.tagIds.map(String) : undefined,
      options,
      answer: this.toPlainRecord(this.parseJsonish(source.answerJson ?? source.answer)),
      scoringRule: this.toPlainRecord(this.parseJsonish(source.scoringRuleJson ?? source.scoringRule)),
    };
  }

  private toComparableQuestion(
    value:
      | CreateQuestionDto
      | Prisma.QuestionGetPayload<{
          include: {
            course: { select: { name: true } };
            options: true;
            answer: true;
          };
        }>,
    index: number,
    fromEntity = false,
  ): ComparableQuestion {
    const type = fromEntity
      ? toApiEnum(String((value as { type: string }).type))
      : toApiEnum(normalizeQuestionType(String((value as CreateQuestionDto).type || 'single_choice')));
    const title = String((value as { title?: string }).title ?? '').trim();
    const content = String((value as { content?: string }).content ?? '').trim();
    const options = this.comparableOptions(value);
    const answer = this.comparableAnswer(value, type);
    const titleKey = this.normalizeComparableText(title);
    const contentKey = this.normalizeComparableText(content);
    const optionContentKey = options.map((option) => this.normalizeComparableText(option.content)).join('|');
    const optionFullKey = options
      .map((option) => `${this.normalizeComparableText(option.content)}:${option.isCorrect ? '1' : '0'}`)
      .join('|');

    return {
      index,
      id: typeof (value as { id?: unknown }).id === 'string' ? ((value as { id: string }).id) : undefined,
      courseId: String((value as { courseId?: string }).courseId ?? ''),
      courseName: (value as { course?: { name?: string } }).course?.name,
      title,
      type,
      status: fromEntity ? toApiEnum(String((value as { status?: string }).status ?? '')) : undefined,
      titleKey,
      contentKey,
      optionContentKey,
      fullKey: [
        String((value as { courseId?: string }).courseId ?? ''),
        type,
        titleKey,
        contentKey,
        optionFullKey,
        this.stableStringify(answer),
      ].join('\n'),
    };
  }

  private normalizeCheckOptions(value: unknown): CreateQuestionDto['options'] {
    const parsed = this.parseJsonish(value);
    if (!Array.isArray(parsed)) return [];
    const options = parsed.map((option, index) => {
      const item = this.toPlainRecord(option);
      return {
        optionKey: String(item.optionKey ?? item.label ?? String.fromCharCode(65 + index)),
        content: String(item.contentMarkdown ?? item.content ?? ''),
        isCorrect: item.isCorrect === true || item.isCorrect === 'true',
        sortOrder: Number(item.sortOrder ?? index + 1) || index + 1,
      };
    });
    return options;
  }

  private parseJsonish(value: unknown): unknown {
    if (value && typeof value === 'object') return value;
    const text = String(value ?? '').trim();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return value;
    }
  }

  private toPlainRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private comparableOptions(
    value:
      | CreateQuestionDto
      | Prisma.QuestionGetPayload<{
          include: {
            course: { select: { name: true } };
            options: true;
            answer: true;
          };
        }>,
  ) {
    const options = ((value as CreateQuestionDto).options ??
      (value as { options?: Array<{ optionKey: string; content: string; isCorrect: boolean; sortOrder: number }> }).options ??
      []) as Array<{ optionKey?: string; content?: string; isCorrect?: boolean; sortOrder?: number }>;

    return [...options]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.optionKey ?? '').localeCompare(String(b.optionKey ?? '')))
      .map((option, index) => ({
        optionKey: String(option.optionKey ?? String.fromCharCode(65 + index)).trim(),
        content: String(option.content ?? '').trim(),
        isCorrect: Boolean(option.isCorrect),
      }));
  }

  private comparableAnswer(
    value:
      | CreateQuestionDto
      | Prisma.QuestionGetPayload<{
          include: {
            course: { select: { name: true } };
            options: true;
            answer: true;
          };
        }>,
    apiType: string,
  ) {
    const type = normalizeQuestionType(apiType);
    if (this.isChoiceQuestion(type)) {
      return {};
    }

    return (
      (value as CreateQuestionDto).answer ??
      (value as { answer?: { answerJson?: unknown } }).answer?.answerJson ??
      {}
    );
  }

  private normalizeComparableText(value: unknown) {
    return String(value ?? '')
      .replace(/!\[[^\]]*]\([^)]+\)/g, '![image]')
      .replace(/\[[^\]]+]\([^)]+\)/g, '[link]')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private extractResourceReferences(...values: unknown[]) {
    const references = new Set<string>();
    const visit = (value: unknown) => {
      if (typeof value === 'string') {
        const markdownLinkRegex = /!?\[[^\]]*]\(([^)]+)\)/g;
        const uploadRegex = /(?:^|["'\s(])((?:\/uploads\/|uploads\/)[^"'\s)]+)/g;
        let match: RegExpExecArray | null;
        while ((match = markdownLinkRegex.exec(value))) {
          const url = this.cleanResourceUrl(match[1]);
          if (url) references.add(url);
        }
        while ((match = uploadRegex.exec(value))) {
          const url = this.cleanResourceUrl(match[1]);
          if (url) references.add(url);
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value && typeof value === 'object') {
        Object.values(value as Record<string, unknown>).forEach(visit);
      }
    };

    values.forEach(visit);
    return [...references];
  }

  private async resourceReferenceStats(urls: string[]) {
    const targetUrls = new Set(urls.map((url) => this.cleanResourceUrl(url)).filter(Boolean));
    const stats = new Map<string, { count: number; locations: string[] }>();
    for (const url of targetUrls) stats.set(url, { count: 0, locations: [] });
    if (!targetUrls.size) return stats;

    const add = (location: string, ...values: unknown[]) => {
      for (const url of this.extractResourceReferences(...values)) {
        if (!targetUrls.has(url)) continue;
        const current = stats.get(url) ?? { count: 0, locations: [] };
        current.count += 1;
        if (current.locations.length < 30) current.locations.push(location);
        stats.set(url, current);
      }
    };

    const [questions, questionVersions, paperQuestions, paperInstances] = await Promise.all([
      this.prisma.question.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          title: true,
          content: true,
          analysis: true,
          options: { select: { content: true } },
          answer: { select: { answerJson: true, scoringRuleJson: true } },
        },
      }),
      this.prisma.questionVersion.findMany({ select: { snapshotJson: true } }),
      this.prisma.paperQuestion.findMany({ select: { questionSnapshotJson: true } }),
      this.prisma.paperInstance.findMany({ select: { paperSnapshotJson: true } }),
    ]);

    for (const question of questions) {
      add(
        `题目：${question.title || question.id}`,
        question.content,
        question.analysis,
        question.options.map((option) => option.content),
        question.answer?.answerJson,
        question.answer?.scoringRuleJson,
      );
    }
    for (const version of questionVersions) add('题目版本快照', version.snapshotJson);
    for (const paperQuestion of paperQuestions) add('试卷题目快照', paperQuestion.questionSnapshotJson);
    for (const instance of paperInstances) add('考试试卷实例快照', instance.paperSnapshotJson);

    return stats;
  }

  private cleanResourceUrl(value: unknown) {
    const raw = String(value ?? '')
      .trim()
      .replace(/^<|>$/g, '')
      .split('#')[0]
      .split('?')[0];
    if (!raw || /^(https?:|data:|javascript:|mailto:)/i.test(raw)) return '';
    return raw.startsWith('uploads/') ? `/${raw}` : raw;
  }

  private resourceKind(url: string, mimeType?: string | null) {
    const value = `${mimeType ?? ''} ${url}`.toLowerCase();
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(value) || value.includes('image/')) return 'image';
    if (/\.pdf$/.test(value) || value.includes('application/pdf')) return 'pdf';
    if (/\.(doc|docx)$/.test(value) || value.includes('word')) return 'word';
    if (/\.(xls|xlsx|csv)$/.test(value) || value.includes('spreadsheet')) return 'sheet';
    return 'file';
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.stableStringify((value as Record<string, unknown>)[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value ?? null);
  }

  private async findOccupationMap(questionIds: string[]) {
    const result = new Map<string, Array<{ id: string; name: string; status: ExamStatus }>>();
    if (!questionIds.length) return result;

    const relations = await this.prisma.paperQuestion.findMany({
      where: {
        questionId: { in: questionIds },
        paper: {
          exams: {
            some: {
              status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
            },
          },
        },
      },
      include: {
        paper: {
          include: {
            exams: {
              where: { status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] } },
              select: { id: true, name: true, status: true },
            },
          },
        },
      },
    });

    for (const relation of relations) {
      result.set(relation.questionId, [...(result.get(relation.questionId) ?? []), ...relation.paper.exams]);
    }

    return result;
  }

  private gradeStandaloneQuestion(
    type: QuestionType,
    totalScore: number,
    answerJson: QuestionAnswerJson,
    submitted: CheckQuestionAnswerDto,
  ) {
    if (this.isChoiceQuestion(type)) {
      const selected = new Set((submitted.selectedOptionIds ?? []).filter(Boolean));
      const correct = new Set(answerJson.correctOptionIds ?? []);
      const isCorrect =
        selected.size === correct.size && [...selected].every((optionId) => correct.has(optionId));

      return {
        isCorrect,
        score: isCorrect ? totalScore : 0,
        status: 'auto_graded',
        message: isCorrect ? '回答正确' : '回答错误',
      };
    }

    if (type === QuestionType.FILL_BLANK) {
      const blanks = submitted.blanks ?? [];
      const rules = answerJson.blanks ?? [];
      let score = 0;
      let allCorrect = true;

      for (const rule of rules) {
        const submittedValue = blanks.find((blank) => blank.index === rule.index)?.value ?? '';
        const normalizedSubmitted = this.normalizeBlank(submittedValue, rule);
        const matched = rule.answers
          .map((answer) => this.normalizeBlank(answer, rule))
          .includes(normalizedSubmitted);
        if (matched) {
          score += rule.score ?? totalScore / Math.max(rules.length, 1);
        } else {
          allCorrect = false;
        }
      }

      return {
        isCorrect: allCorrect,
        score,
        status: 'auto_graded',
        message: allCorrect ? '回答正确' : '回答错误',
      };
    }

    return {
      isCorrect: null,
      score: 0,
      status: type === QuestionType.PROGRAMMING ? 'judge_pending' : 'manual_needed',
      message: type === QuestionType.PROGRAMMING ? '该题型需要外部评测，已提供参考答案' : '该题型需要人工批改，已提供参考答案',
    };
  }

  private buildAnswerSummary(
    type: QuestionType,
    answerJson: QuestionAnswerJson,
    submitted: CheckQuestionAnswerDto,
    options: Array<{ id: string; optionKey: string; content: string }>,
  ) {
    const optionMap = new Map(options.map((option) => [option.id, option]));
    const selectedOptionIds = (submitted.selectedOptionIds ?? []).filter(Boolean);
    const studentAnswerText = this.describeSubmittedAnswer(submitted, optionMap);
    const correctAnswerText = this.describeCorrectAnswer(type, answerJson, optionMap);
    const referenceAnswerText = this.describeReferenceAnswer(type, answerJson, correctAnswerText);
    const answerExplanation = this.describeAnswerRule(type, answerJson);

    return {
      studentAnswerText,
      correctAnswerText,
      referenceAnswerText,
      answerExplanation,
      selectedOptionLabels: selectedOptionIds.map((optionId) => this.describeOption(optionId, optionMap)),
    };
  }

  private describeSubmittedAnswer(
    submitted: CheckQuestionAnswerDto,
    optionMap: Map<string, { optionKey: string; content: string }>,
  ) {
    const selectedOptionIds = (submitted.selectedOptionIds ?? []).filter(Boolean);
    if (selectedOptionIds.length) {
      return selectedOptionIds.map((optionId) => this.describeOption(optionId, optionMap)).join('\n\n');
    }

    if (submitted.blanks?.length) {
      const lines = submitted.blanks
        .filter((blank) => String(blank.value ?? '').trim())
        .map((blank) => `第 ${blank.index} 空：${blank.value}`);
      return lines.length ? lines.join('\n') : '未作答';
    }

    if (String(submitted.text ?? '').trim()) {
      return submitted.text?.trim() ?? '';
    }

    if (submitted.extra && Object.keys(submitted.extra).length) {
      return JSON.stringify(submitted.extra, null, 2);
    }

    return '未作答';
  }

  private describeCorrectAnswer(
    type: QuestionType,
    answerJson: QuestionAnswerJson,
    optionMap: Map<string, { optionKey: string; content: string }>,
  ) {
    if (this.isChoiceQuestion(type)) {
      const correctOptionIds = answerJson.correctOptionIds ?? [];
      return correctOptionIds.length
        ? correctOptionIds.map((optionId) => this.describeOption(optionId, optionMap)).join('\n\n')
        : '未配置正确选项';
    }

    if (type === QuestionType.FILL_BLANK) {
      const blanks = answerJson.blanks ?? [];
      return blanks.length
        ? blanks
            .map((blank) => {
              const answers = blank.answers?.filter(Boolean).join(' / ') || '未配置';
              return `第 ${blank.index} 空：${answers}`;
            })
            .join('\n')
        : '未配置填空答案';
    }

    return '';
  }

  private describeReferenceAnswer(type: QuestionType, answerJson: QuestionAnswerJson, correctAnswerText: string) {
    if (answerJson.reference && String(answerJson.reference).trim()) {
      return String(answerJson.reference).trim();
    }

    if (correctAnswerText) {
      return correctAnswerText;
    }

    const jsonText = JSON.stringify(answerJson ?? {}, null, 2);
    if (jsonText && jsonText !== '{}') {
      return jsonText;
    }

    return type === QuestionType.PROGRAMMING ? '暂无参考代码或外部评测说明' : '暂无参考答案';
  }

  private describeAnswerRule(type: QuestionType, answerJson: QuestionAnswerJson) {
    if (type !== QuestionType.FILL_BLANK) return '';
    const blanks = answerJson.blanks ?? [];
    if (!blanks.length) return '';

    return blanks
      .map((blank) => {
        const rules = [
          blank.ignoreCase ? '不区分大小写' : '区分大小写',
          blank.trimSpace ?? true ? '忽略首尾空格' : '区分首尾空格',
        ];
        return `第 ${blank.index} 空：${rules.join('，')}`;
      })
      .join('\n');
  }

  private describeOption(
    optionId: string,
    optionMap: Map<string, { optionKey: string; content: string }>,
  ) {
    const option = optionMap.get(optionId);
    if (!option) return optionId;
    return `${option.optionKey}. ${option.content}`;
  }

  private normalizeBlank(value: string, rule: { ignoreCase?: boolean; trimSpace?: boolean }) {
    let result = value;
    if (rule.trimSpace ?? true) {
      result = result.trim();
    }
    if (rule.ignoreCase) {
      result = result.toLowerCase();
    }
    return result;
  }

  private validateQuestionInput(type: QuestionType, dto: CreateQuestionDto) {
    if (this.isChoiceQuestion(type) && !dto.options?.length) {
      throw new BadRequestException('客观选择题必须包含选项');
    }

    if (type === QuestionType.SINGLE_CHOICE) {
      const correctCount = dto.options?.filter((option) => option.isCorrect).length ?? 0;
      if (dto.options?.length && correctCount !== 1) {
        throw new BadRequestException('单选题必须有且只有一个正确选项');
      }
    }

    if (type === QuestionType.MULTIPLE_CHOICE) {
      const correctCount = dto.options?.filter((option) => option.isCorrect).length ?? 0;
      if (dto.options?.length && correctCount < 2) {
        throw new BadRequestException('多选题至少需要两个正确选项');
      }
    }
  }

  private async replaceOptions(
    tx: Prisma.TransactionClient,
    questionId: string,
    options: CreateQuestionDto['options'],
  ) {
    await tx.questionOption.deleteMany({ where: { questionId } });

    if (!options?.length) {
      return [];
    }

    await tx.questionOption.createMany({
      data: options.map((option, index) => ({
        questionId,
        optionKey: option.optionKey,
        content: option.content,
        isCorrect: option.isCorrect ?? false,
        sortOrder: option.sortOrder ?? index + 1,
      })),
    });

    return tx.questionOption.findMany({
      where: { questionId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  private async replaceRelations(
    tx: Prisma.TransactionClient,
    questionId: string,
    knowledgePointIds?: string[],
    tagIds?: string[],
  ) {
    if (knowledgePointIds) {
      await tx.questionKnowledgePoint.deleteMany({ where: { questionId } });
      if (knowledgePointIds.length) {
        await tx.questionKnowledgePoint.createMany({
          data: knowledgePointIds.map((knowledgePointId) => ({
            questionId,
            knowledgePointId,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (tagIds) {
      await tx.questionTag.deleteMany({ where: { questionId } });
      if (tagIds.length) {
        await tx.questionTag.createMany({
          data: tagIds.map((tagId) => ({
            questionId,
            tagId,
          })),
          skipDuplicates: true,
        });
      }
    }
  }

  private resolveAnswerJson(
    type: QuestionType,
    dto: CreateQuestionDto,
    options: Array<{ id: string; optionKey: string; isCorrect: boolean }>,
  ): Prisma.InputJsonObject {
    if (this.isChoiceQuestion(type)) {
      const correctOptionIds = options.filter((option) => option.isCorrect).map((option) => option.id);
      return { correctOptionIds };
    }

    if (type === QuestionType.FILL_BLANK) {
      if (dto.answer?.blanks && Array.isArray(dto.answer.blanks)) {
        return dto.answer as Prisma.InputJsonObject;
      }

      return { blanks: [] };
    }

    return (dto.answer as Prisma.InputJsonObject | undefined) ?? {};
  }

  private isUniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private questionOrderBy(query: QueryQuestionDto): Prisma.QuestionOrderByWithRelationInput[] {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const orderMap: Record<string, Prisma.QuestionOrderByWithRelationInput> = {
      createdAt: { createdAt: direction },
      updatedAt: { updatedAt: direction },
      difficulty: { difficulty: direction },
      type: { type: direction },
      status: { status: direction },
      defaultScore: { defaultScore: direction },
      title: { title: direction },
    };
    const primary = orderMap[query.sortBy || 'createdAt'] ?? { createdAt: 'desc' };
    return query.sortBy && query.sortBy !== 'createdAt' ? [primary, { createdAt: 'desc' }] : [primary];
  }

  private isChoiceQuestion(type: QuestionType) {
    return (
      type === QuestionType.SINGLE_CHOICE ||
      type === QuestionType.MULTIPLE_CHOICE ||
      type === QuestionType.TRUE_FALSE
    );
  }
}
