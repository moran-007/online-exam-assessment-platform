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
import { isHydroBotChallenge } from './hydro-http-gateway.operations';
import { hydroBaseUrl, normalizePlatformBaseUrl } from './hydro-platform.operations';
import { absoluteHydroUrl, attributeValue, decodeHtml, extractByRegex, extractMetaContent, extractTagText, parseJsonSafely, stripTags, toRecord } from './hydro-support.operations';
export async function fetchHydroProblemHtml(ctx: HydroContext, url: string, session?: HydroSession | null) {
    const candidates = [
      url,
      url.startsWith('https://') ? url.replace(/^https:/, 'http:') : '',
      url.startsWith('http://') ? url.replace(/^http:/, 'https:') : '',
    ].filter(Boolean);
    let lastError = '';

    for (const candidate of [...new Set(candidates)]) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = session
          ? await session.fetch(candidate, { signal: controller.signal })
          : await fetch(candidate, {
              headers: { 'User-Agent': 'OnlineExamHydroPull/1.0' },
              signal: controller.signal,
        });
        const html = await response.text();
        if (isHydroBotChallenge(ctx, html, response.url || candidate)) {
          throw new BadRequestException(ctx.hydroBotChallengeMessage);
        }
        if (!response.ok) {
          lastError = `${response.status} ${html.slice(0, 120)}`;
          continue;
        }
        return { url: response.url || candidate, html };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isHydroBotChallenge(ctx, message)) throw error;
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new BadRequestException(`Hydro 题目拉取失败：${lastError || '无法访问题目页面'}`);
  }

export async function resolveHydroProblemBySearch(ctx: HydroContext, 
    keyword: string,
    baseUrl = hydroBaseUrl(ctx),
    session?: HydroSession | null,
    domainId?: string | null,
  ) {
    const normalizedDomain = String(domainId || '').trim();
    const domainPrefix = normalizedDomain && normalizedDomain !== 'system' ? `/d/${encodeURIComponent(normalizedDomain)}` : '';
    const searchUrl = `${normalizePlatformBaseUrl(ctx, baseUrl)}${domainPrefix}/p?q=${encodeURIComponent(keyword.trim())}`;
    const fetched = await fetchHydroProblemHtml(ctx, searchUrl, session);
    const href = extractFirstProblemHref(ctx, fetched.html);
    if (!href) {
      throw new BadRequestException('Hydro 未找到匹配题目，请改用题号或完整链接');
    }
    return absoluteHydroUrl(ctx, href, baseUrl);
  }

export function extractFirstProblemHref(ctx: HydroContext, html: string) {
    const scopedMatch = html.match(
      /<td[^>]*class=["'][^"']*col--name[^"']*col--problem-name[^"']*["'][\s\S]*?<a\s+href=["']([^"']+)["']/i,
    );
    if (scopedMatch?.[1]) return scopedMatch[1];
    const genericMatch = html.match(/<a\s+href=["'](\/p\/[^"'?#]+)["'][^>]*>/i);
    return genericMatch?.[1] ?? '';
  }

export function extractHydroContext(ctx: HydroContext, html: string) {
    return toRecord(ctx, extractJsonAssignment(ctx, html, 'UiContextNew'));
  }

export function extractJsonAssignment(ctx: HydroContext, html: string, name: string): unknown {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = html.match(new RegExp(`window\\.${escapedName}\\s*=\\s*'([\\s\\S]*?)';`));
    if (!match?.[1]) return {};
    const raw = match[1];
    try {
      return JSON.parse(raw);
    } catch {
      try {
        return JSON.parse(decodeJsString(ctx, raw));
      } catch {
        return {};
      }
    }
  }

export function decodeJsString(ctx: HydroContext, raw: string) {
    try {
      return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
    } catch {
      return raw;
    }
  }

export function extractHydroStatementHtml(ctx: HydroContext, html: string, context: Record<string, unknown>) {
    const pdoc = toRecord(ctx, context.pdoc);
    const content = pdoc.content;
    const contentRecord =
      typeof content === 'string' ? toRecord(ctx, parseJsonSafely(ctx, content)) : toRecord(ctx, content);
    const localized = contentRecord.zh ?? contentRecord['zh-cn'] ?? contentRecord.zh_CN;
    if (typeof localized === 'string' && localized.trim()) {
      return localized;
    }
    const firstLocalized = Object.values(contentRecord).find((item) => typeof item === 'string' && item.trim());
    if (typeof firstLocalized === 'string') {
      return firstLocalized;
    }

    const markerIndex = html.indexOf('data-fragment-id="problem-description"');
    if (markerIndex < 0) return '';
    const openStart = html.lastIndexOf('<div', markerIndex);
    const openEnd = html.indexOf('>', markerIndex);
    if (openStart < 0 || openEnd < 0) return '';
    const closeStart = findClosingDiv(ctx, html, openEnd + 1);
    return closeStart > openEnd ? html.slice(openEnd + 1, closeStart) : '';
  }

export function findClosingDiv(ctx: HydroContext, html: string, from: number) {
    const divPattern = /<\/?div\b[^>]*>/gi;
    divPattern.lastIndex = from;
    let depth = 1;
    let match: RegExpExecArray | null;
    while ((match = divPattern.exec(html))) {
      if (match[0].startsWith('</')) {
        depth -= 1;
        if (depth === 0) return match.index;
      } else {
        depth += 1;
      }
    }
    return -1;
  }

export function extractHydroTitle(ctx: HydroContext, html: string, context: Record<string, unknown>) {
    const pdoc = toRecord(ctx, context.pdoc);
    const contextTitle = String(pdoc.title ?? context.title ?? '').trim();
    if (contextTitle) return decodeHtml(ctx, stripTags(ctx, contextTitle)).trim();

    const h1Match = html.match(/<h1[^>]*class=["'][^"']*section__title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
    const h1Title = h1Match?.[1] ? decodeHtml(ctx, stripTags(ctx, h1Match[1])).replace(/^#?\S+\.\s*/, '').trim() : '';
    if (h1Title) return h1Title;

    const ogTitle = extractMetaContent(ctx, html, 'og:title')
      .replace(/\s*-\s*.*$/, '')
      .replace(/^#?\S+\.\s*/, '')
      .trim();
    if (ogTitle) return ogTitle;

    return extractTagText(ctx, html, 'title')
      .replace(/\s*-\s*题目详情.*$/, '')
      .trim();
  }

export function extractTimeLimit(ctx: HydroContext, html: string) {
    const text = extractByRegex(ctx, html, /icon-stopwatch[^>]*>([^<]+)/i);
    const match = text.match(/([\d.]+)\s*(ms|s|秒)?/i);
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    return /^(s|秒)$/i.test(match[2] || '') ? Math.round(value * 1000) : Math.round(value);
  }

export function extractMemoryLimit(ctx: HydroContext, html: string) {
    const text = extractByRegex(ctx, html, /icon-comparison[^>]*>([^<]+)/i);
    const match = text.match(/([\d.]+)\s*(kib|kb|mib|mb|gib|gb)?/i);
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    const unit = (match[2] || 'mib').toLowerCase();
    if (unit === 'gib' || unit === 'gb') return Math.round(value * 1024);
    if (unit === 'kib' || unit === 'kb') return Math.max(1, Math.round(value / 1024));
    return Math.round(value);
  }

export function htmlToMarkdown(ctx: HydroContext, html: string) {
    const codeBlocks: string[] = [];
    let source = String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');

    source = source.replace(/<pre[^>]*>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, attrs, code) => {
      const language = String(attrs || '').match(/language-([A-Za-z0-9_.+-]+)/)?.[1] || '';
      const fenced = `\`\`\`${language}\n${decodeHtml(ctx, stripTags(ctx, code)).trimEnd()}\n\`\`\``;
      const token = `@@HYDRO_CODE_${codeBlocks.length}@@`;
      codeBlocks.push(fenced);
      return `\n\n${token}\n\n`;
    });

    source = source
      .replace(/<img\b([^>]*)>/gi, (_, attrs) => {
        const src = attributeValue(ctx, attrs, 'src');
        const alt = attributeValue(ctx, attrs, 'alt') || '图片';
        return src ? `\n\n![${decodeHtml(ctx, alt)}](${absoluteHydroUrl(ctx, src)})\n\n` : '';
      })
      .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, text) => {
        const href = attributeValue(ctx, attrs, 'href');
        const label = decodeHtml(ctx, stripTags(ctx, text)).trim();
        return href && label ? `[${label}](${absoluteHydroUrl(ctx, href)})` : label;
      })
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${decodeHtml(ctx, stripTags(ctx, code)).trim()}\``)
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => {
        const depth = Math.min(Math.max(Number(level), 2), 4);
        return `\n\n${'#'.repeat(depth)} ${decodeHtml(ctx, stripTags(ctx, text)).trim()}\n\n`;
      })
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/li>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<[^>]+>/g, '');

    let markdown = decodeHtml(ctx, source)
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    codeBlocks.forEach((block, index) => {
      markdown = markdown.replace(`@@HYDRO_CODE_${index}@@`, block);
    });

    return markdown;
  }

export function pickHydroLanguages(ctx: HydroContext, rawLanguages: string[]) {
    const available = [...new Set(rawLanguages.map((item) => item.trim()).filter(Boolean))];
    if (!available.length) return defaultHydroLanguages(ctx);
    const preferred = [
      'cc.cc20o2',
      'cc.cc20',
      'cc.cc17o2',
      'cc.cc17',
      'cc.cc14o2',
      'cc.cc14',
      'cc.cc11o2',
      'cc.cc11',
      'py.py3',
      'java',
      'c',
      'cc',
      'pas',
    ];
    const picked = preferred.filter((item) => available.includes(item));
    if (!picked.length) return available.slice(0, 8);
    return [...picked, ...available.filter((item) => !picked.includes(item))].slice(0, 8);
  }

export function extractHydroLanguages(ctx: HydroContext, html: string, config: Record<string, unknown>) {
    const values = new Set<string>();
    const configLanguages = Array.isArray(config.langs) ? config.langs : [];
    for (const language of configLanguages) {
      const value = String(language || '').trim();
      if (value) values.add(value);
    }

    const selectPattern = /<select\b[^>]*(?:name|id)=["'][^"']*(?:lang|language)[^"']*["'][^>]*>([\s\S]*?)<\/select>/gi;
    let selectMatch: RegExpExecArray | null;
    while ((selectMatch = selectPattern.exec(html))) {
      const selectHtml = selectMatch[1] || '';
      const optionPattern = /<option\b[^>]*value=["']([^"']+)["'][^>]*>/gi;
      let optionMatch: RegExpExecArray | null;
      while ((optionMatch = optionPattern.exec(selectHtml))) {
        const value = decodeHtml(ctx, optionMatch[1]).trim();
        if (isHydroLanguageId(ctx, value)) values.add(value);
      }
    }

    return [...values];
  }

export function isHydroLanguageId(ctx: HydroContext, value: string) {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 40 || /[/?#\s]/.test(normalized)) return false;
    if (['c', 'cc', 'java', 'pas', 'go', 'rust', 'rs'].includes(normalized)) return true;
    return /^(?:cc|c|py|java|js|ts|go|rust|rs|pas)[._-][a-z0-9._-]+$/i.test(normalized);
  }

export function defaultHydroLanguages(ctx: HydroContext) {
    return String(process.env.HYDRO_DEFAULT_LANGUAGES || 'cc.cc17o2,py.py3')
      .split(/[,，、\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

export function normalizeHydroLanguage(ctx: HydroContext, language: string, allowedLanguages: string[] = []) {
    const value = String(language || '').trim();
    const alias: Record<string, string> = {
      cpp: 'cc',
      cxx: 'cc',
      'c++': 'cc',
      cpp11: 'cc.cc11o2',
      cxx11: 'cc.cc11o2',
      cpp14: 'cc.cc14o2',
      cxx14: 'cc.cc14o2',
      cpp17: 'cc.cc17o2',
      cxx17: 'cc.cc17o2',
      cpp20: 'cc.cc20o2',
      cxx20: 'cc.cc20o2',
      python: 'py.py3',
      python3: 'py.py3',
      py3: 'py.py3',
      python2: 'py.py2',
      py2: 'py.py2',
      pascal: 'pas',
    };
    const normalized = alias[value.toLowerCase()] ?? value;
    const allowed = allowedLanguages.map((item) => String(item).trim()).filter(Boolean);
    if (!allowed.length || allowed.includes(normalized)) return normalized;
    if (allowed.includes(value)) return value;
    const fallback = alias[allowed[0]?.toLowerCase()] ?? allowed[0];
    return fallback || normalized;
  }