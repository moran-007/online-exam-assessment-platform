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
import { cleanNameList, nameKey, sameName } from './questions-reference.operations';
import { stableStringify } from './questions-snapshot.operations';
import { QuestionsContext } from './questions.context';
export async function checkDuplicates(ctx: QuestionsContext, questions: unknown[] = []) {
    const normalized = questions.map((question) => normalizeCheckQuestion(ctx, question));
    await resolveCheckCourseIds(ctx, normalized);
    const incoming = normalized.map((question, index) => toComparableQuestion(ctx, question, index));
    if (!incoming.length) {
        return { items: [], total: 0, duplicateCount: 0, conflictCount: 0, similarCount: 0 };
    }
    const courseIds = [...new Set(incoming.map((item) => item.courseId).filter(Boolean))];
    const titles = [...new Set(incoming.map((item) => item.title).filter(Boolean))];
    const candidates = await findDuplicateCandidates(ctx, courseIds, titles);
    const existing = candidates.map((question, index) => toComparableQuestion(ctx, question, index, true));
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
            if (previous.courseKey !== item.courseKey || previous.type !== item.type)
                continue;
            if (hasSameQuestionBody(ctx, previous, item)) {
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
            if (hasSameContentAndOptions(ctx, previous, item)) {
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
            if (candidate.courseKey !== item.courseKey || candidate.type !== item.type)
                continue;
            if (candidate.titleKey === item.titleKey) {
                const isDuplicate = hasSameQuestionBody(ctx, candidate, item);
                matches.push({
                    source: 'question_bank',
                    id: candidate.id,
                    title: candidate.title,
                    type: candidate.type,
                    status: candidate.status,
                    courseName: candidate.courseName,
                    reason: isDuplicate ? 'duplicate' : 'conflict',
                    message: isDuplicate
                        ? '题库中已有完全相同题目'
                        : '题库中已有同标题题目，但题干、选项或答案不一致',
                });
                continue;
            }
            if (hasSameContentAndOptions(ctx, candidate, item)) {
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
            message: status === 'ok'
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
export async function resolveCheckCourseIds(ctx: QuestionsContext, questions: CreateQuestionDto[]) {
    const existingIds = new Set<string>();
    const courseIds = [...new Set(questions.map((question) => question.courseId).filter((id): id is string => Boolean(id)))];
    for (const courseIdChunk of chunk(ctx, courseIds, 100)) {
        const courses = await ctx.prisma.course.findMany({
            where: { id: { in: courseIdChunk }, deletedAt: null },
            select: { id: true },
        });
        courses.forEach((course) => existingIds.add(course.id));
    }
    const names = cleanNameList(ctx, questions.map((question) => question.courseName));
    const unresolvedNames = names.filter((name) => questions.some((question) => (!question.courseId || !existingIds.has(question.courseId)) && sameName(ctx, question.courseName, name)));
    if (!unresolvedNames.length) {
        for (const question of questions) {
            if (question.courseId && !existingIds.has(question.courseId))
                question.courseId = '';
        }
        return;
    }
    const courseMap = new Map<string, string>();
    for (const courseNameChunk of chunk(ctx, unresolvedNames, 100)) {
        const courses = await ctx.prisma.course.findMany({
            where: {
                deletedAt: null,
                OR: courseNameChunk.map((name) => ({ name: { equals: name, mode: 'insensitive' } })),
            },
            select: { id: true, name: true },
        });
        courses.forEach((course) => courseMap.set(nameKey(ctx, course.name), course.id));
    }
    for (const question of questions) {
        if (question.courseId && existingIds.has(question.courseId))
            continue;
        const courseId = courseMap.get(nameKey(ctx, question.courseName));
        question.courseId = courseId ?? '';
    }
}
export function normalizeCheckQuestion(ctx: QuestionsContext, value: unknown): CreateQuestionDto {
    const record = toPlainRecord(ctx, parseJsonish(ctx, value));
    const importPayload = toPlainRecord(ctx, parseJsonish(ctx, record.importPayload));
    const source = Object.keys(importPayload).length ? { ...record, ...importPayload } : record;
    const options = normalizeCheckOptions(ctx, source.optionsJson ?? source.options);
    return {
        courseId: String(source.courseId ?? ''),
        courseName: String(source.courseName ?? (toPlainRecord(ctx, source.course).name ?? '')),
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
        answer: toPlainRecord(ctx, parseJsonish(ctx, source.answerJson ?? source.answer)),
        scoringRule: toPlainRecord(ctx, parseJsonish(ctx, source.scoringRuleJson ?? source.scoringRule)),
        comparable: toPlainRecord(ctx, source.comparable),
    };
}
export function toComparableQuestion(ctx: QuestionsContext, value: CreateQuestionDto | Prisma.QuestionGetPayload<{
    include: {
        course: {
            select: {
                name: true;
            };
        };
        options: true;
        answer: true;
    };
}>, index: number, fromEntity = false): ComparableQuestion {
    const type = fromEntity
        ? toApiEnum(String((value as {
            type: string;
        }).type))
        : toApiEnum(normalizeQuestionType(String((value as CreateQuestionDto).type || 'single_choice')));
    const summary = toPlainRecord(ctx, (value as {
        comparable?: unknown;
    }).comparable);
    const title = String((value as {
        title?: string;
    }).title ?? '').trim();
    const content = String((value as {
        content?: string;
    }).content ?? '').trim();
    const options = comparableOptions(ctx, value);
    const answer = comparableAnswer(ctx, value, type);
    const titleKey = typeof summary.titleKey === 'string' ? summary.titleKey : normalizeComparableText(ctx, title);
    const contentKey = normalizeComparableText(ctx, content);
    const optionContentKey = options.map((option) => normalizeComparableText(ctx, option.content)).join('|');
    const optionFullKey = options
        .map((option) => `${normalizeComparableText(ctx, option.content)}:${option.isCorrect ? '1' : '0'}`)
        .join('|');
    const answerKey = stableStringify(ctx, answer);
    return {
        index,
        id: typeof (value as {
            id?: unknown;
        }).id === 'string' ? ((value as {
            id: string;
        }).id) : undefined,
        courseId: String((value as {
            courseId?: string;
        }).courseId ?? ''),
        courseKey: comparableCourseKey(ctx, value),
        courseName: (value as {
            course?: {
                name?: string;
            };
            courseName?: string;
        }).course?.name ?? (value as {
            courseName?: string;
        }).courseName,
        title,
        type,
        status: fromEntity ? toApiEnum(String((value as {
            status?: string;
        }).status ?? '')) : undefined,
        titleKey,
        contentHash: summaryHash(ctx, summary, 'contentHash', contentKey),
        contentLength: summaryLength(ctx, summary, 'contentLength', contentKey),
        optionContentHash: summaryHash(ctx, summary, 'optionContentHash', optionContentKey),
        optionContentLength: summaryLength(ctx, summary, 'optionContentLength', optionContentKey),
        optionFullHash: summaryHash(ctx, summary, 'optionFullHash', optionFullKey),
        optionFullLength: summaryLength(ctx, summary, 'optionFullLength', optionFullKey),
        answerHash: summaryHash(ctx, summary, 'answerHash', answerKey),
        answerLength: summaryLength(ctx, summary, 'answerLength', answerKey),
    };
}
export function normalizeCheckOptions(ctx: QuestionsContext, value: unknown): CreateQuestionDto['options'] {
    const parsed = parseJsonish(ctx, value);
    if (!Array.isArray(parsed))
        return [];
    const options = parsed.map((option, index) => {
        const item = toPlainRecord(ctx, option);
        return {
            optionKey: String(item.optionKey ?? item.label ?? String.fromCharCode(65 + index)),
            content: String(item.contentMarkdown ?? item.content ?? ''),
            isCorrect: item.isCorrect === true || item.isCorrect === 'true',
            sortOrder: Number(item.sortOrder ?? index + 1) || index + 1,
        };
    });
    return options;
}
export async function findDuplicateCandidates(ctx: QuestionsContext, courseIds: string[], titles: string[]) {
    if (!courseIds.length || !titles.length)
        return [];
    const result = new Map<string, Prisma.QuestionGetPayload<{
        include: {
            course: {
                select: {
                    name: true;
                };
            };
            options: true;
            answer: true;
        };
    }>>();
    for (const courseChunk of chunk(ctx, courseIds, 100)) {
        for (const titleChunk of chunk(ctx, titles, 100)) {
            const questions = await ctx.prisma.question.findMany({
                where: {
                    deletedAt: null,
                    courseId: { in: courseChunk },
                    OR: titleChunk.map((title) => ({ title: { equals: title, mode: 'insensitive' } })),
                },
                include: {
                    course: { select: { name: true } },
                    options: { orderBy: { sortOrder: 'asc' } },
                    answer: true,
                },
            });
            questions.forEach((question) => result.set(question.id, question));
        }
    }
    return [...result.values()];
}
export function hasSameQuestionBody(ctx: QuestionsContext, left: ComparableQuestion, right: ComparableQuestion) {
    return (left.titleKey === right.titleKey &&
        sameSignature(ctx, left.contentHash, left.contentLength, right.contentHash, right.contentLength) &&
        sameSignature(ctx, left.optionFullHash, left.optionFullLength, right.optionFullHash, right.optionFullLength) &&
        sameSignature(ctx, left.answerHash, left.answerLength, right.answerHash, right.answerLength));
}
export function hasSameContentAndOptions(ctx: QuestionsContext, left: ComparableQuestion, right: ComparableQuestion) {
    return (left.contentLength > 0 &&
        sameSignature(ctx, left.contentHash, left.contentLength, right.contentHash, right.contentLength) &&
        sameSignature(ctx, left.optionContentHash, left.optionContentLength, right.optionContentHash, right.optionContentLength));
}
export function sameSignature(ctx: QuestionsContext, leftHash: string, leftLength: number, rightHash: string, rightLength: number) {
    return leftLength === rightLength && leftHash === rightHash;
}
export function comparableCourseKey(ctx: QuestionsContext, value: {
    courseId?: string;
    courseName?: string;
    course?: {
        name?: string;
    };
}) {
    const courseId = String(value.courseId ?? '').trim();
    if (courseId)
        return `id:${courseId}`;
    const courseName = nameKey(ctx, value.courseName ?? value.course?.name);
    return courseName ? `name:${courseName}` : 'none';
}
export function summaryHash(ctx: QuestionsContext, summary: Record<string, unknown>, key: string, fallback: string) {
    const value = summary[key];
    return typeof value === 'string' && value ? value : hashComparableText(ctx, fallback);
}
export function summaryLength(ctx: QuestionsContext, summary: Record<string, unknown>, key: string, fallback: string) {
    const value = Number(summary[key]);
    return Number.isFinite(value) && value >= 0 ? value : fallback.length;
}
export function parseJsonish(ctx: QuestionsContext, value: unknown): unknown {
    if (value && typeof value === 'object')
        return value;
    const text = String(value ?? '').trim();
    if (!text)
        return {};
    try {
        return JSON.parse(text);
    }
    catch {
        return value;
    }
}
export function toPlainRecord(ctx: QuestionsContext, value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
export function comparableOptions(ctx: QuestionsContext, value: CreateQuestionDto | Prisma.QuestionGetPayload<{
    include: {
        course: {
            select: {
                name: true;
            };
        };
        options: true;
        answer: true;
    };
}>) {
    const options = ((value as CreateQuestionDto).options ??
        (value as {
            options?: Array<{
                optionKey: string;
                content: string;
                isCorrect: boolean;
                sortOrder: number;
            }>;
        }).options ??
        []) as Array<{
        optionKey?: string;
        content?: string;
        isCorrect?: boolean;
        sortOrder?: number;
    }>;
    return [...options]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.optionKey ?? '').localeCompare(String(b.optionKey ?? '')))
        .map((option, index) => ({
        optionKey: String(option.optionKey ?? String.fromCharCode(65 + index)).trim(),
        content: String(option.content ?? '').trim(),
        isCorrect: Boolean(option.isCorrect),
    }));
}
export function comparableAnswer(ctx: QuestionsContext, value: CreateQuestionDto | Prisma.QuestionGetPayload<{
    include: {
        course: {
            select: {
                name: true;
            };
        };
        options: true;
        answer: true;
    };
}>, apiType: string) {
    const type = normalizeQuestionType(apiType);
    if (isChoiceQuestion(ctx, type)) {
        return {};
    }
    return ((value as CreateQuestionDto).answer ??
        (value as {
            answer?: {
                answerJson?: unknown;
            };
        }).answer?.answerJson ??
        {});
}
export function normalizeComparableText(ctx: QuestionsContext, value: unknown) {
    return String(value ?? '')
        .replace(/!\[[^\]]*]\([^)]+\)/g, '![image]')
        .replace(/\[[^\]]+]\([^)]+\)/g, '[link]')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}
export function hashComparableText(ctx: QuestionsContext, value: string) {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask = 0xffffffffffffffffn;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= BigInt(value.charCodeAt(index));
        hash = (hash * prime) & mask;
    }
    return hash.toString(16).padStart(16, '0');
}
export function chunk<T>(ctx: QuestionsContext, values: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}
