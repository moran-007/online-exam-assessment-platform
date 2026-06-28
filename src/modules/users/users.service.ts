import { Injectable } from '@nestjs/common';
import { Prisma, UserStatus, UserType } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

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

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
