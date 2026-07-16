import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryCatalogDto, QueryCourseUnitDto, SaveCourseUnitDto, SaveLessonTypeDto } from './dto/catalog.dto';

@Injectable()
export class LessonCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listLessonTypes(query: QueryCatalogDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.LessonTypeWhereInput = {
      active: query.active,
      name: query.keyword ? { contains: query.keyword, mode: 'insensitive' } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.lessonType.findMany({ where, orderBy: [{ active: 'desc' }, { name: 'asc' }], skip, take }),
      this.prisma.lessonType.count({ where }),
    ]);
    return { items: items.map(this.lessonTypeView), page, pageSize, total };
  }

  async createLessonType(dto: SaveLessonTypeDto, actor: RequestUser) {
    const item = await this.prisma.lessonType.create({
      data: {
        name: dto.name.trim(),
        defaultHours: dto.defaultHours,
        countInStatistics: dto.countInStatistics,
        active: dto.active ?? true,
        description: dto.description?.trim(),
        createdBy: actor.id,
        updatedBy: actor.id,
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'lesson-type:create',
      module: 'academic-operations',
      targetType: 'lesson-type',
      targetId: item.id,
      afterData: { name: item.name },
    });
    return this.lessonTypeView(item);
  }

  async updateLessonType(id: string, dto: SaveLessonTypeDto, actor: RequestUser) {
    await this.assertLessonType(id);
    const item = await this.prisma.lessonType.update({
      where: { id },
      data: {
        name: dto.name.trim(),
        defaultHours: dto.defaultHours,
        countInStatistics: dto.countInStatistics,
        active: dto.active,
        description: dto.description?.trim(),
        updatedBy: actor.id,
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'lesson-type:update',
      module: 'academic-operations',
      targetType: 'lesson-type',
      targetId: id,
      afterData: { name: item.name, active: item.active },
    });
    return this.lessonTypeView(item);
  }

  async listCourseUnits(query: QueryCourseUnitDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.CourseUnitTemplateWhereInput = {
      courseId: query.courseId,
      lessonTypeId: query.lessonTypeId,
      status: query.status,
      OR: query.keyword
        ? [
            { name: { contains: query.keyword, mode: 'insensitive' } },
            { code: { contains: query.keyword, mode: 'insensitive' } },
            { category: { contains: query.keyword, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const include = { course: { select: { name: true } }, lessonType: { select: { name: true } } } as const;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.courseUnitTemplate.findMany({
        where,
        include,
        orderBy: [{ category: 'asc' }, { stage: 'asc' }, { unitNo: 'asc' }, { name: 'asc' }],
        skip,
        take,
      }),
      this.prisma.courseUnitTemplate.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        defaultHours: Number(item.defaultHours),
        courseName: item.course?.name ?? '',
        lessonTypeName: item.lessonType.name,
      })),
      page,
      pageSize,
      total,
    };
  }

  async createCourseUnit(dto: SaveCourseUnitDto, actor: RequestUser) {
    await this.assertCatalogReferences(dto);
    const item = await this.prisma.courseUnitTemplate.create({ data: this.courseUnitData(dto, actor.id) });
    await this.audit.log({
      userId: actor.id,
      action: 'course-unit:create',
      module: 'academic-operations',
      targetType: 'course-unit',
      targetId: item.id,
      afterData: { code: item.code, name: item.name },
    });
    return { ...item, defaultHours: Number(item.defaultHours) };
  }

  async updateCourseUnit(id: string, dto: SaveCourseUnitDto, actor: RequestUser) {
    await Promise.all([this.assertCourseUnit(id), this.assertCatalogReferences(dto)]);
    const item = await this.prisma.courseUnitTemplate.update({
      where: { id },
      data: { ...this.courseUnitData(dto, actor.id), createdBy: undefined },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'course-unit:update',
      module: 'academic-operations',
      targetType: 'course-unit',
      targetId: id,
      afterData: { code: item.code, name: item.name, status: item.status },
    });
    return { ...item, defaultHours: Number(item.defaultHours) };
  }

  private lessonTypeView(item: { defaultHours: Prisma.Decimal } & Record<string, unknown>) {
    return { ...item, defaultHours: Number(item.defaultHours) };
  }

  private courseUnitData(dto: SaveCourseUnitDto, actorId: string): Prisma.CourseUnitTemplateUncheckedCreateInput {
    return {
      code: dto.code.trim(),
      courseId: dto.courseId,
      lessonTypeId: dto.lessonTypeId,
      category: dto.category?.trim(),
      stage: dto.stage?.trim(),
      unitNo: dto.unitNo,
      name: dto.name.trim(),
      defaultHours: dto.defaultHours,
      teachingContent: dto.teachingContent?.trim(),
      status: dto.status,
      createdBy: actorId,
      updatedBy: actorId,
    };
  }

  private async assertCatalogReferences(dto: SaveCourseUnitDto) {
    const [lessonType, course] = await Promise.all([
      this.prisma.lessonType.findUnique({ where: { id: dto.lessonTypeId }, select: { id: true } }),
      dto.courseId
        ? this.prisma.course.findFirst({ where: { id: dto.courseId, deletedAt: null }, select: { id: true } })
        : Promise.resolve({ id: 'none' }),
    ]);
    if (!lessonType) throw new BadRequestException('课型不存在');
    if (!course) throw new BadRequestException('课程不存在');
  }

  private async assertLessonType(id: string) {
    const item = await this.prisma.lessonType.findUnique({ where: { id }, select: { id: true } });
    if (!item) throw new NotFoundException('课型不存在');
  }

  private async assertCourseUnit(id: string) {
    const item = await this.prisma.courseUnitTemplate.findUnique({ where: { id }, select: { id: true } });
    if (!item) throw new NotFoundException('课程单元不存在');
  }
}
