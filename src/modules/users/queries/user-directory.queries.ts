import { Injectable } from '@nestjs/common';
import { Prisma, UserStatus, UserType } from '@prisma/client';
import { toPagination } from '../../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { ListManagedUsersQueryDto } from '../dto/manage-users.dto';
import { UserSupportOperations } from '../user-support.operations';

@Injectable()
export class UserDirectoryQueries {
  constructor(
    readonly prisma: PrismaService,
    readonly support: UserSupportOperations,
  ) {}

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
      items: items.map((item) => this.support.toManagedUser(item)),
      page,
      pageSize,
      total,
    };
  }

}
