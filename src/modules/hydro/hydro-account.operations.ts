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
import { shortHost } from './hydro-external-format.operations';
import { testHydroAccountLogin } from './hydro-http-gateway.operations';
import { baseUrlFromProblemUrl, isSamePlatformBaseUrl, normalizePlatformBaseUrl, normalizePlatformCode, platformName } from './hydro-platform.operations';
import { loadUserMap, toRecord } from './hydro-support.operations';
export async function accounts(ctx: HydroContext, query: QueryHydroSummaryDto, user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const canManageAll = canManageAllExternalAccounts(ctx, user);
    if (!canManageAll && !canManageOwnExternalAccounts(ctx, user)) {
      throw new ForbiddenException('无权限管理外部账号');
    }
    if (!canManageAll && query.studentId && query.studentId !== user.id) {
      throw new ForbiddenException('只能查看自己的外部账号');
    }
    const where: Prisma.HydroAccountWhereInput = {
      studentId: canManageAll ? query.studentId : user.id,
      platformCode: query.platformCode ? normalizePlatformCode(ctx, query.platformCode) : undefined,
      platformBaseUrl: query.platformBaseUrl ? normalizePlatformBaseUrl(ctx, query.platformBaseUrl) : undefined,
      bindStatus: query.status,
      OR: query.keyword
        ? [
            { hydroUsername: { contains: query.keyword, mode: 'insensitive' } },
            { hydroUserId: { contains: query.keyword, mode: 'insensitive' } },
            { loginUsername: { contains: query.keyword, mode: 'insensitive' } },
            { platformBaseUrl: { contains: query.keyword, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [accounts, total] = await ctx.prisma.$transaction([
      ctx.prisma.hydroAccount.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take }),
      ctx.prisma.hydroAccount.count({ where }),
    ]);
    const userMap = await loadUserMap(ctx, accounts.map((item) => item.studentId));

    return {
      items: accounts.map((item) => {
        const student = userMap.get(item.studentId);
        return {
          ...formatHydroAccount(ctx, item),
          ownerId: item.studentId,
          ownerName: student?.realName ?? student?.username ?? item.studentId,
          ownerUsername: student?.username ?? '',
          ownerType: student?.userType ?? '',
          studentId: item.studentId,
          studentName: student?.realName ?? student?.username ?? item.studentId,
          username: student?.username ?? '',
        };
      }),
      page,
      pageSize,
      total,
    };
  }

export async function myAccounts(ctx: HydroContext, user: RequestUser) {
    assertCanManageOwnExternalAccounts(ctx, user);
    const accounts = await ctx.prisma.hydroAccount.findMany({
      where: { studentId: user.id },
      orderBy: { updatedAt: 'desc' },
    });
    return accounts.map((item) => formatHydroAccount(ctx, item));
  }

export async function myAccount(ctx: HydroContext, user: RequestUser) {
    assertCanManageOwnExternalAccounts(ctx, user);
    const account = await ctx.prisma.hydroAccount.findFirst({
      where: { studentId: user.id, platformCode: 'hydro' },
      orderBy: { updatedAt: 'desc' },
    });
    return account ? formatHydroAccount(ctx, account) : null;
  }

export async function bindMyAccount(ctx: HydroContext, dto: BindHydroAccountDto, user: RequestUser) {
    assertCanManageOwnExternalAccounts(ctx, user);
    return bindAccount(ctx, { ...dto, studentId: user.id }, user);
  }

export async function bindAccount(ctx: HydroContext, dto: BindHydroAccountDto, user: RequestUser) {
    const studentId = dto.studentId;
    if (!studentId) throw new BadRequestException('缺少用户 ID');
    assertCanManageExternalAccount(ctx, user, studentId);
    const platformCode = normalizePlatformCode(ctx, dto.platformCode);
    const platformBaseUrl = normalizePlatformBaseUrl(ctx, dto.platformBaseUrl);
    const loginUsername = dto.loginUsername?.trim() || dto.hydroUsername?.trim() || dto.hydroUserId?.trim();
    const hydroUsername = dto.hydroUsername?.trim() || loginUsername || dto.hydroUserId?.trim();
    const hydroUserId = dto.hydroUserId?.trim() || hydroUsername;
    if (!loginUsername || !hydroUsername || !hydroUserId) {
      throw new BadRequestException('请填写平台登录账号和 Hydro 用户名');
    }
    const targetUser = await ctx.prisma.user.findFirst({
      where: {
        id: studentId,
        status: UserStatus.ACTIVE,
        userType: { in: [UserType.SUPER_ADMIN, UserType.ADMIN, UserType.TEACHER, UserType.ASSISTANT, UserType.STUDENT] },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!targetUser) throw new NotFoundException('用户不存在、不可用或不支持绑定外部账号');

    const existing = dto.id
      ? await ctx.prisma.hydroAccount.findFirst({ where: { id: dto.id, studentId } })
      : await ctx.prisma.hydroAccount.findFirst({
          where: {
            studentId,
            platformCode,
            platformBaseUrl,
            loginUsername,
          },
        });
    if (dto.id && !existing) throw new NotFoundException('外部账号不存在');
    const loginPassword = dto.loginPassword?.trim() || existing?.loginPassword || '';
    if (!loginPassword) {
      throw new BadRequestException('请填写平台登录密码');
    }

    const data = {
      platformUserId: studentId,
      platformCode,
      platformName: dto.platformName?.trim() || platformName(ctx, platformCode),
      platformBaseUrl,
      hydroUserId,
      hydroUsername,
      loginUsername,
      loginPassword,
      bindStatus: dto.bindStatus ?? existing?.bindStatus ?? 'bound',
    };
    const account = existing
      ? await ctx.prisma.hydroAccount.update({
          where: { id: existing.id },
          data,
        })
      : await ctx.prisma.hydroAccount.create({
          data: {
            ...data,
            studentId,
          },
        });

    await ctx.audit.log({
      userId: user.id,
      action: 'hydro:bind-account',
      module: 'hydro',
      targetType: 'user',
      targetId: studentId,
      afterData: {
        accountId: account.id,
        platformCode: account.platformCode,
        platformBaseUrl: account.platformBaseUrl,
        loginUsername: account.loginUsername,
        hydroUserId: account.hydroUserId,
        hydroUsername: account.hydroUsername,
        bindStatus: account.bindStatus,
      },
    });

    return formatHydroAccount(ctx, account);
  }

export async function testMyAccount(ctx: HydroContext, accountId: string, user: RequestUser) {
    assertCanManageOwnExternalAccounts(ctx, user);
    const account = await ctx.prisma.hydroAccount.findFirst({ where: { id: accountId, studentId: user.id } });
    if (!account) throw new NotFoundException('外部账号不存在');
    return testHydroAccountLogin(ctx, account);
  }

export async function testAccount(ctx: HydroContext, accountId: string, user: RequestUser) {
    const account = await ctx.prisma.hydroAccount.findFirst({ where: { id: accountId } });
    if (!account) throw new NotFoundException('外部账号不存在');
    assertCanManageExternalAccount(ctx, user, account.studentId);
    return testHydroAccountLogin(ctx, account);
  }

export async function deleteAccount(ctx: HydroContext, accountId: string, user: RequestUser) {
    const account = await ctx.prisma.hydroAccount.findFirst({ where: { id: accountId } });
    if (!account) throw new NotFoundException('外部账号不存在');
    assertCanManageExternalAccount(ctx, user, account.studentId);

    await ctx.prisma.hydroAccount.delete({ where: { id: accountId } });
    await ctx.audit.log({
      userId: user.id,
      action: 'hydro:delete-account',
      module: 'hydro',
      targetType: 'hydro_account',
      targetId: accountId,
      beforeData: formatHydroAccount(ctx, account),
    });

    return true;
  }

export async function deleteMyAccount(ctx: HydroContext, accountId: string, user: RequestUser) {
    assertCanManageOwnExternalAccounts(ctx, user);
    return deleteAccount(ctx, accountId, user);
  }

export async function findAccountForBinding(ctx: HydroContext, userId: string, binding: HydroProblemBinding, selectedAccountId?: string) {
    const platformCode = normalizePlatformCode(ctx, binding.judgeProvider);
    const judgeConfig = toRecord(ctx, binding.judgeConfig);
    const platformBaseUrl = normalizePlatformBaseUrl(ctx, 
      binding.platformBaseUrl || String(judgeConfig.platformBaseUrl ?? '') || baseUrlFromProblemUrl(ctx, binding.externalProblemUrl),
    );
    const assertMatchedAccount = (account: HydroAccount) => {
      if (!isSamePlatformBaseUrl(ctx, account.platformBaseUrl, platformBaseUrl)) {
        throw new BadRequestException(
          `所选账号属于 ${shortHost(ctx, account.platformBaseUrl)}，当前题目来源 ${shortHost(ctx, platformBaseUrl)}，请切换同站点账号`,
        );
      }
      return account;
    };

    if (selectedAccountId) {
      const selected = await ctx.prisma.hydroAccount.findFirst({
        where: {
          id: selectedAccountId,
          studentId: userId,
          bindStatus: 'bound',
        },
      });
      if (!selected) {
        throw new BadRequestException('所选外部账号不存在或尚未绑定');
      }
      return assertMatchedAccount(selected);
    }

    if (binding.accountId) {
      const preferred = await ctx.prisma.hydroAccount.findFirst({
        where: {
          id: binding.accountId,
          studentId: userId,
          bindStatus: 'bound',
        },
      });
      if (preferred && isSamePlatformBaseUrl(ctx, preferred.platformBaseUrl, platformBaseUrl)) {
        return preferred;
      }
    }

    const candidates = await ctx.prisma.hydroAccount.findMany({
      where: {
        studentId: userId,
        bindStatus: 'bound',
      },
      orderBy: { updatedAt: 'desc' },
    });
    const sameSiteAccounts = candidates.filter((account) => isSamePlatformBaseUrl(ctx, account.platformBaseUrl, platformBaseUrl));
    return sameSiteAccounts.find((account) => normalizePlatformCode(ctx, account.platformCode) === platformCode) ?? sameSiteAccounts[0] ?? null;
  }

export function formatHydroAccount(ctx: HydroContext, account: {
    id: string;
    studentId: string;
    platformCode: string;
    platformName: string | null;
    platformBaseUrl: string;
    hydroUserId: string;
    hydroUsername: string;
    loginUsername: string | null;
    loginPassword?: string | null;
    lastLoginStatus: string | null;
    lastLoginMessage: string | null;
    lastLoginAt: Date | null;
    bindStatus: string;
    updatedAt: Date;
  }) {
    return {
      id: account.id,
      studentId: account.studentId,
      ownerId: account.studentId,
      platformCode: account.platformCode,
      platformName: account.platformName || platformName(ctx, account.platformCode),
      platformBaseUrl: account.platformBaseUrl,
      hydroUserId: account.hydroUserId,
      hydroUsername: account.hydroUsername,
      loginUsername: account.loginUsername,
      hasPassword: Boolean(account.loginPassword),
      lastLoginStatus: account.lastLoginStatus,
      lastLoginMessage: account.lastLoginMessage,
      lastLoginAt: account.lastLoginAt,
      bindStatus: account.bindStatus,
      updatedAt: account.updatedAt,
    };
  }

export function accountLabel(ctx: HydroContext, account: Pick<HydroAccount, 'loginUsername' | 'hydroUsername' | 'platformBaseUrl'>) {
    return `${account.loginUsername || account.hydroUsername}@${shortHost(ctx, account.platformBaseUrl)}`;
  }

export function ensureStudent(ctx: HydroContext, user: RequestUser) {
    if (user.userType !== 'STUDENT') {
      throw new ForbiddenException('仅学生账号可以访问学生端 Hydro 接口');
    }
  }

export function canManageAllExternalAccounts(ctx: HydroContext, user: RequestUser) {
    return user.userType === UserType.SUPER_ADMIN;
  }

export function canManageOwnExternalAccounts(ctx: HydroContext, user: RequestUser) {
    const ownAccountTypes: UserType[] = [
      UserType.SUPER_ADMIN,
      UserType.ADMIN,
      UserType.TEACHER,
      UserType.ASSISTANT,
      UserType.STUDENT,
    ];
    return ownAccountTypes.includes(user.userType as UserType);
  }

export function assertCanManageOwnExternalAccounts(ctx: HydroContext, user: RequestUser) {
    if (!canManageOwnExternalAccounts(ctx, user)) {
      throw new ForbiddenException('只能添加和维护自己的外部账号');
    }
  }

export function assertCanManageExternalAccount(ctx: HydroContext, user: RequestUser, ownerId: string) {
    if (canManageAllExternalAccounts(ctx, user)) return;
    if (canManageOwnExternalAccounts(ctx, user) && ownerId === user.id) return;
    throw new ForbiddenException('外部账号只能由超级管理员管理，或由本人添加和维护');
  }

export function isPrivilegedUser(ctx: HydroContext, user: RequestUser) {
    return ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'ASSISTANT'].includes(user.userType);
  }