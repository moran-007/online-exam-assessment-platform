import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CourseStatus, CourseUnitStatus, Prisma } from '@prisma/client';
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

    const [
      knowledgePointCount,
      questionCount,
      paperCount,
      examCount,
      activeClassCount,
      courseUnitCount,
      lessonHourEntryCount,
    ] = await this.prisma.$transaction([
      this.prisma.knowledgePoint.count({ where: { courseId: id, deletedAt: null } }),
      this.prisma.question.count({ where: { courseId: id, deletedAt: null } }),
      this.prisma.paper.count({ where: { courseId: id, deletedAt: null } }),
      this.prisma.exam.count({ where: { courseId: id, deletedAt: null } }),
      this.prisma.classGroup.count({ where: { courseId: id, deletedAt: null, status: { not: 'archived' } } }),
      this.prisma.courseUnitTemplate.count({ where: { courseId: id, status: { not: CourseUnitStatus.ARCHIVED } } }),
      this.prisma.lessonHourLedger.count({ where: { courseId: id } }),
    ]);

    const references = [
      ['知识点', knowledgePointCount],
      ['题目', questionCount],
      ['试卷', paperCount],
      ['考试', examCount],
      ['活动班级', activeClassCount],
      ['课程单元', courseUnitCount],
      ['课时台账', lessonHourEntryCount],
    ] as const;
    const blockers = references.filter(([, count]) => count > 0);
    if (blockers.length) {
      const summary = blockers.map(([label, count]) => `${label} ${count}`).join('、');
      throw new BadRequestException(`课程仍有业务引用（${summary}），请先迁移或归档相关数据`);
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
