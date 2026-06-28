import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
