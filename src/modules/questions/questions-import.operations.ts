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
import { checkDuplicates } from './questions-duplicate.operations';
import { create, publish as publishQuestion } from './questions-write.operations';
import { QuestionsContext } from './questions.context';
export async function excelImportTemplate(ctx: QuestionsContext) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'online-exam-assessment-platform';
    const worksheet = workbook.addWorksheet('题库导入模板');
    worksheet.columns = [
        { header: '题目标识', key: 'identifier', width: 16 },
        { header: '父题标识', key: 'parentIdentifier', width: 16 },
        { header: '子题分值', key: 'childScore', width: 12 },
        { header: '子题顺序', key: 'childOrder', width: 12 },
        { header: '题型', key: 'type', width: 16 },
        { header: '标题', key: 'title', width: 28 },
        { header: '题干', key: 'content', width: 48 },
        { header: '选项A', key: 'optionA', width: 24 },
        { header: '选项B', key: 'optionB', width: 24 },
        { header: '选项C', key: 'optionC', width: 24 },
        { header: '选项D', key: 'optionD', width: 24 },
        { header: '正确答案', key: 'answer', width: 22 },
        { header: '解析', key: 'analysis', width: 36 },
        { header: '课程', key: 'course', width: 20 },
        { header: '知识点', key: 'knowledgePoints', width: 28 },
        { header: '标签', key: 'tags', width: 24 },
        { header: '难度', key: 'difficulty', width: 10 },
        { header: '分值', key: 'score', width: 10 },
        { header: '允许选项随机', key: 'allowOptionShuffle', width: 14 },
    ];
    worksheet.addRows([
        {
            identifier: 'Q-001',
            type: '单选题',
            title: 'Python 输出',
            content: '以下哪个函数用于输出内容？',
            optionA: 'print()',
            optionB: 'input()',
            optionC: 'len()',
            optionD: 'range()',
            answer: 'A',
            analysis: 'print() 用于输出。',
            course: 'Python 基础',
            knowledgePoints: '输入输出',
            tags: '基础题,课堂练习',
            difficulty: 1,
            score: 2,
            allowOptionShuffle: '是',
        },
        {
            identifier: 'Q-002',
            type: '多选题',
            title: '循环语句',
            content: '下面哪些是 Python 循环语句？',
            optionA: 'for',
            optionB: 'while',
            optionC: 'if',
            optionD: 'def',
            answer: 'A,B',
            analysis: 'for 和 while 是循环。',
            course: 'Python 基础',
            knowledgePoints: '循环',
            tags: '基础题',
            difficulty: 2,
            score: 4,
            allowOptionShuffle: '是',
        },
        {
            identifier: 'Q-003',
            type: '填空题',
            title: '变量赋值',
            content: '把数字 3 赋值给变量 a：a = ____',
            answer: '3',
            analysis: '赋值号右侧写 3。',
            course: 'Python 基础',
            knowledgePoints: '变量',
            tags: '填空',
            difficulty: 1,
            score: 2,
            allowOptionShuffle: '否',
        },
    ]);
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    return Buffer.from(await workbook.xlsx.writeBuffer());
}
export async function importFromExcel(ctx: QuestionsContext, file: {
    originalname?: string;
    buffer: Buffer;
}, options: ExcelImportOptions, userId: string) {
    if (!file?.buffer?.length) {
        throw new BadRequestException('请上传 Excel 文件');
    }
    const workbook = new ExcelJS.Workbook();
    try {
        await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    }
    catch {
        throw new BadRequestException('Excel 文件格式无效或已损坏');
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
        throw new BadRequestException('Excel 文件中没有可读取的工作表');
    }
    const headerMap = excelHeaderMap(ctx, worksheet);
    const rows = excelQuestionRows(ctx, worksheet, headerMap);
    if (!rows.length) {
        throw new BadRequestException('Excel 中没有可导入的题目行');
    }
    const publish = options.publish ?? false;
    const skipDuplicates = options.skipDuplicates ?? true;
    const items: Array<{
        rowNumber: number;
        title: string;
        status: 'imported' | 'skipped' | 'failed';
        questionId?: string;
        message: string;
    }> = [];
    const importedIds = new Map<string, string>();
    const orderedRows = [
        ...rows.filter((row) => excelQuestionType(ctx, row.type) !== 'material'),
        ...rows.filter((row) => excelQuestionType(ctx, row.type) === 'material'),
    ];
    for (const row of orderedRows) {
        try {
            const payload = excelRowToCreateDto(ctx, row);
            if (excelQuestionType(ctx, row.type) === 'material') {
                if (!row.identifier)
                    throw new BadRequestException(`第 ${row.rowNumber} 行材料题缺少题目标识`);
                const childRows = rows
                    .filter((child) => child.parentIdentifier === row.identifier)
                    .sort((a, b) => a.childOrder - b.childOrder || a.rowNumber - b.rowNumber);
                payload.children = childRows.map((child, index) => {
                    const questionId = importedIds.get(child.identifier);
                    if (!questionId)
                        throw new BadRequestException(`子题标识 ${child.identifier || `第 ${child.rowNumber} 行`} 尚未成功导入`);
                    return {
                        questionId,
                        score: child.childScore > 0 ? child.childScore : child.defaultScore,
                        sortOrder: child.childOrder || index + 1,
                    };
                });
                if (!payload.children.length)
                    throw new BadRequestException(`材料题 ${row.identifier} 没有匹配到子题`);
            }
            const duplicate = (await checkDuplicates(ctx, [payload])).items[0];
            if (duplicate && duplicate.status !== 'ok') {
                const message = duplicate.message || '发现重复或冲突题目';
                if (skipDuplicates) {
                    items.push({ rowNumber: row.rowNumber, title: row.title, status: 'skipped', message });
                    continue;
                }
                throw new BadRequestException(message);
            }
            const created = await create(ctx, payload, userId);
            if (row.identifier)
                importedIds.set(row.identifier, created.id);
            if (publish) {
                await publishQuestion(ctx, created.id, userId);
            }
            items.push({
                rowNumber: row.rowNumber,
                title: row.title,
                status: 'imported',
                questionId: created.id,
                message: publish ? '已导入并发布' : '已导入为草稿',
            });
        }
        catch (error) {
            items.push({
                rowNumber: row.rowNumber,
                title: row.title,
                status: 'failed',
                message: error instanceof Error ? error.message : '导入失败',
            });
        }
    }
    const importedCount = items.filter((item) => item.status === 'imported').length;
    const skippedCount = items.filter((item) => item.status === 'skipped').length;
    const failedCount = items.filter((item) => item.status === 'failed').length;
    await ctx.audit.log({
        userId,
        action: 'question:import-excel',
        module: 'question',
        afterData: {
            fileName: file.originalname,
            importedCount,
            skippedCount,
            failedCount,
        },
    });
    return {
        importedCount,
        skippedCount,
        failedCount,
        total: items.length,
        items,
    };
}
export function excelHeaderMap(ctx: QuestionsContext, worksheet: ExcelJS.Worksheet) {
    const map = new Map<string, number>();
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
        for (const key of excelHeaderKeys(ctx, cellText(ctx, cell.value))) {
            if (!map.has(key))
                map.set(key, colNumber);
        }
    });
    return map;
}
export function excelQuestionRows(ctx: QuestionsContext, worksheet: ExcelJS.Worksheet, headerMap: Map<string, number>) {
    const rows: ExcelQuestionRow[] = [];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1)
            return;
        const content = excelValue(ctx, row, headerMap, ['content', '题干', '题目内容']);
        const title = excelValue(ctx, row, headerMap, ['title', '标题', '题目标题']) || content.slice(0, 80);
        const type = excelValue(ctx, row, headerMap, ['type', '题型']) || '单选题';
        const courseName = excelValue(ctx, row, headerMap, ['course', 'courseName', '课程']);
        if (!title && !content && !courseName)
            return;
        const optionValues: ExcelQuestionRow['optionValues'] = [];
        for (const key of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
            const value = excelValue(ctx, row, headerMap, [`option${key}`, `选项${key}`]);
            if (value)
                optionValues.push({ optionKey: key, content: value });
        }
        rows.push({
            rowNumber,
            title,
            content,
            type,
            courseName,
            knowledgePointNames: splitNames(ctx, excelValue(ctx, row, headerMap, ['knowledgePoints', 'knowledgePoint', '知识点'])),
            tagNames: splitNames(ctx, excelValue(ctx, row, headerMap, ['tags', '标签'])),
            difficulty: clampImportNumber(ctx, excelValue(ctx, row, headerMap, ['difficulty', '难度']), 1, 5, 1),
            defaultScore: nonNegativeImportNumber(ctx, excelValue(ctx, row, headerMap, ['score', 'defaultScore', '分值']), 2),
            analysis: excelValue(ctx, row, headerMap, ['analysis', '解析']),
            answerText: excelValue(ctx, row, headerMap, ['answer', 'correctAnswer', '正确答案', '答案']),
            optionValues,
            allowOptionShuffle: optionalBooleanFromExcel(ctx, excelValue(ctx, row, headerMap, ['allowOptionShuffle', '允许选项随机'])),
            identifier: excelValue(ctx, row, headerMap, ['identifier', '题目标识']),
            parentIdentifier: excelValue(ctx, row, headerMap, ['parentIdentifier', '父题标识']),
            childScore: nonNegativeImportNumber(ctx, excelValue(ctx, row, headerMap, ['childScore', '子题分值']), 0),
            childOrder: nonNegativeImportNumber(ctx, excelValue(ctx, row, headerMap, ['childOrder', '子题顺序']), rowNumber),
        });
    });
    return rows;
}
export function excelRowToCreateDto(ctx: QuestionsContext, row: ExcelQuestionRow): CreateQuestionDto {
    if (!row.courseName)
        throw new BadRequestException(`第 ${row.rowNumber} 行缺少课程`);
    if (!row.content)
        throw new BadRequestException(`第 ${row.rowNumber} 行缺少题干`);
    const type = excelQuestionType(ctx, row.type);
    const options = excelOptions(ctx, type, row.optionValues, row.answerText);
    return {
        courseName: row.courseName,
        type,
        title: row.title || row.content.slice(0, 80),
        content: row.content,
        difficulty: row.difficulty,
        defaultScore: row.defaultScore,
        analysis: row.analysis,
        allowOptionShuffle: row.allowOptionShuffle,
        knowledgePointNames: row.knowledgePointNames,
        tagNames: row.tagNames,
        options,
        answer: excelAnswer(ctx, type, row.answerText),
        scoringRule: type === 'fill_blank' ? { mode: 'exact' } : { mode: 'strict' },
    };
}
export function excelOptions(ctx: QuestionsContext, type: string, values: ExcelQuestionRow['optionValues'], answerText: string) {
    const options = type === 'true_false' && !values.length
        ? [
            { optionKey: 'A', content: '正确' },
            { optionKey: 'B', content: '错误' },
        ]
        : values;
    const correctKeys = excelCorrectOptionKeys(ctx, type, answerText);
    return options.map((option, index) => ({
        optionKey: option.optionKey,
        content: option.content,
        isCorrect: correctKeys.has(option.optionKey),
        sortOrder: index + 1,
    }));
}
export function excelAnswer(ctx: QuestionsContext, type: string, answerText: string) {
    if (type === 'fill_blank') {
        const parts = answerText.split(/[;；]/).map((item) => item.trim()).filter(Boolean);
        return {
            blanks: (parts.length ? parts : [answerText]).map((part, index) => ({
                index: index + 1,
                answers: part.split(/[，,、/|]/).map((item) => item.trim()).filter(Boolean),
                trimSpace: true,
                ignoreCase: false,
            })),
        };
    }
    if (['short_answer', 'programming', 'material', 'file_upload', 'scratch_project', 'arduino_project'].includes(type)) {
        return { reference: answerText };
    }
    return {};
}
export function excelCorrectOptionKeys(ctx: QuestionsContext, type: string, answerText: string) {
    const normalized = answerText.trim();
    if (type === 'true_false') {
        if (/^(正确|对|true|t|yes|y|1|a)$/i.test(normalized))
            return new Set(['A']);
        if (/^(错误|错|false|f|no|n|0|b)$/i.test(normalized))
            return new Set(['B']);
    }
    return new Set(normalized
        .split(/[，,;；、\s]+/)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean));
}
export function excelQuestionType(ctx: QuestionsContext, value: string) {
    const map: Record<string, string> = {
        单选: 'single_choice',
        单选题: 'single_choice',
        多选: 'multiple_choice',
        多选题: 'multiple_choice',
        判断: 'true_false',
        判断题: 'true_false',
        填空: 'fill_blank',
        填空题: 'fill_blank',
        简答: 'short_answer',
        简答题: 'short_answer',
        编程: 'programming',
        编程题: 'programming',
        材料: 'material',
        材料题: 'material',
        '材料/组合题': 'material',
        组合题: 'material',
        大题: 'material',
        '大题/组合题': 'material',
        多问题: 'material',
        多问简答: 'material',
        文件上传: 'file_upload',
        文件上传题: 'file_upload',
        scratch: 'scratch_project',
        scratch项目题: 'scratch_project',
        arduino: 'arduino_project',
        arduino项目题: 'arduino_project',
    };
    const raw = value.trim();
    return toApiEnum(normalizeQuestionType(map[raw] ?? map[raw.toLowerCase()] ?? (raw || 'single_choice')));
}
export function excelValue(ctx: QuestionsContext, row: ExcelJS.Row, headerMap: Map<string, number>, keys: string[]) {
    for (const key of keys.flatMap((item) => excelHeaderKeys(ctx, item))) {
        const index = headerMap.get(key);
        if (!index)
            continue;
        const value = cellText(ctx, row.getCell(index).value);
        if (value)
            return value;
    }
    return '';
}
export function excelHeaderKeys(ctx: QuestionsContext, value: string) {
    const normalized = value.trim();
    const compact = normalized.toLowerCase().replace(/\s+/g, '');
    const optionMatch = compact.match(/^(?:选项|option)([a-z])$/i);
    return [
        normalized,
        compact,
        optionMatch ? `option${optionMatch[1].toUpperCase()}` : '',
        optionMatch ? `选项${optionMatch[1].toUpperCase()}` : '',
    ].filter(Boolean);
}
export function cellText(ctx: QuestionsContext, value: ExcelJS.CellValue) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'object') {
        if ('text' in value && value.text)
            return String(value.text).trim();
        if ('result' in value && value.result !== undefined)
            return String(value.result).trim();
        if ('richText' in value && Array.isArray(value.richText)) {
            return value.richText.map((item) => item.text).join('').trim();
        }
        if (value instanceof Date)
            return value.toISOString();
        return String((value as {
            formula?: string;
        }).formula ?? '').trim();
    }
    return String(value).trim();
}
export function splitNames(ctx: QuestionsContext, value: string) {
    return [...new Set(value.split(/[，,;；、]/).map((item) => item.trim()).filter(Boolean))];
}
export function clampImportNumber(ctx: QuestionsContext, value: string, min: number, max: number, fallback: number) {
    const number = Number(value);
    if (!Number.isFinite(number))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}
export function nonNegativeImportNumber(ctx: QuestionsContext, value: string, fallback: number) {
    const number = Number(value);
    if (!Number.isFinite(number))
        return fallback;
    return Math.max(0, number);
}
export function optionalBooleanFromExcel(ctx: QuestionsContext, value: string) {
    if (!value)
        return undefined;
    if (/^(是|true|1|yes|y)$/i.test(value))
        return true;
    if (/^(否|false|0|no|n)$/i.test(value))
        return false;
    return undefined;
}
export function describeOption(ctx: QuestionsContext, optionId: string, optionMap: Map<string, {
    optionKey: string;
    content: string;
}>) {
    const option = optionMap.get(optionId);
    if (!option)
        return optionId;
    return `${option.optionKey}. ${option.content}`;
}
export function normalizeBlank(ctx: QuestionsContext, value: string, rule: {
    ignoreCase?: boolean;
    trimSpace?: boolean;
}) {
    let result = value;
    if (rule.trimSpace ?? true) {
        result = result.trim();
    }
    if (rule.ignoreCase) {
        result = result.toLowerCase();
    }
    return result;
}
