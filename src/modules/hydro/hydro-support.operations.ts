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
import { hydroBaseUrl, normalizePlatformBaseUrl } from './hydro-platform.operations';
export async function loadUserMap(ctx: HydroContext, userIds: string[]) {
    if (!userIds.length) return new Map<string, { id: string; username: string; realName: string | null; userType: UserType }>();
    const users = await ctx.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, username: true, realName: true, userType: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

export function parseJsonEnv(ctx: HydroContext, value?: string) {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  }

export function parseJsonSafely(ctx: HydroContext, value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

export function toPositiveNumber(ctx: HydroContext, value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
  }

export function extractByRegex(ctx: HydroContext, value: string, regex: RegExp) {
    const match = value.match(regex);
    return match?.[1] ? decodeHtml(ctx, stripTags(ctx, match[1])).trim() : '';
  }

export function extractTagText(ctx: HydroContext, html: string, tag: string) {
    return extractByRegex(ctx, html, new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  }

export function extractMetaContent(ctx: HydroContext, html: string, property: string) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = html.match(
      new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    );
    return match?.[1] ? decodeHtml(ctx, match[1]) : '';
  }

export function attributeValue(ctx: HydroContext, attrs: string, name: string) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(attrs || '').match(new RegExp(`${escaped}=["']([^"']*)["']`, 'i'));
    return match?.[1] ? decodeHtml(ctx, match[1]).trim() : '';
  }

export function absoluteHydroUrl(ctx: HydroContext, value: unknown, baseUrl = hydroBaseUrl(ctx)) {
    const url = String(value ?? '').trim();
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('//')) return `http:${url}`;
    const normalizedBaseUrl = normalizePlatformBaseUrl(ctx, baseUrl);
    if (url.startsWith('/')) return `${normalizedBaseUrl}${url}`;
    return `${normalizedBaseUrl}/${url.replace(/^\/+/, '')}`;
  }

export function stripTags(ctx: HydroContext, value: string) {
    return String(value || '').replace(/<[^>]*>/g, '');
  }

export function decodeHtml(ctx: HydroContext, value: string) {
    const entities: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: ' ',
    };
    return String(value || '').replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, entity) => {
      const key = String(entity).toLowerCase();
      if (key.startsWith('#x')) {
        const codePoint = Number.parseInt(key.slice(2), 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
      if (key.startsWith('#')) {
        const codePoint = Number.parseInt(key.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
      return entities[key] ?? match;
    });
  }

export function applyTemplate(ctx: HydroContext, template: string, data: Record<string, string>) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = data[key] ?? '';
      return key === 'code' || key === 'baseUrl' ? value : encodeURIComponent(value);
    });
  }

export function extractExternalSubmissionId(ctx: HydroContext, payload: unknown): string | null {
    const record = toRecord(ctx, payload);
    const candidates = [
      record.submissionId,
      record.sid,
      record.rid,
      record.id,
      toRecord(ctx, record.data).submissionId,
      toRecord(ctx, record.data).sid,
      toRecord(ctx, record.data).rid,
      toRecord(ctx, record.data).id,
    ];
    const value = candidates.find((item) => item !== undefined && item !== null && String(item).trim());
    return value === undefined ? null : String(value);
  }

export function toRecord(ctx: HydroContext, value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

export function delay(ctx: HydroContext, ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

export function average(ctx: HydroContext, values: number[]) {
    return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : 0;
  }