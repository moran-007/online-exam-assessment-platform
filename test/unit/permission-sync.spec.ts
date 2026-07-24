import { permissions } from '../../prisma/seed';
import { syncPermissions } from '../../scripts/sync-permissions';

describe('permission catalog synchronization', () => {
  function createClient(superAdminRole: { id: string } | null = { id: 'super-admin-role' }) {
    const tx = {
      permission: {
        upsert: jest.fn().mockResolvedValue(undefined),
        findMany: jest.fn().mockResolvedValue(permissions.map(([code]) => ({ id: `permission:${code}` }))),
      },
      role: {
        findUnique: jest.fn().mockResolvedValue(superAdminRole),
      },
      rolePermission: {
        createMany: jest.fn().mockResolvedValue({ count: permissions.length }),
      },
    };
    const client = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    return { client, tx };
  }

  it('upserts every registered permission and grants all of them to the super administrator', async () => {
    const { client, tx } = createClient();

    await syncPermissions(client as never);

    expect(tx.permission.upsert).toHaveBeenCalledTimes(permissions.length);
    expect(tx.rolePermission.createMany).toHaveBeenCalledWith({
      data: permissions.map(([code]) => ({
        roleId: 'super-admin-role',
        permissionId: `permission:${code}`,
      })),
      skipDuplicates: true,
    });
  });

  it('can initialize the permission catalog before the super administrator role exists', async () => {
    const { client, tx } = createClient(null);

    await syncPermissions(client as never);

    expect(tx.permission.upsert).toHaveBeenCalledTimes(permissions.length);
    expect(tx.rolePermission.createMany).not.toHaveBeenCalled();
  });
});
