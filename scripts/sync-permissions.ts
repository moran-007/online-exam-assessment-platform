import { PermissionType, PrismaClient } from '@prisma/client';
import { permissions } from '../prisma/seed';
import {
  AI_USER_ROLE_CODE,
  AI_USER_ROLE_NAME,
  isAiReadablePermission,
} from '../src/common/security/ai-user-permissions';

type PermissionSyncClient = Pick<
  PrismaClient,
  'permission' | 'role' | 'rolePermission' | 'aiUserPermissionExclusion' | '$transaction'
>;

export async function syncPermissions(prisma: PermissionSyncClient) {
  await prisma.$transaction(async (tx) => {
    for (const [code, name] of permissions) {
      await tx.permission.upsert({
        where: { code },
        update: { name, description: name },
        create: {
          code,
          name,
          description: name,
          type: PermissionType.API,
        },
      });
    }

    const permissionRows = await tx.permission.findMany({ select: { id: true, code: true } });
    const superAdminRole = await tx.role.findUnique({
      where: { code: 'super_admin' },
      select: { id: true },
    });
    if (superAdminRole) {
      await tx.rolePermission.createMany({
        data: permissionRows.map(({ id: permissionId }) => ({
          roleId: superAdminRole.id,
          permissionId,
        })),
        skipDuplicates: true,
      });
    }

    const permissionByCode = new Map(permissionRows.map((permission) => [permission.code, permission]));
    for (const [legacyCode, lessonPlanCode] of [
      ['lesson-record:read', 'lesson-plan:read'],
      ['lesson-record:manage', 'lesson-plan:manage'],
    ] as const) {
      const legacyPermission = permissionByCode.get(legacyCode);
      const lessonPlanPermission = permissionByCode.get(lessonPlanCode);
      if (!legacyPermission || !lessonPlanPermission) continue;
      const legacyAssignments = await tx.rolePermission.findMany({
        where: {
          permissionId: legacyPermission.id,
          role: { code: { not: AI_USER_ROLE_CODE } },
        },
        select: { roleId: true },
      });
      if (legacyAssignments.length) {
        await tx.rolePermission.createMany({
          data: legacyAssignments.map(({ roleId }) => ({
            roleId,
            permissionId: lessonPlanPermission.id,
          })),
          skipDuplicates: true,
        });
      }
    }

    const aiUserRole = await tx.role.upsert({
      where: { code: AI_USER_ROLE_CODE },
      update: {
        name: AI_USER_ROLE_NAME,
        description: 'AI 平台数据只读权限上限；只能由超级管理员验证密码后配置',
        status: 'ACTIVE',
      },
      create: {
        code: AI_USER_ROLE_CODE,
        name: AI_USER_ROLE_NAME,
        description: 'AI 平台数据只读权限上限；只能由超级管理员验证密码后配置',
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    const excludedPermissionIds = new Set(
      (await tx.aiUserPermissionExclusion.findMany({
        select: { permissionId: true },
      })).map(({ permissionId }) => permissionId),
    );
    const readablePermissionRows = permissionRows
      .filter(({ code }) => isAiReadablePermission(code));
    const readablePermissionIds = new Set(readablePermissionRows.map(({ id }) => id));
    await tx.rolePermission.deleteMany({
      where: {
        roleId: aiUserRole.id,
        permissionId: {
          in: permissionRows
            .filter(({ id }) =>
              !readablePermissionIds.has(id) || excludedPermissionIds.has(id))
            .map(({ id }) => id),
        },
      },
    });
    const aiPermissionRows = readablePermissionRows
      .filter(({ id }) => !excludedPermissionIds.has(id));
    if (aiPermissionRows.length) {
      await tx.rolePermission.createMany({
        data: aiPermissionRows.map(({ id: permissionId }) => ({
          roleId: aiUserRole.id,
          permissionId,
        })),
        skipDuplicates: true,
      });
    }
  });
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await syncPermissions(prisma);
    console.log(`权限目录同步完成：${permissions.length} 项；超级管理员已补齐全部权限，AI 用户已补齐新增读取权限。`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
