import { ExportStatus } from '@prisma/client';
import { CreateExportDto } from './dto/create-export.dto';
import { ExportsContext } from './exports.context';
import {
  defaultExportFormat,
  deleteExportFile,
  formatTask,
  futureDate,
  publishExportFile,
  userFromExportPayload,
} from './export-access.operations';
import { toRecord } from './export-format.operations';
import { renderExportFile } from './export-renderer.registry';
import type { ExportJobLease, ExportJobQueue } from './export-job-queue.interface';

export async function processTask(
  ctx: ExportsContext,
  queue: ExportJobQueue,
  lease: ExportJobLease,
) {
  const task = await ctx.prisma.exportTask.findFirst({
    where: {
      id: lease.taskId,
      status: ExportStatus.PROCESSING,
      leaseOwner: lease.owner,
    },
  });
  if (!task) return null;

  const payload = toRecord(ctx, task.paramsJson);
  const dto = payload as unknown as CreateExportDto;
  const format = defaultExportFormat(ctx, dto);
  const user = userFromExportPayload(ctx, payload, task.createdBy ?? '');

  try {
    const stagedFileUrl = await renderExportFile(ctx, task.id, dto, format, user);
    const fileUrl = await publishExportFile(ctx, stagedFileUrl);
    const updated = await ctx.prisma.exportTask.updateMany({
      where: {
        id: task.id,
        status: ExportStatus.PROCESSING,
        leaseOwner: lease.owner,
      },
      data: {
        status: ExportStatus.SUCCESS,
        progress: 100,
        fileUrl,
        finishedAt: new Date(),
        expiresAt: futureDate(ctx, ctx.exportExpireDays),
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    });
    if (updated.count !== 1) {
      await deleteExportFile(ctx, fileUrl);
      return null;
    }
    ctx.metrics.recordExportQueue('success');
    await ctx.audit.log({
      userId: user.id,
      action: 'export:complete',
      module: 'export',
      targetType: 'export_task',
      targetId: task.id,
      afterData: { type: dto.type, format, fileUrl },
    });
    const completed = await ctx.prisma.exportTask.findUnique({ where: { id: task.id } });
    return completed ? formatTask(ctx, completed) : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出失败';
    const nextRetry = task.retryCount + 1;
    const retryable = nextRetry <= task.maxRetries;
    const updated = await ctx.prisma.exportTask.updateMany({
      where: {
        id: task.id,
        status: ExportStatus.PROCESSING,
        leaseOwner: lease.owner,
      },
      data: {
        status: retryable ? ExportStatus.PENDING : ExportStatus.FAILED,
        progress: retryable ? 0 : 100,
        retryCount: nextRetry,
        errorMessage: retryable ? `${message}；准备第 ${nextRetry} 次重试` : message,
        finishedAt: retryable ? null : new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    });
    if (retryable && updated.count === 1) {
      ctx.metrics.recordExportQueue('retry');
      const retryTimer = setTimeout(() => queue.enqueue(task.id), Math.min(1000 * nextRetry, 5000));
      retryTimer.unref?.();
    }
    if (!retryable && updated.count === 1) ctx.metrics.recordExportQueue('failed');
    return null;
  }
}
