import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, UserType } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DataScopeService {
  constructor(private readonly prisma: PrismaService) {}

  isUnrestricted(user: RequestUser) {
    return user.userType === UserType.SUPER_ADMIN || user.userType === UserType.ADMIN;
  }

  isScopedTeacher(user: RequestUser) {
    return user.userType === UserType.TEACHER || user.userType === UserType.ASSISTANT;
  }

  async classIdsFor(user: RequestUser) {
    if (this.isUnrestricted(user)) return null;
    if (!this.isScopedTeacher(user)) return [];

    const relations = await this.prisma.classTeacher.findMany({
      where: {
        teacherId: user.id,
        classGroup: { deletedAt: null, status: 'active' },
      },
      select: { classId: true },
    });
    return relations.map((relation) => relation.classId);
  }

  async classWhere(user: RequestUser, classId?: string): Promise<Prisma.ClassGroupWhereInput> {
    const classIds = await this.classIdsFor(user);
    if (classIds === null) return classId ? { id: classId } : {};

    if (classId) {
      this.assertInScope(classIds.includes(classId), '无权限访问该班级');
      return { id: classId };
    }

    return { id: { in: classIds } };
  }

  async examWhere(user: RequestUser, classId?: string | null): Promise<Prisma.ExamWhereInput> {
    const classIds = await this.classIdsFor(user);
    if (classIds === null) {
      return classId !== undefined ? { classId } : {};
    }

    if (classId) {
      this.assertInScope(classIds.includes(classId), '无权限访问该班级考试');
      return { classId };
    }

    return {
      OR: [
        { classId: { in: classIds } },
        { classId: null, createdBy: user.id },
      ],
    };
  }

  async assertClassWritable(user: RequestUser, classId?: string | null) {
    if (!classId || this.isUnrestricted(user)) return;
    const classIds = await this.classIdsFor(user);
    this.assertInScope(classIds?.includes(classId) ?? false, '无权限操作该班级');
  }

  async assertExamAccessible(user: RequestUser, examId: string) {
    if (this.isUnrestricted(user)) return;
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, deletedAt: null },
      select: { classId: true, createdBy: true },
    });
    this.assertInScope(Boolean(exam), '考试不存在或无权限访问');
    if (!exam?.classId) {
      this.assertInScope(exam?.createdBy === user.id, '无权限访问该公开考试');
      return;
    }
    await this.assertClassWritable(user, exam.classId);
  }

  async assertStudentSummaryAccessible(user: RequestUser, studentId: string) {
    if (this.isUnrestricted(user)) return;
    this.assertInScope(this.isScopedTeacher(user), '无权限访问该学生');
    const [classMembership, authoredExamAttempt] = await Promise.all([
      this.prisma.classStudent.findFirst({
        where: {
          studentId,
          classGroup: {
            deletedAt: null,
            status: 'active',
            teachers: { some: { teacherId: user.id } },
          },
        },
        select: { id: true },
      }),
      this.prisma.examAttempt.findFirst({
        where: {
          userId: studentId,
          exam: { classId: null, createdBy: user.id, deletedAt: null },
        },
        select: { id: true },
      }),
    ]);
    this.assertInScope(Boolean(classMembership || authoredExamAttempt), '无权限访问该学生');
  }

  private assertInScope(condition: boolean, message: string) {
    if (!condition) {
      throw new ForbiddenException(message);
    }
  }
}
