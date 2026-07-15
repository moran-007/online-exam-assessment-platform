import { Injectable, Logger } from '@nestjs/common';
import { ExportStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../../observability/metrics.service';
import type { ExportJobHandler, ExportJobQueue, ExportJobLease } from './export-job-queue.interface';

const LEASE_MS = 60_000;
const HEARTBEAT_MS = 15_000;
const SCAN_MS = 5_000;

@Injectable()
export class PostgresExportJobQueue implements ExportJobQueue {
  private readonly logger = new Logger(PostgresExportJobQueue.name);
  private readonly owner = `${hostname()}:${process.pid}:${randomUUID()}`;
  private readonly pending = new Set<string>();
  private handler?: ExportJobHandler;
  private scanTimer?: NodeJS.Timeout;
  private draining = false;
  private stopped = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async start(handler: ExportJobHandler) {
    this.handler = handler;
    this.stopped = false;
    await this.recoverExpiredLeases();
    await this.scanPending();
    this.scanTimer = setInterval(() => void this.scanPending(), SCAN_MS);
    this.scanTimer.unref?.();
  }

  async stop() {
    this.stopped = true;
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.scanTimer = undefined;
    this.pending.clear();
  }

  enqueue(taskId: string) {
    if (this.stopped) return;
    this.pending.add(taskId);
    void this.drain();
  }

  cancel(taskId: string) {
    this.pending.delete(taskId);
  }

  private async recoverExpiredLeases() {
    const recovered = await this.prisma.exportTask.updateMany({
      where: {
        status: ExportStatus.PROCESSING,
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: new Date() } },
        ],
      },
      data: {
        status: ExportStatus.PENDING,
        progress: 0,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        errorMessage: '检测到中断的导出任务，已恢复排队',
      },
    });
    if (recovered.count) {
      this.metrics.recordExportQueue('lease_recovered');
      this.logger.warn({ event: 'export_lease_recovered', count: recovered.count });
    }
  }

  private async scanPending() {
    if (this.stopped) return;
    await this.recoverExpiredLeases();
    const tasks = await this.prisma.exportTask.findMany({
      where: { status: ExportStatus.PENDING },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    this.metrics.setExportQueueDepth('pending', tasks.length);
    tasks.forEach((task) => this.pending.add(task.id));
    await this.drain();
  }

  private async drain() {
    if (this.draining || this.stopped || !this.handler) return;
    this.draining = true;
    try {
      while (!this.stopped && this.pending.size) {
        const taskId = this.pending.values().next().value as string | undefined;
        if (!taskId) break;
        this.pending.delete(taskId);
        const lease = await this.claim(taskId);
        if (lease) await this.runWithHeartbeat(lease);
      }
    } finally {
      this.draining = false;
    }
  }

  private async claim(taskId: string): Promise<ExportJobLease | null> {
    const now = new Date();
    const claimed = await this.prisma.exportTask.updateMany({
      where: { id: taskId, status: ExportStatus.PENDING },
      data: {
        status: ExportStatus.PROCESSING,
        progress: 10,
        errorMessage: null,
        leaseOwner: this.owner,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      },
    });
    if (claimed.count !== 1) return null;
    this.metrics.recordExportQueue('claimed');
    this.logger.log({ event: 'export_job_claimed', correlationId: `export:${taskId}`, taskId });
    return { taskId, owner: this.owner };
  }

  private async runWithHeartbeat(lease: ExportJobLease) {
    const heartbeat = setInterval(() => void this.extendLease(lease), HEARTBEAT_MS);
    heartbeat.unref?.();
    try {
      await this.handler?.(lease);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async extendLease(lease: ExportJobLease) {
    const now = new Date();
    await this.prisma.exportTask.updateMany({
      where: {
        id: lease.taskId,
        status: ExportStatus.PROCESSING,
        leaseOwner: lease.owner,
      },
      data: {
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      },
    });
  }
}
