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
import { createQuestionInTransaction, createScoringRuleVersion, replaceComposition, replaceOptions, replaceRelations, resolveAnswerJson, validateQuestionInput } from './questions-persistence.operations';
import { programmingSourceTagNames, resolveCourseIdForQuestion, resolveKnowledgePointIdsForQuestion, resolveTagIdsForQuestion, upsertProgrammingRef, withProgrammingSourceTags } from './questions-reference.operations';
import { buildSnapshot, extractResourceReferences, resourceKind, resourceReferenceStats } from './questions-snapshot.operations';
import { QuestionsContext } from './questions.context';
export async function deleteImpact(ctx: QuestionsContext, id: string) {
    const question = await ctx.prisma.question.findFirst({
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
    const resourceReferences = extractResourceReferences(ctx, question.content, question.analysis, question.options.map((option) => option.content), question.answer?.answerJson, question.answer?.scoringRuleJson);
    const resourceAssets = resourceReferences.length
        ? await ctx.prisma.fileAsset.findMany({
            where: {
                deletedAt: null,
                OR: [
                    { url: { in: resourceReferences } },
                    { objectKey: { in: resourceReferences.map((url) => url.replace(/^\/uploads\//, '')) } },
                ],
            },
        })
        : [];
    const resourceStats = await resourceReferenceStats(ctx, resourceReferences);
    const [paperQuestionCount, relatedPapers, examCount, activeExamCount, paperInstanceCount, answerRecordCount, wrongQuestionCount, judgeSubmissionCount, versionCount] = await ctx.prisma.$transaction([
        ctx.prisma.paperQuestion.count({ where: { questionId: id } }),
        ctx.prisma.paper.findMany({
            where: {
                deletedAt: null,
                questions: { some: { questionId: id } },
            },
            select: { id: true, name: true, status: true },
            orderBy: { updatedAt: 'desc' },
        }),
        ctx.prisma.exam.count({
            where: {
                deletedAt: null,
                paper: { questions: { some: { questionId: id } } },
            },
        }),
        ctx.prisma.exam.count({
            where: {
                deletedAt: null,
                status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
                paper: { questions: { some: { questionId: id } } },
            },
        }),
        ctx.prisma.paperInstance.count({
            where: {
                exam: { deletedAt: null, paper: { questions: { some: { questionId: id } } } },
            },
        }),
        ctx.prisma.answerRecord.count({ where: { questionId: id } }),
        ctx.prisma.wrongQuestion.count({ where: { questionId: id } }),
        ctx.prisma.judgeSubmission.count({ where: { questionId: id } }),
        ctx.prisma.questionVersion.count({ where: { questionId: id } }),
    ]);
    const paperCount = relatedPapers.length;
    const risks: string[] = [];
    if (paperQuestionCount > 0)
        risks.push(`删除时会从 ${paperCount} 份试卷的 ${paperQuestionCount} 个题位中同步移除，并重算试卷总分`);
    if (activeExamCount > 0)
        risks.push(`有 ${activeExamCount} 场已安排或进行中的考试引用该题`);
    if (answerRecordCount > 0)
        risks.push(`已有 ${answerRecordCount} 条答题记录，删除后历史成绩仍保留快照`);
    if (wrongQuestionCount > 0)
        risks.push(`已有 ${wrongQuestionCount} 条错题记录`);
    if (resourceReferences.length > 0)
        risks.push(`题干/选项/解析引用 ${resourceReferences.length} 个资源，删除题目不会删除资源文件`);
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
        relatedPapers: relatedPapers.map((paper) => ({
            id: paper.id,
            name: paper.name,
            status: toApiEnum(paper.status),
        })),
        resources: resourceReferences.map((url) => {
            const asset = resourceAssets.find((item) => item.url === url || `/uploads/${item.objectKey}` === url || item.objectKey === url.replace(/^\/uploads\//, ''));
            const stats = resourceStats.get(url) ?? { count: 0, locations: [] };
            return {
                url,
                kind: resourceKind(ctx, url, asset?.mimeType),
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
export async function create(ctx: QuestionsContext, dto: CreateQuestionDto, userId: string) {
    const question = await ctx.prisma.$transaction((tx) => createQuestionInTransaction(ctx, tx, dto, userId));
    await ctx.audit.log({
        userId,
        action: 'question:create',
        module: 'question',
        targetType: 'question',
        targetId: question.id,
        afterData: { title: question.title, type: question.type, childIds: question.childIds },
    });
    return { id: question.id, childIds: question.childIds };
}
export async function update(ctx: QuestionsContext, id: string, dto: UpdateQuestionDto, userId: string) {
    const current = await ctx.prisma.question.findFirst({
        where: { id, deletedAt: null },
        include: {
            answer: true,
            compositionChildren: {
                include: { childQuestion: { include: { answer: true } } },
            },
        },
    });
    if (!current) {
        throw new NotFoundException('题目不存在');
    }
    const type = dto.type ? normalizeQuestionType(dto.type) : current.type;
    const status = dto.status ? normalizeQuestionStatus(dto.status) : undefined;
    const hasOptionsPatch = dto.options !== undefined;
    const hasAnswerPatch = dto.answer !== undefined;
    const hasScoringRulePatch = dto.scoringRule !== undefined;
    const hasChildrenPatch = dto.children !== undefined;
    const hasKnowledgePatch = dto.knowledgePointIds !== undefined || dto.knowledgePointNames !== undefined;
    const hasTagPatch = dto.tagIds !== undefined || dto.tagNames !== undefined;
    const hasProgrammingRefPatch = dto.programmingRef !== undefined || type !== QuestionType.PROGRAMMING;
    if (hasOptionsPatch || hasChildrenPatch || dto.type) {
        const existingOptions = dto.options
            ? []
            : await ctx.prisma.questionOption.findMany({
                where: { questionId: id },
                orderBy: { sortOrder: 'asc' },
            });
        validateQuestionInput(ctx, type, {
            ...dto,
            type,
            title: dto.title ?? current.title,
            content: dto.content ?? current.content,
            difficulty: dto.difficulty ?? current.difficulty,
            defaultScore: Number(dto.defaultScore ?? current.defaultScore),
            options: (hasOptionsPatch ? dto.options : undefined) ??
                existingOptions.map((option) => ({
                    optionKey: option.optionKey,
                    content: option.content,
                    isCorrect: option.isCorrect,
                    sortOrder: option.sortOrder,
                })),
        } as CreateQuestionDto);
        ctx.questionTypes.validate(toApiEnum(type), { ...dto, type: toApiEnum(type) });
    }
    const updated = await ctx.prisma.$transaction(async (tx) => {
        const courseId = dto.courseId !== undefined || dto.courseName !== undefined
            ? await resolveCourseIdForQuestion(ctx, tx, {
                ...dto,
                courseId: dto.courseName !== undefined && dto.courseId === undefined ? undefined : dto.courseId ?? current.courseId,
                courseName: dto.courseName,
            } as CreateQuestionDto, userId)
            : undefined;
        const targetCourseId = courseId ?? current.courseId;
        const knowledgePointIds = hasKnowledgePatch
            ? await resolveKnowledgePointIdsForQuestion(ctx, tx, targetCourseId, dto.knowledgePointIds, dto.knowledgePointNames)
            : undefined;
        const tagIds = hasTagPatch
            ? await resolveTagIdsForQuestion(ctx, tx, dto.tagIds, withProgrammingSourceTags(ctx, dto.tagNames, type, dto.programmingRef))
            : undefined;
        const question = await tx.question.update({
            where: { id },
            data: {
                courseId,
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
        let options: Array<{
            id: string;
            optionKey: string;
            content: string;
            isCorrect: boolean;
            sortOrder: number;
        }> | undefined;
        if (hasOptionsPatch) {
            options = await replaceOptions(ctx, tx, id, dto.options);
        }
        if (hasAnswerPatch || hasOptionsPatch || hasScoringRulePatch || dto.type) {
            const currentOptions = options ??
                (await tx.questionOption.findMany({
                    where: { questionId: id },
                    orderBy: { sortOrder: 'asc' },
                }));
            const nextAnswerJson = hasAnswerPatch || hasOptionsPatch
                ? resolveAnswerJson(ctx, type, dto as CreateQuestionDto, currentOptions)
                : (current.answer?.answerJson ?? {});
            const nextRuleJson = hasScoringRulePatch
                ? (dto.scoringRule as Prisma.InputJsonObject)
                : ((current.answer?.scoringRuleJson ?? { mode: 'strict' }) as Prisma.InputJsonObject);
            const answer = await tx.questionAnswer.upsert({
                where: { questionId: id },
                update: {
                    answerJson: nextAnswerJson,
                    scoringRuleJson: nextRuleJson,
                },
                create: {
                    questionId: id,
                    answerJson: nextAnswerJson,
                    scoringRuleJson: nextRuleJson,
                },
            });
            const ruleVersion = await createScoringRuleVersion(ctx, tx, id, type, question.version, nextAnswerJson, nextRuleJson, userId);
            await tx.questionAnswer.update({ where: { id: answer.id }, data: { currentRuleVersionId: ruleVersion.id } });
        }
        if (hasKnowledgePatch || hasTagPatch) {
            await replaceRelations(ctx, tx, id, knowledgePointIds, tagIds);
        }
        if (!hasTagPatch && type === QuestionType.PROGRAMMING && dto.programmingRef !== undefined) {
            const sourceTagIds = await resolveTagIdsForQuestion(ctx, tx, undefined, programmingSourceTagNames(ctx, type, dto.programmingRef));
            if (sourceTagIds.length) {
                await tx.questionTag.createMany({
                    data: sourceTagIds.map((tagId) => ({ questionId: id, tagId })),
                    skipDuplicates: true,
                });
            }
        }
        if (hasProgrammingRefPatch) {
            await upsertProgrammingRef(ctx, tx, id, type, dto.programmingRef);
        }
        if (hasChildrenPatch || dto.type) {
            const materialScore = await replaceComposition(ctx, tx, id, type, dto.children);
            if (materialScore !== null) {
                await tx.question.update({ where: { id }, data: { defaultScore: materialScore } });
            }
        }
        const snapshot = await buildSnapshot(ctx, tx, id);
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
    await ctx.audit.log({
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
export async function publish(ctx: QuestionsContext, id: string, userId: string) {
    const question = await ctx.prisma.question.findFirst({
        where: { id, deletedAt: null },
        include: {
            answer: true,
            compositionChildren: {
                orderBy: { sortOrder: 'asc' },
                include: { childQuestion: { include: { answer: true } } },
            },
        },
    });
    if (!question) {
        throw new NotFoundException('题目不存在');
    }
    if (question.type === QuestionType.MATERIAL) {
        if (!question.compositionChildren.length)
            throw new BadRequestException('材料/组合题至少需要一道子题');
        const unavailable = question.compositionChildren.filter((item) => item.childQuestion.status !== QuestionStatus.PUBLISHED || !item.childQuestion.answer);
        if (unavailable.length)
            throw new BadRequestException('材料/组合题存在未发布或缺少答案的子题');
    }
    else if (!question.answer) {
        throw new BadRequestException('题目缺少答案，不能发布');
    }
    const updated = await ctx.prisma.question.update({
        where: { id },
        data: {
            status: QuestionStatus.PUBLISHED,
            reviewedBy: userId,
            reviewedAt: new Date(),
        },
    });
    await ctx.audit.log({
        userId,
        action: 'question:publish',
        module: 'question',
        targetType: 'question',
        targetId: id,
        afterData: { status: updated.status },
    });
    return { id };
}
export async function remove(ctx: QuestionsContext, id: string, userId: string) {
    const exists = await ctx.prisma.question.findFirst({
        where: { id, deletedAt: null },
    });
    if (!exists) {
        throw new NotFoundException('题目不存在');
    }
    const parentReferences = await ctx.prisma.questionComposition.count({ where: { childQuestionId: id } });
    if (parentReferences > 0) {
        throw new BadRequestException(`该题目正被 ${parentReferences} 道材料/组合题引用，请先移除子题关系`);
    }
    const deletion = await ctx.prisma.$transaction(async (tx) => {
        const paperLinks = await tx.paperQuestion.findMany({
            where: { questionId: id },
            select: { paperId: true },
        });
        const paperIds = [...new Set(paperLinks.map((item) => item.paperId))];
        if (paperLinks.length) {
            await tx.paperQuestion.deleteMany({ where: { questionId: id } });
            for (const paperId of paperIds) {
                const aggregate = await tx.paperQuestion.aggregate({
                    where: { paperId },
                    _sum: { score: true },
                });
                await tx.paper.updateMany({
                    where: { id: paperId, deletedAt: null },
                    data: {
                        totalScore: aggregate._sum.score ?? 0,
                        updatedBy: userId,
                    },
                });
            }
        }
        await tx.question.update({
            where: { id },
            data: {
                status: QuestionStatus.ARCHIVED,
                deletedAt: new Date(),
                updatedBy: userId,
            },
        });
        return { paperCount: paperIds.length, paperQuestionCount: paperLinks.length };
    });
    await ctx.audit.log({
        userId,
        action: 'question:delete',
        module: 'question',
        targetType: 'question',
        targetId: id,
        beforeData: { title: exists.title },
        afterData: deletion,
    });
    return {
        deleted: true,
        ...deletion,
        message: deletion.paperQuestionCount
            ? `题目已删除，并从 ${deletion.paperCount} 份试卷中移除 ${deletion.paperQuestionCount} 个关联题位`
            : '题目已删除',
    };
}
export async function bulkDelete(ctx: QuestionsContext, ids: string[], userId: string) {
    const uniqueIds = [...new Set(ids)];
    const failed: Array<{
        id: string;
        message: string;
    }> = [];
    let successCount = 0;
    for (const id of uniqueIds) {
        try {
            await remove(ctx, id, userId);
            successCount += 1;
        }
        catch (error) {
            failed.push({ id, message: error instanceof Error ? error.message : '删除失败' });
        }
    }
    await ctx.audit.log({
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
export async function bulkUpdateStatus(ctx: QuestionsContext, ids: string[], status: string, userId: string) {
    const uniqueIds = [...new Set(ids)];
    const targetStatus = normalizeQuestionStatus(status);
    if (targetStatus === QuestionStatus.ARCHIVED) {
        throw new BadRequestException('归档请使用删除操作');
    }
    const failed: Array<{
        id: string;
        message: string;
    }> = [];
    let successCount = 0;
    for (const id of uniqueIds) {
        try {
            if (targetStatus === QuestionStatus.PUBLISHED) {
                await publish(ctx, id, userId);
            }
            else {
                await update(ctx, id, { status } as UpdateQuestionDto, userId);
            }
            successCount += 1;
        }
        catch (error) {
            failed.push({ id, message: error instanceof Error ? error.message : '状态更新失败' });
        }
    }
    await ctx.audit.log({
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
