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
import { describeOption, normalizeBlank } from './questions-import.operations';
import { QuestionsContext } from './questions.context';
export async function checkAnswer(ctx: QuestionsContext, id: string, dto: CheckQuestionAnswerDto, userId: string) {
    const question = await ctx.prisma.question.findFirst({
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
    const scoreResult = ctx.questionTypes.grade({
        snapshot: {
            id: question.id,
            type: toApiEnum(question.type),
            answer: answerJson as Prisma.JsonObject,
            scoringRule: (question.answer?.scoringRuleJson ?? {}) as Prisma.JsonObject,
            options: question.options,
        },
        answer: dto,
        maxScore: Number(question.defaultScore),
    });
    const grading = {
        isCorrect: scoreResult.isCorrect,
        score: scoreResult.score,
        status: toApiEnum(scoreResult.status),
        message: scoreResultMessage(ctx, scoreResult),
        details: scoreResult.details,
        warnings: scoreResult.warnings,
        engine: scoreResult.engine,
    };
    const answerSummary = buildAnswerSummary(ctx, question.type, answerJson, dto, question.options);
    await ctx.audit.log({
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
export function gradeStandaloneQuestion(ctx: QuestionsContext, type: QuestionType, totalScore: number, answerJson: QuestionAnswerJson, submitted: CheckQuestionAnswerDto) {
    if (isChoiceQuestion(ctx, type)) {
        const selected = new Set((submitted.selectedOptionIds ?? []).filter(Boolean));
        const correct = new Set(answerJson.correctOptionIds ?? []);
        const isCorrect = selected.size === correct.size && [...selected].every((optionId) => correct.has(optionId));
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
            const normalizedSubmitted = normalizeBlank(ctx, submittedValue, rule);
            const matched = rule.answers
                .map((answer) => normalizeBlank(ctx, answer, rule))
                .includes(normalizedSubmitted);
            if (matched) {
                score += rule.score ?? totalScore / Math.max(rules.length, 1);
            }
            else {
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
export function scoreResultMessage(ctx: QuestionsContext, result: {
    isCorrect: boolean | null;
    status: unknown;
    warnings?: string[];
}) {
    if (result.warnings?.length)
        return result.warnings[0];
    if (result.isCorrect === true)
        return '回答正确';
    if (result.isCorrect === false)
        return '回答错误';
    const status = toApiEnum(result.status as never);
    if (status === 'judge_pending')
        return '该题型需要外部评测，已提供参考答案';
    if (status === 'submitted')
        return '该题型已提交，成绩由子题或后续流程汇总';
    return '该题型需要人工批改，已提供参考答案';
}
export function buildAnswerSummary(ctx: QuestionsContext, type: QuestionType, answerJson: QuestionAnswerJson, submitted: CheckQuestionAnswerDto, options: Array<{
    id: string;
    optionKey: string;
    content: string;
}>) {
    const optionMap = new Map(options.map((option) => [option.id, option]));
    const selectedOptionIds = (submitted.selectedOptionIds ?? []).filter(Boolean);
    const studentAnswerText = describeSubmittedAnswer(ctx, submitted, optionMap);
    const correctAnswerText = describeCorrectAnswer(ctx, type, answerJson, optionMap);
    const referenceAnswerText = describeReferenceAnswer(ctx, type, answerJson, correctAnswerText);
    const answerExplanation = describeAnswerRule(ctx, type, answerJson);
    return {
        studentAnswerText,
        correctAnswerText,
        referenceAnswerText,
        answerExplanation,
        selectedOptionLabels: selectedOptionIds.map((optionId) => describeOption(ctx, optionId, optionMap)),
    };
}
export function describeSubmittedAnswer(ctx: QuestionsContext, submitted: CheckQuestionAnswerDto, optionMap: Map<string, {
    optionKey: string;
    content: string;
}>) {
    const selectedOptionIds = (submitted.selectedOptionIds ?? []).filter(Boolean);
    if (selectedOptionIds.length) {
        return selectedOptionIds.map((optionId) => describeOption(ctx, optionId, optionMap)).join('\n\n');
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
export function describeCorrectAnswer(ctx: QuestionsContext, type: QuestionType, answerJson: QuestionAnswerJson, optionMap: Map<string, {
    optionKey: string;
    content: string;
}>) {
    if (isChoiceQuestion(ctx, type)) {
        const correctOptionIds = answerJson.correctOptionIds ?? [];
        return correctOptionIds.length
            ? correctOptionIds.map((optionId) => describeOption(ctx, optionId, optionMap)).join('\n\n')
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
export function describeReferenceAnswer(ctx: QuestionsContext, type: QuestionType, answerJson: QuestionAnswerJson, correctAnswerText: string) {
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
export function describeAnswerRule(ctx: QuestionsContext, type: QuestionType, answerJson: QuestionAnswerJson) {
    if (type !== QuestionType.FILL_BLANK)
        return '';
    const blanks = answerJson.blanks ?? [];
    if (!blanks.length)
        return '';
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
export function blankCount(ctx: QuestionsContext, answerJson: unknown) {
    if (!answerJson || typeof answerJson !== 'object' || Array.isArray(answerJson))
        return 1;
    const blanks = (answerJson as QuestionAnswerJson).blanks;
    return Array.isArray(blanks) && blanks.length ? blanks.length : 1;
}
export function answerRows(ctx: QuestionsContext, answerJson: unknown) {
    if (!answerJson || typeof answerJson !== 'object' || Array.isArray(answerJson))
        return undefined;
    const rows = Number((answerJson as {
        rows?: unknown;
        answerRows?: unknown;
    }).rows ?? (answerJson as {
        answerRows?: unknown;
    }).answerRows);
    if (!Number.isFinite(rows) || rows <= 0)
        return undefined;
    return Math.min(24, Math.max(2, Math.round(rows)));
}
export function isChoiceQuestion(ctx: QuestionsContext, type: QuestionType) {
    return (type === QuestionType.SINGLE_CHOICE ||
        type === QuestionType.MULTIPLE_CHOICE ||
        type === QuestionType.TRUE_FALSE);
}
