import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, ScratchJudgeRunStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ScratchCallbackStatus, ScratchJudgeCallbackDto } from './dto/scratch.dto';
import { ScratchRuntimeAdapter, ScratchRuntimeResult } from './scratch-runtime.adapter';

@Injectable()
export class ScratchJudgeService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly workerId = `scratch-${process.pid}-${randomUUID()}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: ScratchRuntimeAdapter,
  ) {}

  onModuleInit() {
    const interval = Math.max(1_000, this.runtime.pollIntervalMs());
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async callback(
    runId: string,
    dto: ScratchJudgeCallbackDto,
    rawBody: Buffer,
    signature: string | undefined,
  ) {
    if (!this.runtime.verifyCallback(rawBody, signature)) throw new ForbiddenException('Scratch 回调签名无效');
    const hash = createHash('sha256').update(rawBody).digest('hex');
    const existing = await this.prisma.scratchJudgeCallback.findUnique({ where: { callbackId: dto.callbackId } });
    if (existing) {
      if (existing.runId !== runId || existing.payloadHash !== hash) throw new ConflictException('Scratch 回调编号已被不同内容使用');
      const run = await this.prisma.scratchJudgeRun.findUniqueOrThrow({ where: { id: runId } });
      return { idempotent: true, run: this.view(run) };
    }
    const run = await this.prisma.scratchJudgeRun.findUnique({
      where: { id: runId },
      include: { assignment: true },
    });
    if (!run) throw new NotFoundException('Scratch 判定任务不存在');
    if (dto.externalJobId && run.externalJobId && dto.externalJobId !== run.externalJobId) {
      throw new ConflictException('外部任务编号与主平台记录不一致');
    }
    if (dto.score !== undefined && dto.score > Number(run.assignment.maxScore)) {
      throw new ConflictException('外部判定分数超过任务满分');
    }
    if (
      run.status === ScratchJudgeRunStatus.SUCCEEDED ||
      run.status === ScratchJudgeRunStatus.FAILED ||
      run.status === ScratchJudgeRunStatus.CANCELLED
    ) {
      throw new ConflictException('Scratch 判定任务已结束');
    }
    const status = dto.status === ScratchCallbackStatus.SUCCEEDED
      ? ScratchJudgeRunStatus.SUCCEEDED
      : ScratchJudgeRunStatus.FAILED;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.scratchJudgeCallback.create({
        data: {
          runId,
          callbackId: dto.callbackId,
          payloadHash: hash,
          payloadJson: dto as unknown as Prisma.InputJsonValue,
        },
      });
      return tx.scratchJudgeRun.update({
        where: { id: runId },
        data: {
          status,
          externalJobId: dto.externalJobId ?? run.externalJobId,
          externalResultJson: dto.result as Prisma.InputJsonValue | undefined,
          score: dto.score,
          passed: dto.passed,
          message: dto.message?.trim() || (status === ScratchJudgeRunStatus.SUCCEEDED ? '外部判定完成' : '外部判定失败'),
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
        },
      });
    });
    return { idempotent: false, run: this.view(updated) };
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.recoverTimedOut();
      const run = await this.claim();
      if (run) await this.dispatch(run.id);
    } finally {
      this.running = false;
    }
  }

  private async claim() {
    const now = new Date();
    const candidate = await this.prisma.scratchJudgeRun.findFirst({
      where: {
        status: { in: [ScratchJudgeRunStatus.PENDING, ScratchJudgeRunStatus.RETRY] },
        attemptCount: { lt: this.prisma.scratchJudgeRun.fields.maxAttempts },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { requestedAt: 'asc' }],
    });
    if (!candidate || candidate.attemptCount >= candidate.maxAttempts) return null;
    const claimed = await this.prisma.scratchJudgeRun.updateMany({
      where: {
        id: candidate.id,
        status: { in: [ScratchJudgeRunStatus.PENDING, ScratchJudgeRunStatus.RETRY] },
        attemptCount: candidate.attemptCount,
      },
      data: {
        status: ScratchJudgeRunStatus.PROCESSING,
        attemptCount: { increment: 1 },
        startedAt: new Date(),
        leaseOwner: this.workerId,
        leaseExpiresAt: new Date(Date.now() + 30_000),
      },
    });
    return claimed.count === 1 ? candidate : null;
  }

  private async dispatch(runId: string) {
    const run = await this.prisma.scratchJudgeRun.findUniqueOrThrow({
      where: { id: runId },
      include: {
        work: true,
        workVersion: { include: { projectAsset: true } },
        assignment: { include: { template: true } },
      },
    });
    try {
      const result = await this.runtime.submit({
        runId: run.id,
        idempotencyKey: run.idempotencyKey,
        workId: run.workId,
        version: run.workVersion.version,
        project: {
          objectKey: run.workVersion.projectAsset.objectKey,
          fileName: run.workVersion.projectAsset.fileName,
          mimeType: run.workVersion.projectAsset.mimeType,
          fileSize: run.workVersion.projectAsset.fileSize,
        },
        assignment: run.assignment,
      });
      await this.saveDispatchResult(run.id, result);
    } catch (error) {
      const current = await this.prisma.scratchJudgeRun.findUniqueOrThrow({ where: { id: run.id } });
      const retry = current.attemptCount < current.maxAttempts;
      const delay = 10_000 * 3 ** Math.max(0, current.attemptCount - 1);
      await this.prisma.scratchJudgeRun.update({
        where: { id: run.id },
        data: {
          status: retry ? ScratchJudgeRunStatus.RETRY : ScratchJudgeRunStatus.FAILED,
          nextAttemptAt: retry ? new Date(Date.now() + delay) : null,
          message: this.message(error),
          finishedAt: retry ? null : new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    }
  }

  private saveDispatchResult(runId: string, result: ScratchRuntimeResult) {
    const final = result.status !== 'processing';
    return this.prisma.scratchJudgeRun.update({
      where: { id: runId },
      data: {
        externalJobId: result.externalJobId,
        status: result.status === 'succeeded'
          ? ScratchJudgeRunStatus.SUCCEEDED
          : result.status === 'failed'
            ? ScratchJudgeRunStatus.FAILED
            : ScratchJudgeRunStatus.PROCESSING,
        externalResultJson: result.result as Prisma.InputJsonValue | undefined,
        score: result.score,
        passed: result.passed,
        message: result.message || (final ? '外部判定完成' : '等待外部运行时回调'),
        finishedAt: final ? new Date() : null,
        leaseOwner: null,
        leaseExpiresAt: final ? null : new Date(Date.now() + this.runtime.callbackTimeoutMs()),
        nextAttemptAt: null,
      },
    });
  }

  private async recoverTimedOut() {
    const items = await this.prisma.scratchJudgeRun.findMany({
      where: { status: ScratchJudgeRunStatus.PROCESSING, leaseExpiresAt: { lt: new Date() } },
      take: 20,
    });
    for (const item of items) {
      const retry = item.attemptCount < item.maxAttempts;
      await this.prisma.scratchJudgeRun.updateMany({
        where: { id: item.id, status: ScratchJudgeRunStatus.PROCESSING, leaseExpiresAt: { lt: new Date() } },
        data: {
          status: retry ? ScratchJudgeRunStatus.RETRY : ScratchJudgeRunStatus.FAILED,
          nextAttemptAt: retry ? new Date() : null,
          message: retry ? '外部运行时回调超时，等待重试' : '外部运行时回调超时，已停止重试',
          finishedAt: retry ? null : new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    }
  }

  private view(run: any) {
    return {
      id: run.id,
      status: run.status.toLowerCase(),
      score: run.score === null ? null : Number(run.score),
      passed: run.passed,
      message: run.message,
      externalJobId: run.externalJobId,
      finishedAt: run.finishedAt,
    };
  }

  private message(error: unknown) {
    const value = error instanceof Error ? error.message : String(error);
    return value.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 4_000);
  }
}
