import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoleStatus, UserStatus, UserType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { BatchCreateStudentsDto, BatchCreateTeachersDto, CreateStudentDto } from './dto/batch-create-students.dto';
import {
  CreateManagedUserDto,
  ListManagedUsersQueryDto,
  SaveRoleDto,
  UpdateManagedUserDto,
  UpdateRolePermissionsDto,
} from './dto/manage-users.dto';

const userWithRoles = Prisma.validator<Prisma.UserDefaultArgs>()({
  include: {
    roles: {
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    },
  },
});

type UserWithRoles = Prisma.UserGetPayload<typeof userWithRoles>;
type NormalizedStudentInput = {
  index: number;
  username: string;
  realName?: string;
  password: string;
};
type CreatedStudent = {
  id: string;
  username: string;
  realName: string | null;
};
type ExistingStudent = CreatedStudent & {
  userType: UserType;
  status: UserStatus;
};
type ExistingTeacher = ExistingStudent;
type SkippedStudent = {
  username: string;
  reason: string;
};
type CreatedTeacher = CreatedStudent;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findByLogin(login: string) {
    return this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ username: login }, { email: login }, { phone: login }],
      },
    });
  }

  async findAuthenticatedById(id: string): Promise<RequestUser | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      ...userWithRoles,
    });

    return user ? this.toRequestUser(user) : null;
  }

  async touchLastLogin(id: string) {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  async listStudents() {
    return this.prisma.user.findMany({
      where: {
        userType: UserType.STUDENT,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: {
        id: true,
        username: true,
        realName: true,
      },
      orderBy: [{ realName: 'asc' }, { username: 'asc' }],
    });
  }

  async listTeachers() {
    return this.prisma.user.findMany({
      where: {
        userType: { in: [UserType.TEACHER, UserType.ADMIN, UserType.SUPER_ADMIN, UserType.ASSISTANT] },
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: {
        id: true,
        username: true,
        realName: true,
        userType: true,
      },
      orderBy: [{ realName: 'asc' }, { username: 'asc' }],
    });
  }

  async listManagedUsers(query: ListManagedUsersQueryDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.userType ? { userType: query.userType } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    if (query.keyword) {
      where.OR = [
        { username: { contains: query.keyword, mode: 'insensitive' } },
        { realName: { contains: query.keyword, mode: 'insensitive' } },
        { phone: { contains: query.keyword, mode: 'insensitive' } },
        { email: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { username: 'asc' }],
        select: {
          id: true,
          username: true,
          phone: true,
          email: true,
          realName: true,
          userType: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          roles: {
            select: {
              roleId: true,
              role: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  status: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toManagedUser(item)),
      page,
      pageSize,
      total,
    };
  }

  async createManagedUser(dto: CreateManagedUserDto, actor: RequestUser) {
    const username = dto.username.trim();
    const existing = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException('账号已存在');
    }

    const roleIds =
      dto.roleIds === undefined ? await this.defaultRoleIdsForUserType(dto.userType) : this.uniqueIds(dto.roleIds);
    const passwordHash = await bcrypt.hash(dto.password?.trim() || '123456', 10);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          realName: dto.realName?.trim(),
          passwordHash,
          userType: dto.userType,
          status: dto.status ?? UserStatus.ACTIVE,
        },
        select: { id: true },
      });

      await this.syncUserRoles(tx, user.id, roleIds);
      return user;
    });

    await this.audit.log({
      userId: actor.id,
      action: 'user:create',
      module: 'user',
      targetType: 'user',
      targetId: created.id,
      afterData: {
        username,
        userType: dto.userType,
        status: dto.status ?? UserStatus.ACTIVE,
        roleIds,
      },
    });

    return this.getManagedUserOrThrow(created.id);
  }

  async updateManagedUser(id: string, dto: UpdateManagedUserDto, actor: RequestUser) {
    const existing = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, username: true, realName: true, userType: true, status: true },
    });

    if (!existing) {
      throw new NotFoundException('用户不存在');
    }

    if (id === actor.id && (dto.userType !== undefined || dto.status !== undefined || dto.roleIds !== undefined)) {
      throw new BadRequestException('不能修改当前登录账号的身份、状态或角色');
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.realName !== undefined) {
      data.realName = dto.realName?.trim();
    }
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password.trim(), 10);
    }
    if (dto.userType) {
      data.userType = dto.userType;
    }
    if (dto.status) {
      data.status = dto.status;
    }

    const roleIds = dto.roleIds === undefined ? undefined : this.uniqueIds(dto.roleIds);

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.user.update({
          where: { id },
          data,
        });
      }

      if (roleIds !== undefined) {
        await this.syncUserRoles(tx, id, roleIds);
      }
    });

    await this.audit.log({
      userId: actor.id,
      action: 'user:update',
      module: 'user',
      targetType: 'user',
      targetId: id,
      beforeData: {
        realName: existing.realName,
        userType: existing.userType,
        status: existing.status,
      },
      afterData: {
        realName: dto.realName,
        userType: dto.userType,
        status: dto.status,
        roleIds,
        passwordChanged: Boolean(dto.password),
      },
    });

    return this.getManagedUserOrThrow(id);
  }

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: {
        permissions: {
          include: {
            permission: true,
          },
          orderBy: {
            permission: {
              sortOrder: 'asc',
            },
          },
        },
        _count: {
          select: {
            users: true,
          },
        },
      },
    });

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      code: role.code,
      description: role.description,
      status: role.status,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      userCount: role._count.users,
      permissionIds: role.permissions.map((item) => item.permissionId),
      permissions: role.permissions.map((item) => item.permission),
    }));
  }

  async createRole(dto: SaveRoleDto, actor: RequestUser) {
    const existing = await this.prisma.role.findUnique({
      where: { code: dto.code },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException('角色编码已存在');
    }

    const permissionIds = this.uniqueIds(dto.permissionIds ?? []);
    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          name: dto.name,
          code: dto.code,
          description: dto.description,
          status: dto.status ?? RoleStatus.ACTIVE,
        },
        select: { id: true },
      });

      await this.syncRolePermissions(tx, created.id, permissionIds);
      return created;
    });

    await this.audit.log({
      userId: actor.id,
      action: 'role:create',
      module: 'user',
      targetType: 'role',
      targetId: role.id,
      afterData: { name: dto.name, code: dto.code, permissionIds },
    });

    return this.getRoleOrThrow(role.id);
  }

  async updateRole(id: string, dto: SaveRoleDto, actor: RequestUser) {
    const existing = await this.prisma.role.findUnique({
      where: { id },
      select: { id: true, name: true, code: true, description: true, status: true },
    });

    if (!existing) {
      throw new NotFoundException('角色不存在');
    }

    const duplicate = await this.prisma.role.findFirst({
      where: { code: dto.code, id: { not: id } },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException('角色编码已存在');
    }

    const permissionIds = dto.permissionIds === undefined ? undefined : this.uniqueIds(dto.permissionIds);
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id },
        data: {
          name: dto.name,
          code: dto.code,
          description: dto.description,
          status: dto.status ?? RoleStatus.ACTIVE,
        },
      });

      if (permissionIds !== undefined) {
        await this.syncRolePermissions(tx, id, permissionIds);
      }
    });

    await this.audit.log({
      userId: actor.id,
      action: 'role:update',
      module: 'user',
      targetType: 'role',
      targetId: id,
      beforeData: existing,
      afterData: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
        status: dto.status ?? RoleStatus.ACTIVE,
        permissionIds,
      },
    });

    return this.getRoleOrThrow(id);
  }

  async updateRolePermissions(id: string, dto: UpdateRolePermissionsDto, actor: RequestUser) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      select: { id: true, name: true, code: true },
    });

    if (!role) {
      throw new NotFoundException('角色不存在');
    }

    const permissionIds = this.uniqueIds(dto.permissionIds);
    await this.prisma.$transaction((tx) => this.syncRolePermissions(tx, id, permissionIds));

    await this.audit.log({
      userId: actor.id,
      action: 'role:update-permissions',
      module: 'user',
      targetType: 'role',
      targetId: id,
      beforeData: role,
      afterData: { permissionIds },
    });

    return this.getRoleOrThrow(id);
  }

  async listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        name: true,
        code: true,
        type: true,
        parentId: true,
        path: true,
        method: true,
        sortOrder: true,
      },
    });
  }

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
      const user: CreatedTeacher = await tx.user.create({
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
    const uniqueTeachers: NormalizedStudentInput[] = [];
    const duplicateRows: NormalizedStudentInput[] = [];
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

    const created: CreatedTeacher[] = [];
    const existingTeachers: ExistingTeacher[] = [];
    const skipped: SkippedStudent[] = duplicateRows.map((teacher) => ({
      username: teacher.username,
      reason: '本次导入中账号重复',
    }));

    await this.prisma.$transaction(async (tx) => {
      for (const teacher of uniqueTeachers) {
        const existing = existingByUsername.get(teacher.username);
        if (existing) {
          if (existing.userType === UserType.TEACHER && existing.status === UserStatus.ACTIVE) {
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
    const uniqueStudents: NormalizedStudentInput[] = [];
    const duplicateRows: NormalizedStudentInput[] = [];
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

    const created: CreatedStudent[] = [];
    const existingStudents: ExistingStudent[] = [];
    const skipped: SkippedStudent[] = duplicateRows.map((student) => ({
      username: student.username,
      reason: '本次导入中账号重复',
    }));

    await this.prisma.$transaction(async (tx) => {
      for (const student of uniqueStudents) {
        const existing = existingByUsername.get(student.username);
        if (existing) {
          if (existing.userType === UserType.STUDENT && existing.status === UserStatus.ACTIVE) {
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

  private async getManagedUserOrThrow(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        username: true,
        phone: true,
        email: true,
        realName: true,
        userType: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        roles: {
          select: {
            roleId: true,
            role: {
              select: {
                id: true,
                name: true,
                code: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return this.toManagedUser(user);
  }

  private async getRoleOrThrow(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: {
          include: {
            permission: true,
          },
          orderBy: {
            permission: {
              sortOrder: 'asc',
            },
          },
        },
        _count: {
          select: {
            users: true,
          },
        },
      },
    });

    if (!role) {
      throw new NotFoundException('角色不存在');
    }

    return {
      id: role.id,
      name: role.name,
      code: role.code,
      description: role.description,
      status: role.status,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      userCount: role._count.users,
      permissionIds: role.permissions.map((item) => item.permissionId),
      permissions: role.permissions.map((item) => item.permission),
    };
  }

  private toManagedUser(user: {
    roles: Array<{
      roleId: string;
      role: {
        id: string;
        name: string;
        code: string;
        status: RoleStatus;
      };
    }>;
  }) {
    const { roles, ...rest } = user;
    return {
      ...rest,
      roleIds: roles.map((item) => item.roleId),
      roles: roles.map((item) => item.role),
    };
  }

  private uniqueIds(ids: string[]) {
    return [...new Set(ids.filter(Boolean))];
  }

  private defaultRoleCodeForUserType(userType: UserType) {
    switch (userType) {
      case UserType.SUPER_ADMIN:
        return 'super_admin';
      case UserType.TEACHER:
      case UserType.ADMIN:
      case UserType.ASSISTANT:
        return 'teacher';
      case UserType.STUDENT:
        return 'student';
      default:
        return undefined;
    }
  }

  private async defaultRoleIdsForUserType(userType: UserType) {
    const roleCode = this.defaultRoleCodeForUserType(userType);
    if (!roleCode) {
      return [];
    }

    const role = await this.prisma.role.findUnique({
      where: { code: roleCode },
      select: { id: true },
    });

    return role ? [role.id] : [];
  }

  private async syncUserRoles(tx: Prisma.TransactionClient, userId: string, roleIds: string[]) {
    const normalized = this.uniqueIds(roleIds);
    if (normalized.length) {
      const count = await tx.role.count({
        where: { id: { in: normalized } },
      });

      if (count !== normalized.length) {
        throw new BadRequestException('包含不存在的角色');
      }
    }

    await tx.userRole.deleteMany({ where: { userId } });
    if (!normalized.length) {
      return;
    }

    await tx.userRole.createMany({
      data: normalized.map((roleId) => ({
        userId,
        roleId,
        scopeType: 'GLOBAL',
      })),
      skipDuplicates: true,
    });
  }

  private async syncRolePermissions(tx: Prisma.TransactionClient, roleId: string, permissionIds: string[]) {
    const normalized = this.uniqueIds(permissionIds);
    if (normalized.length) {
      const count = await tx.permission.count({
        where: { id: { in: normalized } },
      });

      if (count !== normalized.length) {
        throw new BadRequestException('包含不存在的权限');
      }
    }

    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (!normalized.length) {
      return;
    }

    await tx.rolePermission.createMany({
      data: normalized.map((permissionId) => ({
        roleId,
        permissionId,
      })),
      skipDuplicates: true,
    });
  }

  private toRequestUser(user: UserWithRoles): RequestUser {
    const roles = user.roles.map((item) => item.role.code);
    const permissions = new Set<string>();

    for (const userRole of user.roles) {
      for (const rolePermission of userRole.role.permissions) {
        permissions.add(rolePermission.permission.code);
      }
    }

    return {
      id: user.id,
      username: user.username,
      realName: user.realName,
      userType: user.userType,
      roles,
      permissions: [...permissions],
    };
  }
}
