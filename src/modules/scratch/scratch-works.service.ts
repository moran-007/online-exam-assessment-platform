import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  FileAsset,
  ScratchJudgeMode,
  ScratchJudgeRunStatus,
  ScratchWorkStatus,
  ScratchWorkVersionSource,
  UserType,
} from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateScratchWorkDto,
  ReviewScratchWorkDto,
  SaveScratchWorkVersionDto,
  SubmitScratchWorkDto,
} from './dto/scratch.dto';
import { ScratchAccessService } from './scratch-access.service';
import { ScratchAssetsService, ScratchUploadFile } from './scratch-assets.service';

@Injectable()
export class ScratchWorksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ScratchAccessService,
    private readonly assets: ScratchAssetsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(assignmentId: string, dto: CreateScratchWorkDto, actor: RequestUser) {
    this.assertStudent(actor);
    const { assignment, learnerId } = await this.access.assignment(assignmentId, actor, actor.id);
    this.assertOpen(assignment.dueAt);
    const existing = await this.prisma.scratchWork.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: learnerId! } },
    });
    if (existing) return this.detail(existing.id, actor);
    const work = await this.prisma.$transaction(async (tx) => {
      const created = await tx.scratchWork.create({
        data: {
          assignmentId,
          studentId: learnerId!,
          title: dto.title?.trim() || assignment.title,
          currentVersion: 1,
        },
      });
      await tx.scratchWorkVersion.create({
        data: {
          workId: created.id,
          version: 1,
          source: ScratchWorkVersionSource.TEMPLATE_COPY,
          projectAssetId: assignment.template.projectAssetId,
          thumbnailAssetId: assignment.template.thumbnailAssetId,
          note: '从课堂模板创建',
          createdBy: actor.id,
        },
      });
      return created;
    });
    await this.log(actor, 'create', work.id, { assignmentId, version: 1 });
    return this.detail(work.id, actor);
  }

  async saveVersion(
    workId: string,
    dto: SaveScratchWorkVersionDto,
    project: ScratchUploadFile,
    thumbnail: ScratchUploadFile | undefined,
    actor: RequestUser,
  ) {
    this.assertStudent(actor);
    const scoped = await this.access.work(workId, actor);
    if (scoped.work.studentId !== actor.id) throw new ForbiddenException('只能保存本人 Scratch 作品');
    this.assertOpen(scoped.work.assignment.dueAt);
    const storedProject = await this.assets.storeProject(project, actor.id, `works/${workId}`);
    let storedThumbnail: FileAsset | null = null;
    try {
      storedThumbnail = await this.assets.storeThumbnail(thumbnail, actor.id, `work-thumbnails/${workId}`);
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.scratchWork.findUniqueOrThrow({ where: { id: workId } });
        const latest = current.currentVersion
          ? await tx.scratchWorkVersion.findUnique({ where: { workId_version: { workId, version: current.currentVersion } } })
          : null;
        const nextVersion = current.currentVersion + 1;
        await tx.scratchWorkVersion.create({
          data: {
            workId,
            version: nextVersion,
            source: ScratchWorkVersionSource.STUDENT_SAVE,
            projectAssetId: storedProject.asset.id,
            thumbnailAssetId: storedThumbnail?.id ?? latest?.thumbnailAssetId,
            note: this.clean(dto.note),
            createdBy: actor.id,
          },
        });
        const updated = await tx.scratchWork.updateMany({
          where: { id: workId, currentVersion: current.currentVersion },
          data: {
            currentVersion: nextVersion,
            status: ScratchWorkStatus.DRAFT,
            submittedAt: null,
            reviewedAt: null,
          },
        });
        if (updated.count !== 1) throw new ConflictException('作品已产生新版本，请刷新后重试');
      });
      await this.log(actor, 'save-version', workId, { projectSha256: storedProject.asset.sha256 });
      return this.detail(workId, actor);
    } catch (error) {
      await this.assets.discard([storedProject.asset, storedThumbnail]);
      throw error;
    }
  }

  async submit(workId: string, dto: SubmitScratchWorkDto, actor: RequestUser) {
    this.assertStudent(actor);
    const scoped = await this.access.work(workId, actor);
    if (scoped.work.studentId !== actor.id) throw new ForbiddenException('只能提交本人 Scratch 作品');
    this.assertOpen(scoped.work.assignment.dueAt);
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.scratchWork.findUniqueOrThrow({
        where: { id: workId },
        include: { assignment: true },
      });
      if (current.currentVersion < 1) throw new ConflictException('作品还没有可提交版本');
      const latest = await tx.scratchWorkVersion.findUniqueOrThrow({
        where: { workId_version: { workId, version: current.currentVersion } },
      });
      const nextVersion = current.currentVersion + 1;
      const submissionVersion = await tx.scratchWorkVersion.create({
        data: {
          workId,
          version: nextVersion,
          source: ScratchWorkVersionSource.SUBMISSION,
          projectAssetId: latest.projectAssetId,
          thumbnailAssetId: latest.thumbnailAssetId,
          note: this.clean(dto.submitNote),
          createdBy: actor.id,
        },
      });
      const updated = await tx.scratchWork.updateMany({
        where: { id: workId, currentVersion: current.currentVersion },
        data: {
          currentVersion: nextVersion,
          status: ScratchWorkStatus.SUBMITTED,
          submitNote: this.clean(dto.submitNote),
          submittedAt: new Date(),
          reviewedAt: null,
        },
      });
      if (updated.count !== 1) throw new ConflictException('作品已产生新版本，请刷新后重试');
      const runStatus = this.initialRunStatus(current.assignment.judgeMode);
      const run = runStatus ? await tx.scratchJudgeRun.create({
        data: {
          workId,
          workVersionId: submissionVersion.id,
          assignmentId: current.assignmentId,
          idempotencyKey: `scratch-submit:${workId}:v${nextVersion}`,
          status: runStatus,
          nextAttemptAt: runStatus === ScratchJudgeRunStatus.PENDING ? new Date() : null,
          message: runStatus === ScratchJudgeRunStatus.AWAITING_REVIEW ? '等待教师人工批阅' : null,
        },
      }) : null;
      return { version: submissionVersion.version, runId: run?.id ?? null };
    });
    await this.log(actor, 'submit', workId, result);
    return this.detail(workId, actor);
  }

  async review(workId: string, dto: ReviewScratchWorkDto, actor: RequestUser) {
    const { work } = await this.access.work(workId, actor);
    if (work.status !== ScratchWorkStatus.SUBMITTED && work.status !== ScratchWorkStatus.REVIEWED) {
      throw new ConflictException('作品尚未提交，不能批阅');
    }
    if (dto.score === undefined && !this.clean(dto.comment) && !dto.rubric) {
      throw new ConflictException('评分、点评或量表至少填写一项');
    }
    if (dto.score !== undefined && dto.score > Number(work.assignment.maxScore)) {
      throw new ConflictException(`评分不能超过任务满分 ${Number(work.assignment.maxScore)}`);
    }
    const latest = await this.prisma.scratchWorkVersion.findUniqueOrThrow({
      where: { workId_version: { workId, version: work.currentVersion } },
    });
    const review = await this.prisma.$transaction(async (tx) => {
      const created = await tx.scratchReview.create({
        data: {
          workId,
          workVersionId: latest.id,
          reviewerId: actor.id,
          score: dto.score,
          comment: this.clean(dto.comment),
          rubricJson: dto.rubric as Prisma.InputJsonValue | undefined,
        },
      });
      await tx.scratchWork.update({
        where: { id: workId },
        data: { status: ScratchWorkStatus.REVIEWED, reviewedAt: created.createdAt },
      });
      await tx.scratchJudgeRun.updateMany({
        where: { workId, workVersionId: latest.id, status: ScratchJudgeRunStatus.AWAITING_REVIEW },
        data: {
          status: ScratchJudgeRunStatus.SUCCEEDED,
          score: dto.score,
          message: '教师人工批阅完成',
          finishedAt: created.createdAt,
        },
      });
      return created;
    });
    await this.notifications.notifyMany({
      userIds: [work.studentId],
      title: 'Scratch 作品已批阅',
      content: `${work.assignment.title} 已收到教师点评`,
      type: 'info',
      bizType: 'scratch-work',
      bizId: workId,
    });
    await this.log(actor, 'review', workId, { reviewId: review.id, score: dto.score });
    return this.detail(workId, actor);
  }

  async detail(workId: string, actor: RequestUser) {
    const scoped = await this.access.work(workId, actor);
    const work = await this.prisma.scratchWork.findUniqueOrThrow({
      where: { id: workId },
      include: {
        student: { select: { id: true, username: true, realName: true } },
        assignment: { include: { session: { include: { classGroup: { select: { id: true, name: true } } } }, template: true } },
        versions: { include: { projectAsset: true, thumbnailAsset: true }, orderBy: { version: 'desc' } },
        reviews: { include: { reviewer: { select: { id: true, username: true, realName: true } } }, orderBy: { createdAt: 'desc' } },
        judgeRuns: { orderBy: { createdAt: 'desc' } },
      },
    });
    return this.view(work, scoped.internal);
  }

  async retryJudge(runId: string, actor: RequestUser) {
    const run = await this.prisma.scratchJudgeRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Scratch 判定任务不存在');
    await this.access.work(run.workId, actor);
    if (run.status !== ScratchJudgeRunStatus.FAILED && run.status !== ScratchJudgeRunStatus.RETRY) {
      throw new ConflictException('当前判定任务不需要重试');
    }
    await this.prisma.scratchJudgeRun.update({
      where: { id: runId },
      data: {
        status: ScratchJudgeRunStatus.PENDING,
        attemptCount: 0,
        nextAttemptAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        message: '已人工安排重试',
      },
    });
    await this.log(actor, 'retry-judge', run.workId, { runId });
    return { id: runId, status: 'pending' };
  }

  private view(work: any, internal: boolean) {
    return {
      id: work.id,
      title: work.title,
      status: work.status.toLowerCase(),
      currentVersion: work.currentVersion,
      submitNote: work.submitNote,
      submittedAt: work.submittedAt,
      reviewedAt: work.reviewedAt,
      student: internal ? work.student : undefined,
      assignment: {
        id: work.assignment.id,
        title: work.assignment.title,
        maxScore: Number(work.assignment.maxScore),
        judgeMode: work.assignment.judgeMode.toLowerCase(),
        dueAt: work.assignment.dueAt,
        session: {
          id: work.assignment.session.id,
          title: work.assignment.session.title,
          classId: work.assignment.session.classGroup.id,
          className: work.assignment.session.classGroup.name,
        },
      },
      versions: work.versions.map((version: any) => ({
        id: version.id,
        version: version.version,
        source: version.source.toLowerCase(),
        note: version.note,
        project: this.file(version.projectAsset),
        thumbnailAvailable: Boolean(version.thumbnailAsset),
        createdAt: version.createdAt,
      })),
      reviews: work.reviews.map((review: any) => ({
        id: review.id,
        workVersionId: review.workVersionId,
        score: review.score === null ? null : Number(review.score),
        comment: review.comment,
        rubric: review.rubricJson,
        reviewer: review.reviewer,
        createdAt: review.createdAt,
      })),
      judgeRuns: work.judgeRuns.map((run: any) => ({
        id: run.id,
        workVersionId: run.workVersionId,
        status: run.status.toLowerCase(),
        attemptCount: run.attemptCount,
        score: run.score === null ? null : Number(run.score),
        passed: run.passed,
        message: run.message,
        externalJobId: internal ? run.externalJobId : undefined,
        requestedAt: run.requestedAt,
        finishedAt: run.finishedAt,
      })),
    };
  }

  private file(asset: any) {
    return { id: asset.id, fileName: asset.fileName, fileSize: asset.fileSize.toString(), sha256: asset.sha256 };
  }

  private initialRunStatus(mode: ScratchJudgeMode) {
    if (mode === ScratchJudgeMode.EXTERNAL) return ScratchJudgeRunStatus.PENDING;
    if (mode === ScratchJudgeMode.MANUAL) return ScratchJudgeRunStatus.AWAITING_REVIEW;
    return null;
  }

  private assertStudent(actor: RequestUser) {
    if (actor.userType !== UserType.STUDENT) throw new ForbiddenException('只有学生本人可以创建、保存或提交 Scratch 作品');
  }

  private assertOpen(dueAt: Date | null) {
    if (dueAt && dueAt.getTime() < Date.now()) throw new ConflictException('Scratch 任务已截止');
  }

  private log(actor: RequestUser, action: string, targetId: string, afterData: any) {
    return this.audit.log({ userId: actor.id, action: `scratch-work:${action}`, module: 'scratch', targetType: 'scratch-work', targetId, afterData });
  }

  private clean(value?: string) {
    return value?.trim() || null;
  }
}
