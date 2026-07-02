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

@Injectable()
export class HydroService implements OnModuleInit, OnModuleDestroy {
  private pollTimer?: ReturnType<typeof setInterval>;
  private readonly hydroBotChallengeMessage =
    'Hydro 触发人机验证/机器人检测，系统不会绕过该验证。请先在浏览器打开对应 OJ 完成人工验证，或改用自建 Hydro 站点后重试。';

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService,
  ) {}

  onModuleInit() {
    this.pollTimer = setInterval(() => {
      void this.syncPendingSubmissions().catch(() => undefined);
    }, 15_000);
  }

  onModuleDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  settings() {
    return {
      baseUrl: this.hydroBaseUrl(),
      directSubmitEnabled: true,
      callbackEnabled: Boolean(process.env.HYDRO_CALLBACK_SECRET),
      callbackPath: '/api/v1/hydro/callback',
    };
  }

  async platforms(user?: RequestUser, includeDisabled = false) {
    const canSeeDisabled = includeDisabled && user?.userType === UserType.SUPER_ADMIN;
    const disabledFilter = canSeeDisabled ? Prisma.empty : Prisma.sql`AND enabled = true`;
    const platforms = await this.prisma.$queryRaw<ExternalOjPlatformRow[]>`
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

    return platforms.map((platform, index) => this.formatPlatform(platform, index === 0));
  }

  async createPlatform(dto: SaveHydroPlatformDto, user: RequestUser) {
    const data = this.platformData(dto);
    await this.assertPlatformCodeAvailable(data.code);

    const [platform] = await this.prisma.$queryRaw<ExternalOjPlatformRow[]>`
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

    await this.audit.log({
      userId: user.id,
      action: 'hydro:create-platform',
      module: 'hydro',
      targetType: 'external_oj_platform',
      targetId: platform.id,
      afterData: this.formatPlatform(platform),
    });

    return this.formatPlatform(platform);
  }

  async updatePlatform(id: string, dto: SaveHydroPlatformDto, user: RequestUser) {
    const existing = await this.findPlatform(id);
    if (!existing) throw new NotFoundException('接入平台不存在');

    const data = this.platformData(dto);
    await this.assertPlatformCodeAvailable(data.code, id);

    const [platform] = await this.prisma.$queryRaw<ExternalOjPlatformRow[]>`
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

    await this.audit.log({
      userId: user.id,
      action: 'hydro:update-platform',
      module: 'hydro',
      targetType: 'external_oj_platform',
      targetId: id,
      beforeData: this.formatPlatform(existing),
      afterData: this.formatPlatform(platform),
    });

    return this.formatPlatform(platform);
  }

  async deletePlatform(id: string, user: RequestUser) {
    const existing = await this.findPlatform(id);
    if (!existing) throw new NotFoundException('接入平台不存在');

    await this.prisma.$executeRaw`DELETE FROM external_oj_platforms WHERE id = ${id}::uuid`;

    await this.audit.log({
      userId: user.id,
      action: 'hydro:delete-platform',
      module: 'hydro',
      targetType: 'external_oj_platform',
      targetId: id,
      beforeData: this.formatPlatform(existing),
    });

    return true;
  }

  async pullProblem(query: PullHydroProblemDto) {
    const source = (query.problemUrl || query.problemId || '').trim();
    if (!source) throw new BadRequestException('请填写 Hydro 题号或题目链接');

    const pullAccount = query.accountId
      ? await this.prisma.hydroAccount.findFirst({ where: { id: query.accountId } })
      : null;
    if (query.accountId && !pullAccount) throw new NotFoundException('录入账号不存在');
    const judgeProvider = this.normalizePlatformCode(query.judgeProvider || pullAccount?.platformCode);
    const pullSession = pullAccount ? await this.createHydroSession(pullAccount) : null;
    const baseUrl = this.normalizePlatformBaseUrl(
      query.platformBaseUrl || pullAccount?.platformBaseUrl || this.baseUrlFromProblemUrl(query.problemUrl),
    );
    const fallbackProblemId = this.problemIdFromInput(source);
    const requestedDomainId = String(query.domainId || '').trim();
    const targetUrl =
      query.problemUrl?.trim() || this.normalizeProblemUrl(fallbackProblemId, undefined, baseUrl, requestedDomainId);
    let fetched: { url: string; html: string };
    try {
      fetched = await this.fetchHydroProblemHtml(targetUrl, pullSession);
    } catch (error) {
      if (query.problemUrl?.trim()) throw error;
      const resolvedUrl = await this.resolveHydroProblemBySearch(source, baseUrl, pullSession, requestedDomainId);
      fetched = await this.fetchHydroProblemHtml(resolvedUrl, pullSession);
    }
    const context = this.extractHydroContext(fetched.html);
    const pdoc = this.toRecord(context.pdoc);
    const config = this.toRecord(pdoc.config);
    const contextProblemId = String(context.problemId ?? pdoc.pid ?? fallbackProblemId).trim();
    const externalProblemId = contextProblemId || fallbackProblemId;
    const fetchedProblemUrl = this.normalizeProblemUrl(externalProblemId, fetched.url);
    const rawLanguages = this.extractHydroLanguages(fetched.html, config);
    const languages = this.pickHydroLanguages(rawLanguages);
    const statementHtml = this.extractHydroStatementHtml(fetched.html, context);
    const content = this.htmlToMarkdown(statementHtml);

    if (!content.trim()) {
      throw new BadRequestException('Hydro 题干拉取失败，请确认题目是否公开或题号是否正确');
    }

    const timeLimit = this.toPositiveNumber(config.timeMax ?? config.timeMin) ?? this.extractTimeLimit(fetched.html);
    const memoryLimit =
      this.toPositiveNumber(config.memoryMax ?? config.memoryMin) ?? this.extractMemoryLimit(fetched.html);
    const numericProblemId = this.toPositiveNumber(context.problemNumId ?? pdoc.docId);
    const domainId = String(query.domainId || context.domainId || pdoc.domainId || 'system').trim() || 'system';
    const domain = this.toRecord(context.domain);
    const domainName = String(query.domainName || domain.name || domain.displayName || domain._id || domainId).trim();
    const fetchedBaseUrl = this.baseUrlFromProblemUrl(fetchedProblemUrl) || baseUrl;
    const platformBaseUrl =
      pullAccount && this.isSamePlatformBaseUrl(pullAccount.platformBaseUrl, fetchedBaseUrl)
        ? this.normalizePlatformBaseUrl(pullAccount.platformBaseUrl)
        : fetchedBaseUrl;
    const externalProblemUrl = this.normalizeProblemUrl(externalProblemId, undefined, platformBaseUrl, domainId);
    const accountLabel = pullAccount
      ? `${pullAccount.loginUsername || pullAccount.hydroUsername}@${this.shortHost(pullAccount.platformBaseUrl)}`
      : '';

    return {
      type: 'programming',
      title: this.extractHydroTitle(fetched.html, context) || externalProblemId,
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
          submitPageUrl: this.submitPageUrlFromProblemUrl(externalProblemUrl),
          postSubmitUrl: this.absoluteHydroUrl(context.postSubmitUrl, platformBaseUrl),
          getSubmissionsUrl: this.absoluteHydroUrl(context.getSubmissionsUrl, platformBaseUrl),
          getRecordDetailUrl: this.absoluteHydroUrl(context.getRecordDetailUrl, platformBaseUrl),
          rawLanguages,
          sourceUrl: fetched.url,
        },
      },
    };
  }

  async listProblemBindings(query: QueryHydroSummaryDto, user: RequestUser) {
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
    const [items, total] = await this.prisma.$transaction([
      this.prisma.question.findMany({
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
      this.prisma.question.count({ where }),
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
        binding: item.programmingRef ? this.formatProblemRef(item.programmingRef) : null,
      })),
      page,
      pageSize,
      total,
    };
  }

  async tasks(query: QueryHydroSummaryDto, user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where = await this.hydroTaskWhere(query, user);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.hydroTask.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.hydroTask.count({ where }),
    ]);
    const [meta, metrics] = await Promise.all([
      this.hydroTaskMeta(items),
      this.hydroTaskMetrics(items.map((item) => item.id)),
    ]);

    return {
      items: items.map((item) => this.formatHydroTask(item, meta, metrics.get(item.id))),
      page,
      pageSize,
      total,
    };
  }

  async createTask(dto: SaveHydroTaskDto, user: RequestUser) {
    const exam = dto.examId ? await this.findAccessibleExam(dto.examId, user) : null;
    const courseId = dto.courseId ?? exam?.courseId ?? null;
    const classId = dto.classId ?? exam?.classId ?? null;
    if (classId) {
      await this.dataScope.assertClassWritable(user, classId);
    }
    if (courseId) {
      await this.assertCourseExists(courseId);
    }

    const startTime = this.parseHydroTaskDate(dto.startTime, '开始时间');
    const endTime = this.parseHydroTaskDate(dto.endTime, '结束时间');
    this.assertHydroTaskTimeRange(startTime, endTime);
    const task = await this.prisma.hydroTask.create({
      data: {
        title: this.requiredTaskText(dto.title, '任务标题'),
        courseId,
        classId,
        examId: dto.examId ?? null,
        hydroUrl: this.requiredTaskText(dto.hydroUrl, 'Hydro 地址'),
        hydroProblemId: this.optionalTaskText(dto.hydroProblemId),
        hydroContestId: this.optionalTaskText(dto.hydroContestId),
        startTime,
        endTime,
        status: dto.status ?? 'draft',
        createdBy: user.id,
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'hydro:create-task',
      module: 'hydro',
      targetType: 'hydro_task',
      targetId: task.id,
      afterData: { title: task.title, examId: task.examId, hydroProblemId: task.hydroProblemId },
    });

    const [meta, metrics] = await Promise.all([
      this.hydroTaskMeta([task]),
      this.hydroTaskMetrics([task.id]),
    ]);
    return this.formatHydroTask(task, meta, metrics.get(task.id));
  }

  async updateTask(taskId: string, dto: UpdateHydroTaskDto, user: RequestUser) {
    const task = await this.findHydroTask(taskId);
    await this.assertHydroTaskAccessible(task, user);
    const data: Prisma.HydroTaskUpdateInput = {};

    if (dto.title !== undefined) data.title = this.requiredTaskText(dto.title, '任务标题');
    if (dto.hydroUrl !== undefined) data.hydroUrl = this.requiredTaskText(dto.hydroUrl, 'Hydro 地址');
    if (dto.hydroProblemId !== undefined) data.hydroProblemId = this.optionalTaskText(dto.hydroProblemId);
    if (dto.hydroContestId !== undefined) data.hydroContestId = this.optionalTaskText(dto.hydroContestId);
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.startTime !== undefined) data.startTime = this.parseHydroTaskDate(dto.startTime, '开始时间');
    if (dto.endTime !== undefined) data.endTime = this.parseHydroTaskDate(dto.endTime, '结束时间');
    if (dto.examId !== undefined) {
      if (dto.examId) {
        const exam = await this.findAccessibleExam(dto.examId, user);
        data.examId = exam.id;
        data.courseId = dto.courseId === undefined ? exam.courseId : data.courseId;
        data.classId = dto.classId === undefined ? exam.classId : data.classId;
      } else {
        data.examId = null;
      }
    }
    if (dto.classId !== undefined) {
      const classId = this.optionalTaskText(dto.classId);
      if (classId) {
        await this.dataScope.assertClassWritable(user, classId);
      }
      data.classId = classId;
    }
    if (dto.courseId !== undefined) {
      const courseId = this.optionalTaskText(dto.courseId);
      if (courseId) {
        await this.assertCourseExists(courseId);
      }
      data.courseId = courseId;
    }

    const nextStartTime = (data.startTime as Date | null | undefined) ?? task.startTime;
    const nextEndTime = (data.endTime as Date | null | undefined) ?? task.endTime;
    this.assertHydroTaskTimeRange(nextStartTime, nextEndTime);
    const updated = await this.prisma.hydroTask.update({ where: { id: taskId }, data });

    await this.audit.log({
      userId: user.id,
      action: 'hydro:update-task',
      module: 'hydro',
      targetType: 'hydro_task',
      targetId: taskId,
      beforeData: { title: task.title, status: task.status },
      afterData: { title: updated.title, status: updated.status },
    });

    const [meta, metrics] = await Promise.all([
      this.hydroTaskMeta([updated]),
      this.hydroTaskMetrics([updated.id]),
    ]);
    return this.formatHydroTask(updated, meta, metrics.get(updated.id));
  }

  async syncTasks(dto: SyncHydroTasksDto, user: RequestUser) {
    const where = await this.hydroTaskWhere(dto, user);
    const taskIds = dto.taskIds?.filter(Boolean);
    const tasks = await this.prisma.hydroTask.findMany({
      where: taskIds?.length ? { AND: [where, { id: { in: [...new Set(taskIds)] } }] } : where,
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    const items: Array<{
      taskId: string;
      title: string;
      submissionCount: number;
      syncedCount: number;
      duplicateCleanedCount: number;
      syncedAt: Date;
    }> = [];
    for (const task of tasks) {
      items.push(await this.syncHydroTaskRecord(task, user));
    }

    return {
      syncedTaskCount: items.length,
      submissionCount: items.reduce((sum, item) => sum + item.submissionCount, 0),
      resultCount: items.reduce((sum, item) => sum + item.syncedCount, 0),
      items,
    };
  }

  async taskResults(taskId: string, query: QueryHydroSummaryDto, user: RequestUser) {
    const task = await this.findHydroTask(taskId);
    await this.assertHydroTaskAccessible(task, user);
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.HydroResultWhereInput = {
      taskId,
      studentId: query.studentId,
      status: query.status,
    };
    const [items, total, allResults] = await this.prisma.$transaction([
      this.prisma.hydroResult.findMany({
        where,
        orderBy: [{ lastSubmitAt: 'desc' }, { updatedAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.hydroResult.count({ where }),
      this.prisma.hydroResult.findMany({ where: { taskId }, select: { status: true, score: true } }),
    ]);
    const users = await this.loadUserMap(items.map((item) => item.studentId));
    const scores = allResults.map((item) => (item.score === null ? null : Number(item.score))).filter((score): score is number => score !== null);

    return {
      task: this.formatHydroTask(task, await this.hydroTaskMeta([task]), (await this.hydroTaskMetrics([task.id])).get(task.id)),
      metrics: {
        total: allResults.length,
        submittedCount: allResults.filter((item) => item.status !== 'not_started').length,
        judgedCount: allResults.filter((item) => ['accepted', 'judged', 'done'].includes(item.status)).length,
        averageScore: this.average(scores),
        maxScore: scores.length ? Math.max(...scores) : 0,
      },
      items: items.map((item) => {
        const student = users.get(item.studentId);
        return {
          id: item.id,
          taskId: item.taskId,
          studentId: item.studentId,
          studentName: student?.realName ?? student?.username ?? '学生',
          username: student?.username ?? '',
          hydroUserId: item.hydroUserId,
          score: item.score === null ? null : Number(item.score),
          status: item.status,
          submitCount: item.submitCount,
          lastSubmitAt: item.lastSubmitAt,
          syncedAt: item.syncedAt,
          rawResult: item.rawResult,
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  async syncTaskResults(taskId: string, user: RequestUser) {
    const task = await this.findHydroTask(taskId);
    await this.assertHydroTaskAccessible(task, user);
    return this.syncHydroTaskRecord(task, user);
  }

  async retryFailedTaskResults(taskId: string, user: RequestUser) {
    const task = await this.findHydroTask(taskId);
    await this.assertHydroTaskAccessible(task, user);
    const failedResults = await this.prisma.hydroResult.findMany({
      where: {
        taskId,
        status: { in: ['failed', 'error', 'pending', 'judging'] },
      },
    });
    let retriedCount = 0;
    for (const result of failedResults) {
      const raw = this.toRecord(result.rawResult);
      const latestSubmissionId = String(raw.latestSubmissionId ?? '');
      if (!latestSubmissionId) continue;
      const synced = await this.syncSubmission(latestSubmissionId).catch(() => null);
      if (synced) retriedCount += 1;
    }
    const synced = await this.syncHydroTaskRecord(task, user);
    return { ...synced, retriedCount };
  }

  async problemBinding(questionId: string) {
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, deletedAt: null },
      include: { programmingRef: true },
    });
    if (!question) throw new NotFoundException('题目不存在');
    return question.programmingRef ? this.formatProblemRef(question.programmingRef) : null;
  }

  async bindProblem(questionId: string, dto: BindHydroProblemDto, user: RequestUser) {
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, deletedAt: null },
      select: { id: true, type: true, title: true },
    });
    if (!question) throw new NotFoundException('题目不存在');
    if (question.type !== QuestionType.PROGRAMMING) {
      throw new BadRequestException('只有编程题可以绑定 Hydro 题目');
    }

    const provider = (dto.judgeProvider || 'hydro').trim().toLowerCase();
    const externalProblemId = dto.externalProblemId.trim();
    const platformBaseUrl = this.normalizePlatformBaseUrl(dto.platformBaseUrl || this.baseUrlFromProblemUrl(dto.externalProblemUrl));
    const externalProblemUrl = this.normalizeProblemUrl(externalProblemId, dto.externalProblemUrl, platformBaseUrl, dto.domainId);
    const domainId = String(dto.domainId || this.domainIdFromProblemUrl(externalProblemUrl) || 'system').trim() || 'system';
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
      accountId: dto.accountId ?? this.toRecord(dto.judgeConfig).accountId ?? null,
      accountLabel,
      submitPageUrl:
        String(this.toRecord(dto.judgeConfig).submitPageUrl ?? '').trim() ||
        this.submitPageUrlFromProblemUrl(externalProblemUrl),
    };

    const binding = await this.prisma.programmingProblemRef.upsert({
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

    await this.audit.log({
      userId: user.id,
      action: 'hydro:bind-problem',
      module: 'hydro',
      targetType: 'question',
      targetId: questionId,
      afterData: { externalProblemId, externalProblemUrl },
    });

    return this.formatProblemRef(binding);
  }

  async removeProblemBinding(questionId: string, user: RequestUser) {
    await this.prisma.programmingProblemRef.deleteMany({ where: { questionId } });
    await this.audit.log({
      userId: user.id,
      action: 'hydro:remove-problem-binding',
      module: 'hydro',
      targetType: 'question',
      targetId: questionId,
    });
    return true;
  }

  async accounts(query: QueryHydroSummaryDto, user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const canManageAll = this.canManageAllExternalAccounts(user);
    if (!canManageAll && !this.canManageOwnExternalAccounts(user)) {
      throw new ForbiddenException('无权限管理外部账号');
    }
    if (!canManageAll && query.studentId && query.studentId !== user.id) {
      throw new ForbiddenException('只能查看自己的外部账号');
    }
    const where: Prisma.HydroAccountWhereInput = {
      studentId: canManageAll ? query.studentId : user.id,
      platformCode: query.platformCode ? this.normalizePlatformCode(query.platformCode) : undefined,
      platformBaseUrl: query.platformBaseUrl ? this.normalizePlatformBaseUrl(query.platformBaseUrl) : undefined,
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
    const [accounts, total] = await this.prisma.$transaction([
      this.prisma.hydroAccount.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take }),
      this.prisma.hydroAccount.count({ where }),
    ]);
    const userMap = await this.loadUserMap(accounts.map((item) => item.studentId));

    return {
      items: accounts.map((item) => {
        const student = userMap.get(item.studentId);
        return {
          ...this.formatHydroAccount(item),
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

  async myAccounts(user: RequestUser) {
    this.assertCanManageOwnExternalAccounts(user);
    const accounts = await this.prisma.hydroAccount.findMany({
      where: { studentId: user.id },
      orderBy: { updatedAt: 'desc' },
    });
    return accounts.map((item) => this.formatHydroAccount(item));
  }

  async myAccount(user: RequestUser) {
    this.assertCanManageOwnExternalAccounts(user);
    const account = await this.prisma.hydroAccount.findFirst({
      where: { studentId: user.id, platformCode: 'hydro' },
      orderBy: { updatedAt: 'desc' },
    });
    return account ? this.formatHydroAccount(account) : null;
  }

  async bindMyAccount(dto: BindHydroAccountDto, user: RequestUser) {
    this.assertCanManageOwnExternalAccounts(user);
    return this.bindAccount({ ...dto, studentId: user.id }, user);
  }

  async bindAccount(dto: BindHydroAccountDto, user: RequestUser) {
    const studentId = dto.studentId;
    if (!studentId) throw new BadRequestException('缺少用户 ID');
    this.assertCanManageExternalAccount(user, studentId);
    const platformCode = this.normalizePlatformCode(dto.platformCode);
    const platformBaseUrl = this.normalizePlatformBaseUrl(dto.platformBaseUrl);
    const loginUsername = dto.loginUsername?.trim() || dto.hydroUsername?.trim() || dto.hydroUserId?.trim();
    const hydroUsername = dto.hydroUsername?.trim() || loginUsername || dto.hydroUserId?.trim();
    const hydroUserId = dto.hydroUserId?.trim() || hydroUsername;
    if (!loginUsername || !hydroUsername || !hydroUserId) {
      throw new BadRequestException('请填写平台登录账号和 Hydro 用户名');
    }
    const targetUser = await this.prisma.user.findFirst({
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
      ? await this.prisma.hydroAccount.findFirst({ where: { id: dto.id, studentId } })
      : await this.prisma.hydroAccount.findFirst({
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
      platformName: dto.platformName?.trim() || this.platformName(platformCode),
      platformBaseUrl,
      hydroUserId,
      hydroUsername,
      loginUsername,
      loginPassword,
      bindStatus: dto.bindStatus ?? existing?.bindStatus ?? 'bound',
    };
    const account = existing
      ? await this.prisma.hydroAccount.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.hydroAccount.create({
          data: {
            ...data,
            studentId,
          },
        });

    await this.audit.log({
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

    return this.formatHydroAccount(account);
  }

  async testMyAccount(accountId: string, user: RequestUser) {
    this.assertCanManageOwnExternalAccounts(user);
    const account = await this.prisma.hydroAccount.findFirst({ where: { id: accountId, studentId: user.id } });
    if (!account) throw new NotFoundException('外部账号不存在');
    return this.testHydroAccountLogin(account);
  }

  async testAccount(accountId: string, user: RequestUser) {
    const account = await this.prisma.hydroAccount.findFirst({ where: { id: accountId } });
    if (!account) throw new NotFoundException('外部账号不存在');
    this.assertCanManageExternalAccount(user, account.studentId);
    return this.testHydroAccountLogin(account);
  }

  async deleteAccount(accountId: string, user: RequestUser) {
    const account = await this.prisma.hydroAccount.findFirst({ where: { id: accountId } });
    if (!account) throw new NotFoundException('外部账号不存在');
    this.assertCanManageExternalAccount(user, account.studentId);

    await this.prisma.hydroAccount.delete({ where: { id: accountId } });
    await this.audit.log({
      userId: user.id,
      action: 'hydro:delete-account',
      module: 'hydro',
      targetType: 'hydro_account',
      targetId: accountId,
      beforeData: this.formatHydroAccount(account),
    });

    return true;
  }

  async deleteMyAccount(accountId: string, user: RequestUser) {
    this.assertCanManageOwnExternalAccounts(user);
    return this.deleteAccount(accountId, user);
  }

  async submitCode(attemptId: string, questionId: string, dto: SubmitHydroCodeDto, user: RequestUser) {
    this.ensureStudent(user);
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId: user.id },
      include: { exam: true, paperInstance: true },
    });
    if (!attempt) throw new NotFoundException('答题记录不存在');
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('当前答题记录已提交，不能继续提交代码');
    }
    if (attempt.exam.endTime <= new Date()) {
      throw new BadRequestException('考试已结束，不能提交代码');
    }
    if (this.attemptDeadline(attempt) <= new Date()) {
      throw new BadRequestException('答题时长已用完，不能继续提交代码');
    }

    const paperSnapshot = attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot;
    const snapshotQuestion = this.findSnapshotQuestion(paperSnapshot, questionId);
    if (!snapshotQuestion) throw new BadRequestException('题目不属于当前试卷实例');
    if (String(snapshotQuestion.snapshot.type).toLowerCase() !== 'programming') {
      throw new BadRequestException('只有编程题可以提交代码');
    }

    const binding =
      snapshotQuestion.snapshot.programmingRef ??
      this.formatProblemRef(
        await this.prisma.programmingProblemRef.findUniqueOrThrow({ where: { questionId } }).catch(() => {
          throw new BadRequestException('该编程题尚未绑定 Hydro 题目');
        }),
      );
    const language = this.normalizeHydroLanguage(dto.language, binding.languages);
    const submitDto = { ...dto, language };
    const hydroAccount = await this.findAccountForBinding(user.id, binding, dto.accountId);
    if (!hydroAccount) {
      throw new BadRequestException('请先在个人信息中绑定当前 Hydro 站点账号，再提交编程题代码');
    }
    if (!hydroAccount.loginUsername || !hydroAccount.loginPassword) {
      throw new BadRequestException('当前 Hydro 账号缺少登录账号或密码，请先补全后再提交');
    }
    const hydroUsername = hydroAccount.hydroUsername;
    const submitResult = await this.submitToHydro(binding, submitDto, hydroAccount);

    const submission = await this.prisma.$transaction(async (tx) => {
      const created = await tx.judgeSubmission.create({
        data: {
          attemptId,
          questionId,
          studentId: user.id,
          provider: binding.judgeProvider || 'hydro',
          externalSubmissionId: submitResult.externalSubmissionId,
          language,
          codeSnapshot: submitDto.code,
          status: 'pending',
          resultJson: {
            mode: submitResult.mode,
            problemUrl: submitResult.problemUrl,
            recordUrl: submitResult.recordUrl ?? null,
            language,
            hydroAccountId: hydroAccount.id,
            hydroAccountLabel: this.accountLabel(hydroAccount),
            raw: submitResult.raw ?? null,
            message: submitResult.message ?? null,
          } as Prisma.InputJsonObject,
        },
      });

      await tx.answerRecord.upsert({
        where: {
          attemptId_questionId: {
            attemptId,
            questionId,
          },
        },
        update: {
          answerJson: this.codeAnswerJson(submitDto, binding, created.id, submitResult),
          status: AnswerRecordStatus.JUDGE_PENDING,
          isCorrect: null,
          score: 0,
          autoResultJson: {
            latestSubmissionId: created.id,
            mode: submitResult.mode,
            problemUrl: submitResult.problemUrl,
            recordUrl: submitResult.recordUrl ?? null,
          } as Prisma.InputJsonObject,
        },
        create: {
          attemptId,
          questionId,
          answerJson: this.codeAnswerJson(submitDto, binding, created.id, submitResult),
          status: AnswerRecordStatus.JUDGE_PENDING,
          isCorrect: null,
          score: 0,
          autoResultJson: {
            latestSubmissionId: created.id,
            mode: submitResult.mode,
            problemUrl: submitResult.problemUrl,
            recordUrl: submitResult.recordUrl ?? null,
          } as Prisma.InputJsonObject,
        },
      });

      return created;
    });

    await this.audit.log({
      userId: user.id,
      action: 'hydro:submit-code',
      module: 'hydro',
      targetType: 'judge_submission',
      targetId: submission.id,
      afterData: {
        attemptId,
        questionId,
        externalSubmissionId: submission.externalSubmissionId,
        mode: submitResult.mode,
      },
    });

    const synced = await this.syncSubmission(submission.id);
    if (synced) {
      const detail = await this.submissionDetail(submission.id, user);
      return {
        ...detail,
        hydroUsername,
        account: this.formatHydroAccount(hydroAccount),
        binding,
      };
    }

    return {
      submissionId: submission.id,
      externalSubmissionId: submission.externalSubmissionId,
      status: submitResult.status || submission.status,
      mode: submitResult.mode,
      problemUrl: submitResult.problemUrl,
      recordUrl: submitResult.recordUrl,
      score: submitResult.score ?? null,
      hydroUsername,
      language,
      account: this.formatHydroAccount(hydroAccount),
      binding,
      message:
        submitResult.message ||
        (submitResult.mode === 'direct'
          ? '代码已提交到 Hydro，等待判题回写'
          : '已记录本地提交；当前未配置自动提交适配，请在 Hydro 页面提交或由管理员回写结果'),
    };
  }

  async submitPracticeCode(questionId: string, dto: SubmitHydroCodeDto, user: RequestUser) {
    if (!this.canManageOwnExternalAccounts(user)) {
      throw new ForbiddenException('请使用学生或教师账号提交编程题测试');
    }
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, deletedAt: null, status: QuestionStatus.PUBLISHED, type: QuestionType.PROGRAMMING },
      include: { answer: true, programmingRef: true },
    });
    if (!question) throw new NotFoundException('编程题不存在或未发布');
    if (!question.programmingRef) throw new BadRequestException('该编程题尚未绑定 Hydro 题目');

    const binding = this.formatProblemRef(question.programmingRef);
    const language = this.normalizeHydroLanguage(dto.language, binding.languages);
    const hydroAccount = await this.findAccountForBinding(user.id, binding, dto.accountId);
    if (!hydroAccount) {
      throw new BadRequestException('请先在个人信息中绑定当前 Hydro 站点账号，再提交编程题代码');
    }
    if (!hydroAccount.loginUsername || !hydroAccount.loginPassword) {
      throw new BadRequestException('当前 Hydro 账号缺少登录账号或密码，请先补全后再提交');
    }

    const submitResult = await this.submitToHydro(binding, { ...dto, language }, hydroAccount);
    const maxScore = Number(question.defaultScore);
    const practiceScore = submitResult.score === null || submitResult.score === undefined ? null : Math.min(Math.max(Number(submitResult.score), 0), maxScore);
    const shouldRecordWrong =
      user.userType === UserType.STUDENT &&
      Number.isFinite(maxScore) &&
      maxScore > 0 &&
      practiceScore !== null &&
      practiceScore < maxScore;

    if (shouldRecordWrong) {
      await this.prisma.$transaction(async (tx) => {
        await this.upsertProgrammingWrongQuestion(tx, {
          studentId: user.id,
          questionId,
          sourceType: WrongQuestionSourceType.PRACTICE,
          sourceId: questionId,
          score: practiceScore,
          wrongAnswerJson: {
            language,
            code: dto.code,
            externalSubmissionId: submitResult.externalSubmissionId ?? null,
            status: submitResult.status ?? null,
          } as Prisma.InputJsonObject,
          correctAnswerJson: (question.answer?.answerJson ?? {}) as Prisma.InputJsonObject,
          eventType: 'practice_wrong',
          eventJson: {
            externalSubmissionId: submitResult.externalSubmissionId ?? null,
            status: submitResult.status ?? null,
            maxScore,
            message: submitResult.message ?? '',
          } as Prisma.InputJsonObject,
        });
      });
    }

    return {
      questionId,
      questionTitle: question.title,
      externalSubmissionId: submitResult.externalSubmissionId,
      status: submitResult.status || 'pending',
      mode: submitResult.mode,
      problemUrl: submitResult.problemUrl,
      recordUrl: submitResult.recordUrl,
      score: submitResult.score ?? null,
      maxScore,
      wrongQuestionAdded: shouldRecordWrong,
      language,
      account: this.formatHydroAccount(hydroAccount),
      binding,
      result: submitResult.result ?? submitResult.raw ?? null,
      message: submitResult.message || '代码已提交到 Hydro',
      judgedAt: submitResult.judgedAt,
    };
  }

  async submissionDetail(submissionId: string, user: RequestUser) {
    let submission = await this.prisma.judgeSubmission.findFirst({
      where: { id: submissionId },
      include: {
        question: { include: { programmingRef: true } },
        attempt: { select: { userId: true, examId: true } },
      },
    });
    if (!submission) throw new NotFoundException('判题提交记录不存在');
    if (submission.studentId !== user.id && !this.isPrivilegedUser(user)) {
      throw new ForbiddenException('无权查看该提交记录');
    }
    if (this.isSyncableSubmission(submission.status, submission.externalSubmissionId, submission.resultJson)) {
      await this.syncSubmission(submission.id);
      submission =
        (await this.prisma.judgeSubmission.findFirst({
          where: { id: submissionId },
          include: {
            question: { include: { programmingRef: true } },
            attempt: { select: { userId: true, examId: true } },
          },
        })) ?? submission;
    }
    const result = this.toRecord(submission.resultJson);
    return {
      submissionId: submission.id,
      attemptId: submission.attemptId,
      examId: submission.attempt.examId,
      questionId: submission.questionId,
      questionTitle: submission.question.title,
      provider: submission.provider,
      externalSubmissionId: submission.externalSubmissionId,
      externalProblemId: submission.question.programmingRef?.externalProblemId ?? '',
      externalProblemUrl: submission.question.programmingRef?.externalProblemUrl ?? '',
      language: submission.language,
      status: submission.status,
      score: submission.score === null ? null : Number(submission.score),
      message: String(result.message ?? ''),
      mode: String(result.mode ?? ''),
      problemUrl: String(result.problemUrl ?? ''),
      recordUrl: String(result.recordUrl ?? ''),
      submittedAt: submission.submittedAt,
      judgedAt: submission.judgedAt,
      result,
    };
  }

  async writeBackResult(dto: WriteBackHydroResultDto, user: RequestUser) {
    const result = await this.applyJudgeResult(dto);
    await this.audit.log({
      userId: user.id,
      action: 'hydro:writeback-result',
      module: 'hydro',
      targetType: 'judge_submission',
      targetId: result.submissionId,
      afterData: { score: result.score, status: result.status },
    });
    return result;
  }

  async writeBackCallback(dto: WriteBackHydroResultDto, headerSecret?: string) {
    const expected = process.env.HYDRO_CALLBACK_SECRET;
    if (expected && dto.secret !== expected && headerSecret !== expected) {
      throw new UnauthorizedException('Hydro 回写密钥不正确');
    }
    if (!expected && !process.env.HYDRO_ALLOW_UNSIGNED_CALLBACK) {
      throw new UnauthorizedException('未配置 HYDRO_CALLBACK_SECRET');
    }
    return this.applyJudgeResult(dto);
  }

  async summary(query: QueryHydroSummaryDto, user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const examScope = await this.dataScope.examWhere(user, query.classId);
    const status = query.status ? this.normalizeAnswerStatus(query.status) : undefined;
    const where: Prisma.AnswerRecordWhereInput = {
      questionId: query.questionId,
      question: {
        type: QuestionType.PROGRAMMING,
        deletedAt: null,
        courseId: query.courseId,
      },
      status: status ?? { in: [AnswerRecordStatus.JUDGE_PENDING, AnswerRecordStatus.JUDGE_DONE] },
      attempt: {
        examId: query.examId,
        userId: query.studentId,
        submittedAt: { not: null },
        exam: {
          ...examScope,
          deletedAt: null,
          courseId: query.courseId,
        },
      },
      OR: query.keyword
        ? [
            { question: { title: { contains: query.keyword, mode: 'insensitive' } } },
            { attempt: { exam: { name: { contains: query.keyword, mode: 'insensitive' } } } },
          ]
        : undefined,
    };

    const [records, total, allRecords, submissionCount, pendingSubmissionCount] = await this.prisma.$transaction([
      this.prisma.answerRecord.findMany({
        where,
        include: {
          question: {
            include: {
              programmingRef: true,
              course: { select: { name: true } },
            },
          },
          attempt: {
            include: {
              exam: { include: { course: { select: { name: true } } } },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.answerRecord.count({ where }),
      this.prisma.answerRecord.findMany({
        where,
        select: { id: true, questionId: true, attemptId: true, score: true, status: true, isCorrect: true },
      }),
      this.prisma.judgeSubmission.count({
        where: {
          questionId: query.questionId,
          studentId: query.studentId,
          attempt: {
            examId: query.examId,
            exam: {
              ...examScope,
              deletedAt: null,
              courseId: query.courseId,
            },
          },
        },
      }),
      this.prisma.judgeSubmission.count({
        where: {
          status: { in: ['pending', 'judging'] },
          questionId: query.questionId,
          studentId: query.studentId,
          attempt: {
            examId: query.examId,
            exam: {
              ...examScope,
              deletedAt: null,
              courseId: query.courseId,
            },
          },
        },
      }),
    ]);
    const users = await this.loadUserMap(records.map((item) => item.attempt.userId));
    const latestSubmissionMap = await this.latestSubmissionMap(
      records.map((item) => ({ attemptId: item.attemptId, questionId: item.questionId })),
    );
    const scores = allRecords.map((item) => Number(item.score));
    const questionGroups = new Map<string, { title: string; total: number; done: number; score: number }>();
    for (const record of records) {
      const group = questionGroups.get(record.questionId) ?? {
        title: record.question.title,
        total: 0,
        done: 0,
        score: 0,
      };
      group.total += 1;
      group.done += record.status === AnswerRecordStatus.JUDGE_DONE ? 1 : 0;
      group.score += Number(record.score);
      questionGroups.set(record.questionId, group);
    }

    return {
      metrics: {
        answerCount: allRecords.length,
        submissionCount,
        pendingSubmissionCount,
        judgedCount: allRecords.filter((item) => item.status === AnswerRecordStatus.JUDGE_DONE).length,
        pendingCount: allRecords.filter((item) => item.status === AnswerRecordStatus.JUDGE_PENDING).length,
        averageScore: this.average(scores),
        maxScore: scores.length ? Math.max(...scores) : 0,
      },
      byQuestion: [...questionGroups.entries()].map(([questionId, item]) => ({
        questionId,
        title: item.title,
        answerCount: item.total,
        judgedCount: item.done,
        averageScore: item.total ? Number((item.score / item.total).toFixed(2)) : 0,
      })),
      items: records.map((record) => {
        const student = users.get(record.attempt.userId);
        const latestSubmission = latestSubmissionMap.get(`${record.attemptId}:${record.questionId}`);
        return {
          answerRecordId: record.id,
          attemptId: record.attemptId,
          examId: record.attempt.examId,
          examName: record.attempt.exam.name,
          courseName: record.attempt.exam.course.name,
          studentId: record.attempt.userId,
          studentName: student?.realName ?? student?.username ?? '学生',
          username: student?.username ?? '',
          questionId: record.questionId,
          questionTitle: record.question.title,
          externalProblemId: record.question.programmingRef?.externalProblemId ?? '',
          externalProblemUrl: record.question.programmingRef?.externalProblemUrl ?? '',
          score: Number(record.score),
          isCorrect: record.isCorrect,
          status: toApiEnum(record.status),
          updatedAt: record.updatedAt,
          latestSubmission: latestSubmission
            ? {
                submissionId: latestSubmission.id,
                externalSubmissionId: latestSubmission.externalSubmissionId,
                language: latestSubmission.language,
                status: latestSubmission.status,
                score: latestSubmission.score === null ? null : Number(latestSubmission.score),
                submittedAt: latestSubmission.submittedAt,
                judgedAt: latestSubmission.judgedAt,
              }
            : null,
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  private async hydroTaskWhere(
    query: Pick<QueryHydroSummaryDto, 'courseId' | 'classId' | 'examId' | 'status' | 'keyword'>,
    user: RequestUser,
  ): Promise<Prisma.HydroTaskWhereInput> {
    if (query.classId) {
      await this.dataScope.assertClassWritable(user, query.classId);
    }
    if (query.examId) {
      await this.dataScope.assertExamAccessible(user, query.examId);
    }

    const and: Prisma.HydroTaskWhereInput[] = [
      { courseId: query.courseId },
      { classId: query.classId },
      { examId: query.examId },
      { status: query.status },
    ].filter((item) => Object.values(item).some((value) => value !== undefined));

    if (query.keyword) {
      and.push({
        OR: [
          { title: { contains: query.keyword, mode: 'insensitive' } },
          { hydroProblemId: { contains: query.keyword, mode: 'insensitive' } },
          { hydroContestId: { contains: query.keyword, mode: 'insensitive' } },
        ],
      });
    }

    const classIds = await this.dataScope.classIdsFor(user);
    if (classIds !== null) {
      and.push({
        OR: [
          { classId: { in: classIds } },
          { classId: null, createdBy: user.id },
        ],
      });
    }

    return and.length ? { AND: and } : {};
  }

  private async hydroTaskMeta(tasks: HydroTaskRecord[]) {
    const courseIds = [...new Set(tasks.map((item) => item.courseId).filter((id): id is string => Boolean(id)))];
    const classIds = [...new Set(tasks.map((item) => item.classId).filter((id): id is string => Boolean(id)))];
    const examIds = [...new Set(tasks.map((item) => item.examId).filter((id): id is string => Boolean(id)))];
    const [courses, classes, exams] = await Promise.all([
      courseIds.length
        ? this.prisma.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      classIds.length
        ? this.prisma.classGroup.findMany({ where: { id: { in: classIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      examIds.length
        ? this.prisma.exam.findMany({ where: { id: { in: examIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);

    return {
      courseNames: new Map(courses.map((item) => [item.id, item.name] as const)),
      classNames: new Map(classes.map((item) => [item.id, item.name] as const)),
      examNames: new Map(exams.map((item) => [item.id, item.name] as const)),
    };
  }

  private async hydroTaskMetrics(taskIds: string[]) {
    if (!taskIds.length) {
      return new Map<string, { resultCount: number; submittedCount: number; pendingCount: number; averageScore: number; maxScore: number }>();
    }
    const results = await this.prisma.hydroResult.findMany({
      where: { taskId: { in: taskIds } },
      select: { taskId: true, status: true, score: true },
    });
    const map = new Map<string, { resultCount: number; submittedCount: number; pendingCount: number; scores: number[] }>();
    for (const taskId of taskIds) {
      map.set(taskId, { resultCount: 0, submittedCount: 0, pendingCount: 0, scores: [] });
    }
    for (const result of results) {
      const metrics = map.get(result.taskId) ?? { resultCount: 0, submittedCount: 0, pendingCount: 0, scores: [] };
      metrics.resultCount += 1;
      if (result.status !== 'not_started') metrics.submittedCount += 1;
      if (['pending', 'judging'].includes(result.status)) metrics.pendingCount += 1;
      if (result.score !== null) metrics.scores.push(Number(result.score));
      map.set(result.taskId, metrics);
    }

    return new Map(
      [...map.entries()].map(([taskId, item]) => [
        taskId,
        {
          resultCount: item.resultCount,
          submittedCount: item.submittedCount,
          pendingCount: item.pendingCount,
          averageScore: this.average(item.scores),
          maxScore: item.scores.length ? Math.max(...item.scores) : 0,
        },
      ]),
    );
  }

  private formatHydroTask(
    task: HydroTaskRecord,
    meta: Awaited<ReturnType<HydroService['hydroTaskMeta']>>,
    metrics?: { resultCount: number; submittedCount: number; pendingCount: number; averageScore: number; maxScore: number },
  ) {
    return {
      id: task.id,
      title: task.title,
      courseId: task.courseId,
      courseName: task.courseId ? meta.courseNames.get(task.courseId) ?? '' : '',
      classId: task.classId,
      className: task.classId ? meta.classNames.get(task.classId) ?? '' : '',
      examId: task.examId,
      examName: task.examId ? meta.examNames.get(task.examId) ?? '' : '',
      hydroUrl: task.hydroUrl,
      hydroProblemId: task.hydroProblemId,
      hydroContestId: task.hydroContestId,
      startTime: task.startTime,
      endTime: task.endTime,
      status: task.status,
      resultCount: metrics?.resultCount ?? 0,
      submittedCount: metrics?.submittedCount ?? 0,
      pendingCount: metrics?.pendingCount ?? 0,
      averageScore: metrics?.averageScore ?? 0,
      maxScore: metrics?.maxScore ?? 0,
      createdBy: task.createdBy,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  private async findAccessibleExam(examId: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, examId);
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, deletedAt: null },
      select: { id: true, name: true, courseId: true, classId: true },
    });
    if (!exam) throw new NotFoundException('考试不存在');
    return exam;
  }

  private async assertCourseExists(courseId: string) {
    const exists = await this.prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('课程不存在');
  }

  private parseHydroTaskDate(value: string | null | undefined, label: string) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${label}格式不正确`);
    }
    return date;
  }

  private assertHydroTaskTimeRange(startTime?: Date | null, endTime?: Date | null) {
    if (startTime && endTime && startTime >= endTime) {
      throw new BadRequestException('Hydro 任务结束时间必须晚于开始时间');
    }
  }

  private requiredTaskText(value: unknown, label: string) {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException(`请填写${label}`);
    return text;
  }

  private optionalTaskText(value: unknown) {
    const text = String(value ?? '').trim();
    return text || null;
  }

  private async findHydroTask(taskId: string) {
    const task = await this.prisma.hydroTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Hydro 任务不存在');
    return task;
  }

  private async assertHydroTaskAccessible(task: HydroTaskRecord, user: RequestUser) {
    if (this.dataScope.isUnrestricted(user)) return;
    if (task.examId) {
      await this.dataScope.assertExamAccessible(user, task.examId);
      return;
    }
    if (task.classId) {
      await this.dataScope.assertClassWritable(user, task.classId);
      return;
    }
    if (task.createdBy === user.id) return;
    throw new ForbiddenException('无权限访问该 Hydro 任务');
  }

  private async syncHydroTaskRecord(task: HydroTaskRecord, user: RequestUser) {
    if (!task.examId && !task.hydroProblemId) {
      throw new BadRequestException('Hydro 任务至少需要绑定考试或 Hydro 题号后才能同步');
    }
    const submissions = await this.prisma.judgeSubmission.findMany({
      where: {
        attempt: task.examId ? { examId: task.examId } : undefined,
        question: task.hydroProblemId
          ? {
              programmingRef: {
                is: {
                  externalProblemId: task.hydroProblemId,
                },
              },
            }
          : undefined,
      },
      include: {
        question: { select: { id: true, title: true, programmingRef: true } },
        attempt: { select: { id: true, examId: true, userId: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });

    const latestByStudent = new Map<string, (typeof submissions)[number]>();
    const submitCountByStudent = new Map<string, number>();
    for (const submission of submissions) {
      submitCountByStudent.set(submission.studentId, (submitCountByStudent.get(submission.studentId) ?? 0) + 1);
      if (!latestByStudent.has(submission.studentId)) {
        latestByStudent.set(submission.studentId, submission);
      }
    }

    const studentIds = [...latestByStudent.keys()];
    const accounts = studentIds.length
      ? await this.prisma.hydroAccount.findMany({
          where: { studentId: { in: studentIds }, bindStatus: 'bound' },
          orderBy: { updatedAt: 'desc' },
        })
      : [];
    const accountMap = new Map<string, (typeof accounts)[number]>();
    for (const account of accounts) {
      if (!accountMap.has(account.studentId)) accountMap.set(account.studentId, account);
    }
    const existingResults = studentIds.length
      ? await this.prisma.hydroResult.findMany({
          where: { taskId: task.id, studentId: { in: studentIds } },
          orderBy: { updatedAt: 'desc' },
        })
      : [];
    const existingByStudent = new Map<string, (typeof existingResults)[number]>();
    const duplicateIds: string[] = [];
    for (const result of existingResults) {
      if (existingByStudent.has(result.studentId)) {
        duplicateIds.push(result.id);
      } else {
        existingByStudent.set(result.studentId, result);
      }
    }

    const syncedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (duplicateIds.length) {
        await tx.hydroResult.deleteMany({ where: { id: { in: duplicateIds } } });
      }
      for (const [studentId, latest] of latestByStudent.entries()) {
        const account = accountMap.get(studentId);
        const data = {
          hydroUserId: account?.hydroUserId ?? studentId,
          score: latest.score === null ? null : Number(latest.score),
          status: latest.status || 'pending',
          submitCount: submitCountByStudent.get(studentId) ?? 1,
          lastSubmitAt: latest.submittedAt,
          rawResult: {
            latestSubmissionId: latest.id,
            externalSubmissionId: latest.externalSubmissionId,
            questionId: latest.questionId,
            questionTitle: latest.question.title,
            provider: latest.provider,
            language: latest.language,
            judgedAt: latest.judgedAt?.toISOString() ?? null,
            result: latest.resultJson ?? null,
          } as Prisma.InputJsonObject,
          syncedAt,
        };
        const existing = existingByStudent.get(studentId);
        if (existing) {
          await tx.hydroResult.update({
            where: { id: existing.id },
            data,
          });
        } else {
          await tx.hydroResult.create({
            data: {
              taskId: task.id,
              studentId,
              ...data,
            },
          });
        }
      }
      if (task.status === 'draft' && latestByStudent.size) {
        await tx.hydroTask.update({ where: { id: task.id }, data: { status: 'active' } });
      }
    });

    await this.audit.log({
      userId: user.id,
      action: 'hydro:sync-task-results',
      module: 'hydro',
      targetType: 'hydro_task',
      targetId: task.id,
      afterData: {
        submissionCount: submissions.length,
        syncedCount: latestByStudent.size,
        hydroProblemId: task.hydroProblemId,
      },
    });

    return {
      taskId: task.id,
      title: task.title,
      submissionCount: submissions.length,
      syncedCount: latestByStudent.size,
      duplicateCleanedCount: duplicateIds.length,
      syncedAt,
    };
  }

  private async applyJudgeResult(dto: WriteBackHydroResultDto) {
    if (!dto.submissionId && !dto.externalSubmissionId) {
      throw new BadRequestException('缺少 submissionId 或 externalSubmissionId');
    }

    const submission = await this.prisma.judgeSubmission.findFirst({
      where: dto.submissionId
        ? { id: dto.submissionId }
        : {
            provider: 'hydro',
            externalSubmissionId: dto.externalSubmissionId,
          },
      include: {
        attempt: { include: { paperInstance: true } },
      },
    });
    if (!submission) throw new NotFoundException('判题提交记录不存在');

    const snapshot = this.findSnapshotQuestion(
      submission.attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot,
      submission.questionId,
    );
    const maxScore = Number(snapshot?.score ?? 0);
    const normalizedStatus = this.normalizeJudgeStatus(dto.status);
    const accepted = normalizedStatus === 'accepted';
    const score =
      dto.score === undefined || dto.score === null
        ? accepted
          ? maxScore
          : 0
        : Math.min(Math.max(Number(dto.score), 0), maxScore);
    const isFullScore = maxScore > 0 ? score >= maxScore : accepted;
    const judgedAt = dto.judgedAt ? new Date(dto.judgedAt) : new Date();
    const previousResult = this.toRecord(submission.resultJson);
    const hydroResult = this.toRecord(dto.result);
    const recordUrl = String(hydroResult.recordUrl ?? previousResult.recordUrl ?? '');
    const problemUrl = String(previousResult.problemUrl ?? hydroResult.problemUrl ?? '');
    const mode = String(previousResult.mode ?? hydroResult.mode ?? 'direct');
    const resultJson = {
      ...previousResult,
      ...hydroResult,
      message: dto.message ?? null,
      recordUrl: recordUrl || null,
      problemUrl: problemUrl || null,
      writebackStatus: dto.status,
    } as Prisma.InputJsonObject;
    const autoResultJson = {
      latestSubmissionId: submission.id,
      externalSubmissionId: submission.externalSubmissionId,
      status: normalizedStatus,
      message: dto.message ?? '',
      mode,
      problemUrl,
      recordUrl,
      language: String(hydroResult.language ?? previousResult.language ?? submission.language),
      result: hydroResult,
    } as Prisma.InputJsonObject;

    await this.prisma.$transaction(async (tx) => {
      await tx.judgeSubmission.update({
        where: { id: submission.id },
        data: {
          status: normalizedStatus,
          score,
          judgedAt,
          resultJson,
        },
      });

      await tx.answerRecord.upsert({
        where: {
          attemptId_questionId: {
            attemptId: submission.attemptId,
            questionId: submission.questionId,
          },
        },
        update: {
          score,
          isCorrect: isFullScore,
          status: AnswerRecordStatus.JUDGE_DONE,
          autoResultJson,
          gradedAt: judgedAt,
        },
        create: {
          attemptId: submission.attemptId,
          questionId: submission.questionId,
          answerJson: {
            language: submission.language,
            code: submission.codeSnapshot,
            latestSubmissionId: submission.id,
          } as Prisma.InputJsonObject,
          score,
          isCorrect: isFullScore,
          status: AnswerRecordStatus.JUDGE_DONE,
          autoResultJson,
          gradedAt: judgedAt,
        },
      });

      if (maxScore > 0 && score < maxScore) {
        await this.upsertProgrammingWrongQuestion(tx, {
          studentId: submission.studentId,
          questionId: submission.questionId,
          sourceType: WrongQuestionSourceType.EXAM,
          sourceId: submission.attempt.examId,
          score,
          wrongAnswerJson: {
            language: submission.language,
            code: submission.codeSnapshot,
            latestSubmissionId: submission.id,
            externalSubmissionId: submission.externalSubmissionId,
            status: normalizedStatus,
          } as Prisma.InputJsonObject,
          correctAnswerJson: this.snapshotAnswerJson(snapshot),
          eventType: 'exam_wrong',
          eventJson: {
            attemptId: submission.attemptId,
            submissionId: submission.id,
            externalSubmissionId: submission.externalSubmissionId,
            status: normalizedStatus,
            maxScore,
            message: dto.message ?? '',
          } as Prisma.InputJsonObject,
        });
      }

      await this.recalculateAttempt(tx, submission.attemptId);
    });

    return {
      submissionId: submission.id,
      externalSubmissionId: submission.externalSubmissionId,
      attemptId: submission.attemptId,
      questionId: submission.questionId,
      status: normalizedStatus,
      score,
      maxScore,
      judgedAt,
    };
  }

  private async upsertProgrammingWrongQuestion(
    tx: Prisma.TransactionClient,
    params: {
      studentId: string;
      questionId: string;
      sourceType: WrongQuestionSourceType;
      sourceId: string;
      score: number;
      wrongAnswerJson: Prisma.InputJsonObject;
      correctAnswerJson: Prisma.InputJsonValue;
      eventType: string;
      eventJson: Prisma.InputJsonObject;
    },
  ) {
    const wrongItem = await tx.wrongQuestion.upsert({
      where: {
        studentId_questionId: {
          studentId: params.studentId,
          questionId: params.questionId,
        },
      },
      update: {
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        wrongAnswerJson: params.wrongAnswerJson,
        correctAnswerJson: params.correctAnswerJson,
        score: params.score,
        masteryStatus: MasteryStatus.UNMASTERED,
        wrongCount: { increment: 1 },
        lastWrongAt: new Date(),
      },
      create: {
        studentId: params.studentId,
        questionId: params.questionId,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        wrongAnswerJson: params.wrongAnswerJson,
        correctAnswerJson: params.correctAnswerJson,
        score: params.score,
        masteryStatus: MasteryStatus.UNMASTERED,
      },
    });

    await tx.wrongQuestionEvent.create({
      data: {
        wrongQuestionId: wrongItem.id,
        studentId: params.studentId,
        questionId: params.questionId,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        eventType: params.eventType,
        isCorrect: false,
        score: params.score,
        masteryStatus: MasteryStatus.UNMASTERED,
        eventJson: params.eventJson,
      },
    });
  }

  private snapshotAnswerJson(snapshot?: SnapshotQuestion) {
    const answer = (snapshot?.snapshot as { answer?: Prisma.JsonValue } | undefined)?.answer;
    return (answer ?? {}) as Prisma.InputJsonValue;
  }

  private problemIdFromInput(value: string) {
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

  private async fetchHydroProblemHtml(url: string, session?: HydroSession | null) {
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
              headers: { 'User-Agent': 'MoranExamHydroPull/1.0' },
              signal: controller.signal,
        });
        const html = await response.text();
        if (this.isHydroBotChallenge(html, response.url || candidate)) {
          throw new BadRequestException(this.hydroBotChallengeMessage);
        }
        if (!response.ok) {
          lastError = `${response.status} ${html.slice(0, 120)}`;
          continue;
        }
        return { url: response.url || candidate, html };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (this.isHydroBotChallenge(message)) throw error;
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new BadRequestException(`Hydro 题目拉取失败：${lastError || '无法访问题目页面'}`);
  }

  private async resolveHydroProblemBySearch(
    keyword: string,
    baseUrl = this.hydroBaseUrl(),
    session?: HydroSession | null,
    domainId?: string | null,
  ) {
    const normalizedDomain = String(domainId || '').trim();
    const domainPrefix = normalizedDomain && normalizedDomain !== 'system' ? `/d/${encodeURIComponent(normalizedDomain)}` : '';
    const searchUrl = `${this.normalizePlatformBaseUrl(baseUrl)}${domainPrefix}/p?q=${encodeURIComponent(keyword.trim())}`;
    const fetched = await this.fetchHydroProblemHtml(searchUrl, session);
    const href = this.extractFirstProblemHref(fetched.html);
    if (!href) {
      throw new BadRequestException('Hydro 未找到匹配题目，请改用题号或完整链接');
    }
    return this.absoluteHydroUrl(href, baseUrl);
  }

  private extractFirstProblemHref(html: string) {
    const scopedMatch = html.match(
      /<td[^>]*class=["'][^"']*col--name[^"']*col--problem-name[^"']*["'][\s\S]*?<a\s+href=["']([^"']+)["']/i,
    );
    if (scopedMatch?.[1]) return scopedMatch[1];
    const genericMatch = html.match(/<a\s+href=["'](\/p\/[^"'?#]+)["'][^>]*>/i);
    return genericMatch?.[1] ?? '';
  }

  private extractHydroContext(html: string) {
    return this.toRecord(this.extractJsonAssignment(html, 'UiContextNew'));
  }

  private extractJsonAssignment(html: string, name: string): unknown {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = html.match(new RegExp(`window\\.${escapedName}\\s*=\\s*'([\\s\\S]*?)';`));
    if (!match?.[1]) return {};
    const raw = match[1];
    try {
      return JSON.parse(raw);
    } catch {
      try {
        return JSON.parse(this.decodeJsString(raw));
      } catch {
        return {};
      }
    }
  }

  private decodeJsString(raw: string) {
    try {
      return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
    } catch {
      return raw;
    }
  }

  private extractHydroStatementHtml(html: string, context: Record<string, unknown>) {
    const pdoc = this.toRecord(context.pdoc);
    const content = pdoc.content;
    const contentRecord =
      typeof content === 'string' ? this.toRecord(this.parseJsonSafely(content)) : this.toRecord(content);
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
    const closeStart = this.findClosingDiv(html, openEnd + 1);
    return closeStart > openEnd ? html.slice(openEnd + 1, closeStart) : '';
  }

  private findClosingDiv(html: string, from: number) {
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

  private extractHydroTitle(html: string, context: Record<string, unknown>) {
    const pdoc = this.toRecord(context.pdoc);
    const contextTitle = String(pdoc.title ?? context.title ?? '').trim();
    if (contextTitle) return this.decodeHtml(this.stripTags(contextTitle)).trim();

    const h1Match = html.match(/<h1[^>]*class=["'][^"']*section__title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
    const h1Title = h1Match?.[1] ? this.decodeHtml(this.stripTags(h1Match[1])).replace(/^#?\S+\.\s*/, '').trim() : '';
    if (h1Title) return h1Title;

    const ogTitle = this.extractMetaContent(html, 'og:title')
      .replace(/\s*-\s*.*$/, '')
      .replace(/^#?\S+\.\s*/, '')
      .trim();
    if (ogTitle) return ogTitle;

    return this.extractTagText(html, 'title')
      .replace(/\s*-\s*题目详情.*$/, '')
      .trim();
  }

  private extractTimeLimit(html: string) {
    const text = this.extractByRegex(html, /icon-stopwatch[^>]*>([^<]+)/i);
    const match = text.match(/([\d.]+)\s*(ms|s|秒)?/i);
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    return /^(s|秒)$/i.test(match[2] || '') ? Math.round(value * 1000) : Math.round(value);
  }

  private extractMemoryLimit(html: string) {
    const text = this.extractByRegex(html, /icon-comparison[^>]*>([^<]+)/i);
    const match = text.match(/([\d.]+)\s*(kib|kb|mib|mb|gib|gb)?/i);
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    const unit = (match[2] || 'mib').toLowerCase();
    if (unit === 'gib' || unit === 'gb') return Math.round(value * 1024);
    if (unit === 'kib' || unit === 'kb') return Math.max(1, Math.round(value / 1024));
    return Math.round(value);
  }

  private htmlToMarkdown(html: string) {
    const codeBlocks: string[] = [];
    let source = String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');

    source = source.replace(/<pre[^>]*>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, attrs, code) => {
      const language = String(attrs || '').match(/language-([A-Za-z0-9_.+-]+)/)?.[1] || '';
      const fenced = `\`\`\`${language}\n${this.decodeHtml(this.stripTags(code)).trimEnd()}\n\`\`\``;
      const token = `@@HYDRO_CODE_${codeBlocks.length}@@`;
      codeBlocks.push(fenced);
      return `\n\n${token}\n\n`;
    });

    source = source
      .replace(/<img\b([^>]*)>/gi, (_, attrs) => {
        const src = this.attributeValue(attrs, 'src');
        const alt = this.attributeValue(attrs, 'alt') || '图片';
        return src ? `\n\n![${this.decodeHtml(alt)}](${this.absoluteHydroUrl(src)})\n\n` : '';
      })
      .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, text) => {
        const href = this.attributeValue(attrs, 'href');
        const label = this.decodeHtml(this.stripTags(text)).trim();
        return href && label ? `[${label}](${this.absoluteHydroUrl(href)})` : label;
      })
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${this.decodeHtml(this.stripTags(code)).trim()}\``)
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => {
        const depth = Math.min(Math.max(Number(level), 2), 4);
        return `\n\n${'#'.repeat(depth)} ${this.decodeHtml(this.stripTags(text)).trim()}\n\n`;
      })
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/li>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<[^>]+>/g, '');

    let markdown = this.decodeHtml(source)
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    codeBlocks.forEach((block, index) => {
      markdown = markdown.replace(`@@HYDRO_CODE_${index}@@`, block);
    });

    return markdown;
  }

  private pickHydroLanguages(rawLanguages: string[]) {
    const available = [...new Set(rawLanguages.map((item) => item.trim()).filter(Boolean))];
    if (!available.length) return this.defaultHydroLanguages();
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

  private extractHydroLanguages(html: string, config: Record<string, unknown>) {
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
        const value = this.decodeHtml(optionMatch[1]).trim();
        if (this.isHydroLanguageId(value)) values.add(value);
      }
    }

    return [...values];
  }

  private isHydroLanguageId(value: string) {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 40 || /[/?#\s]/.test(normalized)) return false;
    if (['c', 'cc', 'java', 'pas', 'go', 'rust', 'rs'].includes(normalized)) return true;
    return /^(?:cc|c|py|java|js|ts|go|rust|rs|pas)[._-][a-z0-9._-]+$/i.test(normalized);
  }

  private defaultHydroLanguages() {
    return String(process.env.HYDRO_DEFAULT_LANGUAGES || 'cc.cc17o2,py.py3')
      .split(/[,，、\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private normalizeHydroLanguage(language: string, allowedLanguages: string[] = []) {
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

  private async findAccountForBinding(userId: string, binding: HydroProblemBinding, selectedAccountId?: string) {
    const platformCode = this.normalizePlatformCode(binding.judgeProvider);
    const judgeConfig = this.toRecord(binding.judgeConfig);
    const platformBaseUrl = this.normalizePlatformBaseUrl(
      binding.platformBaseUrl || String(judgeConfig.platformBaseUrl ?? '') || this.baseUrlFromProblemUrl(binding.externalProblemUrl),
    );
    const assertMatchedAccount = (account: HydroAccount) => {
      if (!this.isSamePlatformBaseUrl(account.platformBaseUrl, platformBaseUrl)) {
        throw new BadRequestException(
          `所选账号属于 ${this.shortHost(account.platformBaseUrl)}，当前题目来源 ${this.shortHost(platformBaseUrl)}，请切换同站点账号`,
        );
      }
      return account;
    };

    if (selectedAccountId) {
      const selected = await this.prisma.hydroAccount.findFirst({
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
      const preferred = await this.prisma.hydroAccount.findFirst({
        where: {
          id: binding.accountId,
          studentId: userId,
          bindStatus: 'bound',
        },
      });
      if (preferred && this.isSamePlatformBaseUrl(preferred.platformBaseUrl, platformBaseUrl)) {
        return preferred;
      }
    }

    const candidates = await this.prisma.hydroAccount.findMany({
      where: {
        studentId: userId,
        bindStatus: 'bound',
      },
      orderBy: { updatedAt: 'desc' },
    });
    const sameSiteAccounts = candidates.filter((account) => this.isSamePlatformBaseUrl(account.platformBaseUrl, platformBaseUrl));
    return sameSiteAccounts.find((account) => this.normalizePlatformCode(account.platformCode) === platformCode) ?? sameSiteAccounts[0] ?? null;
  }

  private isSamePlatformBaseUrl(left?: string | null, right?: string | null) {
    const normalizedLeft = this.normalizePlatformBaseUrl(left);
    const normalizedRight = this.normalizePlatformBaseUrl(right);
    try {
      return this.canonicalHost(normalizedLeft) === this.canonicalHost(normalizedRight);
    } catch {
      return normalizedLeft === normalizedRight;
    }
  }

  private canonicalHost(value?: string | null) {
    try {
      return new URL(this.normalizePlatformBaseUrl(value)).host.toLowerCase().replace(/^www\./, '');
    } catch {
      return String(value || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase().replace(/^www\./, '');
    }
  }

  private normalizePlatformCode(value?: string) {
    return String(value || 'hydro').trim().toLowerCase() || 'hydro';
  }

  private normalizePlatformBaseUrl(value?: string | null) {
    const raw = String(value || this.hydroBaseUrl()).trim() || this.hydroBaseUrl();
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return withScheme.replace(/\/+$/, '');
  }

  private platformData(dto: SaveHydroPlatformDto) {
    const code = this.normalizePlatformCode(dto.code);
    const name = dto.name.trim();
    const baseUrl = this.normalizePlatformBaseUrl(dto.baseUrl);
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

  private async assertPlatformCodeAvailable(code: string, currentId?: string) {
    const currentFilter = currentId ? Prisma.sql`AND id <> ${currentId}::uuid` : Prisma.empty;
    const duplicate = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM external_oj_platforms
      WHERE code = ${code} ${currentFilter}
      LIMIT 1
    `;
    if (duplicate.length) {
      throw new BadRequestException('平台编码已存在');
    }
  }

  private async findPlatform(id: string) {
    const [platform] = await this.prisma.$queryRaw<ExternalOjPlatformRow[]>`
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

  private formatPlatform(
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

  private platformName(code: string) {
    return code === 'hydro' ? 'Hydro' : code;
  }

  private baseUrlFromProblemUrl(url?: string | null) {
    const raw = String(url || '').trim();
    if (!raw) return this.hydroBaseUrl();
    try {
      const parsed = new URL(raw);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return this.hydroBaseUrl();
    }
  }

  private isHydroBotChallenge(content?: string | null, locationOrUrl?: string | null) {
    const raw = `${content || ''} ${locationOrUrl || ''}`;
    const text = this.decodeHtml(this.stripTags(raw)).replace(/\s+/g, ' ').toLowerCase();
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

  private sanitizeHydroMessage(value: string, fallback: string) {
    if (this.isHydroBotChallenge(value)) return this.hydroBotChallengeMessage;
    return this.decodeHtml(this.stripTags(value)).replace(/\s+/g, ' ').trim().slice(0, 240) || fallback;
  }

  private async markHydroAccountBlocked(account: Pick<HydroAccount, 'id'>) {
    await this.prisma.hydroAccount.updateMany({
      where: { id: account.id },
      data: {
        lastLoginStatus: 'blocked',
        lastLoginMessage: this.hydroBotChallengeMessage,
        lastLoginAt: new Date(),
      },
    });
  }

  private async testHydroAccountLogin(account: HydroAccount) {
    if (!account.loginUsername || !account.loginPassword) {
      throw new BadRequestException('外部账号缺少登录账号或密码');
    }

    const platformLabel = this.platformLoginLabel(account);
    let status = 'failed';
    let message = `${platformLabel} 登录失败`;
    try {
      await this.createHydroSession(account);
      status = 'success';
      message = `${platformLabel} 登录检测通过`;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : message;
      if (this.isHydroBotChallenge(rawMessage)) {
        status = 'blocked';
        message = this.hydroBotChallengeMessage;
      } else {
        message = this.sanitizeHydroMessage(rawMessage, message);
      }
    }

    const updated = await this.prisma.hydroAccount.update({
      where: { id: account.id },
      data: {
        lastLoginStatus: status,
        lastLoginMessage: message,
        lastLoginAt: new Date(),
      },
    });
    return {
      ...this.formatHydroAccount(updated),
      success: status === 'success',
      status,
      message,
    };
  }

  private async submitToHydro(
    binding: HydroProblemBinding,
    dto: SubmitHydroCodeDto,
    account: HydroAccount,
  ): Promise<HydroSubmitResult> {
    if (account.lastLoginStatus === 'blocked') {
      throw new BadRequestException(this.hydroBotChallengeMessage);
    }

    const judgeConfig = this.toRecord(binding.judgeConfig);
    const bindingBaseUrl = this.normalizePlatformBaseUrl(
      binding.platformBaseUrl ||
        String(judgeConfig.platformBaseUrl ?? '') ||
        account.platformBaseUrl ||
        this.baseUrlFromProblemUrl(binding.externalProblemUrl),
    );
    if (!this.isSamePlatformBaseUrl(account.platformBaseUrl, bindingBaseUrl)) {
      throw new BadRequestException(
        `提交账号属于 ${this.shortHost(account.platformBaseUrl)}，当前题目来源 ${this.shortHost(bindingBaseUrl)}，不能跨站点提交`,
      );
    }
    const baseUrl = this.normalizePlatformBaseUrl(account.platformBaseUrl);
    const domainId = String(binding.domainId || judgeConfig.domainId || '').trim();
    const problemUrl = this.normalizeProblemUrl(binding.externalProblemId, undefined, baseUrl, domainId);
    const session = await this.createHydroSession(account, baseUrl);
    const submitUrl = this.submitPageUrlFromProblemUrl(problemUrl) || `${baseUrl}/p/${encodeURIComponent(binding.externalProblemId)}/submit`;

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
    if (this.isHydroBotChallenge(text, `${response.url} ${location}`)) {
      await this.markHydroAccountBlocked(account);
      throw new BadRequestException(this.hydroBotChallengeMessage);
    }
    const externalSubmissionId = this.extractHydroRecordIdFromLocation(location);
    if (!externalSubmissionId) {
      const message = this.sanitizeHydroMessage(text, '未返回评测记录');
      throw new BadRequestException(`Hydro 提交失败：${response.status} ${message || '未返回评测记录'}`);
    }

    const recordUrl = this.absoluteHydroUrl(location, baseUrl);
    let record = await this.fetchHydroRecordResult(session, externalSubmissionId, recordUrl).catch(async (error) => {
      const message = error instanceof Error ? error.message : 'Hydro 结果读取失败';
      if (this.isHydroBotChallenge(message)) {
        await this.markHydroAccountBlocked(account);
      }
      return {
        externalSubmissionId,
        recordUrl,
        status: 'pending',
        score: null,
        message,
        judgedAt: null,
        final: false,
        result: { error: message },
      } satisfies HydroRecordResult;
    });
    for (const waitMs of [1000, 2000, 3000]) {
      if (record.final) break;
      await this.delay(waitMs);
      record = await this.fetchHydroRecordResult(session, externalSubmissionId, recordUrl).catch(async (error) => {
        const message = error instanceof Error ? error.message : 'Hydro 结果读取失败';
        if (this.isHydroBotChallenge(message)) {
          await this.markHydroAccountBlocked(account);
        }
        return record;
      });
    }

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

  private async createHydroSession(account: HydroAccount, explicitBaseUrl?: string): Promise<HydroSession> {
    const baseUrl = this.normalizePlatformBaseUrl(explicitBaseUrl || account.platformBaseUrl);
    const platformLabel = this.platformLoginLabel(account);
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
        'User-Agent': 'Mozilla/5.0 MoranExamHydro/1.0',
        ...(init.headers ?? {}),
        ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
      };
      const response = await fetch(this.absoluteHydroUrl(url, baseUrl), {
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
    if (this.isHydroBotChallenge(loginPageText, `${loginPageResponse.url} ${loginPageLocation}`)) {
      await this.markHydroAccountBlocked(account);
      throw new BadRequestException(this.hydroBotChallengeMessage);
    }

    const body = new URLSearchParams({
      uname: account.loginUsername ?? '',
      password: account.loginPassword ?? '',
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
    if (this.isHydroBotChallenge(text, `${response.url} ${location}`)) {
      await this.markHydroAccountBlocked(account);
      throw new BadRequestException(this.hydroBotChallengeMessage);
    }
    const redirectedAway = response.status >= 300 && response.status < 400 && !/\/login\b/i.test(location);
    const hasSession = cookies.has('sid') || cookies.has('sid.sig');
    const bodyLooksLoggedIn = /退出|注销|logout/i.test(text) && !/密码错误|登录失败|LoginError|password/i.test(text);
    if (!((redirectedAway && hasSession) || bodyLooksLoggedIn)) {
      const message = this.sanitizeHydroMessage(text, `${platformLabel} 登录失败：${response.status}`);
      throw new BadRequestException(message);
    }

    await this.prisma.hydroAccount.updateMany({
      where: { id: account.id },
      data: {
        lastLoginStatus: 'success',
        lastLoginMessage: `${platformLabel} 登录检测通过`,
        lastLoginAt: new Date(),
      },
    });

    return { baseUrl, cookieHeader, fetch: sessionFetch };
  }

  private platformLoginLabel(account: Pick<HydroAccount, 'platformCode' | 'platformName'>) {
    return account.platformName?.trim() || this.platformName(this.normalizePlatformCode(account.platformCode));
  }

  private async fetchHydroRecordResult(
    session: HydroSession,
    externalSubmissionId: string,
    recordUrl?: string,
  ): Promise<HydroRecordResult> {
    const targetUrl = recordUrl || `${session.baseUrl}/record/${encodeURIComponent(externalSubmissionId)}`;
    const response = await session.fetch(targetUrl, {
      redirect: 'manual',
      headers: { Referer: session.baseUrl },
    });
    const html = await response.text();
    if (this.isHydroBotChallenge(html, response.url || targetUrl)) {
      throw new BadRequestException(this.hydroBotChallengeMessage);
    }
    if (!response.ok) {
      throw new BadRequestException(`Hydro 结果读取失败：${response.status}`);
    }
    return this.parseHydroRecordHtml(html, externalSubmissionId, this.absoluteHydroUrl(targetUrl, session.baseUrl));
  }

  private parseHydroRecordHtml(html: string, externalSubmissionId: string, recordUrl: string): HydroRecordResult {
    const statusText =
      this.extractByRegex(html, /<span[^>]*class=["'][^"']*record-status--text[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
      this.extractByRegex(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const status = this.normalizeJudgeStatus(statusText);
    const scoreText =
      this.extractByRegex(html, /<dl[^>]*id=["']summary["'][\s\S]*?<dt>\s*分数\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i) ||
      this.extractByRegex(html, /<h1[^>]*class=["'][^"']*section__title[^"']*["'][\s\S]*?<span[^>]*style=["'][^"']*color:[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const parsedScore = Number(String(scoreText).trim());
    const score = Number.isFinite(parsedScore) && parsedScore >= 0 ? parsedScore : status === 'accepted' ? 100 : null;
    const judgedTimestamp = this.extractByRegex(
      html,
      /<dt>\s*评测时间\s*<\/dt>\s*<dd>\s*<span[^>]*data-timestamp=["']([^"']+)["'][^>]*>/i,
    );
    const judgedAtNumber = Number(judgedTimestamp);
    const judgedAt = Number.isFinite(judgedAtNumber) && judgedAtNumber > 0 ? new Date(judgedAtNumber * 1000).toISOString() : null;
    const message =
      this.extractByRegex(html, /<span[^>]*class=["']message["'][^>]*>([\s\S]*?)<\/span>/i) ||
      statusText ||
      status;
    const dataStatus = this.extractByRegex(html, /<div[^>]*id=["']status["'][^>]*data-status=["']([^"']+)["']/i);
    const language = this.extractDlValue(html, '语言');
    const submitter = this.extractByRegex(html, /<dt>\s*递交者\s*<\/dt>[\s\S]*?<a[^>]*class=["'][^"']*user-profile-name[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    return {
      externalSubmissionId,
      recordUrl,
      status,
      score,
      message: this.decodeHtml(this.stripTags(message)).replace(/\s+/g, ' ').trim(),
      judgedAt,
      final: !['pending', 'judging'].includes(status),
      result: {
        externalSubmissionId,
        recordUrl,
        statusText: this.decodeHtml(this.stripTags(statusText)).replace(/\s+/g, ' ').trim(),
        dataStatus,
        score,
        language,
        submitter,
      },
    };
  }

  private async syncSubmission(submissionId: string) {
    const submission = await this.prisma.judgeSubmission.findFirst({
      where: { id: submissionId },
      include: { question: { include: { programmingRef: true } } },
    });
    if (!submission || !this.isSyncableSubmission(submission.status, submission.externalSubmissionId, submission.resultJson)) {
      return null;
    }
    const resultJson = this.toRecord(submission.resultJson);
    const accountId = String(resultJson.hydroAccountId ?? '');
    const account = accountId ? await this.prisma.hydroAccount.findFirst({ where: { id: accountId } }) : null;
    if (!account) return null;
    if (account.lastLoginStatus === 'blocked') return null;
    const session = await this.createHydroSession(account);
    const recordUrl = String(resultJson.recordUrl || '');
    const record = await this.fetchHydroRecordResult(session, submission.externalSubmissionId as string, recordUrl || undefined);
    if (!record.final) {
      await this.prisma.judgeSubmission.update({
        where: { id: submission.id },
        data: {
          status: record.status,
          resultJson: {
            ...resultJson,
            recordUrl: record.recordUrl,
            message: record.message,
            result: record.result,
          } as Prisma.InputJsonObject,
        },
      });
      return record;
    }
    await this.applyJudgeResult({
      submissionId: submission.id,
      externalSubmissionId: submission.externalSubmissionId ?? undefined,
      status: record.status,
      score: record.score ?? undefined,
      message: record.message,
      judgedAt: record.judgedAt ?? undefined,
      result: {
        ...record.result,
        recordUrl: record.recordUrl,
      },
    });
    return record;
  }

  private async syncPendingSubmissions() {
    const submissions = await this.prisma.judgeSubmission.findMany({
      where: {
        status: { in: ['pending', 'judging'] },
        externalSubmissionId: { not: null },
      },
      orderBy: { submittedAt: 'asc' },
      take: 20,
    });
    for (const submission of submissions) {
      await this.syncSubmission(submission.id).catch(() => undefined);
    }
  }

  private isSyncableSubmission(status: string, externalSubmissionId: string | null, resultJson: Prisma.JsonValue | null) {
    const result = this.toRecord(resultJson);
    return Boolean(externalSubmissionId) && ['pending', 'judging'].includes(status) && result.mode === 'direct';
  }

  private codeAnswerJson(
    dto: SubmitHydroCodeDto,
    binding: HydroProblemBinding,
    submissionId: string,
    submitResult: HydroSubmitResult,
  ): Prisma.InputJsonObject {
    return {
      text: dto.code,
      language: dto.language,
      code: dto.code,
      hydro: {
        submissionId,
        externalSubmissionId: submitResult.externalSubmissionId ?? null,
        externalProblemId: binding.externalProblemId,
        problemUrl: submitResult.problemUrl,
        mode: submitResult.mode,
      },
    } as Prisma.InputJsonObject;
  }

  private async recalculateAttempt(tx: Prisma.TransactionClient, attemptId: string) {
    const attempt = await tx.examAttempt.findUnique({
      where: { id: attemptId },
      select: { status: true, submittedAt: true },
    });
    const answers = await tx.answerRecord.findMany({ where: { attemptId } });
    let objectiveScore = 0;
    let subjectiveScore = 0;
    let judgeScore = 0;
    let hasManual = false;
    let hasJudge = false;

    for (const answer of answers) {
      const score = Number(answer.score);
      if (answer.status === AnswerRecordStatus.JUDGE_PENDING || answer.status === AnswerRecordStatus.JUDGE_DONE) {
        judgeScore += score;
        hasJudge ||= answer.status === AnswerRecordStatus.JUDGE_PENDING;
      } else if (answer.status === AnswerRecordStatus.MANUAL_NEEDED || answer.status === AnswerRecordStatus.MANUAL_GRADED) {
        subjectiveScore += score;
        hasManual ||= answer.status === AnswerRecordStatus.MANUAL_NEEDED;
      } else {
        objectiveScore += score;
      }
    }

    await tx.examAttempt.update({
      where: { id: attemptId },
      data: {
        objectiveScore,
        subjectiveScore,
        judgeScore,
        totalScore: objectiveScore + subjectiveScore + judgeScore,
        status:
          attempt?.status === AttemptStatus.IN_PROGRESS && !attempt.submittedAt
            ? AttemptStatus.IN_PROGRESS
            : hasManual || hasJudge
              ? AttemptStatus.GRADING
              : AttemptStatus.GRADED,
      },
    });
  }

  private formatProblemRef(ref: {
    judgeProvider: string;
    externalProblemId: string;
    externalProblemUrl: string | null;
    languageConfigJson: Prisma.JsonValue | null;
    timeLimit: number | null;
    memoryLimit: number | null;
    judgeConfigJson: Prisma.JsonValue | null;
  }): HydroProblemBinding {
    const languageConfig = this.toRecord(ref.languageConfigJson);
    const judgeConfig = this.toRecord(ref.judgeConfigJson);
    return {
      judgeProvider: ref.judgeProvider,
      externalProblemId: ref.externalProblemId,
      externalProblemUrl: ref.externalProblemUrl || this.normalizeProblemUrl(ref.externalProblemId),
      platformBaseUrl: String(judgeConfig.platformBaseUrl ?? this.baseUrlFromProblemUrl(ref.externalProblemUrl)).trim(),
      domainId: String(judgeConfig.domainId ?? this.domainIdFromProblemUrl(ref.externalProblemUrl) ?? 'system').trim(),
      domainName: String(judgeConfig.domainName ?? judgeConfig.domainId ?? this.domainIdFromProblemUrl(ref.externalProblemUrl) ?? 'system').trim(),
      accountId: judgeConfig.accountId ? String(judgeConfig.accountId) : null,
      accountLabel: judgeConfig.accountLabel ? String(judgeConfig.accountLabel) : null,
      languages: Array.isArray(languageConfig.languages) ? languageConfig.languages.map(String) : [],
      timeLimit: ref.timeLimit,
      memoryLimit: ref.memoryLimit,
      judgeConfig: ref.judgeConfigJson,
    };
  }

  private formatHydroAccount(account: {
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
      platformName: account.platformName || this.platformName(account.platformCode),
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

  private accountLabel(account: Pick<HydroAccount, 'loginUsername' | 'hydroUsername' | 'platformBaseUrl'>) {
    return `${account.loginUsername || account.hydroUsername}@${this.shortHost(account.platformBaseUrl)}`;
  }

  private normalizeProblemUrl(problemId: string, explicitUrl?: string, baseUrl = this.hydroBaseUrl(), domainId?: string) {
    if (explicitUrl?.trim()) return explicitUrl.trim();
    const normalizedBaseUrl = this.normalizePlatformBaseUrl(baseUrl);
    const normalizedDomain = String(domainId || '').trim();
    const domainPrefix = normalizedDomain && normalizedDomain !== 'system' ? `/d/${encodeURIComponent(normalizedDomain)}` : '';
    return `${normalizedBaseUrl}${domainPrefix}/p/${encodeURIComponent(problemId)}`;
  }

  private submitPageUrlFromProblemUrl(problemUrl?: string | null) {
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

  private domainIdFromProblemUrl(problemUrl?: string | null) {
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

  private extractHydroRecordIdFromLocation(location: string) {
    const match = String(location || '').match(/\/record\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }

  private extractDlValue(html: string, label: string) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.extractByRegex(html, new RegExp(`<dt>\\s*${escaped}\\s*<\\/dt>\\s*<dd>([\\s\\S]*?)<\\/dd>`, 'i'));
  }

  private shortHost(value?: string | null) {
    try {
      return new URL(this.normalizePlatformBaseUrl(value)).host;
    } catch {
      return String(value || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }
  }

  private hydroBaseUrl() {
    const raw = process.env.HYDRO_BASE_URL || 'http://moran007.top';
    return raw.replace(/\/+$/, '');
  }

  private normalizeJudgeStatus(status: string) {
    const value = status.trim().toLowerCase().replace(/\s+/g, '_');
    const accepted = new Set(['accepted', 'accept', 'ac', 'ok', 'success', 'passed']);
    if (accepted.has(value)) return 'accepted';
    if (['pending', 'queued', 'waiting', 'wait', 'waiting_judge'].includes(value) || /等待|排队/.test(status)) return 'pending';
    if (['judging', 'running', 'compiling', 'fetched'].includes(value) || /评测|运行|编译/.test(status)) return 'judging';
    if (['compile_error', 'ce', 'compile_error_'].includes(value) || /编译错误/i.test(status)) return 'compile_error';
    if (['wrong_answer', 'wa'].includes(value) || /答案错误|wrong answer/i.test(status)) return 'wrong_answer';
    if (['runtime_error', 're'].includes(value) || /运行错误|runtime/i.test(status)) return 'runtime_error';
    if (['time_limit_exceeded', 'time_limit_exceed', 'tle'].includes(value) || /时间超限|time limit/i.test(status)) return 'time_limit_exceeded';
    if (['memory_limit_exceeded', 'memory_limit_exceed', 'mle'].includes(value) || /内存超限|memory limit/i.test(status)) return 'memory_limit_exceeded';
    if (['system_error', 'se', 'failed', 'error', 'unknown'].includes(value) || /系统错误|system/i.test(status)) return 'system_error';
    return value || 'unknown';
  }

  private attemptDeadline(attempt: { startedAt: Date; exam: { durationMinutes: number; endTime: Date } }) {
    const durationDeadline = new Date(attempt.startedAt.getTime() + attempt.exam.durationMinutes * 60 * 1000);
    return durationDeadline < attempt.exam.endTime ? durationDeadline : attempt.exam.endTime;
  }

  private normalizeAnswerStatus(status: string) {
    const value = status.replace(/-/g, '_').toLowerCase();
    if (value === 'pending') return AnswerRecordStatus.JUDGE_PENDING;
    if (value === 'done' || value === 'judged') return AnswerRecordStatus.JUDGE_DONE;
    if (value === 'all') return undefined;
    const enumKey = value.toUpperCase() as keyof typeof AnswerRecordStatus;
    const result = AnswerRecordStatus[enumKey];
    if (!result) throw new BadRequestException('Hydro 汇总状态不合法');
    return result;
  }

  private findSnapshotQuestion(paperSnapshot: PaperSnapshot, questionId: string) {
    return paperSnapshot.sections.flatMap((section) => section.questions).find((item) => item.questionId === questionId);
  }

  private async latestSubmissionMap(keys: Array<{ attemptId: string; questionId: string }>) {
    if (!keys.length) {
      return new Map<string, Prisma.JudgeSubmissionGetPayload<Record<string, never>>>();
    }
    const attemptIds = [...new Set(keys.map((item) => item.attemptId))];
    const questionIds = [...new Set(keys.map((item) => item.questionId))];
    const wanted = new Set(keys.map((item) => `${item.attemptId}:${item.questionId}`));
    const submissions = await this.prisma.judgeSubmission.findMany({
      where: { attemptId: { in: attemptIds }, questionId: { in: questionIds } },
      orderBy: { submittedAt: 'desc' },
    });
    const map = new Map<string, (typeof submissions)[number]>();
    for (const submission of submissions) {
      const key = `${submission.attemptId}:${submission.questionId}`;
      if (wanted.has(key) && !map.has(key)) {
        map.set(key, submission);
      }
    }
    return map;
  }

  private async loadUserMap(userIds: string[]) {
    if (!userIds.length) return new Map<string, { id: string; username: string; realName: string | null; userType: UserType }>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, username: true, realName: true, userType: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

  private parseJsonEnv(value?: string) {
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

  private parseJsonSafely(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  private toPositiveNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
  }

  private extractByRegex(value: string, regex: RegExp) {
    const match = value.match(regex);
    return match?.[1] ? this.decodeHtml(this.stripTags(match[1])).trim() : '';
  }

  private extractTagText(html: string, tag: string) {
    return this.extractByRegex(html, new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  }

  private extractMetaContent(html: string, property: string) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = html.match(
      new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    );
    return match?.[1] ? this.decodeHtml(match[1]) : '';
  }

  private attributeValue(attrs: string, name: string) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(attrs || '').match(new RegExp(`${escaped}=["']([^"']*)["']`, 'i'));
    return match?.[1] ? this.decodeHtml(match[1]).trim() : '';
  }

  private absoluteHydroUrl(value: unknown, baseUrl = this.hydroBaseUrl()) {
    const url = String(value ?? '').trim();
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('//')) return `http:${url}`;
    const normalizedBaseUrl = this.normalizePlatformBaseUrl(baseUrl);
    if (url.startsWith('/')) return `${normalizedBaseUrl}${url}`;
    return `${normalizedBaseUrl}/${url.replace(/^\/+/, '')}`;
  }

  private stripTags(value: string) {
    return String(value || '').replace(/<[^>]*>/g, '');
  }

  private decodeHtml(value: string) {
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

  private applyTemplate(template: string, data: Record<string, string>) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = data[key] ?? '';
      return key === 'code' || key === 'baseUrl' ? value : encodeURIComponent(value);
    });
  }

  private extractExternalSubmissionId(payload: unknown): string | null {
    const record = this.toRecord(payload);
    const candidates = [
      record.submissionId,
      record.sid,
      record.rid,
      record.id,
      this.toRecord(record.data).submissionId,
      this.toRecord(record.data).sid,
      this.toRecord(record.data).rid,
      this.toRecord(record.data).id,
    ];
    const value = candidates.find((item) => item !== undefined && item !== null && String(item).trim());
    return value === undefined ? null : String(value);
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private average(values: number[]) {
    return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : 0;
  }

  private ensureStudent(user: RequestUser) {
    if (user.userType !== 'STUDENT') {
      throw new ForbiddenException('仅学生账号可以访问学生端 Hydro 接口');
    }
  }

  private canManageAllExternalAccounts(user: RequestUser) {
    return user.userType === UserType.SUPER_ADMIN;
  }

  private canManageOwnExternalAccounts(user: RequestUser) {
    const ownAccountTypes: UserType[] = [
      UserType.SUPER_ADMIN,
      UserType.ADMIN,
      UserType.TEACHER,
      UserType.ASSISTANT,
      UserType.STUDENT,
    ];
    return ownAccountTypes.includes(user.userType as UserType);
  }

  private assertCanManageOwnExternalAccounts(user: RequestUser) {
    if (!this.canManageOwnExternalAccounts(user)) {
      throw new ForbiddenException('只能添加和维护自己的外部账号');
    }
  }

  private assertCanManageExternalAccount(user: RequestUser, ownerId: string) {
    if (this.canManageAllExternalAccounts(user)) return;
    if (this.canManageOwnExternalAccounts(user) && ownerId === user.id) return;
    throw new ForbiddenException('外部账号只能由超级管理员管理，或由本人添加和维护');
  }

  private isPrivilegedUser(user: RequestUser) {
    return ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'ASSISTANT'].includes(user.userType);
  }
}
