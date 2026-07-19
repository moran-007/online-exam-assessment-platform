import { PrismaClient } from '@prisma/client';
import { KnowledgePointsService } from '../../src/modules/knowledge-points/knowledge-points.service';

describe('knowledge point subtree levels', () => {
  const prisma = new PrismaClient();
  const service = new KnowledgePointsService(prisma as never);
  const courseIds: string[] = [];

  afterAll(async () => {
    if (courseIds.length) {
      await prisma.knowledgePoint.deleteMany({ where: { courseId: { in: courseIds } } });
      await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    }
    await prisma.$disconnect();
  });

  it('moves a subtree with a grandchild below another parent and back to the root', async () => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
    const course = await prisma.course.create({
      data: { name: `Tree course ${suffix}`, code: `tree-${suffix}` },
    });
    const otherCourse = await prisma.course.create({
      data: { name: `Other tree course ${suffix}`, code: `tree-other-${suffix}` },
    });
    courseIds.push(course.id, otherCourse.id);

    const target = await createPoint(course.id, null, `target-${suffix}`);
    const branch = await createPoint(course.id, null, `branch-${suffix}`);
    const child = await createPoint(course.id, branch.id, `child-${suffix}`);
    const grandchild = await createPoint(course.id, child.id, `grandchild-${suffix}`);
    const otherRoot = await createPoint(otherCourse.id, null, `other-${suffix}`);

    await service.update(branch.id, { parentId: target.id });
    await expectLevels([target.id, branch.id, child.id, grandchild.id], [1, 2, 3, 4]);

    await service.update(branch.id, { parentId: null });
    await expectLevels([target.id, branch.id, child.id, grandchild.id], [1, 1, 2, 3]);

    await expect(service.update(branch.id, { parentId: otherRoot.id }))
      .rejects.toThrow('父级知识点必须属于同一课程');
    await expect(service.update(branch.id, { parentId: grandchild.id }))
      .rejects.toThrow('不能将知识点移动到自身或其后代节点下');
    await expectLevels([target.id, branch.id, child.id, grandchild.id], [1, 1, 2, 3]);
  });

  async function createPoint(courseId: string, parentId: string | null, code: string) {
    return service.create({ courseId, parentId, name: code, code, sortOrder: 0 });
  }

  async function expectLevels(ids: string[], expected: number[]) {
    const points = await prisma.knowledgePoint.findMany({ where: { id: { in: ids } } });
    const levels = new Map(points.map((point) => [point.id, point.level]));
    expect(ids.map((id) => levels.get(id))).toEqual(expected);
  }
});
