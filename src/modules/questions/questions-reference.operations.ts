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
import { hashComparableText, toPlainRecord } from './questions-duplicate.operations';
import { isUniqueConflict } from './questions-persistence.operations';
import { QuestionsContext } from './questions.context';
export async function upsertProgrammingRef(ctx: QuestionsContext, tx: Prisma.TransactionClient, questionId: string, type: QuestionType, ref: CreateQuestionDto['programmingRef'] | undefined) {
    if (type !== QuestionType.PROGRAMMING) {
        await tx.programmingProblemRef.deleteMany({ where: { questionId } });
        return;
    }
    if (ref === undefined)
        return;
    const externalProblemId = String(ref?.externalProblemId ?? '').trim();
    if (!externalProblemId) {
        await tx.programmingProblemRef.deleteMany({ where: { questionId } });
        return;
    }
    const provider = String(ref?.judgeProvider || 'hydro').trim().toLowerCase();
    const platformBaseUrl = normalizeHydroBaseUrl(ctx, ref?.platformBaseUrl || baseUrlFromProblemUrl(ctx, ref?.externalProblemUrl));
    const domainId = String(ref?.domainId || domainIdFromProblemUrl(ctx, ref?.externalProblemUrl) || 'system').trim() || 'system';
    const domainName = String(ref?.domainName || domainId).trim();
    const externalProblemUrl = ref?.externalProblemUrl?.trim() || defaultHydroProblemUrl(ctx, externalProblemId, platformBaseUrl, domainId);
    const languageConfig = {
        languages: Array.isArray(ref?.languages)
            ? ref.languages.map((item) => String(item).trim()).filter(Boolean)
            : [],
    };
    const judgeConfig = {
        ...(ref?.judgeConfig ?? {}),
        platformCode: provider,
        platformBaseUrl,
        domainId,
        domainName,
        accountId: ref?.accountId ?? toPlainRecord(ctx, ref?.judgeConfig).accountId ?? null,
        accountLabel: ref?.accountLabel?.trim() || String(toPlainRecord(ctx, ref?.judgeConfig).accountLabel ?? ''),
        submitPageUrl: String(toPlainRecord(ctx, ref?.judgeConfig).submitPageUrl ?? '').trim() ||
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
export function defaultHydroProblemUrl(ctx: QuestionsContext, problemId: string, baseUrl = process.env.HYDRO_BASE_URL || 'https://oj.example.com', domainId?: string) {
    const normalizedBaseUrl = normalizeHydroBaseUrl(ctx, baseUrl);
    const normalizedDomain = String(domainId || '').trim();
    const domainPrefix = normalizedDomain && normalizedDomain !== 'system' ? `/d/${encodeURIComponent(normalizedDomain)}` : '';
    return `${normalizedBaseUrl}${domainPrefix}/p/${encodeURIComponent(problemId)}`;
}
export function normalizeHydroBaseUrl(ctx: QuestionsContext, value?: string | null) {
    const raw = String(value || process.env.HYDRO_BASE_URL || 'https://oj.example.com').trim();
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return withScheme.replace(/\/+$/, '');
}
export function baseUrlFromProblemUrl(ctx: QuestionsContext, url?: string | null) {
    const raw = String(url || '').trim();
    if (!raw)
        return process.env.HYDRO_BASE_URL || 'https://oj.example.com';
    try {
        const parsed = new URL(raw);
        return `${parsed.protocol}//${parsed.host}`;
    }
    catch {
        return process.env.HYDRO_BASE_URL || 'https://oj.example.com';
    }
}
export function domainIdFromProblemUrl(ctx: QuestionsContext, url?: string | null) {
    const raw = String(url || '').trim();
    if (!raw)
        return '';
    try {
        const parsed = new URL(raw);
        const match = parsed.pathname.match(/\/d\/([^/]+)\/p\//);
        return match?.[1] ? decodeURIComponent(match[1]) : 'system';
    }
    catch {
        const match = raw.match(/\/d\/([^/]+)\/p\//);
        return match?.[1] ? decodeURIComponent(match[1]) : '';
    }
}
export async function resolveCourseIdForQuestion(ctx: QuestionsContext, tx: Prisma.TransactionClient, dto: Pick<CreateQuestionDto, 'courseId' | 'courseName'>, userId: string) {
    const courseName = cleanName(ctx, dto.courseName);
    if (dto.courseId) {
        const exists = await tx.course.findFirst({
            where: { id: dto.courseId, deletedAt: null },
            select: { id: true },
        });
        if (exists)
            return exists.id;
        if (!courseName) {
            throw new BadRequestException('课程不存在，请选择有效课程或提供课程名称');
        }
    }
    if (!courseName) {
        throw new BadRequestException('请选择课程或填写课程名称');
    }
    const existing = await tx.course.findFirst({
        where: {
            deletedAt: null,
            name: { equals: courseName, mode: 'insensitive' },
        },
        select: { id: true },
    });
    if (existing)
        return existing.id;
    const code = await nextCourseCode(ctx, tx, courseName);
    try {
        const created = await tx.course.create({
            data: {
                name: courseName,
                code,
                description: '题目导入时自动创建',
                createdBy: userId,
            },
            select: { id: true },
        });
        return created.id;
    }
    catch (error) {
        if (!isUniqueConflict(ctx, error))
            throw error;
        const raceCreated = await tx.course.findFirst({
            where: {
                deletedAt: null,
                name: { equals: courseName, mode: 'insensitive' },
            },
            select: { id: true },
        });
        if (raceCreated)
            return raceCreated.id;
        const created = await tx.course.create({
            data: {
                name: courseName,
                code: await nextCourseCode(ctx, tx, `${courseName}-${Date.now().toString(36)}`),
                description: '题目导入时自动创建',
                createdBy: userId,
            },
            select: { id: true },
        });
        return created.id;
    }
}
export async function resolveKnowledgePointIdsForQuestion(ctx: QuestionsContext, tx: Prisma.TransactionClient, courseId: string, ids?: string[], names?: string[]) {
    const result = new Set<string>();
    const uniqueIds = [...new Set((ids ?? []).filter(Boolean))];
    if (uniqueIds.length) {
        const existing = await tx.knowledgePoint.findMany({
            where: {
                id: { in: uniqueIds },
                courseId,
                deletedAt: null,
            },
            select: { id: true },
        });
        existing.forEach((item) => result.add(item.id));
    }
    for (const name of cleanNameList(ctx, names)) {
        const existing = await tx.knowledgePoint.findFirst({
            where: {
                courseId,
                deletedAt: null,
                name: { equals: name, mode: 'insensitive' },
            },
            select: { id: true },
        });
        if (existing) {
            result.add(existing.id);
            continue;
        }
        const created = await createKnowledgePointByName(ctx, tx, courseId, name);
        result.add(created.id);
    }
    return [...result];
}
export async function createKnowledgePointByName(ctx: QuestionsContext, tx: Prisma.TransactionClient, courseId: string, name: string) {
    try {
        return await tx.knowledgePoint.create({
            data: {
                courseId,
                name,
                code: await nextKnowledgePointCode(ctx, tx, courseId, name),
                level: 1,
                sortOrder: 0,
            },
            select: { id: true },
        });
    }
    catch (error) {
        if (!isUniqueConflict(ctx, error))
            throw error;
        const existing = await tx.knowledgePoint.findFirst({
            where: {
                courseId,
                deletedAt: null,
                name: { equals: name, mode: 'insensitive' },
            },
            select: { id: true },
        });
        if (existing)
            return existing;
        return tx.knowledgePoint.create({
            data: {
                courseId,
                name,
                code: await nextKnowledgePointCode(ctx, tx, courseId, `${name}-${Date.now().toString(36)}`),
                level: 1,
                sortOrder: 0,
            },
            select: { id: true },
        });
    }
}
export async function resolveTagIdsForQuestion(ctx: QuestionsContext, tx: Prisma.TransactionClient, ids?: string[], names?: string[]) {
    const result = new Set<string>();
    const uniqueIds = [...new Set((ids ?? []).filter(Boolean))];
    if (uniqueIds.length) {
        const existing = await tx.tag.findMany({
            where: {
                id: { in: uniqueIds },
                type: TagType.QUESTION,
                deletedAt: null,
            },
            select: { id: true },
        });
        existing.forEach((item) => result.add(item.id));
    }
    for (const name of cleanNameList(ctx, names)) {
        const existing = await tx.tag.findFirst({
            where: {
                type: TagType.QUESTION,
                deletedAt: null,
                name: { equals: name, mode: 'insensitive' },
            },
            select: { id: true },
        });
        if (existing) {
            result.add(existing.id);
            continue;
        }
        try {
            const created = await tx.tag.create({
                data: {
                    name,
                    code: await nextTagCode(ctx, tx, name),
                    type: TagType.QUESTION,
                },
                select: { id: true },
            });
            result.add(created.id);
        }
        catch (error) {
            if (!isUniqueConflict(ctx, error))
                throw error;
            const raceCreated = await tx.tag.findFirst({
                where: {
                    type: TagType.QUESTION,
                    deletedAt: null,
                    name: { equals: name, mode: 'insensitive' },
                },
                select: { id: true },
            });
            if (raceCreated) {
                result.add(raceCreated.id);
                continue;
            }
            const created = await tx.tag.create({
                data: {
                    name,
                    code: await nextTagCode(ctx, tx, `${name}-${Date.now().toString(36)}`),
                    type: TagType.QUESTION,
                },
                select: { id: true },
            });
            result.add(created.id);
        }
    }
    return [...result];
}
export async function nextCourseCode(ctx: QuestionsContext, tx: Prisma.TransactionClient, name: string) {
    const base = codeBase(ctx, name, 'course');
    return nextScopedCode(ctx, (code) => tx.course.findUnique({ where: { code }, select: { id: true } }), base);
}
export async function nextKnowledgePointCode(ctx: QuestionsContext, tx: Prisma.TransactionClient, courseId: string, name: string) {
    const base = codeBase(ctx, name, 'kp');
    return nextScopedCode(ctx, (code) => tx.knowledgePoint.findFirst({
        where: { courseId, code },
        select: { id: true },
    }), base);
}
export async function nextTagCode(ctx: QuestionsContext, tx: Prisma.TransactionClient, name: string) {
    const base = codeBase(ctx, name, 'tag');
    return nextScopedCode(ctx, (code) => tx.tag.findUnique({ where: { code }, select: { id: true } }), base);
}
export async function nextScopedCode(ctx: QuestionsContext, exists: (code: string) => Promise<{
    id: string;
} | null>, base: string) {
    for (let index = 0; index < 50; index += 1) {
        const suffix = index ? `_${index + 1}` : '';
        const code = `${base.slice(0, 64 - suffix.length)}${suffix}`;
        if (!(await exists(code)))
            return code;
    }
    const suffix = `_${Date.now().toString(36)}`;
    return `${base.slice(0, 64 - suffix.length)}${suffix}`;
}
export function codeBase(ctx: QuestionsContext, value: string, prefix: string) {
    const cleaned = cleanName(ctx, value);
    const ascii = cleaned
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 30);
    const hash = hashComparableText(ctx, cleaned).slice(0, 10);
    return `${prefix}_${ascii || 'auto'}_${hash}`.slice(0, 64);
}
export function cleanName(ctx: QuestionsContext, value: unknown) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    return text && !['undefined', 'null', '-', '无'].includes(text.toLowerCase()) ? text : '';
}
export function cleanNameList(ctx: QuestionsContext, values?: unknown[] | null) {
    return [...new Set((values ?? []).map((value) => cleanName(ctx, value)).filter(Boolean))];
}
export function withProgrammingSourceTags(ctx: QuestionsContext, tagNames: string[] | undefined, type: QuestionType, ref: CreateQuestionDto['programmingRef'] | undefined | null) {
    return cleanNameList(ctx, [...(tagNames ?? []), ...programmingSourceTagNames(ctx, type, ref)]);
}
export function programmingSourceTagNames(ctx: QuestionsContext, type: QuestionType, ref: CreateQuestionDto['programmingRef'] | undefined | null) {
    if (type !== QuestionType.PROGRAMMING || !ref?.externalProblemId)
        return [];
    const judgeConfig = toPlainRecord(ctx, ref.judgeConfig);
    const rawBaseUrl = ref.platformBaseUrl ||
        String(judgeConfig.platformBaseUrl ?? '') ||
        (ref.externalProblemUrl ? baseUrlFromProblemUrl(ctx, ref.externalProblemUrl) : '');
    const host = hostTagName(ctx, rawBaseUrl);
    return ['外部编程题', host].filter(Boolean);
}
export function hostTagName(ctx: QuestionsContext, value?: string | null) {
    const raw = String(value || '').trim();
    if (!raw)
        return '';
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    try {
        return new URL(withScheme).host.toLowerCase().replace(/^www\./, '');
    }
    catch {
        return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase().replace(/^www\./, '');
    }
}
export function nameKey(ctx: QuestionsContext, value: unknown) {
    return cleanName(ctx, value).toLowerCase();
}
export function sameName(ctx: QuestionsContext, left: unknown, right: unknown) {
    return nameKey(ctx, left) === nameKey(ctx, right);
}
