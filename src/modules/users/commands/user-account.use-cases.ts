import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChangeOwnPasswordDto,
  CreateManagedUserDto,
  ResetManagedUserPasswordDto,
  UpdateManagedUserDto,
} from '../dto/manage-users.dto';
import { UserSupportOperations } from '../user-support.operations';

@Injectable()
export class UserAccountUseCases {
  constructor(
    readonly prisma: PrismaService,
    readonly audit: AuditService,
    readonly support: UserSupportOperations,
  ) {}

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
      dto.roleIds === undefined ? await this.support.defaultRoleIdsForUserType(dto.userType) : this.support.uniqueIds(dto.roleIds);
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

      await this.support.syncUserRoles(tx, user.id, roleIds);
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

    return this.support.getManagedUserOrThrow(created.id);
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

    const roleIds = dto.roleIds === undefined ? undefined : this.support.uniqueIds(dto.roleIds);

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.user.update({
          where: { id },
          data,
        });
      }

      if (roleIds !== undefined) {
        await this.support.syncUserRoles(tx, id, roleIds);
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

    return this.support.getManagedUserOrThrow(id);
  }


  async changeOwnPassword(dto: ChangeOwnPasswordDto, actor: RequestUser) {
    const user = await this.prisma.user.findFirst({
      where: { id: actor.id, deletedAt: null },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const passwordMatches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!passwordMatches) {
      throw new BadRequestException('当前密码不正确');
    }

    await this.prisma.user.update({
      where: { id: actor.id },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) },
    });

    await this.audit.log({
      userId: actor.id,
      action: 'user:change-own-password',
      module: 'user',
      targetType: 'user',
      targetId: actor.id,
      afterData: { passwordChanged: true },
    });

    return true;
  }


  async resetManagedUserPassword(id: string, dto: ResetManagedUserPasswordDto, actor: RequestUser) {
    const existing = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, username: true, userType: true, status: true },
    });

    if (!existing) {
      throw new NotFoundException('用户不存在');
    }

    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(dto.password, 10) },
    });

    await this.audit.log({
      userId: actor.id,
      action: 'user:reset-password',
      module: 'user',
      targetType: 'user',
      targetId: id,
      beforeData: {
        username: existing.username,
        userType: existing.userType,
        status: existing.status,
      },
      afterData: { passwordChanged: true },
    });

    return true;
  }

}
