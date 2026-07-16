import { Injectable } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { PrismaService } from '../../prisma/prisma.service';

const userWithRoles = Prisma.validator<Prisma.UserDefaultArgs>()({
  include: {
    roles: {
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
    },
  },
});

type UserWithRoles = Prisma.UserGetPayload<typeof userWithRoles>;

@Injectable()
export class UserIdentityReader {
  constructor(readonly prisma: PrismaService) {}

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


  toRequestUser(user: UserWithRoles): RequestUser {
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
      mustChangePassword: user.mustChangePassword,
    };
  }
}
