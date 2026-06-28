import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserStatus, UserType } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryClassDto } from './dto/query-class.dto';
import { SaveClassDto, UpdateClassDto } from './dto/save-class.dto';

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: QueryClassDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.ClassGroupWhereInput = {
      deletedAt: null,
      courseId: query.courseId,
      status: query.status,
      OR: query.keyword
        ? [
            { name: { contains: query.keyword, mode: 'insensitive' } },
            { code: { contains: query.keyword, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.classGroup.findMany({
        where,
        include: {
          course: { select: { name: true } },
          _count: { select: { students: true, teachers: true } },
        },
        orderBy: this.orderBy(query),
        skip,
        take,
      }),
      this.prisma.classGroup.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        courseName: item.course?.name ?? '',
        studentCount: item._count.students,
        teacherCount: item._count.teachers,
      })),
      page,
      pageSize,
      total,
    };
  }

  async detail(id: string) {
    const item = await this.prisma.classGroup.findFirst({
      where: { id, deletedAt: null },
      include: {
        course: true,
        students: { include: { student: { select: { id: true, username: true, realName: true } } } },
        teachers: { include: { teacher: { select: { id: true, username: true, realName: true } } } },
      },
    });
    if (!item) {
      throw new NotFoundException('班级不存在');
    }
    return {
      ...item,
      courseName: item.course?.name ?? '',
      students: item.students.map((relation) => relation.student),
      teachers: item.teachers.map((relation) => relation.teacher),
    };
  }

  async create(dto: SaveClassDto, userId: string) {
    await this.assertCourseExists(dto.courseId);
    const code = dto.code?.trim() || `class_${Date.now()}`;
    const created = await this.prisma.classGroup.create({
      data: {
        name: dto.name.trim(),
        code,
        courseId: dto.courseId,
        description: dto.description?.trim(),
        status: dto.status ?? 'active',
        sortOrder: dto.sortOrder ?? 0,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit.log({
      userId,
      action: 'class:create',
      module: 'class',
      targetType: 'class',
      targetId: created.id,
      afterData: { name: created.name },
    });
    return { id: created.id };
  }

  async update(id: string, dto: UpdateClassDto, userId: string) {
    const current = await this.findExisting(id);
    await this.assertCourseExists(dto.courseId);
    const updated = await this.prisma.classGroup.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        courseId: dto.courseId,
        code: dto.code?.trim(),
        description: dto.description?.trim(),
        status: dto.status,
        sortOrder: dto.sortOrder,
        updatedBy: userId,
      },
    });
    await this.audit.log({
      userId,
      action: 'class:update',
      module: 'class',
      targetType: 'class',
      targetId: id,
      beforeData: { name: current.name, status: current.status },
      afterData: { name: updated.name, status: updated.status },
    });
    return { id };
  }

  async remove(id: string, userId: string) {
    await this.findExisting(id);
    await this.prisma.classGroup.update({
      where: { id },
      data: { status: 'archived', deletedAt: new Date(), updatedBy: userId },
    });
    await this.audit.log({
      userId,
      action: 'class:delete',
      module: 'class',
      targetType: 'class',
      targetId: id,
    });
    return true;
  }

  async addStudents(id: string, studentIds: string[], userId: string) {
    await this.findExisting(id);
    const students = await this.prisma.user.findMany({
      where: {
        id: { in: [...new Set(studentIds)] },
        userType: UserType.STUDENT,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (students.length !== [...new Set(studentIds)].length) {
      throw new BadRequestException('存在不可用学生账号');
    }
    await this.prisma.$transaction(
      students.map((student) =>
        this.prisma.classStudent.upsert({
          where: { classId_studentId: { classId: id, studentId: student.id } },
          update: {},
          create: { classId: id, studentId: student.id },
        }),
      ),
    );
    await this.audit.log({
      userId,
      action: 'class:add-students',
      module: 'class',
      targetType: 'class',
      targetId: id,
      afterData: { studentIds },
    });
    return true;
  }

  async removeStudent(id: string, studentId: string, userId: string) {
    await this.prisma.classStudent.deleteMany({ where: { classId: id, studentId } });
    await this.audit.log({
      userId,
      action: 'class:remove-student',
      module: 'class',
      targetType: 'class',
      targetId: id,
      afterData: { studentId },
    });
    return true;
  }

  async addTeachers(id: string, teacherIds: string[], userId: string) {
    await this.findExisting(id);
    const teachers = await this.prisma.user.findMany({
      where: {
        id: { in: [...new Set(teacherIds)] },
        userType: { in: [UserType.TEACHER, UserType.ADMIN, UserType.SUPER_ADMIN, UserType.ASSISTANT] },
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (teachers.length !== [...new Set(teacherIds)].length) {
      throw new BadRequestException('存在不可用教师账号');
    }
    await this.prisma.$transaction(
      teachers.map((teacher) =>
        this.prisma.classTeacher.upsert({
          where: { classId_teacherId: { classId: id, teacherId: teacher.id } },
          update: {},
          create: { classId: id, teacherId: teacher.id },
        }),
      ),
    );
    await this.audit.log({
      userId,
      action: 'class:add-teachers',
      module: 'class',
      targetType: 'class',
      targetId: id,
      afterData: { teacherIds },
    });
    return true;
  }

  async removeTeacher(id: string, teacherId: string, userId: string) {
    await this.prisma.classTeacher.deleteMany({ where: { classId: id, teacherId } });
    await this.audit.log({
      userId,
      action: 'class:remove-teacher',
      module: 'class',
      targetType: 'class',
      targetId: id,
      afterData: { teacherId },
    });
    return true;
  }

  private async findExisting(id: string) {
    const item = await this.prisma.classGroup.findFirst({ where: { id, deletedAt: null } });
    if (!item) {
      throw new NotFoundException('班级不存在');
    }
    return item;
  }

  private async assertCourseExists(courseId?: string) {
    if (!courseId) return;
    const course = await this.prisma.course.findFirst({ where: { id: courseId, deletedAt: null } });
    if (!course) {
      throw new BadRequestException('课程不存在');
    }
  }

  private orderBy(query: QueryClassDto): Prisma.ClassGroupOrderByWithRelationInput[] {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const map: Record<string, Prisma.ClassGroupOrderByWithRelationInput> = {
      name: { name: direction },
      status: { status: direction },
      sortOrder: { sortOrder: direction },
      createdAt: { createdAt: direction },
    };
    const primary = map[query.sortBy || 'sortOrder'] ?? { sortOrder: 'asc' };
    return [primary, { createdAt: 'desc' }];
  }
}
