import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExportStatus, Prisma, UserType } from '@prisma/client';
import { basename } from 'node:path';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { toApiEnum } from '../../common/utils/enum-normalizer';
import { CreateExportDto } from './dto/create-export.dto';
import { QueryExportDto } from './dto/query-export.dto';
import { ExportsContext } from './exports.context';
import {
  assertExportRequestAllowed,
  defaultExportFormat,
  deleteExportFile,
  exportAccessWhere,
  exportMimeType,
  exportObjectKey,
  findAccessibleTask,
  formatTask,
  withPermissionSnapshot,
} from './export-access.operations';
import { normalizeStatus, toRecord } from './export-format.operations';
import type { ExportJobQueue } from './export-job-queue.interface';
export function startExportMaintenance(ctx: ExportsContext) {
    void cleanupExpiredTasks(ctx);
    ctx.cleanupTimer = setInterval(() => {
      void cleanupExpiredTasks(ctx);
    }, 60 * 60 * 1000);
    ctx.cleanupTimer.unref?.();
  }

export async function list(ctx: ExportsContext, query: QueryExportDto, user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.ExportTaskWhereInput = {
      ...exportAccessWhere(ctx, query, user),
      type: query.type,
      status: query.status ? normalizeStatus(ctx, query.status) : undefined,
    };
    const [items, total] = await ctx.prisma.$transaction([
      ctx.prisma.exportTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      ctx.prisma.exportTask.count({ where }),
    ]);

    return {
      items: items.map((item) => formatTask(ctx, item)),
      page,
      pageSize,
      total,
    };
  }

export async function create(ctx: ExportsContext, queue: ExportJobQueue, dto: CreateExportDto, user: RequestUser) {
    assertExportRequestAllowed(ctx, dto, user);
    const format = defaultExportFormat(ctx, dto);
    const payload = withPermissionSnapshot(ctx, { ...dto, format }, user);
    const task = await ctx.prisma.exportTask.create({
      data: {
        type: dto.type,
        paramsJson: payload,
        status: ExportStatus.PENDING,
        progress: 0,
        maxRetries: 2,
        createdBy: user.id,
      },
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'export:queue',
      module: 'export',
      targetType: 'export_task',
      targetId: task.id,
      afterData: { type: dto.type, format },
    });
    queue.enqueue(task.id);
    return formatTask(ctx, task);
  }

export async function createWrongQuestionExport(ctx: ExportsContext, queue: ExportJobQueue, dto: CreateExportDto, user: RequestUser) {
    if (user.userType !== UserType.STUDENT) {
      throw new BadRequestException('只有学生可以导出个人错题本');
    }

    return create(ctx, queue,
      {
        ...dto,
        type: 'wrong_questions',
        format: dto.format ?? 'pdf',
        includeAnswers: dto.includeAnswers ?? true,
        includeAnalysis: dto.includeAnalysis ?? true,
        includeWrongInfo: dto.includeWrongInfo ?? true,
      },
      user,
    );
  }

export async function download(ctx: ExportsContext, id: string, user: RequestUser) {
    const task = await findAccessibleTask(ctx, id, user);
    if (task.status !== ExportStatus.SUCCESS || !task.fileUrl) {
      throw new BadRequestException('导出文件尚未生成');
    }
    const params = toRecord(ctx, task.paramsJson);
    const snapshot = toRecord(ctx, params.permissionSnapshot);
    await ctx.audit.log({
      userId: user.id,
      action: 'export:download',
      module: 'export',
      targetType: 'export_task',
      targetId: task.id,
      afterData: {
        type: task.type,
        fileUrl: task.fileUrl,
        createdBy: task.createdBy,
        downloadedBy: user.id,
        permissionSnapshotUserId: snapshot.userId ?? null,
        permissionSnapshotUserType: snapshot.userType ?? null,
        permissionSnapshotCapturedAt: snapshot.capturedAt ?? null,
      },
    });
    const objectKey = exportObjectKey(ctx, task.fileUrl);
    if (!objectKey) throw new NotFoundException('导出文件地址无效');
    try {
      const stream = await ctx.storage.open(objectKey);
      const fileName = basename(objectKey);
      return { stream, fileName, mimeType: exportMimeType(ctx, fileName) };
    } catch {
      throw new NotFoundException('导出文件不存在或已被清理');
    }
  }

export async function retry(ctx: ExportsContext, queue: ExportJobQueue, id: string, user: RequestUser) {
    const task = await findAccessibleTask(ctx, id, user);
    const retryableStatuses: ExportStatus[] = [ExportStatus.FAILED, ExportStatus.EXPIRED, ExportStatus.CANCELED];
    if (!retryableStatuses.includes(task.status)) {
      throw new BadRequestException('只有失败、过期或已取消任务可以重试');
    }
    const updated = await ctx.prisma.exportTask.update({
      where: { id },
      data: {
        status: ExportStatus.PENDING,
        progress: 0,
        errorMessage: null,
        fileUrl: null,
        finishedAt: null,
        expiresAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    });
    await ctx.audit.log({
      userId: user.id,
      action: 'export:retry',
      module: 'export',
      targetType: 'export_task',
      targetId: id,
      afterData: { type: task.type, retryCount: task.retryCount },
    });
    queue.enqueue(id);
    return formatTask(ctx, updated);
  }

export async function retryMany(ctx: ExportsContext, queue: ExportJobQueue, ids: string[], user: RequestUser) {
    const uniqueIds = [...new Set(ids)];
    const failed: Array<{ id: string; message: string }> = [];
    let successCount = 0;

    for (const id of uniqueIds) {
      try {
        await retry(ctx, queue, id, user);
        successCount += 1;
      } catch (error) {
        failed.push({ id, message: error instanceof Error ? error.message : '重试失败' });
      }
    }

    await ctx.audit.log({
      userId: user.id,
      action: 'export:batch-retry',
      module: 'export',
      targetType: 'export_task',
      targetId: uniqueIds[0],
      afterData: { ids: uniqueIds, successCount, failedCount: failed.length },
    });
    return { successCount, failed };
  }

export async function cancel(ctx: ExportsContext, queue: ExportJobQueue, id: string, user: RequestUser) {
    const task = await findAccessibleTask(ctx, id, user);
    const cancelableStatuses: ExportStatus[] = [ExportStatus.PENDING, ExportStatus.PROCESSING];
    if (!cancelableStatuses.includes(task.status)) {
      throw new BadRequestException('只有等待中或处理中任务可以取消');
    }

    queue.cancel(id);
    const updated = await ctx.prisma.exportTask.update({
      where: { id },
      data: {
        status: ExportStatus.CANCELED,
        progress: 100,
        errorMessage: '用户取消导出',
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    });
    await ctx.audit.log({
      userId: user.id,
      action: 'export:cancel',
      module: 'export',
      targetType: 'export_task',
      targetId: id,
      afterData: { type: task.type, previousStatus: task.status },
    });
    return formatTask(ctx, updated);
  }

export async function cancelMany(ctx: ExportsContext, queue: ExportJobQueue, ids: string[], user: RequestUser) {
    const uniqueIds = [...new Set(ids)];
    const failed: Array<{ id: string; message: string }> = [];
    let successCount = 0;

    for (const id of uniqueIds) {
      try {
        await cancel(ctx, queue, id, user);
        successCount += 1;
      } catch (error) {
        failed.push({ id, message: error instanceof Error ? error.message : '取消失败' });
      }
    }

    await ctx.audit.log({
      userId: user.id,
      action: 'export:batch-cancel',
      module: 'export',
      targetType: 'export_task',
      targetId: uniqueIds[0],
      afterData: { ids: uniqueIds, successCount, failedCount: failed.length },
    });
    return { successCount, failed };
  }

export async function downloadAudits(ctx: ExportsContext, query: QueryExportDto, user: RequestUser) {
    if (!ctx.dataScope.isUnrestricted(user)) {
      throw new ForbiddenException('只有管理员可以查看导出下载审计');
    }
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.AuditLogWhereInput = {
      module: 'export',
      action: 'export:download',
      targetType: 'export_task',
    };
    const [logs, total] = await ctx.prisma.$transaction([
      ctx.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              realName: true,
              userType: true,
            },
          },
        },
      }),
      ctx.prisma.auditLog.count({ where }),
    ]);
    const taskIds = logs.map((log) => log.targetId).filter((id): id is string => Boolean(id));
    const tasks = await ctx.prisma.exportTask.findMany({
      where: { id: { in: taskIds } },
      select: {
        id: true,
        type: true,
        status: true,
        createdBy: true,
        createdAt: true,
        fileUrl: true,
      },
    });
    const taskMap = new Map(tasks.map((task) => [task.id, task]));

    return {
      items: logs.map((log) => {
        const afterData = toRecord(ctx, log.afterData);
        const task = log.targetId ? taskMap.get(log.targetId) : undefined;
        return {
          id: log.id,
          taskId: log.targetId,
          type: String(afterData.type ?? task?.type ?? ''),
          fileUrl: String(afterData.fileUrl ?? task?.fileUrl ?? ''),
          downloadedAt: log.createdAt,
          downloadedBy: log.user
            ? {
                id: log.user.id,
                username: log.user.username,
                realName: log.user.realName,
                userType: toApiEnum(log.user.userType),
              }
            : null,
          taskStatus: task ? toApiEnum(task.status) : null,
          taskCreatedBy: String(afterData.createdBy ?? task?.createdBy ?? ''),
          taskCreatedAt: task?.createdAt ?? null,
          permissionSnapshot: {
            userId: afterData.permissionSnapshotUserId ?? null,
            userType: afterData.permissionSnapshotUserType ?? null,
            capturedAt: afterData.permissionSnapshotCapturedAt ?? null,
          },
        };
      }),
      page,
      pageSize,
      total,
    };
  }

export async function cleanupExpiredTasks(ctx: ExportsContext) {
    const now = new Date();
    const tasks = await ctx.prisma.exportTask.findMany({
      where: {
        status: ExportStatus.SUCCESS,
        expiresAt: { lte: now },
      },
      select: { id: true, fileUrl: true },
      take: 100,
    });
    for (const task of tasks) {
      await deleteExportFile(ctx, task.fileUrl);
      await ctx.prisma.exportTask.update({
        where: { id: task.id },
        data: {
          status: ExportStatus.EXPIRED,
          fileUrl: null,
          errorMessage: '导出文件已过期清理',
        },
      });
    }
    return { cleaned: tasks.length };
  }
