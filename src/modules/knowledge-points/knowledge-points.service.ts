import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { KnowledgePoint, KnowledgePointStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKnowledgePointDto } from './dto/create-knowledge-point.dto';
import { UpdateKnowledgePointDto } from './dto/update-knowledge-point.dto';

const MAX_TREE_DEPTH = 100;
const LEVEL_UPDATE_BATCH_SIZE = 1_000;

type KnowledgePointStore = Pick<Prisma.TransactionClient, 'knowledgePoint'>;

interface DescendantLevelBatch {
  ids: string[];
  level: number;
}

export interface KnowledgePointNode {
  id: string;
  courseId: string;
  parentId: string | null;
  name: string;
  code: string;
  level: number;
  sortOrder: number;
  status: string;
  children: KnowledgePointNode[];
}

@Injectable()
export class KnowledgePointsService {
  constructor(private readonly prisma: PrismaService) {}

  async tree(courseId: string) {
    const items = await this.prisma.knowledgePoint.findMany({
      where: {
        courseId,
        deletedAt: null,
      },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return this.buildTree(items);
  }

  async create(dto: CreateKnowledgePointDto) {
    const parent = dto.parentId ? await this.findActive(dto.parentId) : null;
    if (parent && parent.courseId !== dto.courseId) {
      throw new ConflictException('父级知识点必须属于同一课程');
    }

    try {
      return await this.prisma.knowledgePoint.create({
        data: {
          courseId: dto.courseId,
          parentId: dto.parentId,
          name: dto.name,
          code: dto.code,
          level: parent ? parent.level + 1 : 1,
          sortOrder: dto.sortOrder,
        },
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException('知识点编码在当前课程下已存在');
      }

      throw error;
    }
  }

  async update(id: string, dto: UpdateKnowledgePointDto) {
    try {
      return await this.serializable(async (tx) => {
        const current = await this.findActive(id, tx);
        const parent = dto.parentId ? await this.findActive(dto.parentId, tx) : null;
        const rootLevel = dto.parentId === undefined
          ? current.level
          : parent
            ? await this.resolveMovedRootLevel(tx, current, parent)
            : 1;
        const descendantBatches = dto.parentId === undefined
          ? []
          : await this.collectDescendantLevelBatches(tx, current, rootLevel);

        const updated = await tx.knowledgePoint.update({
          where: { id },
          data: {
            parentId: dto.parentId,
            level: dto.parentId === undefined ? undefined : rootLevel,
            name: dto.name,
            code: dto.code,
            sortOrder: dto.sortOrder,
            status: dto.status,
            courseId: current.courseId,
          },
        });

        for (const batch of descendantBatches) {
          for (const ids of this.chunks(batch.ids)) {
            const result = await tx.knowledgePoint.updateMany({
              where: { id: { in: ids }, courseId: current.courseId, deletedAt: null },
              data: { level: batch.level },
            });
            if (result.count !== ids.length) {
              throw new ConflictException('知识点子树已发生并发变更，请重试');
            }
          }
        }

        return updated;
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException('知识点编码在当前课程下已存在');
      }

      throw error;
    }
  }

  async remove(id: string) {
    await this.findActive(id);

    const childCount = await this.prisma.knowledgePoint.count({
      where: {
        parentId: id,
        deletedAt: null,
      },
    });

    if (childCount) {
      throw new BadRequestException('请先删除或移动子知识点');
    }

    await this.prisma.$transaction([
      this.prisma.questionKnowledgePoint.deleteMany({ where: { knowledgePointId: id } }),
      this.prisma.knowledgePoint.update({
        where: { id },
        data: {
          status: KnowledgePointStatus.ARCHIVED,
          deletedAt: new Date(),
        },
      }),
    ]);

    return true;
  }

  private async findActive(id: string, store: KnowledgePointStore = this.prisma) {
    const item = await store.knowledgePoint.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!item) {
      throw new NotFoundException('知识点不存在');
    }

    return item;
  }

  private async resolveMovedRootLevel(
    store: KnowledgePointStore,
    current: KnowledgePoint,
    parent: KnowledgePoint,
  ) {
    const visited = new Set<string>();
    let cursor: KnowledgePoint | null = parent;

    for (let depth = 1; cursor; depth += 1) {
      if (cursor.courseId !== current.courseId) {
        throw new ConflictException('父级知识点必须属于同一课程');
      }
      if (cursor.id === current.id) {
        throw new ConflictException('不能将知识点移动到自身或其后代节点下');
      }
      if (visited.has(cursor.id)) {
        throw new ConflictException('知识点父级链已存在循环，请先修复层级数据');
      }
      visited.add(cursor.id);
      if (!cursor.parentId) {
        if (depth >= MAX_TREE_DEPTH) {
          throw new ConflictException('知识点层级过深，无法安全移动');
        }
        return depth + 1;
      }
      if (depth >= MAX_TREE_DEPTH) {
        throw new ConflictException('知识点层级过深，无法安全移动');
      }
      cursor = await this.findActive(cursor.parentId, store);
    }

    throw new ConflictException('目标父级知识点无效');
  }

  private async collectDescendantLevelBatches(
    store: KnowledgePointStore,
    current: KnowledgePoint,
    rootLevel: number,
  ) {
    const batches: DescendantLevelBatch[] = [];
    const visited = new Set([current.id]);
    let frontier = [current.id];
    let level = rootLevel + 1;

    while (frontier.length) {
      const children: Array<{ id: string; courseId: string }> = [];
      for (const parentIds of this.chunks(frontier)) {
        children.push(...await store.knowledgePoint.findMany({
          where: { parentId: { in: parentIds }, deletedAt: null },
          select: { id: true, courseId: true },
        }));
      }
      if (!children.length) break;
      if (level > MAX_TREE_DEPTH) {
        throw new ConflictException('知识点层级过深，无法安全移动');
      }

      const ids: string[] = [];
      for (const child of children) {
        if (child.courseId !== current.courseId) {
          throw new ConflictException('知识点子树包含跨课程节点，请先修复层级数据');
        }
        if (visited.has(child.id)) {
          throw new ConflictException('知识点子树已存在循环，请先修复层级数据');
        }
        visited.add(child.id);
        ids.push(child.id);
      }

      batches.push({ ids, level });
      frontier = ids;
      level += 1;
    }

    return batches;
  }

  private chunks<T>(items: T[]) {
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += LEVEL_UPDATE_BATCH_SIZE) {
      result.push(items.slice(index, index + LEVEL_UPDATE_BATCH_SIZE));
    }
    return result;
  }

  private async serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
          if (attempt < 2) continue;
          throw new ConflictException('知识点正在被并发修改，请重试');
        }
        throw error;
      }
    }
    throw new ConflictException('知识点正在被并发修改，请重试');
  }

  private buildTree(items: KnowledgePoint[]): KnowledgePointNode[] {
    const map = new Map<string, KnowledgePointNode>();
    const roots: KnowledgePointNode[] = [];

    for (const item of items) {
      map.set(item.id, {
        id: item.id,
        courseId: item.courseId,
        parentId: item.parentId,
        name: item.name,
        code: item.code,
        level: item.level,
        sortOrder: item.sortOrder,
        status: item.status,
        children: [],
      });
    }

    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)?.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  private isUniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
