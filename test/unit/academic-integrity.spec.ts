import { KnowledgePointStatus } from '@prisma/client';
import { CoursesService } from '../../src/modules/courses/courses.service';
import { KnowledgePointsService } from '../../src/modules/knowledge-points/knowledge-points.service';

describe('academic domain integrity', () => {
  it('blocks course archival while academic references remain', async () => {
    const prisma = {
      course: {
        findFirst: jest.fn().mockResolvedValue({ id: 'course-1' }),
        update: jest.fn(),
      },
      knowledgePoint: { count: jest.fn() },
      question: { count: jest.fn() },
      paper: { count: jest.fn() },
      exam: { count: jest.fn() },
      classGroup: { count: jest.fn() },
      courseUnitTemplate: { count: jest.fn() },
      lessonHourLedger: { count: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([0, 0, 0, 0, 1, 2, 3]),
    };

    await expect(new CoursesService(prisma as never).remove('course-1'))
      .rejects.toThrow('活动班级 1、课程单元 2、课时台账 3');
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('rejects a parent knowledge point from another course', async () => {
    const prisma = {
      knowledgePoint: {
        findFirst: jest.fn().mockResolvedValue(point('parent', 'course-b')),
        create: jest.fn(),
      },
    };
    const service = new KnowledgePointsService(prisma as never);

    await expect(service.create({
      courseId: 'course-a', parentId: 'parent', name: 'child', code: 'child', sortOrder: 0,
    })).rejects.toThrow('父级知识点必须属于同一课程');
    expect(prisma.knowledgePoint.create).not.toHaveBeenCalled();
  });

  it('rejects moving a knowledge point below its own descendant', async () => {
    const root = point('root', 'course-a');
    const child = point('child', 'course-a', 'root');
    const { prisma } = knowledgePointPrisma([root, child]);
    const service = new KnowledgePointsService(prisma as never);

    await expect(service.update('root', { parentId: 'child' }))
      .rejects.toThrow('不能将知识点移动到自身或其后代节点下');
    expect(prisma.knowledgePoint.update).not.toHaveBeenCalled();
  });

  it('relevels every descendant when moving a subtree below a parent and back to root', async () => {
    const target = point('target', 'course-a');
    const branch = point('branch', 'course-a');
    const child = point('child', 'course-a', 'branch', 2);
    const grandchild = point('grandchild', 'course-a', 'child', 3);
    const { prisma, records } = knowledgePointPrisma([target, branch, child, grandchild]);
    const service = new KnowledgePointsService(prisma as never);

    await service.update('branch', { parentId: 'target' });
    expect(levels(records, ['target', 'branch', 'child', 'grandchild'])).toEqual([1, 2, 3, 4]);
    expect(records.get('branch')?.parentId).toBe('target');

    await service.update('branch', { parentId: null });
    expect(levels(records, ['target', 'branch', 'child', 'grandchild'])).toEqual([1, 1, 2, 3]);
    expect(records.get('branch')?.parentId).toBeNull();
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.knowledgePoint.updateMany).toHaveBeenCalledTimes(4);
  });
});

type Point = ReturnType<typeof point>;

function point(id: string, courseId: string, parentId: string | null = null, level = parentId ? 2 : 1) {
  return {
    id,
    courseId,
    parentId,
    name: id,
    code: id,
    level,
    sortOrder: 0,
    status: KnowledgePointStatus.ACTIVE,
    createdAt: new Date('2026-07-19T00:00:00Z'),
    updatedAt: new Date('2026-07-19T00:00:00Z'),
    deletedAt: null,
  };
}

function knowledgePointPrisma(initial: Point[]) {
  const records = new Map(initial.map((item) => [item.id, { ...item }]));
  const knowledgePoint = {
    findFirst: jest.fn(async ({ where }: { where: { id: string } }) => records.get(where.id) ?? null),
    findMany: jest.fn(async ({ where }: { where: { parentId: { in: string[] } } }) =>
      [...records.values()]
        .filter((item) => where.parentId.in.includes(item.parentId ?? '') && !item.deletedAt)
        .map(({ id, courseId }) => ({ id, courseId }))),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Point> }) => {
      const current = records.get(where.id);
      if (!current) throw new Error(`missing point ${where.id}`);
      const changes = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
      const updated = { ...current, ...changes } as Point;
      records.set(where.id, updated);
      return updated;
    }),
    updateMany: jest.fn(async ({ where, data }: {
      where: { id: { in: string[] } };
      data: Pick<Point, 'level'>;
    }) => {
      for (const id of where.id.in) {
        const current = records.get(id);
        if (current) records.set(id, { ...current, ...data });
      }
      return { count: where.id.in.length };
    }),
  };
  const prisma = {
    knowledgePoint,
    $transaction: jest.fn(async (operation: (tx: { knowledgePoint: typeof knowledgePoint }) => unknown) =>
      operation({ knowledgePoint })),
  };
  return { prisma, records };
}

function levels(records: Map<string, Point>, ids: string[]) {
  return ids.map((id) => records.get(id)?.level);
}
