import { Injectable } from '@nestjs/common';
import { ClassMemberStatus, Prisma, UserStatus, UserType } from '@prisma/client';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { toPagination } from '../../../common/dto/pagination-query.dto';
import { DataScopeService } from '../../data-scope/data-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListManagedUsersQueryDto } from '../dto/manage-users.dto';
import { UserSupportOperations } from '../user-support.operations';

@Injectable()
export class UserDirectoryQueries {
  constructor(
    readonly prisma: PrismaService,
    readonly support: UserSupportOperations,
    readonly dataScope: DataScopeService,
  ) {}

  async listStudents(actor: RequestUser) {
    const scopedWhere: Prisma.UserWhereInput = this.dataScope.isUnrestricted(actor)
      ? {}
      : actor.userType === UserType.STUDENT
        ? { id: actor.id }
        : actor.userType === UserType.PARENT
          ? { childParents: { some: { parentId: actor.id, status: ClassMemberStatus.ACTIVE } } }
          : {
              studentClasses: {
                some: {
                  status: ClassMemberStatus.ACTIVE,
                  classGroup: {
                    deletedAt: null,
                    teachers: { some: { teacherId: actor.id, status: ClassMemberStatus.ACTIVE } },
                  },
                },
              },
            };
    return this.prisma.user.findMany({
      where: {
        ...scopedWhere,
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


  async listTeachers(actor: RequestUser) {
    const visibleIds = await this.dataScope.teacherIdsVisibleTo(actor);
    return this.prisma.user.findMany({
      where: {
        id: visibleIds === null ? undefined : { in: visibleIds },
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
          mustChangePassword: true,
          activatedAt: true,
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
