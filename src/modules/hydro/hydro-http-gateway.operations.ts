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
import { formatHydroAccount } from './hydro-account.operations';
import { extractHydroRecordIdFromLocation, normalizeProblemUrl, shortHost, submitPageUrlFromProblemUrl } from './hydro-external-format.operations';
import { baseUrlFromProblemUrl, isSamePlatformBaseUrl, normalizePlatformBaseUrl, normalizePlatformCode, platformName } from './hydro-platform.operations';
import { fetchHydroRecordResult } from './hydro-submission-sync.operations';
import { absoluteHydroUrl, decodeHtml, delay, stripTags, toRecord } from './hydro-support.operations';
import { hasHydroCredential, resolveHydroPassword } from './hydro-credential.operations';
export function isHydroBotChallenge(ctx: HydroContext, content?: string | null, locationOrUrl?: string | null) {
    const raw = `${content || ''} ${locationOrUrl || ''}`;
    const text = decodeHtml(ctx, stripTags(ctx, raw)).replace(/\s+/g, ' ').toLowerCase();
    const source = raw.toLowerCase();
    return (
      source.includes('cerberus challenge') ||
      source.includes("making sure you're not a bot") ||
      (source.includes('not a bot') && source.includes('challenge')) ||
      /\/challenge(?:[/?#\s]|$)/i.test(String(locationOrUrl || '')) ||
      text.includes('cerberus challenge') ||
      text.includes("making sure you're not a bot") ||
      text.includes('机器人检测') ||
      text.includes('人机验证')
    );
  }

export function sanitizeHydroMessage(ctx: HydroContext, value: string, fallback: string) {
    if (isHydroBotChallenge(ctx, value)) return ctx.hydroBotChallengeMessage;
    return decodeHtml(ctx, stripTags(ctx, value)).replace(/\s+/g, ' ').trim().slice(0, 240) || fallback;
  }

export async function markHydroAccountBlocked(ctx: HydroContext, account: Pick<HydroAccount, 'id'>) {
    await ctx.prisma.hydroAccount.updateMany({
      where: { id: account.id },
      data: {
        lastLoginStatus: 'blocked',
        lastLoginMessage: ctx.hydroBotChallengeMessage,
        lastLoginAt: new Date(),
      },
    });
    ctx.metrics.recordHydro('bot_challenge', 'blocked');
  }

export async function testHydroAccountLogin(ctx: HydroContext, account: HydroAccount) {
    const startedAt = Date.now();
    if (!account.loginUsername || !hasHydroCredential(account)) {
      throw new BadRequestException('外部账号缺少登录账号或密码');
    }

    const platformLabel = platformLoginLabel(ctx, account);
    let status = 'failed';
    let message = `${platformLabel} 登录失败`;
    try {
      await createHydroSession(ctx, account);
      status = 'success';
      message = `${platformLabel} 登录检测通过`;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : message;
      if (isHydroBotChallenge(ctx, rawMessage)) {
        status = 'blocked';
        message = ctx.hydroBotChallengeMessage;
      } else {
        message = sanitizeHydroMessage(ctx, rawMessage, message);
      }
    }

    const updated = await ctx.prisma.hydroAccount.update({
      where: { id: account.id },
      data: {
        lastLoginStatus: status,
        lastLoginMessage: message,
        lastLoginAt: new Date(),
      },
    });
    ctx.metrics.recordHydro('login', status, (Date.now() - startedAt) / 1000);
    return {
      ...formatHydroAccount(ctx, updated),
      success: status === 'success',
      status,
      message,
    };
  }

export async function submitToHydro(ctx: HydroContext, 
    binding: HydroProblemBinding,
    dto: SubmitHydroCodeDto,
    account: HydroAccount,
    waitSchedule = [1000, 2000, 3000],
  ): Promise<HydroSubmitResult> {
    if (account.lastLoginStatus === 'blocked') {
      throw new BadRequestException(ctx.hydroBotChallengeMessage);
    }

    const judgeConfig = toRecord(ctx, binding.judgeConfig);
    const bindingBaseUrl = normalizePlatformBaseUrl(ctx, 
      binding.platformBaseUrl ||
        String(judgeConfig.platformBaseUrl ?? '') ||
        account.platformBaseUrl ||
        baseUrlFromProblemUrl(ctx, binding.externalProblemUrl),
    );
    if (!isSamePlatformBaseUrl(ctx, account.platformBaseUrl, bindingBaseUrl)) {
      throw new BadRequestException(
        `提交账号属于 ${shortHost(ctx, account.platformBaseUrl)}，当前题目来源 ${shortHost(ctx, bindingBaseUrl)}，不能跨站点提交`,
      );
    }
    const baseUrl = normalizePlatformBaseUrl(ctx, account.platformBaseUrl);
    const domainId = String(binding.domainId || judgeConfig.domainId || '').trim();
    const problemUrl = normalizeProblemUrl(ctx, binding.externalProblemId, undefined, baseUrl, domainId);
    const session = await createHydroSession(ctx, account, baseUrl);
    const submitUrl = submitPageUrlFromProblemUrl(ctx, problemUrl) || `${baseUrl}/p/${encodeURIComponent(binding.externalProblemId)}/submit`;

    const form = new FormData();
    form.set('lang', dto.language);
    form.set('code', dto.code);
    const response = await session.fetch(submitUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Referer: submitUrl,
        Origin: baseUrl,
      },
      body: form,
    });
    const text = await response.text().catch(() => '');
    const location = response.headers.get('location') || '';
    if (isHydroBotChallenge(ctx, text, `${response.url} ${location}`)) {
      await markHydroAccountBlocked(ctx, account);
      throw new BadRequestException(ctx.hydroBotChallengeMessage);
    }
    const externalSubmissionId = extractHydroRecordIdFromLocation(ctx, location);
    if (!externalSubmissionId) {
      ctx.metrics.recordHydro('submit', 'rejected');
      const message = sanitizeHydroMessage(ctx, text, '未返回评测记录');
      throw new BadRequestException(`Hydro 提交失败：${response.status} ${message || '未返回评测记录'}`);
    }

    const recordUrl = absoluteHydroUrl(ctx, location, baseUrl);
    let record = await fetchHydroRecordResult(ctx, session, externalSubmissionId, recordUrl).catch(async (error) => {
      const message = error instanceof Error ? error.message : 'Hydro 结果读取失败';
      if (isHydroBotChallenge(ctx, message)) {
        await markHydroAccountBlocked(ctx, account);
      }
      return {
        externalSubmissionId,
        recordUrl,
        status: 'pending',
        score: null,
        passedTestCaseCount: null,
        totalTestCaseCount: null,
        message,
        judgedAt: null,
        final: false,
        result: { error: message },
      } satisfies HydroRecordResult;
    });
    for (const waitMs of waitSchedule) {
      if (record.final) break;
      await delay(ctx, waitMs);
      record = await fetchHydroRecordResult(ctx, session, externalSubmissionId, recordUrl).catch(async (error) => {
        const message = error instanceof Error ? error.message : 'Hydro 结果读取失败';
        if (isHydroBotChallenge(ctx, message)) {
          await markHydroAccountBlocked(ctx, account);
        }
        return record;
      });
    }

    ctx.metrics.recordHydro('submit', record.final ? 'judged' : 'pending');
    return {
      mode: 'direct',
      externalSubmissionId,
      problemUrl,
      recordUrl,
      status: record.status,
      score: record.score,
      judgedAt: record.judgedAt,
      result: record.result,
      raw: record.result,
      message: record.message || '代码已提交到 Hydro，等待判题结果',
    };
  }

export async function createHydroSession(ctx: HydroContext, account: HydroAccount, explicitBaseUrl?: string): Promise<HydroSession> {
    if (!account.loginUsername || !hasHydroCredential(account)) {
      throw new BadRequestException('外部账号缺少登录账号或密码');
    }
    const credentialPassword = await resolveHydroPassword(ctx, account);
    const baseUrl = normalizePlatformBaseUrl(ctx, explicitBaseUrl || account.platformBaseUrl);
    const platformLabel = platformLoginLabel(ctx, account);
    const cookies = new Map<string, string>();
    const collectCookies = (response: Response) => {
      const anyHeaders = response.headers as Headers & { getSetCookie?: () => string[]; raw?: () => Record<string, string[]> };
      const setCookies =
        anyHeaders.getSetCookie?.() ??
        anyHeaders.raw?.()['set-cookie'] ??
        (response.headers.get('set-cookie') ? [response.headers.get('set-cookie') as string] : []);
      for (const value of setCookies) {
        const cookie = value.split(';')[0];
        const equalsIndex = cookie.indexOf('=');
        if (equalsIndex > 0) {
          cookies.set(cookie.slice(0, equalsIndex), cookie.slice(equalsIndex + 1));
        }
      }
    };
    const cookieHeader = () => [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
    const sessionFetch: HydroSession['fetch'] = async (url, init = {}) => {
      const headers = {
        'User-Agent': 'Mozilla/5.0 OnlineExamHydro/1.0',
        ...(init.headers ?? {}),
        ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
      };
      const response = await fetch(absoluteHydroUrl(ctx, url, baseUrl), {
        ...init,
        headers,
      });
      collectCookies(response);
      return response;
    };

    const loginUrl = `${baseUrl}/login`;
    const loginPageResponse = await sessionFetch(loginUrl, { redirect: 'manual' });
    const loginPageText = await loginPageResponse.text().catch(() => '');
    const loginPageLocation = loginPageResponse.headers.get('location') || '';
    if (isHydroBotChallenge(ctx, loginPageText, `${loginPageResponse.url} ${loginPageLocation}`)) {
      await markHydroAccountBlocked(ctx, account);
      throw new BadRequestException(ctx.hydroBotChallengeMessage);
    }

    const body = new URLSearchParams({
      uname: account.loginUsername ?? '',
      password: credentialPassword,
      tfa: '',
      authnChallenge: '',
    });
    const response = await sessionFetch(loginUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: loginUrl,
        Origin: baseUrl,
      },
      body,
    });
    const text = await response.text().catch(() => '');
    const location = response.headers.get('location') || '';
    if (isHydroBotChallenge(ctx, text, `${response.url} ${location}`)) {
      await markHydroAccountBlocked(ctx, account);
      throw new BadRequestException(ctx.hydroBotChallengeMessage);
    }
    const redirectedAway = response.status >= 300 && response.status < 400 && !/\/login\b/i.test(location);
    const hasSession = cookies.has('sid') || cookies.has('sid.sig');
    const bodyLooksLoggedIn = /退出|注销|logout/i.test(text) && !/密码错误|登录失败|LoginError|password/i.test(text);
    if (!((redirectedAway && hasSession) || bodyLooksLoggedIn)) {
      const message = sanitizeHydroMessage(ctx, text, `${platformLabel} 登录失败：${response.status}`);
      throw new BadRequestException(message);
    }

    await ctx.prisma.hydroAccount.updateMany({
      where: { id: account.id },
      data: {
        lastLoginStatus: 'success',
        lastLoginMessage: `${platformLabel} 登录检测通过`,
        lastLoginAt: new Date(),
      },
    });

    return { baseUrl, cookieHeader, fetch: sessionFetch };
  }

export function platformLoginLabel(ctx: HydroContext, account: Pick<HydroAccount, 'platformCode' | 'platformName'>) {
    return account.platformName?.trim() || platformName(ctx, normalizePlatformCode(ctx, account.platformCode));
  }
