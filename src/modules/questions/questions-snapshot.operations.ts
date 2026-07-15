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
import { toPlainRecord } from './questions-duplicate.operations';
import { baseUrlFromProblemUrl, domainIdFromProblemUrl } from './questions-reference.operations';
import { QuestionsContext } from './questions.context';
export async function buildResourceSnapshot(ctx: QuestionsContext, tx: Prisma.TransactionClient | PrismaService, ...values: unknown[]): Promise<Prisma.InputJsonArray> {
    const urls = extractResourceReferences(ctx, ...values);
    const objectKeys = urls.map((url) => url.replace(/^\/?uploads\//, ''));
    const assets = objectKeys.length
        ? await tx.fileAsset.findMany({ where: { objectKey: { in: objectKeys }, deletedAt: null } })
        : [];
    const byKey = new Map(assets.map((asset) => [asset.objectKey, asset]));
    return urls.map((url) => {
        const objectKey = url.replace(/^\/?uploads\//, '');
        const asset = byKey.get(objectKey);
        return {
            logicalUrl: url,
            assetId: asset?.id ?? null,
            objectKey,
            version: asset?.version ?? 1,
            sha256: asset?.sha256 ?? null,
            fileSize: asset ? Number(asset.fileSize) : null,
            mimeType: asset?.mimeType ?? null,
        } as Prisma.InputJsonObject;
    });
}
export async function buildSnapshot(ctx: QuestionsContext, tx: Prisma.TransactionClient | PrismaService, questionId: string): Promise<Prisma.InputJsonObject> {
    const question = await tx.question.findUniqueOrThrow({
        where: { id: questionId },
        include: {
            course: true,
            options: { orderBy: { sortOrder: 'asc' } },
            answer: true,
            programmingRef: true,
            knowledgePoints: { include: { knowledgePoint: true } },
            tags: { include: { tag: true } },
            compositionChildren: { orderBy: { sortOrder: 'asc' } },
        },
    });
    const children = await Promise.all(question.compositionChildren.map(async (relation) => ({
        questionId: relation.childQuestionId,
        score: Number(relation.score),
        sortOrder: relation.sortOrder,
        snapshot: await buildSnapshot(ctx, tx, relation.childQuestionId),
    })));
    const resources = await buildResourceSnapshot(ctx, tx, question.content, question.analysis, question.options, question.answer?.answerJson, question.answer?.scoringRuleJson);
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
        engine: {
            adapterKey: toApiEnum(question.type),
            adapterVersion: ctx.questionTypes.descriptor(toApiEnum(question.type)).version,
            schemaVersion: 1,
        },
        options: question.options.map((option) => ({
            id: option.id,
            optionKey: option.optionKey,
            content: option.content,
            isCorrect: option.isCorrect,
            sortOrder: option.sortOrder,
        })),
        answer: question.answer?.answerJson ?? null,
        scoringRule: question.answer?.scoringRuleJson ?? null,
        scoringRuleVersionId: question.answer?.currentRuleVersionId ?? null,
        programmingRef: question.programmingRef
            ? formatProgrammingRef(ctx, question.programmingRef)
            : null,
        knowledgePoints: question.knowledgePoints.map((relation) => ({
            id: relation.knowledgePoint.id,
            name: relation.knowledgePoint.name,
        })),
        tags: question.tags.map((relation) => ({
            id: relation.tag.id,
            name: relation.tag.name,
        })),
        resources,
        children,
    };
}
export function programmingLanguages(ctx: QuestionsContext, value: Prisma.JsonValue | null) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return [];
    const languages = (value as Record<string, unknown>).languages;
    return Array.isArray(languages) ? languages.map(String).filter(Boolean) : [];
}
export function formatProgrammingRef(ctx: QuestionsContext, ref: {
    judgeProvider: string;
    externalProblemId: string;
    externalProblemUrl: string | null;
    languageConfigJson: Prisma.JsonValue | null;
    timeLimit: number | null;
    memoryLimit: number | null;
    judgeConfigJson: Prisma.JsonValue | null;
}) {
    const judgeConfig = toPlainRecord(ctx, ref.judgeConfigJson);
    return {
        judgeProvider: ref.judgeProvider,
        externalProblemId: ref.externalProblemId,
        externalProblemUrl: ref.externalProblemUrl,
        platformBaseUrl: String(judgeConfig.platformBaseUrl ?? baseUrlFromProblemUrl(ctx, ref.externalProblemUrl)).trim(),
        domainId: String(judgeConfig.domainId ?? domainIdFromProblemUrl(ctx, ref.externalProblemUrl) ?? 'system').trim(),
        domainName: String(judgeConfig.domainName ?? judgeConfig.domainId ?? domainIdFromProblemUrl(ctx, ref.externalProblemUrl) ?? 'system').trim(),
        accountId: judgeConfig.accountId ? String(judgeConfig.accountId) : null,
        accountLabel: judgeConfig.accountLabel ? String(judgeConfig.accountLabel) : null,
        languages: programmingLanguages(ctx, ref.languageConfigJson),
        timeLimit: ref.timeLimit,
        memoryLimit: ref.memoryLimit,
        judgeConfig: ref.judgeConfigJson,
    };
}
export function extractResourceReferences(ctx: QuestionsContext, ...values: unknown[]) {
    const references = new Set<string>();
    const visit = (value: unknown) => {
        if (typeof value === 'string') {
            const markdownLinkRegex = /!?\[[^\]]*]\(([^)]+)\)/g;
            const uploadRegex = /(?:^|["'\s(])((?:\/uploads\/|uploads\/)[^"'\s)]+)/g;
            let match: RegExpExecArray | null;
            while ((match = markdownLinkRegex.exec(value))) {
                const url = cleanResourceUrl(ctx, match[1]);
                if (url)
                    references.add(url);
            }
            while ((match = uploadRegex.exec(value))) {
                const url = cleanResourceUrl(ctx, match[1]);
                if (url)
                    references.add(url);
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
export async function resourceReferenceStats(ctx: QuestionsContext, urls: string[]) {
    const targetUrls = new Set(urls.map((url) => cleanResourceUrl(ctx, url)).filter(Boolean));
    const stats = new Map<string, {
        count: number;
        locations: string[];
    }>();
    for (const url of targetUrls)
        stats.set(url, { count: 0, locations: [] });
    if (!targetUrls.size)
        return stats;
    const add = (location: string, ...values: unknown[]) => {
        for (const url of extractResourceReferences(ctx, ...values)) {
            if (!targetUrls.has(url))
                continue;
            const current = stats.get(url) ?? { count: 0, locations: [] };
            current.count += 1;
            if (current.locations.length < 30)
                current.locations.push(location);
            stats.set(url, current);
        }
    };
    const [questions, questionVersions, paperQuestions, paperInstances] = await Promise.all([
        ctx.prisma.question.findMany({
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
        ctx.prisma.questionVersion.findMany({ select: { snapshotJson: true } }),
        ctx.prisma.paperQuestion.findMany({ select: { questionSnapshotJson: true } }),
        ctx.prisma.paperInstance.findMany({ select: { paperSnapshotJson: true } }),
    ]);
    for (const question of questions) {
        add(`题目：${question.title || question.id}`, question.content, question.analysis, question.options.map((option) => option.content), question.answer?.answerJson, question.answer?.scoringRuleJson);
    }
    for (const version of questionVersions)
        add('题目版本快照', version.snapshotJson);
    for (const paperQuestion of paperQuestions)
        add('试卷题目快照', paperQuestion.questionSnapshotJson);
    for (const instance of paperInstances)
        add('考试试卷实例快照', instance.paperSnapshotJson);
    return stats;
}
export function cleanResourceUrl(ctx: QuestionsContext, value: unknown) {
    const raw = String(value ?? '')
        .trim()
        .replace(/^<|>$/g, '')
        .split('#')[0]
        .split('?')[0];
    if (!raw || /^(https?:|data:|javascript:|mailto:)/i.test(raw))
        return '';
    return raw.startsWith('uploads/') ? `/${raw}` : raw;
}
export function resourceKind(ctx: QuestionsContext, url: string, mimeType?: string | null) {
    const value = `${mimeType ?? ''} ${url}`.toLowerCase();
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(value) || value.includes('image/'))
        return 'image';
    if (/\.pdf$/.test(value) || value.includes('application/pdf'))
        return 'pdf';
    if (/\.(doc|docx)$/.test(value) || value.includes('word'))
        return 'word';
    if (/\.(xls|xlsx|csv)$/.test(value) || value.includes('spreadsheet'))
        return 'sheet';
    return 'file';
}
export function stableStringify(ctx: QuestionsContext, value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(ctx, item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value as Record<string, unknown>)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(ctx, (value as Record<string, unknown>)[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}
