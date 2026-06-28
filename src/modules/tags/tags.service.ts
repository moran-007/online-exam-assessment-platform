import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TagStatus } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { QueryTagDto } from './dto/query-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: QueryTagDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.TagWhereInput = {
      deletedAt: null,
      type: query.type,
      status: query.status,
      OR: query.keyword
        ? [
            { name: { contains: query.keyword, mode: 'insensitive' } },
            { code: { contains: query.keyword, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.tag.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.tag.count({ where }),
    ]);

    return {
      items,
      page,
      pageSize,
      total,
    };
  }

  async create(dto: CreateTagDto) {
    try {
      return await this.prisma.tag.create({
        data: dto,
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException('标签编码已存在');
      }

      throw error;
    }
  }

  async update(id: string, dto: UpdateTagDto) {
    const exists = await this.prisma.tag.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!exists) {
      throw new NotFoundException('标签不存在');
    }

    try {
      return await this.prisma.tag.update({
        where: { id },
        data: dto,
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException('标签编码已存在');
      }

      throw error;
    }
  }

  async remove(id: string) {
    const exists = await this.prisma.tag.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!exists) {
      throw new NotFoundException('标签不存在');
    }

    await this.prisma.$transaction([
      this.prisma.questionTag.deleteMany({ where: { tagId: id } }),
      this.prisma.tag.update({
        where: { id },
        data: {
          status: TagStatus.DISABLED,
          deletedAt: new Date(),
        },
      }),
    ]);

    return true;
  }

  private isUniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
