import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import {
  AI_USER_ROLE_CODE,
  isAiReadablePermission,
} from '../../../common/security/ai-user-permissions';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SaveRoleDto,
  UpdateAiUserPermissionsDto,
  UpdateRolePermissionsDto,
} from '../dto/manage-users.dto';
import { UserSupportOperations } from '../user-support.operations';

@Injectable()
export class RoleManagementUseCases {
  constructor(
    readonly prisma: PrismaService,
    readonly audit: AuditService,
    readonly support: UserSupportOperations,
  ) {}

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
      assignable: role.code !== AI_USER_ROLE_CODE,
      protected: role.code === AI_USER_ROLE_CODE,
    }));
  }


  async createRole(dto: SaveRoleDto, actor: RequestUser) {
    if (dto.code === AI_USER_ROLE_CODE) {
      throw new BadRequestException('AI 用户是系统特殊角色，不能手动创建');
    }
    const existing = await this.prisma.role.findUnique({
      where: { code: dto.code },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException('角色编码已存在');
    }

    const permissionIds = this.support.uniqueIds(dto.permissionIds ?? []);
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

      await this.support.syncRolePermissions(tx, created.id, permissionIds);
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

    return this.support.getRoleOrThrow(role.id);
  }


  async updateRole(id: string, dto: SaveRoleDto, actor: RequestUser) {
    const existing = await this.prisma.role.findUnique({
      where: { id },
      select: { id: true, name: true, code: true, description: true, status: true },
    });

    if (!existing) {
      throw new NotFoundException('角色不存在');
    }
    if (existing.code === AI_USER_ROLE_CODE || dto.code === AI_USER_ROLE_CODE) {
      throw new BadRequestException('AI 用户只能在 AI 中心验证密码后配置');
    }

    const duplicate = await this.prisma.role.findFirst({
      where: { code: dto.code, id: { not: id } },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException('角色编码已存在');
    }

    const permissionIds = dto.permissionIds === undefined ? undefined : this.support.uniqueIds(dto.permissionIds);
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
        await this.support.syncRolePermissions(tx, id, permissionIds);
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

    return this.support.getRoleOrThrow(id);
  }


  async updateRolePermissions(id: string, dto: UpdateRolePermissionsDto, actor: RequestUser) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      select: { id: true, name: true, code: true },
    });

    if (!role) {
      throw new NotFoundException('角色不存在');
    }
    if (role.code === AI_USER_ROLE_CODE) {
      throw new BadRequestException('AI 用户只能在 AI 中心验证密码后配置');
    }

    const permissionIds = this.support.uniqueIds(dto.permissionIds);
    await this.prisma.$transaction((tx) => this.support.syncRolePermissions(tx, id, permissionIds));

    await this.audit.log({
      userId: actor.id,
      action: 'role:update-permissions',
      module: 'user',
      targetType: 'role',
      targetId: id,
      beforeData: role,
      afterData: { permissionIds },
    });

    return this.support.getRoleOrThrow(id);
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

  async getAiUserPermissions() {
    const role = await this.prisma.role.findUnique({
      where: { code: AI_USER_ROLE_CODE },
      select: { id: true },
    });
    if (!role) {
      throw new NotFoundException('AI 用户角色尚未初始化，请先执行权限同步');
    }
    const [roleView, availablePermissions] = await Promise.all([
      this.support.getRoleOrThrow(role.id),
      this.prisma.permission.findMany({
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        select: {
          id: true,
          name: true,
          description: true,
          code: true,
          type: true,
          sortOrder: true,
        },
      }),
    ]);
    return {
      role: { ...roleView, assignable: false, protected: true },
      availablePermissions: availablePermissions.filter(({ code }) => isAiReadablePermission(code)),
    };
  }

  async updateAiUserPermissions(dto: UpdateAiUserPermissionsDto, actor: RequestUser) {
    const [admin, role, availablePermissions] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: actor.id, deletedAt: null },
        select: { id: true, passwordHash: true },
      }),
      this.prisma.role.findUnique({
        where: { code: AI_USER_ROLE_CODE },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.permission.findMany({ select: { id: true, code: true } }),
    ]);
    if (!admin || !(await bcrypt.compare(dto.password, admin.passwordHash))) {
      throw new BadRequestException('当前密码不正确');
    }
    if (!role) {
      throw new NotFoundException('AI 用户角色尚未初始化，请先执行权限同步');
    }

    const allowedIds = new Set(
      availablePermissions.filter(({ code }) => isAiReadablePermission(code)).map(({ id }) => id),
    );
    const permissionIds = this.support.uniqueIds(dto.permissionIds).filter((id) => allowedIds.has(id));
    const excludedPermissionIds = [...allowedIds].filter((id) => !permissionIds.includes(id));
    await this.prisma.$transaction(async (tx) => {
      await this.support.syncRolePermissions(tx, role.id, permissionIds);
      await tx.aiUserPermissionExclusion.deleteMany({});
      if (excludedPermissionIds.length) {
        await tx.aiUserPermissionExclusion.createMany({
          data: excludedPermissionIds.map((permissionId) => ({
            permissionId,
            updatedBy: actor.id,
          })),
          skipDuplicates: true,
        });
      }
    });

    await this.audit.log({
      userId: actor.id,
      action: 'ai-user:update-permissions',
      module: 'ai',
      targetType: 'role',
      targetId: role.id,
      beforeData: role,
      afterData: { permissionIds },
    });
    return this.support.getRoleOrThrow(role.id);
  }

}
