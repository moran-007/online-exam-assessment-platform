/* eslint-disable @typescript-eslint/no-unused-vars */
import { BadRequestException, Injectable, NotFoundException, } from '@nestjs/common';
import ExcelJS = require('exceljs');
import { ExamStatus, Prisma, QuestionStatus, QuestionType, TagType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { normalizeQuestionStatus, normalizeQuestionType, toApiEnum, } from '../../common/utils/enum-normalizer';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionTypeRegistry } from '../question-types/question-type-registry.service';
import { AssetTokenService } from '../uploads/asset-token.service';
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
    courseKey: string;
    courseName?: string;
    title: string;
    type: string;
    status?: string;
    titleKey: string;
    contentHash: string;
    contentLength: number;
    optionContentHash: string;
    optionContentLength: number;
    optionFullHash: string;
    optionFullLength: number;
    answerHash: string;
    answerLength: number;
};
type ExcelImportOptions = {
    publish?: boolean;
    skipDuplicates?: boolean;
};
type ExcelQuestionRow = {
    rowNumber: number;
    title: string;
    content: string;
    type: string;
    courseName: string;
    knowledgePointNames: string[];
    tagNames: string[];
    difficulty: number;
    defaultScore: number;
    analysis: string;
    answerText: string;
    optionValues: Array<{
        optionKey: string;
        content: string;
    }>;
    allowOptionShuffle?: boolean;
    identifier: string;
    parentIdentifier: string;
    childScore: number;
    childOrder: number;
};
import { answerRows, blankCount } from './questions-answer.operations';
import { formatProgrammingRef } from './questions-snapshot.operations';
import { QuestionsContext } from './questions.context';
export async function list(ctx: QuestionsContext, query: QueryQuestionDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const scopeWhere = questionScopeWhere(ctx, query.scope);
    const where: Prisma.QuestionWhereInput = {
        deletedAt: null,
        courseId: query.courseId,
        type: query.type ? normalizeQuestionType(query.type) : undefined,
        status: query.status ? normalizeQuestionStatus(query.status) : undefined,
        difficulty: query.difficulty,
        tags: query.tagId ? { some: { tagId: query.tagId } } : undefined,
        knowledgePoints: query.knowledgePointId ? { some: { knowledgePointId: query.knowledgePointId } } : undefined,
        compositionParents: query.includeChildItems ? undefined : { none: {} },
        AND: [scopeWhere],
        OR: query.keyword
            ? [
                { title: { contains: query.keyword, mode: 'insensitive' } },
                { content: { contains: query.keyword, mode: 'insensitive' } },
            ]
            : undefined,
    };
    const [items, total] = await ctx.prisma.$transaction([
        ctx.prisma.question.findMany({
            where,
            include: {
                course: { select: { name: true } },
                knowledgePoints: { include: { knowledgePoint: true } },
                tags: { include: { tag: true } },
            },
            orderBy: questionOrderBy(ctx, query),
            skip,
            take,
        }),
        ctx.prisma.question.count({ where }),
    ]);
    const occupationMap = await findOccupationMap(ctx, items.map((item) => item.id));
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
export function questionScopeWhere(ctx: QuestionsContext, scope?: string): Prisma.QuestionWhereInput {
    const value = String(scope || '').trim().toLowerCase();
    const now = new Date();
    const activeOccupation: Prisma.PaperQuestionWhereInput = {
        paper: {
            exams: {
                some: {
                    status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
                    startTime: { lte: now },
                    endTime: { gt: now },
                },
            },
        },
    };
    if (value === 'occupied') {
        return { paperQuestions: { some: activeOccupation } };
    }
    if (value === 'published') {
        return {
            status: QuestionStatus.PUBLISHED,
            paperQuestions: { none: activeOccupation },
        };
    }
    if (value === 'draft') {
        return {
            status: { in: [QuestionStatus.DRAFT, QuestionStatus.PENDING_REVIEW, QuestionStatus.DISABLED] },
        };
    }
    return {};
}
export async function publicList(ctx: QuestionsContext, query: QueryQuestionDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const now = new Date();
    const where: Prisma.QuestionWhereInput = {
        deletedAt: null,
        status: QuestionStatus.PUBLISHED,
        courseId: query.courseId,
        type: query.type ? normalizeQuestionType(query.type) : undefined,
        difficulty: query.difficulty,
        tags: query.tagId ? { some: { tagId: query.tagId } } : undefined,
        knowledgePoints: query.knowledgePointId ? { some: { knowledgePointId: query.knowledgePointId } } : undefined,
        compositionParents: query.includeChildItems ? undefined : { none: {} },
        paperQuestions: {
            none: {
                paper: {
                    exams: {
                        some: {
                            status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
                            startTime: { lte: now },
                            endTime: { gt: now },
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
    const [items, total] = await ctx.prisma.$transaction([
        ctx.prisma.question.findMany({
            where,
            include: {
                course: { select: { name: true } },
                knowledgePoints: { include: { knowledgePoint: true } },
                tags: { include: { tag: true } },
            },
            orderBy: questionOrderBy(ctx, query),
            skip,
            take,
        }),
        ctx.prisma.question.count({ where }),
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
export async function publicDetail(ctx: QuestionsContext, id: string) {
    const now = new Date();
    const question = await ctx.prisma.question.findFirst({
        where: {
            id,
            deletedAt: null,
            status: QuestionStatus.PUBLISHED,
            compositionParents: { none: {} },
            paperQuestions: {
                none: {
                    paper: {
                        exams: {
                            some: {
                                status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
                                startTime: { lte: now },
                                endTime: { gt: now },
                            },
                        },
                    },
                },
            },
        },
        include: {
            course: true,
            options: { orderBy: { sortOrder: 'asc' } },
            answer: { select: { answerJson: true } },
            programmingRef: true,
            tags: { include: { tag: true } },
            compositionChildren: {
                orderBy: { sortOrder: 'asc' },
                include: {
                    childQuestion: {
                        include: {
                            course: true,
                            options: { orderBy: { sortOrder: 'asc' } },
                            answer: { select: { answerJson: true } },
                            programmingRef: true,
                            tags: { include: { tag: true } },
                        },
                    },
                },
            },
        },
    });
    if (!question) {
        throw new NotFoundException('题目不存在或暂不可见');
    }
    return {
        id: question.id,
        assetAccessToken: ctx.assetTokens.issuePublicQuestionToken(question.id),
        title: question.title,
        content: question.content,
        type: toApiEnum(question.type),
        difficulty: question.difficulty,
        defaultScore: Number(question.defaultScore),
        courseName: question.course.name,
        tags: question.tags.map((relation) => relation.tag),
        blankCount: blankCount(ctx, question.answer?.answerJson),
        answerRows: answerRows(ctx, question.answer?.answerJson),
        programmingRef: question.programmingRef ? formatProgrammingRef(ctx, question.programmingRef) : null,
        options: question.options.map((option) => ({
            optionId: option.id,
            label: option.optionKey,
            content: option.content,
        })),
        children: question.compositionChildren.map((relation) => ({
            questionId: relation.childQuestionId,
            score: Number(relation.score),
            sortOrder: relation.sortOrder,
            assetAccessToken: ctx.assetTokens.issuePublicQuestionToken(relation.childQuestionId),
            title: relation.childQuestion.title,
            content: relation.childQuestion.content,
            type: toApiEnum(relation.childQuestion.type),
            difficulty: relation.childQuestion.difficulty,
            blankCount: blankCount(ctx, relation.childQuestion.answer?.answerJson),
            answerRows: answerRows(ctx, relation.childQuestion.answer?.answerJson),
            programmingRef: relation.childQuestion.programmingRef
                ? formatProgrammingRef(ctx, relation.childQuestion.programmingRef)
                : null,
            options: relation.childQuestion.options.map((option) => ({
                optionId: option.id,
                label: option.optionKey,
                content: option.content,
            })),
        })),
    };
}
export async function detail(ctx: QuestionsContext, id: string) {
    const question = await ctx.prisma.question.findFirst({
        where: { id, deletedAt: null },
        include: {
            course: true,
            options: { orderBy: { sortOrder: 'asc' } },
            answer: true,
            programmingRef: true,
            knowledgePoints: { include: { knowledgePoint: true } },
            tags: { include: { tag: true } },
            versions: { orderBy: { version: 'desc' }, take: 10 },
            compositionChildren: {
                orderBy: { sortOrder: 'asc' },
                include: {
                    childQuestion: {
                        include: {
                            course: true,
                            options: { orderBy: { sortOrder: 'asc' } },
                            answer: true,
                            programmingRef: true,
                            knowledgePoints: { include: { knowledgePoint: true } },
                            tags: { include: { tag: true } },
                        },
                    },
                },
            },
        },
    });
    if (!question) {
        throw new NotFoundException('题目不存在');
    }
    return {
        ...question,
        type: toApiEnum(question.type),
        status: toApiEnum(question.status),
        programmingRef: question.programmingRef ? formatProgrammingRef(ctx, question.programmingRef) : null,
        blankCount: blankCount(ctx, question.answer?.answerJson),
        answerRows: answerRows(ctx, question.answer?.answerJson),
        knowledgePoints: question.knowledgePoints.map((relation) => relation.knowledgePoint),
        tags: question.tags.map((relation) => relation.tag),
        children: question.compositionChildren.map((relation) => ({
            questionId: relation.childQuestionId,
            score: Number(relation.score),
            sortOrder: relation.sortOrder,
            question: {
                ...relation.childQuestion,
                type: toApiEnum(relation.childQuestion.type),
                status: toApiEnum(relation.childQuestion.status),
                defaultScore: Number(relation.childQuestion.defaultScore),
                blankCount: blankCount(ctx, relation.childQuestion.answer?.answerJson),
                answerRows: answerRows(ctx, relation.childQuestion.answer?.answerJson),
                programmingRef: relation.childQuestion.programmingRef
                    ? formatProgrammingRef(ctx, relation.childQuestion.programmingRef)
                    : null,
                knowledgePoints: relation.childQuestion.knowledgePoints.map((item) => item.knowledgePoint),
                tags: relation.childQuestion.tags.map((item) => item.tag),
            },
        })),
    };
}
export async function findOccupationMap(ctx: QuestionsContext, questionIds: string[]) {
    const result = new Map<string, Array<{
        id: string;
        name: string;
        status: ExamStatus;
    }>>();
    if (!questionIds.length)
        return result;
    const now = new Date();
    const relations = await ctx.prisma.paperQuestion.findMany({
        where: {
            questionId: { in: questionIds },
            paper: {
                exams: {
                    some: {
                        status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
                        startTime: { lte: now },
                        endTime: { gt: now },
                    },
                },
            },
        },
        include: {
            paper: {
                include: {
                    exams: {
                        where: {
                            status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
                            startTime: { lte: now },
                            endTime: { gt: now },
                        },
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
export function questionOrderBy(ctx: QuestionsContext, query: QueryQuestionDto): Prisma.QuestionOrderByWithRelationInput[] {
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
