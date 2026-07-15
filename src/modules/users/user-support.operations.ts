import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoleStatus, UserType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserSupportOperations {
  constructor(readonly prisma: PrismaService) {}

  async getManagedUserOrThrow(id: string) {
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


  async getRoleOrThrow(id: string) {
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


  toManagedUser(user: {
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


  uniqueIds(ids: string[]) {
    return [...new Set(ids.filter(Boolean))];
  }


  defaultRoleCodeForUserType(userType: UserType) {
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


  async defaultRoleIdsForUserType(userType: UserType) {
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


  async syncUserRoles(tx: Prisma.TransactionClient, userId: string, roleIds: string[]) {
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


  async syncRolePermissions(tx: Prisma.TransactionClient, roleId: string, permissionIds: string[]) {
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

}
