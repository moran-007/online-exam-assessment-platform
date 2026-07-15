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
export function settings(ctx: HydroContext) {
    return {
      baseUrl: hydroBaseUrl(ctx),
      directSubmitEnabled: true,
      callbackEnabled: Boolean(process.env.HYDRO_CALLBACK_SECRET),
      callbackPath: '/api/v1/hydro/callback',
    };
  }

export async function platforms(ctx: HydroContext, user?: RequestUser, includeDisabled = false) {
    const canSeeDisabled = includeDisabled && user?.userType === UserType.SUPER_ADMIN;
    const disabledFilter = canSeeDisabled ? Prisma.empty : Prisma.sql`AND enabled = true`;
    const platforms = await ctx.prisma.$queryRaw<ExternalOjPlatformRow[]>`
      SELECT
        id,
        code,
        name,
        base_url AS "baseUrl",
        enabled,
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM external_oj_platforms
      WHERE deleted_at IS NULL ${disabledFilter}
      ORDER BY sort_order ASC, name ASC
    `;

    return platforms.map((platform, index) => formatPlatform(ctx, platform, index === 0));
  }

export async function createPlatform(ctx: HydroContext, dto: SaveHydroPlatformDto, user: RequestUser) {
    const data = platformData(ctx, dto);
    await assertPlatformCodeAvailable(ctx, data.code);

    const [platform] = await ctx.prisma.$queryRaw<ExternalOjPlatformRow[]>`
      INSERT INTO external_oj_platforms (id, code, name, base_url, enabled, sort_order, updated_at)
      VALUES (${randomUUID()}::uuid, ${data.code}, ${data.name}, ${data.baseUrl}, ${data.enabled}, ${data.sortOrder}, CURRENT_TIMESTAMP)
      RETURNING
        id,
        code,
        name,
        base_url AS "baseUrl",
        enabled,
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    await ctx.audit.log({
      userId: user.id,
      action: 'hydro:create-platform',
      module: 'hydro',
      targetType: 'external_oj_platform',
      targetId: platform.id,
      afterData: formatPlatform(ctx, platform),
    });

    return formatPlatform(ctx, platform);
  }

export async function updatePlatform(ctx: HydroContext, id: string, dto: SaveHydroPlatformDto, user: RequestUser) {
    const existing = await findPlatform(ctx, id);
    if (!existing) throw new NotFoundException('接入平台不存在');

    const data = platformData(ctx, dto);
    await assertPlatformCodeAvailable(ctx, data.code, id);

    const [platform] = await ctx.prisma.$queryRaw<ExternalOjPlatformRow[]>`
      UPDATE external_oj_platforms
      SET
        code = ${data.code},
        name = ${data.name},
        base_url = ${data.baseUrl},
        enabled = ${data.enabled},
        sort_order = ${data.sortOrder},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}::uuid AND deleted_at IS NULL
      RETURNING
        id,
        code,
        name,
        base_url AS "baseUrl",
        enabled,
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    await ctx.audit.log({
      userId: user.id,
      action: 'hydro:update-platform',
      module: 'hydro',
      targetType: 'external_oj_platform',
      targetId: id,
      beforeData: formatPlatform(ctx, existing),
      afterData: formatPlatform(ctx, platform),
    });

    return formatPlatform(ctx, platform);
  }

export async function deletePlatform(ctx: HydroContext, id: string, user: RequestUser) {
    const existing = await findPlatform(ctx, id);
    if (!existing) throw new NotFoundException('接入平台不存在');

    await ctx.prisma.$executeRaw`DELETE FROM external_oj_platforms WHERE id = ${id}::uuid`;

    await ctx.audit.log({
      userId: user.id,
      action: 'hydro:delete-platform',
      module: 'hydro',
      targetType: 'external_oj_platform',
      targetId: id,
      beforeData: formatPlatform(ctx, existing),
    });

    return true;
  }

export function isSamePlatformBaseUrl(ctx: HydroContext, left?: string | null, right?: string | null) {
    const normalizedLeft = normalizePlatformBaseUrl(ctx, left);
    const normalizedRight = normalizePlatformBaseUrl(ctx, right);
    try {
      return canonicalHost(ctx, normalizedLeft) === canonicalHost(ctx, normalizedRight);
    } catch {
      return normalizedLeft === normalizedRight;
    }
  }

export function canonicalHost(ctx: HydroContext, value?: string | null) {
    try {
      return new URL(normalizePlatformBaseUrl(ctx, value)).host.toLowerCase().replace(/^www\./, '');
    } catch {
      return String(value || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase().replace(/^www\./, '');
    }
  }

export function normalizePlatformCode(ctx: HydroContext, value?: string) {
    return String(value || 'hydro').trim().toLowerCase() || 'hydro';
  }

export function normalizePlatformBaseUrl(ctx: HydroContext, value?: string | null) {
    const raw = String(value || hydroBaseUrl(ctx)).trim() || hydroBaseUrl(ctx);
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return withScheme.replace(/\/+$/, '');
  }

export function platformData(ctx: HydroContext, dto: SaveHydroPlatformDto) {
    const code = normalizePlatformCode(ctx, dto.code);
    const name = dto.name.trim();
    const baseUrl = normalizePlatformBaseUrl(ctx, dto.baseUrl);
    if (!code) throw new BadRequestException('请填写平台编码');
    if (!name) throw new BadRequestException('请填写平台名称');
    if (!baseUrl) throw new BadRequestException('请填写平台站点');
    return {
      code,
      name,
      baseUrl,
      enabled: dto.enabled ?? true,
      sortOrder: dto.sortOrder ?? 0,
    };
  }

export async function assertPlatformCodeAvailable(ctx: HydroContext, code: string, currentId?: string) {
    const currentFilter = currentId ? Prisma.sql`AND id <> ${currentId}::uuid` : Prisma.empty;
    const duplicate = await ctx.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM external_oj_platforms
      WHERE code = ${code} ${currentFilter}
      LIMIT 1
    `;
    if (duplicate.length) {
      throw new BadRequestException('平台编码已存在');
    }
  }

export async function findPlatform(ctx: HydroContext, id: string) {
    const [platform] = await ctx.prisma.$queryRaw<ExternalOjPlatformRow[]>`
      SELECT
        id,
        code,
        name,
        base_url AS "baseUrl",
        enabled,
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM external_oj_platforms
      WHERE id = ${id}::uuid AND deleted_at IS NULL
      LIMIT 1
    `;
    return platform ?? null;
  }

export function formatPlatform(ctx: HydroContext, 
    platform: ExternalOjPlatformRow,
    isDefault = false,
  ) {
    return {
      id: platform.id,
      code: platform.code,
      name: platform.name,
      baseUrl: platform.baseUrl,
      enabled: platform.enabled,
      sortOrder: platform.sortOrder,
      createdAt: platform.createdAt,
      updatedAt: platform.updatedAt,
      default: isDefault,
    };
  }

export function platformName(ctx: HydroContext, code: string) {
    return code === 'hydro' ? 'Hydro' : code;
  }

export function baseUrlFromProblemUrl(ctx: HydroContext, url?: string | null) {
    const raw = String(url || '').trim();
    if (!raw) return hydroBaseUrl(ctx);
    try {
      const parsed = new URL(raw);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return hydroBaseUrl(ctx);
    }
  }

export function hydroBaseUrl(ctx: HydroContext) {
    const raw = process.env.HYDRO_BASE_URL || 'https://oj.example.com';
    return raw.replace(/\/+$/, '');
  }