import { Injectable } from '@nestjs/common';
import {
  AI_USER_ROLE_CODE,
  isAiReadablePermission,
} from '../../common/security/ai-user-permissions';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AiUserPermissionService {
  constructor(private readonly prisma: PrismaService) {}

  async codes() {
    const [role, exclusions] = await Promise.all([
      this.prisma.role.findUnique({
        where: { code: AI_USER_ROLE_CODE },
        select: {
          status: true,
          permissions: {
            select: {
              permission: {
                select: { code: true },
              },
            },
          },
        },
      }),
      this.prisma.aiUserPermissionExclusion.findMany({
        select: {
          permission: {
            select: { code: true },
          },
        },
      }),
    ]);
    if (!role || role.status !== 'ACTIVE') {
      return new Set<string>();
    }
    const excludedCodes = new Set(
      exclusions.map(({ permission }) => permission.code),
    );
    return new Set(
      role.permissions
        .map(({ permission }) => permission.code)
        .filter((code) =>
          isAiReadablePermission(code) && !excludedCodes.has(code)),
    );
  }
}
