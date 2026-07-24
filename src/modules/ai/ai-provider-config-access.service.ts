import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AiProviderConfigScope, Prisma, UserType } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

const PERSONAL_CONFIG_USER_TYPES = new Set<string>([
  UserType.SUPER_ADMIN,
  UserType.ADMIN,
  UserType.TEACHER,
  UserType.ASSISTANT,
]);

@Injectable()
export class AiProviderConfigAccessService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: RequestUser) {
    return this.prisma.aiProviderConfig.findMany({
      where: this.visibleWhere(user),
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async resolve(user: RequestUser, id?: string) {
    if (id) {
      const row = await this.prisma.aiProviderConfig.findFirst({
        where: { id, enabled: true, ...this.visibleWhere(user) },
      });
      if (!row) throw new NotFoundException('AI 配置不存在或不可用');
      return row;
    }
    const rows = await this.prisma.aiProviderConfig.findMany({
      where: { enabled: true, ...this.visibleWhere(user) },
    });
    const selected = rows.sort((left, right) => this.priority(left, user) - this.priority(right, user)
      || left.createdAt.getTime() - right.createdAt.getTime())[0];
    if (!selected) throw new NotFoundException('尚未配置可用的 AI 提供商');
    return selected;
  }

  async requireManageable(id: string, user: RequestUser) {
    const row = await this.prisma.aiProviderConfig.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('AI 配置不存在');
    const allowed = this.canManage(row, user);
    if (!allowed) throw new NotFoundException('AI 配置不存在');
    return row;
  }

  canManage(row: { scope: AiProviderConfigScope; ownerUserId: string | null }, user: RequestUser) {
    return row.scope === AiProviderConfigScope.SYSTEM
      ? this.isSuperAdmin(user)
      : row.ownerUserId === user.id;
  }

  createOwnership(requestedScope: 'system' | 'personal' | undefined, user: RequestUser) {
    const scope = requestedScope ?? (this.isSuperAdmin(user) ? 'system' : 'personal');
    if (scope === 'system' && !this.isSuperAdmin(user)) {
      throw new ForbiddenException('只有超级管理员可以创建系统共享 AI 配置');
    }
    if (scope === 'personal' && !PERSONAL_CONFIG_USER_TYPES.has(user.userType)) {
      throw new ForbiddenException('当前用户类型不能创建个人 AI 配置');
    }
    return scope === 'system'
      ? { scope: AiProviderConfigScope.SYSTEM, ownerUserId: null }
      : { scope: AiProviderConfigScope.PERSONAL, ownerUserId: user.id };
  }

  defaultPeers(row: { scope: AiProviderConfigScope; ownerUserId: string | null }): Prisma.AiProviderConfigWhereInput {
    return row.scope === AiProviderConfigScope.SYSTEM
      ? { scope: AiProviderConfigScope.SYSTEM, deletedAt: null }
      : { scope: AiProviderConfigScope.PERSONAL, ownerUserId: row.ownerUserId, deletedAt: null };
  }

  private visibleWhere(user: RequestUser): Prisma.AiProviderConfigWhereInput {
    return {
      deletedAt: null,
      OR: [
        { scope: AiProviderConfigScope.SYSTEM },
        { scope: AiProviderConfigScope.PERSONAL, ownerUserId: user.id },
      ],
    };
  }

  private priority(row: { scope: AiProviderConfigScope; ownerUserId: string | null; isDefault: boolean }, user: RequestUser) {
    const personal = row.scope === AiProviderConfigScope.PERSONAL && row.ownerUserId === user.id;
    if (personal && row.isDefault) return 0;
    if (!personal && row.isDefault) return 1;
    return personal ? 2 : 3;
  }

  private isSuperAdmin(user: RequestUser) {
    return user.userType === UserType.SUPER_ADMIN;
  }
}
