import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClassMemberStatus, Prisma, UserType } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  LinkParentStudentDto,
  ProfileListQueryDto,
  UpdateStudentProfileDto,
  UpdateTeacherProfileDto,
} from './dto/academic-profiles.dto';

@Injectable()
export class AcademicProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
  ) {}

  async listStudents(query: ProfileListQueryDto, actor: RequestUser) {
    const where = await this.studentWhere(actor);
    return this.prisma.user.findMany({
      where: {
        ...where,
        userType: UserType.STUDENT,
        deletedAt: null,
        OR: query.keyword
          ? [
              { username: { contains: query.keyword, mode: 'insensitive' } },
              { realName: { contains: query.keyword, mode: 'insensitive' } },
              { studentProfile: { studentNo: { contains: query.keyword, mode: 'insensitive' } } },
            ]
          : undefined,
      },
      select: this.studentSelect(this.dataScope.isUnrestricted(actor)),
      orderBy: [{ realName: 'asc' }, { username: 'asc' }],
    });
  }

  async studentDetail(userId: string, actor: RequestUser) {
    await this.assertStudentAccessible(userId, actor);
    const student = await this.prisma.user.findFirst({
      where: { id: userId, userType: UserType.STUDENT, deletedAt: null },
      select: this.studentSelect(this.dataScope.isUnrestricted(actor)),
    });
    if (!student) throw new NotFoundException('学生档案不存在');
    return student;
  }

  async updateStudent(userId: string, dto: UpdateStudentProfileDto, actor: RequestUser) {
    await this.assertUserType(userId, UserType.STUDENT, '学生不存在');
    const profile = await this.prisma.studentProfile.upsert({
      where: { userId },
      update: this.studentProfileData(dto),
      create: { userId, ...this.studentProfileData(dto) },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'profile:update-student',
      module: 'academic-profile',
      targetType: 'student-profile',
      targetId: profile.id,
      afterData: { userId, fields: Object.keys(dto) },
    });
    return this.studentDetail(userId, actor);
  }

  async listTeachers(query: ProfileListQueryDto, actor: RequestUser) {
    const unrestricted = this.dataScope.isUnrestricted(actor);
    const teacherIds = unrestricted ? null : await this.dataScope.teacherIdsVisibleTo(actor);
    return this.prisma.user.findMany({
      where: {
        id: teacherIds === null ? undefined : { in: teacherIds },
        userType: { in: [UserType.TEACHER, UserType.ASSISTANT] },
        deletedAt: null,
        OR: query.keyword
          ? [
              { username: { contains: query.keyword, mode: 'insensitive' } },
              { realName: { contains: query.keyword, mode: 'insensitive' } },
              { teacherProfile: { employeeNo: { contains: query.keyword, mode: 'insensitive' } } },
            ]
          : undefined,
      },
      select: {
        id: true,
        username: true,
        realName: true,
        phone: unrestricted,
        status: true,
        mustChangePassword: true,
        teacherProfile: true,
        teachingClasses: {
          where: { status: ClassMemberStatus.ACTIVE, classGroup: { deletedAt: null } },
          select: { role: true, classGroup: { select: { id: true, name: true, code: true } } },
        },
      },
      orderBy: [{ realName: 'asc' }, { username: 'asc' }],
    });
  }

  async teacherDetail(userId: string, actor: RequestUser) {
    const visibleIds = await this.dataScope.teacherIdsVisibleTo(actor);
    if (visibleIds !== null && !visibleIds.includes(userId)) throw new ForbiddenException('无权限访问该教师档案');
    const items = await this.listTeachers({}, actor);
    const teacher = items.find((item) => item.id === userId);
    if (!teacher) throw new NotFoundException('教师档案不存在');
    return teacher;
  }

  async updateTeacher(userId: string, dto: UpdateTeacherProfileDto, actor: RequestUser) {
    await this.assertTeacher(userId);
    const profile = await this.prisma.teacherProfile.upsert({
      where: { userId },
      update: this.teacherProfileData(dto),
      create: { userId, ...this.teacherProfileData(dto) },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'profile:update-teacher',
      module: 'academic-profile',
      targetType: 'teacher-profile',
      targetId: profile.id,
      afterData: { userId, fields: Object.keys(dto) },
    });
    return this.teacherDetail(userId, actor);
  }

  async listParents(query: ProfileListQueryDto) {
    return this.prisma.user.findMany({
      where: {
        userType: UserType.PARENT,
        deletedAt: null,
        OR: query.keyword
          ? [
              { username: { contains: query.keyword, mode: 'insensitive' } },
              { realName: { contains: query.keyword, mode: 'insensitive' } },
              { phone: { contains: query.keyword, mode: 'insensitive' } },
            ]
          : undefined,
      },
      select: {
        id: true,
        username: true,
        realName: true,
        phone: true,
        status: true,
        mustChangePassword: true,
        parentStudents: {
          where: { status: ClassMemberStatus.ACTIVE },
          select: {
            relationship: true,
            isPrimary: true,
            student: { select: { id: true, username: true, realName: true } },
          },
        },
      },
      orderBy: [{ realName: 'asc' }, { username: 'asc' }],
    });
  }

  async myChildren(actor: RequestUser) {
    if (actor.userType !== UserType.PARENT) throw new ForbiddenException('仅家长账号可访问关联学生');
    return this.prisma.parentStudent.findMany({
      where: { parentId: actor.id, status: ClassMemberStatus.ACTIVE },
      select: {
        relationship: true,
        isPrimary: true,
        linkedAt: true,
        student: { select: { id: true, username: true, realName: true, studentProfile: true } },
      },
      orderBy: [{ isPrimary: 'desc' }, { linkedAt: 'asc' }],
    });
  }

  async linkParent(dto: LinkParentStudentDto, actor: RequestUser) {
    await Promise.all([
      this.assertUserType(dto.parentId, UserType.PARENT, '家长账号不存在'),
      this.assertUserType(dto.studentId, UserType.STUDENT, '学生账号不存在'),
    ]);
    const relation = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.parentStudent.updateMany({
          where: { studentId: dto.studentId, status: ClassMemberStatus.ACTIVE },
          data: { isPrimary: false, updatedBy: actor.id },
        });
      }
      return tx.parentStudent.upsert({
        where: { parentId_studentId: { parentId: dto.parentId, studentId: dto.studentId } },
        update: {
          relationship: dto.relationship,
          isPrimary: dto.isPrimary ?? false,
          status: ClassMemberStatus.ACTIVE,
          unlinkedAt: null,
          updatedBy: actor.id,
        },
        create: { ...dto, isPrimary: dto.isPrimary ?? false, createdBy: actor.id, updatedBy: actor.id },
      });
    });
    await this.audit.log({
      userId: actor.id,
      action: 'profile:link-parent-student',
      module: 'academic-profile',
      targetType: 'parent-student',
      targetId: relation.id,
      afterData: { parentId: dto.parentId, studentId: dto.studentId, relationship: dto.relationship },
    });
    return relation;
  }

  async unlinkParent(parentId: string, studentId: string, actor: RequestUser) {
    const result = await this.prisma.parentStudent.updateMany({
      where: { parentId, studentId, status: ClassMemberStatus.ACTIVE },
      data: {
        status: ClassMemberStatus.LEFT,
        isPrimary: false,
        unlinkedAt: new Date(),
        updatedBy: actor.id,
      },
    });
    if (!result.count) throw new NotFoundException('家长关联不存在');
    await this.audit.log({
      userId: actor.id,
      action: 'profile:unlink-parent-student',
      module: 'academic-profile',
      targetType: 'parent-student',
      afterData: { parentId, studentId },
    });
    return true;
  }

  private async studentWhere(actor: RequestUser): Promise<Prisma.UserWhereInput> {
    if (this.dataScope.isUnrestricted(actor)) return {};
    if (actor.userType === UserType.STUDENT) return { id: actor.id };
    if (actor.userType === UserType.PARENT) {
      return { childParents: { some: { parentId: actor.id, status: ClassMemberStatus.ACTIVE } } };
    }
    const classIds = await this.dataScope.classIdsFor(actor);
    return {
      studentClasses: {
        some: { status: ClassMemberStatus.ACTIVE, classId: { in: classIds ?? [] } },
      },
    };
  }

  private async assertStudentAccessible(studentId: string, actor: RequestUser) {
    const where = await this.studentWhere(actor);
    const exists = await this.prisma.user.findFirst({ where: { ...where, id: studentId }, select: { id: true } });
    if (!exists) throw new ForbiddenException('无权限访问该学生档案');
  }

  private async assertUserType(userId: string, userType: UserType, message: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, userType, deletedAt: null }, select: { id: true } });
    if (!user) throw new BadRequestException(message);
  }

  private async assertTeacher(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, userType: { in: [UserType.TEACHER, UserType.ASSISTANT] }, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new BadRequestException('教师不存在');
  }

  private studentSelect(includeParents: boolean): Prisma.UserSelect {
    return {
      id: true,
      username: true,
      realName: true,
      phone: includeParents,
      status: true,
      mustChangePassword: true,
      studentProfile: true,
      studentClasses: {
        where: { status: ClassMemberStatus.ACTIVE, classGroup: { deletedAt: null } },
        select: { joinedAt: true, classGroup: { select: { id: true, name: true, code: true } } },
      },
      childParents: includeParents
        ? {
            where: { status: ClassMemberStatus.ACTIVE },
            select: {
              relationship: true,
              isPrimary: true,
              parent: { select: { id: true, username: true, realName: true, phone: true } },
            },
          }
        : false,
    };
  }

  private studentProfileData(dto: UpdateStudentProfileDto) {
    return {
      ...dto,
      birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
      enrolledAt: dto.enrolledAt ? new Date(dto.enrolledAt) : undefined,
    };
  }

  private teacherProfileData(dto: UpdateTeacherProfileDto) {
    return { ...dto, joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : undefined };
  }
}
