import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { QueryNotificationDto } from './dto/query-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: QueryNotificationDto, user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.NotificationWhereInput = {
      userId: user.id,
      readAt: this.isTruthy(query.unreadOnly) ? null : undefined,
    };
    const [items, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);

    return { items, page, pageSize, total, unreadCount };
  }

  async unreadCount(user: RequestUser) {
    const count = await this.prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });
    return { count };
  }

  async markRead(id: string, user: RequestUser) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!notification) {
      throw new NotFoundException('通知不存在');
    }

    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(user: RequestUser) {
    const result = await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }

  async notifyMany(input: {
    userIds: string[];
    title: string;
    content?: string;
    type: string;
    bizType?: string;
    bizId?: string;
  }) {
    const userIds = [...new Set(input.userIds.filter(Boolean))];
    if (!userIds.length) return { count: 0 };
    return this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        title: input.title,
        content: input.content,
        type: input.type,
        bizType: input.bizType,
        bizId: input.bizId,
      })),
    });
  }

  private isTruthy(value: unknown) {
    return value === true || value === 'true' || value === '1';
  }
}
