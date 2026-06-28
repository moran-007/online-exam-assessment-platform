import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { KnowledgePoint, KnowledgePointStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKnowledgePointDto } from './dto/create-knowledge-point.dto';
import { UpdateKnowledgePointDto } from './dto/update-knowledge-point.dto';

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
    const current = await this.findActive(id);
    const parent =
      dto.parentId === undefined || dto.parentId === null ? null : await this.findActive(dto.parentId);

    if (parent?.id === id) {
      throw new ConflictException('父级知识点不能是自己');
    }

    try {
      return await this.prisma.knowledgePoint.update({
        where: { id },
        data: {
          parentId: dto.parentId,
          level: dto.parentId === undefined ? undefined : parent ? parent.level + 1 : 1,
          name: dto.name,
          code: dto.code,
          sortOrder: dto.sortOrder,
          status: dto.status,
          courseId: current.courseId,
        },
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

  private async findActive(id: string) {
    const item = await this.prisma.knowledgePoint.findFirst({
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
