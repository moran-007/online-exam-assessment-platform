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
import { baseUrlFromProblemUrl, hydroBaseUrl, normalizePlatformBaseUrl } from './hydro-platform.operations';
import { extractByRegex, toRecord } from './hydro-support.operations';
export function formatProblemRef(ctx: HydroContext, ref: {
    judgeProvider: string;
    externalProblemId: string;
    externalProblemUrl: string | null;
    languageConfigJson: Prisma.JsonValue | null;
    timeLimit: number | null;
    memoryLimit: number | null;
    judgeConfigJson: Prisma.JsonValue | null;
  }): HydroProblemBinding {
    const languageConfig = toRecord(ctx, ref.languageConfigJson);
    const judgeConfig = toRecord(ctx, ref.judgeConfigJson);
    return {
      judgeProvider: ref.judgeProvider,
      externalProblemId: ref.externalProblemId,
      externalProblemUrl: ref.externalProblemUrl || normalizeProblemUrl(ctx, ref.externalProblemId),
      platformBaseUrl: String(judgeConfig.platformBaseUrl ?? baseUrlFromProblemUrl(ctx, ref.externalProblemUrl)).trim(),
      domainId: String(judgeConfig.domainId ?? domainIdFromProblemUrl(ctx, ref.externalProblemUrl) ?? 'system').trim(),
      domainName: String(judgeConfig.domainName ?? judgeConfig.domainId ?? domainIdFromProblemUrl(ctx, ref.externalProblemUrl) ?? 'system').trim(),
      accountId: judgeConfig.accountId ? String(judgeConfig.accountId) : null,
      accountLabel: judgeConfig.accountLabel ? String(judgeConfig.accountLabel) : null,
      languages: Array.isArray(languageConfig.languages) ? languageConfig.languages.map(String) : [],
      timeLimit: ref.timeLimit,
      memoryLimit: ref.memoryLimit,
      judgeConfig: ref.judgeConfigJson,
    };
  }

export function normalizeProblemUrl(ctx: HydroContext, problemId: string, explicitUrl?: string, baseUrl = hydroBaseUrl(ctx), domainId?: string) {
    if (explicitUrl?.trim()) return explicitUrl.trim();
    const normalizedBaseUrl = normalizePlatformBaseUrl(ctx, baseUrl);
    const normalizedDomain = String(domainId || '').trim();
    const domainPrefix = normalizedDomain && normalizedDomain !== 'system' ? `/d/${encodeURIComponent(normalizedDomain)}` : '';
    return `${normalizedBaseUrl}${domainPrefix}/p/${encodeURIComponent(problemId)}`;
  }

export function submitPageUrlFromProblemUrl(ctx: HydroContext, problemUrl?: string | null) {
    const raw = String(problemUrl || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/submit`;
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return `${raw.replace(/\/+$/, '')}/submit`;
    }
  }

export function domainIdFromProblemUrl(ctx: HydroContext, problemUrl?: string | null) {
    const raw = String(problemUrl || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      const match = parsed.pathname.match(/\/d\/([^/]+)\/p\//);
      return match?.[1] ? decodeURIComponent(match[1]) : 'system';
    } catch {
      const match = raw.match(/\/d\/([^/]+)\/p\//);
      return match?.[1] ? decodeURIComponent(match[1]) : '';
    }
  }

export function extractHydroRecordIdFromLocation(ctx: HydroContext, location: string) {
    const match = String(location || '').match(/\/record\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }

export function extractDlValue(ctx: HydroContext, html: string, label: string) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return extractByRegex(ctx, html, new RegExp(`<dt>\\s*${escaped}\\s*<\\/dt>\\s*<dd>([\\s\\S]*?)<\\/dd>`, 'i'));
  }

export function shortHost(ctx: HydroContext, value?: string | null) {
    try {
      return new URL(normalizePlatformBaseUrl(ctx, value)).host;
    } catch {
      return String(value || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }
  }