import { BadRequestException, Injectable } from '@nestjs/common';
import { UserStatus, UserType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchCreateStudentsDto, BatchCreateTeachersDto, CreateStudentDto } from '../dto/batch-create-students.dto';

type NormalizedUserInput = {
  index: number;
  username: string;
  realName?: string;
  password: string;
};
type CreatedUser = {
  id: string;
  username: string;
  realName: string | null;
};
type ExistingUser = CreatedUser & {
  userType: UserType;
  status: UserStatus;
};
type SkippedUser = {
  username: string;
  reason: string;
};

@Injectable()
export class UserProvisioningUseCases {
  constructor(
    readonly prisma: PrismaService,
    readonly audit: AuditService,
  ) {}

  async createStudent(dto: CreateStudentDto, actor: RequestUser) {
    const result = await this.batchCreateStudents({ students: [dto] }, actor);
    const student = result.created[0] ?? result.existingStudents[0];

    if (!student) {
      throw new BadRequestException(result.skipped[0]?.reason ?? '学生创建失败');
    }

    return {
      created: Boolean(result.created[0]),
      student,
      skipped: result.skipped,
    };
  }


  async createTeacher(dto: CreateStudentDto, actor: RequestUser) {
    const username = dto.username.trim();
    if (!username) {
      throw new BadRequestException('请填写教师账号');
    }

    const existing = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: { id: true, username: true, realName: true, userType: true, status: true },
    });
    if (existing) {
      if (existing.userType === UserType.TEACHER && existing.status === UserStatus.ACTIVE) {
        await this.prisma.teacherProfile.upsert({
          where: { userId: existing.id },
          update: {},
          create: { userId: existing.id },
        });
        return {
          created: false,
          teacher: {
            id: existing.id,
            username: existing.username,
            realName: existing.realName,
          },
        };
      }
      throw new BadRequestException('账号已存在且不是可用教师账号');
    }

    const teacherRole = await this.prisma.role.findUnique({ where: { code: 'teacher' } });
    if (!teacherRole) {
      throw new BadRequestException('缺少教师角色，请先初始化角色数据');
    }

    const passwordHash = await bcrypt.hash(dto.password?.trim() || '123456', 10);
    const teacher = await this.prisma.$transaction(async (tx) => {
      const user: CreatedUser = await tx.user.create({
        data: {
          username,
          realName: dto.realName?.trim(),
          passwordHash,
          userType: UserType.TEACHER,
          status: UserStatus.ACTIVE,
        },
        select: { id: true, username: true, realName: true },
      });
      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: teacherRole.id,
          scopeType: 'GLOBAL',
        },
      });
      await tx.teacherProfile.create({ data: { userId: user.id } });
      return user;
    });

    await this.audit.log({
      userId: actor.id,
      action: 'user:create-teacher',
      module: 'user',
      targetType: 'user',
      targetId: teacher.id,
      afterData: { username: teacher.username, realName: teacher.realName },
    });

    return {
      created: true,
      teacher,
    };
  }


  async batchCreateTeachers(dto: BatchCreateTeachersDto, actor: RequestUser) {
    const normalized = dto.teachers
      .map((teacher, index) => ({
        index,
        username: teacher.username.trim(),
        realName: teacher.realName?.trim(),
        password: teacher.password?.trim() || dto.defaultPassword?.trim() || '123456',
      }))
      .filter((teacher) => teacher.username);

    if (!normalized.length) {
      throw new BadRequestException('请至少填写一个教师账号');
    }

    const seen = new Set<string>();
    const uniqueTeachers: NormalizedUserInput[] = [];
    const duplicateRows: NormalizedUserInput[] = [];
    for (const teacher of normalized) {
      if (seen.has(teacher.username)) {
        duplicateRows.push(teacher);
        continue;
      }
      seen.add(teacher.username);
      uniqueTeachers.push(teacher);
    }

    const existingUsers = uniqueTeachers.length
      ? await this.prisma.user.findMany({
          where: { username: { in: uniqueTeachers.map((teacher) => teacher.username) }, deletedAt: null },
          select: { id: true, username: true, realName: true, userType: true, status: true },
        })
      : [];
    const existingByUsername = new Map(existingUsers.map((user) => [user.username, user]));
    const teacherRole = await this.prisma.role.findUnique({ where: { code: 'teacher' } });

    if (!teacherRole) {
      throw new BadRequestException('缺少教师角色，请先初始化角色数据');
    }

    const created: CreatedUser[] = [];
    const existingTeachers: ExistingUser[] = [];
    const skipped: SkippedUser[] = duplicateRows.map((teacher) => ({
      username: teacher.username,
      reason: '本次导入中账号重复',
    }));

    await this.prisma.$transaction(async (tx) => {
      for (const teacher of uniqueTeachers) {
        const existing = existingByUsername.get(teacher.username);
        if (existing) {
          if (existing.userType === UserType.TEACHER && existing.status === UserStatus.ACTIVE) {
            await tx.teacherProfile.upsert({ where: { userId: existing.id }, update: {}, create: { userId: existing.id } });
            existingTeachers.push(existing);
          } else {
            skipped.push({
              username: teacher.username,
              reason: '账号已存在且不是可用教师账号',
            });
          }
          continue;
        }

        const passwordHash = await bcrypt.hash(teacher.password, 10);
        const user = await tx.user.create({
          data: {
            username: teacher.username,
            realName: teacher.realName,
            passwordHash,
            userType: UserType.TEACHER,
            status: UserStatus.ACTIVE,
          },
          select: { id: true, username: true, realName: true },
        });

        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: teacherRole.id,
            scopeType: 'GLOBAL',
          },
        });
        await tx.teacherProfile.create({ data: { userId: user.id } });
        created.push(user);
      }
    });

    await this.audit.log({
      userId: actor.id,
      action: 'user:batch-create-teachers',
      module: 'user',
      targetType: 'user',
      afterData: {
        createdCount: created.length,
        existingTeacherCount: existingTeachers.length,
        skippedCount: skipped.length,
        usernames: normalized.map((teacher) => teacher.username),
      },
    });

    return {
      createdCount: created.length,
      existingTeacherCount: existingTeachers.length,
      skippedCount: skipped.length,
      created,
      existingTeachers,
      availableTeachers: [...created, ...existingTeachers],
      skipped,
    };
  }


  async batchCreateStudents(dto: BatchCreateStudentsDto, actor: RequestUser) {
    const normalized = dto.students
      .map((student, index) => ({
        index,
        username: student.username.trim(),
        realName: student.realName?.trim(),
        password: student.password?.trim() || dto.defaultPassword?.trim() || '123456',
      }))
      .filter((student) => student.username);

    if (!normalized.length) {
      throw new BadRequestException('请至少填写一个学生账号');
    }

    const seen = new Set<string>();
    const uniqueStudents: NormalizedUserInput[] = [];
    const duplicateRows: NormalizedUserInput[] = [];
    for (const student of normalized) {
      if (seen.has(student.username)) {
        duplicateRows.push(student);
        continue;
      }
      seen.add(student.username);
      uniqueStudents.push(student);
    }

    const existingUsers = uniqueStudents.length
      ? await this.prisma.user.findMany({
          where: { username: { in: uniqueStudents.map((student) => student.username) }, deletedAt: null },
          select: { id: true, username: true, realName: true, userType: true, status: true },
        })
      : [];
    const existingByUsername = new Map(existingUsers.map((user) => [user.username, user]));
    const studentRole = await this.prisma.role.findUnique({ where: { code: 'student' } });

    if (!studentRole) {
      throw new BadRequestException('缺少学生角色，请先初始化角色数据');
    }

    const created: CreatedUser[] = [];
    const existingStudents: ExistingUser[] = [];
    const skipped: SkippedUser[] = duplicateRows.map((student) => ({
      username: student.username,
      reason: '本次导入中账号重复',
    }));

    await this.prisma.$transaction(async (tx) => {
      for (const student of uniqueStudents) {
        const existing = existingByUsername.get(student.username);
        if (existing) {
          if (existing.userType === UserType.STUDENT && existing.status === UserStatus.ACTIVE) {
            await tx.studentProfile.upsert({ where: { userId: existing.id }, update: {}, create: { userId: existing.id } });
            existingStudents.push(existing);
          } else {
            skipped.push({
              username: student.username,
              reason: '账号已存在且不是可用学生账号',
            });
          }
          continue;
        }

        const passwordHash = await bcrypt.hash(student.password, 10);
        const user = await tx.user.create({
          data: {
            username: student.username,
            realName: student.realName,
            passwordHash,
            userType: UserType.STUDENT,
            status: UserStatus.ACTIVE,
          },
          select: { id: true, username: true, realName: true },
        });

        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: studentRole.id,
            scopeType: 'GLOBAL',
          },
        });
        await tx.studentProfile.create({ data: { userId: user.id } });
        created.push(user);
      }
    });

    await this.audit.log({
      userId: actor.id,
      action: 'user:batch-create-students',
      module: 'user',
      targetType: 'user',
      afterData: {
        createdCount: created.length,
        existingStudentCount: existingStudents.length,
        skippedCount: skipped.length,
        usernames: normalized.map((student) => student.username),
      },
    });

    return {
      createdCount: created.length,
      existingStudentCount: existingStudents.length,
      skippedCount: skipped.length,
      created,
      existingStudents,
      availableStudents: [...created, ...existingStudents],
      skipped,
    };
  }

}
