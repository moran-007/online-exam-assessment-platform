import { ExportStatus } from '@prisma/client';
import { PostgresExportJobQueue } from '../../src/modules/exports/postgres-export-job-queue';
import { MetricsService } from '../../src/observability/metrics.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

describe('PostgresExportJobQueue', () => {
  it('claims a pending task before invoking the handler', async () => {
    const updateMany = jest.fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const findMany = jest.fn().mockResolvedValueOnce([{ id: 'task-1' }]);
    const prisma = {
      exportTask: { updateMany, findMany },
    } as unknown as PrismaService;
    const queue = new PostgresExportJobQueue(prisma, new MetricsService());
    const handler = jest.fn().mockResolvedValue(undefined);

    await queue.start(handler);
    await queue.stop();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ taskId: 'task-1' });
    expect(updateMany.mock.calls[2][0]).toMatchObject({
      where: { id: 'task-1', status: ExportStatus.PENDING },
      data: { status: ExportStatus.PROCESSING, progress: 10 },
    });
  });

  it('does not process a task claimed by another worker', async () => {
    const prisma = {
      exportTask: {
        updateMany: jest.fn()
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce({ count: 0 }),
        findMany: jest.fn().mockResolvedValueOnce([{ id: 'task-2' }]),
      },
    } as unknown as PrismaService;
    const queue = new PostgresExportJobQueue(prisma, new MetricsService());
    const handler = jest.fn().mockResolvedValue(undefined);

    await queue.start(handler);
    await queue.stop();

    expect(handler).not.toHaveBeenCalled();
  });
});
