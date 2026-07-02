import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

export interface AuditLogInput {
  userId?: string;
  action: string;
  module: string;
  targetType?: string;
  targetId?: string;
  beforeData?: Prisma.InputJsonValue;
  afterData?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(query: QueryAuditLogDto) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.AuditLogWhereInput = {
      module: query.module,
      action: query.action,
      userId: query.userId,
      targetType: query.targetType,
      targetId: query.targetId,
      OR: query.keyword
        ? [
            { action: { contains: query.keyword, mode: 'insensitive' } },
            { module: { contains: query.keyword, mode: 'insensitive' } },
            { targetType: { contains: query.keyword, mode: 'insensitive' } },
            { user: { username: { contains: query.keyword, mode: 'insensitive' } } },
            { user: { realName: { contains: query.keyword, mode: 'insensitive' } } },
          ]
        : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, username: true, realName: true, userType: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        userId: item.userId,
        username: item.user?.username ?? '',
        userName: item.user?.realName ?? item.user?.username ?? '',
        userType: item.user?.userType ?? null,
        action: item.action,
        module: item.module,
        targetType: item.targetType,
        targetId: item.targetId,
        ip: item.ip,
        userAgent: item.userAgent,
        createdAt: item.createdAt,
      })),
      page,
      pageSize,
      total,
    };
  }

  async detail(id: string) {
    const item = await this.prisma.auditLog.findUnique({
      where: { id },
      include: { user: { select: { id: true, username: true, realName: true, userType: true } } },
    });
    if (!item) throw new NotFoundException('操作日志不存在');
    return {
      ...item,
      username: item.user?.username ?? '',
      userName: item.user?.realName ?? item.user?.username ?? '',
    };
  }

  async log(input: AuditLogInput) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: input.userId,
          action: input.action,
          module: input.module,
          targetType: input.targetType,
          targetId: input.targetId,
          beforeData: input.beforeData,
          afterData: input.afterData,
          ip: input.ip,
          userAgent: input.userAgent,
        },
      });
    } catch (error) {
      this.logger.warn(`Audit log write failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}
