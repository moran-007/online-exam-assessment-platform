import { PermissionType, PrismaClient } from '@prisma/client';
import { permissions } from '../prisma/seed';

type PermissionSyncClient = Pick<PrismaClient, 'permission' | 'role' | 'rolePermission' | '$transaction'>;

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

    const superAdminRole = await tx.role.findUnique({
      where: { code: 'super_admin' },
      select: { id: true },
    });
    if (!superAdminRole) return;

    const permissionIds = await tx.permission.findMany({ select: { id: true } });
    await tx.rolePermission.createMany({
      data: permissionIds.map(({ id: permissionId }) => ({
        roleId: superAdminRole.id,
        permissionId,
      })),
      skipDuplicates: true,
    });
  });
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await syncPermissions(prisma);
    console.log(`权限目录同步完成：${permissions.length} 项；超级管理员已补齐全部权限。`);
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
