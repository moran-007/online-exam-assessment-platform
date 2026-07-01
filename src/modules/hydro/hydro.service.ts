import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AnswerRecordStatus,
  AttemptStatus,
  HydroAccount,
  Prisma,
  QuestionStatus,
  QuestionType,
  UserStatus,
  UserType,
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
  SubmitHydroCodeDto,
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

@Injectable()
export class HydroService implements OnModuleInit, OnModuleDestroy {
  private pollTimer?: ReturnType<typeof setInterval>;

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

  platforms() {
    return [
      {
        code: 'hydro',
        name: 'Hydro',
        baseUrl: this.hydroBaseUrl(),
        default: true,
      },
    ];
  }

  async pullProblem(query: PullHydroProblemDto) {
    const source = (query.problemUrl || query.problemId || '').trim();
    if (!source) throw new BadRequestException('请填写 Hydro 题号或题目链接');

    const pullAccount = query.accountId
      ? await this.prisma.hydroAccount.findFirst({ where: { id: query.accountId } })
      : null;
    if (query.accountId && !pullAccount) throw new NotFoundException('录入账号不存在');
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
    const externalProblemUrl = this.normalizeProblemUrl(externalProblemId, fetched.url);
    const rawLanguages = Array.isArray(config.langs) ? config.langs.map(String).filter(Boolean) : [];
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
    const platformBaseUrl = this.baseUrlFromProblemUrl(externalProblemUrl) || baseUrl;
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
        judgeProvider: 'hydro',
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

  async accounts(query: QueryHydroSummaryDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.HydroAccountWhereInput = {
      studentId: query.studentId,
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
    const accounts = await this.prisma.hydroAccount.findMany({
      where: { studentId: user.id },
      orderBy: { updatedAt: 'desc' },
    });
    return accounts.map((item) => this.formatHydroAccount(item));
  }

  async myAccount(user: RequestUser) {
    const account = await this.prisma.hydroAccount.findFirst({
      where: { studentId: user.id, platformCode: 'hydro' },
      orderBy: { updatedAt: 'desc' },
    });
    return account ? this.formatHydroAccount(account) : null;
  }

  async bindMyAccount(dto: BindHydroAccountDto, user: RequestUser) {
    return this.bindAccount({ ...dto, studentId: user.id }, user);
  }

  async bindAccount(dto: BindHydroAccountDto, user: RequestUser) {
    const studentId = dto.studentId;
    if (!studentId) throw new BadRequestException('缺少用户 ID');
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
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!targetUser) throw new NotFoundException('用户不存在或不可用');

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
    const account = await this.prisma.hydroAccount.findFirst({ where: { id: accountId, studentId: user.id } });
    if (!account) throw new NotFoundException('外部账号不存在');
    return this.testHydroAccountLogin(account);
  }

  async testAccount(accountId: string) {
    const account = await this.prisma.hydroAccount.findFirst({ where: { id: accountId } });
    if (!account) throw new NotFoundException('外部账号不存在');
    return this.testHydroAccountLogin(account);
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
    const hydroAccount = await this.findAccountForBinding(user.id, binding);
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
    this.ensureStudent(user);
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, deletedAt: null, status: QuestionStatus.PUBLISHED, type: QuestionType.PROGRAMMING },
      include: { programmingRef: true },
    });
    if (!question) throw new NotFoundException('编程题不存在或未发布');
    if (!question.programmingRef) throw new BadRequestException('该编程题尚未绑定 Hydro 题目');

    const binding = this.formatProblemRef(question.programmingRef);
    const language = this.normalizeHydroLanguage(dto.language, binding.languages);
    const hydroAccount = await this.findAccountForBinding(user.id, binding);
    if (!hydroAccount) {
      throw new BadRequestException('请先在个人信息中绑定当前 Hydro 站点账号，再提交编程题代码');
    }
    if (!hydroAccount.loginUsername || !hydroAccount.loginPassword) {
      throw new BadRequestException('当前 Hydro 账号缺少登录账号或密码，请先补全后再提交');
    }

    const submitResult = await this.submitToHydro(binding, { ...dto, language }, hydroAccount);
    return {
      questionId,
      questionTitle: question.title,
      externalSubmissionId: submitResult.externalSubmissionId,
      status: submitResult.status || 'pending',
      mode: submitResult.mode,
      problemUrl: submitResult.problemUrl,
      recordUrl: submitResult.recordUrl,
      score: submitResult.score ?? null,
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
          isCorrect: accepted || (maxScore > 0 && score >= maxScore),
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
          isCorrect: accepted || (maxScore > 0 && score >= maxScore),
          status: AnswerRecordStatus.JUDGE_DONE,
          autoResultJson,
          gradedAt: judgedAt,
        },
      });

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
              headers: { 'User-Agent': 'OnlineExamHydroPull/1.0' },
              signal: controller.signal,
            });
        const html = await response.text();
        if (!response.ok) {
          lastError = `${response.status} ${html.slice(0, 120)}`;
          continue;
        }
        return { url: response.url || candidate, html };
      } catch (error) {
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
    const available = rawLanguages.map((item) => item.trim()).filter(Boolean);
    if (!available.length) return this.defaultHydroLanguages();
    const preferred = ['cc.cc17o2', 'cc.cc17', 'py.py3', 'java', 'c', 'cc.cc14', 'cc.cc11', 'pas'];
    const picked = preferred.filter((item) => available.includes(item));
    return picked.length ? picked : available.slice(0, 8);
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

  private async findAccountForBinding(userId: string, binding: HydroProblemBinding) {
    const platformCode = this.normalizePlatformCode(binding.judgeProvider);
    const judgeConfig = this.toRecord(binding.judgeConfig);
    const platformBaseUrl = this.normalizePlatformBaseUrl(
      binding.platformBaseUrl || String(judgeConfig.platformBaseUrl ?? '') || this.baseUrlFromProblemUrl(binding.externalProblemUrl),
    );
    return this.prisma.hydroAccount.findFirst({
      where: {
        studentId: userId,
        platformCode,
        platformBaseUrl,
        bindStatus: 'bound',
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private normalizePlatformCode(value?: string) {
    return String(value || 'hydro').trim().toLowerCase() || 'hydro';
  }

  private normalizePlatformBaseUrl(value?: string | null) {
    const raw = String(value || this.hydroBaseUrl()).trim() || this.hydroBaseUrl();
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return withScheme.replace(/\/+$/, '');
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

  private async testHydroAccountLogin(account: HydroAccount) {
    if (account.platformCode !== 'hydro') {
      throw new BadRequestException('当前只支持 Hydro 平台登录检测');
    }
    if (!account.loginUsername || !account.loginPassword) {
      throw new BadRequestException('外部账号缺少登录账号或密码');
    }

    let status = 'failed';
    let message = 'Hydro 登录失败';
    try {
      await this.createHydroSession(account);
      status = 'success';
      message = 'Hydro 登录检测通过';
    } catch (error) {
      message = error instanceof Error ? error.message : message;
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
    const judgeConfig = this.toRecord(binding.judgeConfig);
    const baseUrl = this.normalizePlatformBaseUrl(
      binding.platformBaseUrl ||
        String(judgeConfig.platformBaseUrl ?? '') ||
        account.platformBaseUrl ||
        this.baseUrlFromProblemUrl(binding.externalProblemUrl),
    );
    const problemUrl = binding.externalProblemUrl || this.normalizeProblemUrl(binding.externalProblemId, undefined, baseUrl);
    const session = await this.createHydroSession(account, baseUrl);
    const submitUrl =
      String(judgeConfig.submitPageUrl ?? '').trim() ||
      this.submitPageUrlFromProblemUrl(problemUrl) ||
      `${baseUrl}/p/${encodeURIComponent(binding.externalProblemId)}/submit`;

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
    const externalSubmissionId = this.extractHydroRecordIdFromLocation(location);
    if (!externalSubmissionId) {
      const message = this.decodeHtml(this.stripTags(text)).replace(/\s+/g, ' ').slice(0, 240);
      throw new BadRequestException(`Hydro 提交失败：${response.status} ${message || '未返回评测记录'}`);
    }

    const recordUrl = this.absoluteHydroUrl(location, baseUrl);
    let record = await this.fetchHydroRecordResult(session, externalSubmissionId, recordUrl).catch((error) => {
      const message = error instanceof Error ? error.message : 'Hydro 结果读取失败';
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
      record = await this.fetchHydroRecordResult(session, externalSubmissionId, recordUrl).catch(() => record);
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
      const response = await fetch(this.absoluteHydroUrl(url, baseUrl), {
        ...init,
        headers,
      });
      collectCookies(response);
      return response;
    };

    const loginUrl = `${baseUrl}/login`;
    await sessionFetch(loginUrl, { redirect: 'manual' });
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
    const redirectedAway = response.status >= 300 && response.status < 400 && !/\/login\b/i.test(location);
    const hasSession = cookies.has('sid') || cookies.has('sid.sig');
    const bodyLooksLoggedIn = /退出|注销|logout/i.test(text) && !/密码错误|登录失败|LoginError|password/i.test(text);
    if (!((redirectedAway && hasSession) || bodyLooksLoggedIn)) {
      const message =
        this.decodeHtml(this.stripTags(text)).replace(/\s+/g, ' ').slice(0, 180) ||
        `Hydro 登录失败：${response.status}`;
      throw new BadRequestException(message);
    }

    await this.prisma.hydroAccount.updateMany({
      where: { id: account.id },
      data: {
        lastLoginStatus: 'success',
        lastLoginMessage: 'Hydro 登录检测通过',
        lastLoginAt: new Date(),
      },
    });

    return { baseUrl, cookieHeader, fetch: sessionFetch };
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
    const raw = process.env.HYDRO_BASE_URL || 'https://oj.example.com';
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

  private isPrivilegedUser(user: RequestUser) {
    return ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'ASSISTANT'].includes(user.userType);
  }
}
