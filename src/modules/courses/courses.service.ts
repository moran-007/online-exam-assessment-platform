import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CourseStatus, Prisma } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { QueryCourseDto } from './dto/query-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: QueryCourseDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.CourseWhereInput = {
      deletedAt: null,
      status: query.status,
      OR: query.keyword
        ? [
            { name: { contains: query.keyword, mode: 'insensitive' } },
            { code: { contains: query.keyword, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.course.count({ where }),
    ]);

    return {
      items,
      page,
      pageSize,
      total,
    };
  }

  async create(dto: CreateCourseDto, userId: string) {
    try {
      return await this.prisma.course.create({
        data: {
          name: dto.name,
          code: dto.code,
          description: dto.description,
          coverUrl: dto.coverUrl,
          sortOrder: dto.sortOrder,
          createdBy: userId,
        },
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException('课程编码已存在');
      }

      throw error;
    }
  }

  async update(id: string, dto: UpdateCourseDto) {
    const exists = await this.prisma.course.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!exists) {
      throw new NotFoundException('课程不存在');
    }

    return this.prisma.course.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        coverUrl: dto.coverUrl,
        sortOrder: dto.sortOrder,
        status: dto.status,
      },
    });
  }

  async remove(id: string) {
    const exists = await this.prisma.course.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!exists) {
      throw new NotFoundException('课程不存在');
    }

    const [knowledgePointCount, questionCount, paperCount, examCount] = await this.prisma.$transaction([
      this.prisma.knowledgePoint.count({ where: { courseId: id, deletedAt: null } }),
      this.prisma.question.count({ where: { courseId: id, deletedAt: null } }),
      this.prisma.paper.count({ where: { courseId: id, deletedAt: null } }),
      this.prisma.exam.count({ where: { courseId: id, deletedAt: null } }),
    ]);

    if (knowledgePointCount || questionCount || paperCount || examCount) {
      throw new BadRequestException('课程下仍有知识点、题目、试卷或考试，请先迁移/删除后再删除');
    }

    await this.prisma.course.update({
      where: { id },
      data: {
        status: CourseStatus.ARCHIVED,
        deletedAt: new Date(),
      },
    });

    return true;
  }

  private isUniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
