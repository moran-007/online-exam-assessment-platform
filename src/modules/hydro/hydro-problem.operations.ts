/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AnswerRecordStatus,
  AttemptStatus,
  HydroAccount,
  MasteryStatus,
  Prisma,
  QuestionStatus,
  QuestionType,
  UserStatus,
  UserType,
  WrongQuestionSourceType,
} from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { toApiEnum } from '../../common/utils/enum-normalizer';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  BindHydroAccountDto,
  BindHydroProblemDto,
  PullHydroProblemDto,
  QueryHydroSummaryDto,
  SaveHydroPlatformDto,
  SaveHydroTaskDto,
  SyncHydroTasksDto,
  SubmitHydroCodeDto,
  UpdateHydroTaskDto,
  WriteBackHydroResultDto,
} from './dto/hydro.dto';

type SnapshotQuestion = {
  questionId: string;
  score: number;
  snapshot: {
    id: string;
    type: string;
    title: string;
    content: string;
    programmingRef?: {
      judgeProvider: string;
      externalProblemId: string;
      externalProblemUrl?: string | null;
      languages?: string[];
      timeLimit?: number | null;
      memoryLimit?: number | null;
      judgeConfig?: Prisma.JsonValue | null;
    } | null;
  };
};

type PaperSnapshot = {
  sections: Array<{ questions: SnapshotQuestion[] }>;
};

type HydroSubmitResult = {
  mode: 'direct' | 'manual';
  externalSubmissionId?: string | null;
  problemUrl: string;
  recordUrl?: string | null;
  status?: string | null;
  score?: number | null;
  judgedAt?: string | null;
  result?: Record<string, unknown> | null;
  raw?: unknown;
  message?: string;
};

type HydroProblemBinding = {
  judgeProvider: string;
  externalProblemId: string;
  externalProblemUrl?: string | null;
  platformBaseUrl?: string | null;
  domainId?: string | null;
  domainName?: string | null;
  accountId?: string | null;
  accountLabel?: string | null;
  languages?: string[];
  timeLimit?: number | null;
  memoryLimit?: number | null;
  judgeConfig?: Prisma.JsonValue | null;
};

type HydroSession = {
  baseUrl: string;
  cookieHeader: () => string;
  fetch: (url: string, init?: RequestInit & { headers?: Record<string, string> }) => Promise<Response>;
};

type HydroRecordResult = {
  externalSubmissionId: string;
  recordUrl: string;
  status: string;
  score: number | null;
  passedTestCaseCount: number | null;
  totalTestCaseCount: number | null;
  message: string;
  judgedAt: string | null;
  final: boolean;
  result: Record<string, unknown>;
};

type ExternalOjPlatformRow = {
  id: string;
  code: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type HydroTaskRecord = Prisma.HydroTaskGetPayload<Record<string, never>>;
import { HydroContext } from './hydro.context';
import { domainIdFromProblemUrl, formatProblemRef, normalizeProblemUrl, shortHost, submitPageUrlFromProblemUrl } from './hydro-external-format.operations';
import { extractHydroContext, extractHydroLanguages, extractHydroStatementHtml, extractHydroTitle, extractMemoryLimit, extractTimeLimit, fetchHydroProblemHtml, htmlToMarkdown, pickHydroLanguages, resolveHydroProblemBySearch } from './hydro-html-parser.operations';
import { createHydroSession } from './hydro-http-gateway.operations';
import { baseUrlFromProblemUrl, isSamePlatformBaseUrl, normalizePlatformBaseUrl, normalizePlatformCode } from './hydro-platform.operations';
import { absoluteHydroUrl, toPositiveNumber, toRecord } from './hydro-support.operations';
export async function pullProblem(ctx: HydroContext, query: PullHydroProblemDto) {
    const source = (query.problemUrl || query.problemId || '').trim();
    if (!source) throw new BadRequestException('请填写 Hydro 题号或题目链接');

    const pullAccount = query.accountId
      ? await ctx.prisma.hydroAccount.findFirst({ where: { id: query.accountId } })
      : null;
    if (query.accountId && !pullAccount) throw new NotFoundException('录入账号不存在');
    const judgeProvider = normalizePlatformCode(ctx, query.judgeProvider || pullAccount?.platformCode);
    const pullSession = pullAccount ? await createHydroSession(ctx, pullAccount) : null;
    const baseUrl = normalizePlatformBaseUrl(ctx, 
      query.platformBaseUrl || pullAccount?.platformBaseUrl || baseUrlFromProblemUrl(ctx, query.problemUrl),
    );
    const fallbackProblemId = problemIdFromInput(ctx, source);
    const requestedDomainId = String(query.domainId || '').trim();
    const targetUrl =
      query.problemUrl?.trim() || normalizeProblemUrl(ctx, fallbackProblemId, undefined, baseUrl, requestedDomainId);
    let fetched: { url: string; html: string };
    try {
      fetched = await fetchHydroProblemHtml(ctx, targetUrl, pullSession);
    } catch (error) {
      if (query.problemUrl?.trim()) throw error;
      const resolvedUrl = await resolveHydroProblemBySearch(ctx, source, baseUrl, pullSession, requestedDomainId);
      fetched = await fetchHydroProblemHtml(ctx, resolvedUrl, pullSession);
    }
    const context = extractHydroContext(ctx, fetched.html);
    const pdoc = toRecord(ctx, context.pdoc);
    const config = toRecord(ctx, pdoc.config);
    const contextProblemId = String(context.problemId ?? pdoc.pid ?? fallbackProblemId).trim();
    const externalProblemId = contextProblemId || fallbackProblemId;
    const fetchedProblemUrl = normalizeProblemUrl(ctx, externalProblemId, fetched.url);
    const rawLanguages = extractHydroLanguages(ctx, fetched.html, config);
    const languages = pickHydroLanguages(ctx, rawLanguages);
    const statementHtml = extractHydroStatementHtml(ctx, fetched.html, context);
    const content = htmlToMarkdown(ctx, statementHtml);

    if (!content.trim()) {
      throw new BadRequestException('Hydro 题干拉取失败，请确认题目是否公开或题号是否正确');
    }

    const timeLimit = toPositiveNumber(ctx, config.timeMax ?? config.timeMin) ?? extractTimeLimit(ctx, fetched.html);
    const memoryLimit =
      toPositiveNumber(ctx, config.memoryMax ?? config.memoryMin) ?? extractMemoryLimit(ctx, fetched.html);
    const numericProblemId = toPositiveNumber(ctx, context.problemNumId ?? pdoc.docId);
    const domainId = String(query.domainId || context.domainId || pdoc.domainId || 'system').trim() || 'system';
    const domain = toRecord(ctx, context.domain);
    const domainName = String(query.domainName || domain.name || domain.displayName || domain._id || domainId).trim();
    const fetchedBaseUrl = baseUrlFromProblemUrl(ctx, fetchedProblemUrl) || baseUrl;
    const platformBaseUrl =
      pullAccount && isSamePlatformBaseUrl(ctx, pullAccount.platformBaseUrl, fetchedBaseUrl)
        ? normalizePlatformBaseUrl(ctx, pullAccount.platformBaseUrl)
        : fetchedBaseUrl;
    const externalProblemUrl = normalizeProblemUrl(ctx, externalProblemId, undefined, platformBaseUrl, domainId);
    const accountLabel = pullAccount
      ? `${pullAccount.loginUsername || pullAccount.hydroUsername}@${shortHost(ctx, pullAccount.platformBaseUrl)}`
      : '';

    return {
      type: 'programming',
      title: extractHydroTitle(ctx, fetched.html, context) || externalProblemId,
      content,
      externalProblemId,
      externalProblemUrl,
      languages,
      timeLimit,
      memoryLimit,
      programmingRef: {
        judgeProvider,
        externalProblemId,
        externalProblemUrl,
        platformBaseUrl,
        domainId,
        domainName,
        accountId: pullAccount?.id ?? null,
        accountLabel,
        languages,
        timeLimit,
        memoryLimit,
        judgeConfig: {
          platformCode: judgeProvider,
          platformName: pullAccount?.platformName ?? undefined,
          platformBaseUrl,
          domainId,
          domainName,
          accountId: pullAccount?.id ?? null,
          accountLabel,
          numericProblemId,
          submitPageUrl: submitPageUrlFromProblemUrl(ctx, externalProblemUrl),
          postSubmitUrl: absoluteHydroUrl(ctx, context.postSubmitUrl, platformBaseUrl),
          getSubmissionsUrl: absoluteHydroUrl(ctx, context.getSubmissionsUrl, platformBaseUrl),
          getRecordDetailUrl: absoluteHydroUrl(ctx, context.getRecordDetailUrl, platformBaseUrl),
          rawLanguages,
          sourceUrl: fetched.url,
        },
      },
    };
  }

export async function listProblemBindings(ctx: HydroContext, query: QueryHydroSummaryDto, _user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.QuestionWhereInput = {
      deletedAt: null,
      type: QuestionType.PROGRAMMING,
      courseId: query.courseId,
      id: query.questionId,
      OR: query.keyword
        ? [
            { title: { contains: query.keyword, mode: 'insensitive' } },
            { content: { contains: query.keyword, mode: 'insensitive' } },
            { programmingRef: { externalProblemId: { contains: query.keyword, mode: 'insensitive' } } },
          ]
        : undefined,
    };
    const [items, total] = await ctx.prisma.$transaction([
      ctx.prisma.question.findMany({
        where,
        include: {
          course: { select: { name: true } },
          programmingRef: true,
          _count: { select: { judgeSubmissions: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      ctx.prisma.question.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        questionId: item.id,
        title: item.title,
        courseId: item.courseId,
        courseName: item.course.name,
        status: toApiEnum(item.status),
        defaultScore: Number(item.defaultScore),
        submissionCount: item._count.judgeSubmissions,
        binding: item.programmingRef ? formatProblemRef(ctx, item.programmingRef) : null,
      })),
      page,
      pageSize,
      total,
    };
  }

export async function problemBinding(ctx: HydroContext, questionId: string) {
    const question = await ctx.prisma.question.findFirst({
      where: { id: questionId, deletedAt: null },
      include: { programmingRef: true },
    });
    if (!question) throw new NotFoundException('题目不存在');
    return question.programmingRef ? formatProblemRef(ctx, question.programmingRef) : null;
  }

export async function bindProblem(ctx: HydroContext, questionId: string, dto: BindHydroProblemDto, user: RequestUser) {
    const question = await ctx.prisma.question.findFirst({
      where: { id: questionId, deletedAt: null },
      select: { id: true, type: true, title: true },
    });
    if (!question) throw new NotFoundException('题目不存在');
    if (question.type !== QuestionType.PROGRAMMING) {
      throw new BadRequestException('只有编程题可以绑定 Hydro 题目');
    }

    const provider = (dto.judgeProvider || 'hydro').trim().toLowerCase();
    const externalProblemId = dto.externalProblemId.trim();
    const platformBaseUrl = normalizePlatformBaseUrl(ctx, dto.platformBaseUrl || baseUrlFromProblemUrl(ctx, dto.externalProblemUrl));
    const externalProblemUrl = normalizeProblemUrl(ctx, externalProblemId, dto.externalProblemUrl, platformBaseUrl, dto.domainId);
    const domainId = String(dto.domainId || domainIdFromProblemUrl(ctx, externalProblemUrl) || 'system').trim() || 'system';
    const domainName = String(dto.domainName || domainId).trim();
    const accountLabel = dto.accountLabel?.trim() || '';
    const languageConfig = {
      languages: (dto.languages ?? []).map((item) => item.trim()).filter(Boolean),
    };
    const judgeConfig = {
      ...(dto.judgeConfig ?? {}),
      platformCode: provider,
      platformBaseUrl,
      domainId,
      domainName,
      accountId: dto.accountId ?? toRecord(ctx, dto.judgeConfig).accountId ?? null,
      accountLabel,
      submitPageUrl:
        String(toRecord(ctx, dto.judgeConfig).submitPageUrl ?? '').trim() ||
        submitPageUrlFromProblemUrl(ctx, externalProblemUrl),
    };

    const binding = await ctx.prisma.programmingProblemRef.upsert({
      where: { questionId },
      update: {
        judgeProvider: provider,
        externalProblemId,
        externalProblemUrl,
        languageConfigJson: languageConfig as Prisma.InputJsonObject,
        timeLimit: dto.timeLimit,
        memoryLimit: dto.memoryLimit,
        judgeConfigJson: judgeConfig as Prisma.InputJsonObject,
      },
      create: {
        questionId,
        judgeProvider: provider,
        externalProblemId,
        externalProblemUrl,
        languageConfigJson: languageConfig as Prisma.InputJsonObject,
        timeLimit: dto.timeLimit,
        memoryLimit: dto.memoryLimit,
        judgeConfigJson: judgeConfig as Prisma.InputJsonObject,
      },
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'hydro:bind-problem',
      module: 'hydro',
      targetType: 'question',
      targetId: questionId,
      afterData: { externalProblemId, externalProblemUrl },
    });

    return formatProblemRef(ctx, binding);
  }

export async function removeProblemBinding(ctx: HydroContext, questionId: string, user: RequestUser) {
    await ctx.prisma.programmingProblemRef.deleteMany({ where: { questionId } });
    await ctx.audit.log({
      userId: user.id,
      action: 'hydro:remove-problem-binding',
      module: 'hydro',
      targetType: 'question',
      targetId: questionId,
    });
    return true;
  }

export function problemIdFromInput(ctx: HydroContext, value: string) {
    const raw = value.trim();
    if (!raw) throw new BadRequestException('请填写 Hydro 题号或题目链接');
    try {
      const url = new URL(raw);
      const match = url.pathname.match(/\/p\/([^/?#]+)/);
      if (match?.[1]) return decodeURIComponent(match[1]).trim();
    } catch {
      const match = raw.match(/\/p\/([^/?#]+)/);
      if (match?.[1]) return decodeURIComponent(match[1]).trim();
    }
    return raw.replace(/^#/, '').trim();
  }