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
import { isChoiceQuestion } from './questions-answer.operations';
import { toPlainRecord } from './questions-duplicate.operations';
import { resolveCourseIdForQuestion, resolveKnowledgePointIdsForQuestion, resolveTagIdsForQuestion, upsertProgrammingRef, withProgrammingSourceTags } from './questions-reference.operations';
import { buildSnapshot } from './questions-snapshot.operations';
import { QuestionsContext } from './questions.context';
export async function createQuestionInTransaction(ctx: QuestionsContext, tx: Prisma.TransactionClient, dto: CreateQuestionDto, userId: string, inherited?: {
    courseId?: string;
    knowledgePointIds?: string[];
    tagIds?: string[];
    tagNames?: string[];
}) {
    const type = normalizeQuestionType(dto.type);
    const inlineChildren = dto.inlineChildren ?? [];
    if (inlineChildren.length && type !== QuestionType.MATERIAL) {
        throw new BadRequestException('只有材料/组合题可以内联创建子题');
    }
    if (inlineChildren.length && dto.children?.length) {
        throw new BadRequestException('材料/组合题不能同时选择已有子题和内联创建子题');
    }
    if (inlineChildren.some((child) => normalizeQuestionType(child.type) === QuestionType.MATERIAL)) {
        throw new BadRequestException('当前版本只支持单层组合，内联子题不能再是材料/组合题');
    }
    const validationDto = inlineChildren.length
        ? ({
            ...dto,
            children: inlineChildren.map((child, index) => ({
                questionId: '00000000-0000-0000-0000-000000000000',
                score: child.score,
                sortOrder: child.sortOrder ?? index + 1,
            })),
        } as CreateQuestionDto)
        : dto;
    validateQuestionInput(ctx, type, validationDto);
    ctx.questionTypes.validate(toApiEnum(type), validationDto);
    const courseId = inherited?.courseId ?? await resolveCourseIdForQuestion(ctx, tx, dto, userId);
    const knowledgePointIds = inherited?.knowledgePointIds ?? await resolveKnowledgePointIdsForQuestion(ctx, tx, courseId, dto.knowledgePointIds, dto.knowledgePointNames);
    const tagNames = withProgrammingSourceTags(ctx, inherited?.tagNames ?? dto.tagNames, type, dto.programmingRef);
    const tagIds = inherited?.tagIds ?? await resolveTagIdsForQuestion(ctx, tx, dto.tagIds, tagNames);
    const created = await tx.question.create({
        data: {
            courseId,
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
    const options = await replaceOptions(ctx, tx, created.id, dto.options);
    const answerJson = resolveAnswerJson(ctx, type, dto, options);
    const questionAnswer = await tx.questionAnswer.create({
        data: {
            questionId: created.id,
            answerJson,
            scoringRuleJson: (dto.scoringRule ?? { mode: 'strict' }) as Prisma.InputJsonObject,
        },
    });
    await replaceRelations(ctx, tx, created.id, knowledgePointIds, tagIds);
    await upsertProgrammingRef(ctx, tx, created.id, type, dto.programmingRef);
    const childIds: string[] = [];
    let compositionChildren = dto.children;
    if (inlineChildren.length) {
        compositionChildren = [];
        for (const [index, child] of inlineChildren.entries()) {
            const childDto = inlineChildToCreateDto(ctx, child, dto, courseId, knowledgePointIds, tagNames);
            const createdChild = await createQuestionInTransaction(ctx, tx, childDto, userId, {
                courseId,
                knowledgePointIds,
                tagNames,
            });
            childIds.push(createdChild.id);
            compositionChildren.push({
                questionId: createdChild.id,
                score: child.score,
                sortOrder: child.sortOrder ?? index + 1,
            });
        }
    }
    const materialScore = await replaceComposition(ctx, tx, created.id, type, compositionChildren);
    if (materialScore !== null) {
        await tx.question.update({ where: { id: created.id }, data: { defaultScore: materialScore } });
    }
    const ruleVersion = await createScoringRuleVersion(ctx, tx, created.id, type, 1, answerJson, dto.scoringRule ?? { mode: 'strict' }, userId);
    await tx.questionAnswer.update({
        where: { id: questionAnswer.id },
        data: { currentRuleVersionId: ruleVersion.id },
    });
    const snapshot = await buildSnapshot(ctx, tx, created.id);
    await tx.questionVersion.create({
        data: {
            questionId: created.id,
            version: 1,
            snapshotJson: snapshot,
            createdBy: userId,
        },
    });
    return { ...created, childIds };
}
export function inlineChildToCreateDto(ctx: QuestionsContext, child: NonNullable<CreateQuestionDto['inlineChildren']>[number], parent: CreateQuestionDto, courseId: string, knowledgePointIds: string[], tagNames: string[]): CreateQuestionDto {
    return {
        courseId,
        type: child.type,
        title: child.title,
        content: child.content,
        difficulty: child.difficulty,
        defaultScore: child.score,
        analysis: child.analysis,
        allowOptionShuffle: child.allowOptionShuffle,
        knowledgePointIds,
        tagNames,
        options: child.options,
        answer: child.answer,
        scoringRule: child.scoringRule,
        programmingRef: child.programmingRef,
        comparable: parent.comparable,
    };
}
export async function replaceComposition(ctx: QuestionsContext, tx: Prisma.TransactionClient, parentQuestionId: string, type: QuestionType, children: CreateQuestionDto['children']) {
    if (type !== QuestionType.MATERIAL) {
        if (children?.length)
            throw new BadRequestException('只有材料/组合题可以配置子题');
        await tx.questionComposition.deleteMany({ where: { parentQuestionId } });
        return null;
    }
    if (!children?.length)
        throw new BadRequestException('材料/组合题至少需要一道子题');
    if (children.length > 100)
        throw new BadRequestException('单道材料/组合题最多包含 100 道子题');
    const uniqueIds = [...new Set(children.map((item) => item.questionId))];
    if (uniqueIds.length !== children.length)
        throw new BadRequestException('材料/组合题不能重复引用同一道子题');
    if (uniqueIds.includes(parentQuestionId))
        throw new BadRequestException('材料/组合题不能引用自身');
    const questions = await tx.question.findMany({
        where: { id: { in: uniqueIds }, deletedAt: null },
        select: { id: true, type: true },
    });
    if (questions.length !== uniqueIds.length)
        throw new BadRequestException('部分子题不存在或已删除');
    if (questions.some((item) => item.type === QuestionType.MATERIAL)) {
        throw new BadRequestException('当前版本只支持单层组合，子题不能再是材料/组合题');
    }
    await tx.questionComposition.deleteMany({ where: { parentQuestionId } });
    await tx.questionComposition.createMany({
        data: children.map((item, index) => ({
            parentQuestionId,
            childQuestionId: item.questionId,
            score: item.score,
            sortOrder: item.sortOrder ?? index,
        })),
    });
    return children.reduce((sum, item) => sum + item.score, 0);
}
export async function createScoringRuleVersion(ctx: QuestionsContext, tx: Prisma.TransactionClient, questionId: string, type: QuestionType, version: number, answerJson: Prisma.InputJsonValue, ruleJson: unknown, userId: string) {
    const rule = toPlainRecord(ctx, ruleJson);
    return tx.scoringRuleVersion.create({
        data: {
            questionId,
            version,
            adapterKey: toApiEnum(type),
            adapterVersion: ctx.questionTypes.descriptor(toApiEnum(type)).version,
            answerJson,
            ruleJson: rule as Prisma.InputJsonObject,
            rubricJson: Array.isArray(rule.rubric) ? (rule.rubric as Prisma.InputJsonArray) : Prisma.JsonNull,
            checksum: createHash('sha256').update(JSON.stringify({ answerJson, rule })).digest('hex'),
            createdBy: userId,
        },
    });
}
export function validateQuestionInput(ctx: QuestionsContext, type: QuestionType, dto: CreateQuestionDto) {
    if (isChoiceQuestion(ctx, type) && !dto.options?.length) {
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
export async function replaceOptions(ctx: QuestionsContext, tx: Prisma.TransactionClient, questionId: string, options: CreateQuestionDto['options']) {
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
export async function replaceRelations(ctx: QuestionsContext, tx: Prisma.TransactionClient, questionId: string, knowledgePointIds?: string[], tagIds?: string[]) {
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
export function resolveAnswerJson(ctx: QuestionsContext, type: QuestionType, dto: CreateQuestionDto, options: Array<{
    id: string;
    optionKey: string;
    isCorrect: boolean;
}>): Prisma.InputJsonObject {
    if (isChoiceQuestion(ctx, type)) {
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
export function isUniqueConflict(ctx: QuestionsContext, error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
